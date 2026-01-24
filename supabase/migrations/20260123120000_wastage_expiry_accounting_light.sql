-- Wastage & Expiry Accounting Light
-- 1) Add optional warehouse_id to inventory_movements (non-breaking)
alter table public.inventory_movements
add column if not exists warehouse_id uuid;
create index if not exists idx_inventory_movements_warehouse on public.inventory_movements(warehouse_id);

-- 2) Accounting light entries table
create table if not exists public.accounting_light_entries (
  id uuid primary key default gen_random_uuid(),
  entry_type text not null check (entry_type in ('wastage','expiry')),
  item_id text not null,
  warehouse_id uuid,
  batch_id uuid,
  quantity numeric not null check (quantity > 0),
  unit text,
  unit_cost numeric not null default 0,
  total_cost numeric not null default 0,
  occurred_at timestamptz not null default now(),
  debit_account text not null default 'shrinkage',
  credit_account text not null default 'inventory',
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  notes text,
  source_ref text
);
create index if not exists idx_accounting_light_entries_item on public.accounting_light_entries(item_id);
create index if not exists idx_accounting_light_entries_wh on public.accounting_light_entries(warehouse_id);
create index if not exists idx_accounting_light_entries_batch on public.accounting_light_entries(batch_id);
create index if not exists idx_accounting_light_entries_date on public.accounting_light_entries(occurred_at);
alter table public.accounting_light_entries enable row level security;
drop policy if exists accounting_light_entries_admin_only on public.accounting_light_entries;
create policy accounting_light_entries_admin_only
on public.accounting_light_entries
for all
using (public.is_admin())
with check (public.is_admin());

-- 3) RPC: record_wastage_light
create or replace function public.record_wastage_light(
  p_item_id uuid,
  p_warehouse_id uuid,
  p_quantity numeric,
  p_batch_id uuid default null,
  p_unit text default 'piece',
  p_reason text default null,
  p_occurred_at timestamptz default now()
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid;
  v_sm record;
  v_unit_cost numeric;
  v_total_cost numeric;
  v_movement_id uuid;
begin
  v_actor := auth.uid();
  if v_actor is null then
    raise exception 'not authenticated';
  end if;
  if p_item_id is null or p_quantity is null or p_quantity <= 0 then
    raise exception 'invalid params';
  end if;
  if p_warehouse_id is null then
    select w.id into p_warehouse_id
    from public.warehouses w
    where w.is_active = true
    order by (upper(coalesce(w.code, '')) = 'MAIN') desc, w.code asc
    limit 1;
    if p_warehouse_id is null then
      raise exception 'warehouse_id is required';
    end if;
  end if;

  select * into v_sm
  from public.stock_management sm
  where sm.item_id::text = p_item_id::text
    and sm.warehouse_id = p_warehouse_id
  for update;
  if not found then
    raise exception 'stock record not found for item % in warehouse %', p_item_id, p_warehouse_id;
  end if;
  if coalesce(v_sm.available_quantity,0) < p_quantity then
    raise exception 'insufficient stock for wastage (available %, requested %)', v_sm.available_quantity, p_quantity;
  end if;

  v_unit_cost := coalesce(v_sm.avg_cost, 0);
  if p_batch_id is not null then
    select im.unit_cost
    into v_unit_cost
    from public.inventory_movements im
    where im.batch_id = p_batch_id
      and im.movement_type = 'purchase_in'
    order by im.occurred_at asc
    limit 1;
    v_unit_cost := coalesce(v_unit_cost, coalesce(v_sm.avg_cost, 0));
  end if;

  update public.stock_management
  set available_quantity = greatest(0, available_quantity - p_quantity),
      last_updated = now(),
      updated_at = now()
  where item_id::text = p_item_id::text
    and warehouse_id = p_warehouse_id;

  v_total_cost := p_quantity * coalesce(v_unit_cost,0);
  insert into public.inventory_movements(
    item_id, movement_type, quantity, unit_cost, total_cost,
    reference_table, reference_id, occurred_at, created_by, data, batch_id, warehouse_id
  )
  values (
    p_item_id::text, 'wastage_out', p_quantity, coalesce(v_unit_cost,0), v_total_cost,
    'accounting_light_entries', null, coalesce(p_occurred_at, now()), v_actor,
    jsonb_build_object('reason', coalesce(p_reason,''), 'warehouseId', p_warehouse_id, 'batchId', p_batch_id),
    p_batch_id, p_warehouse_id
  )
  returning id into v_movement_id;
  perform public.post_inventory_movement(v_movement_id);

  insert into public.accounting_light_entries(
    entry_type, item_id, warehouse_id, batch_id, quantity, unit, unit_cost, total_cost,
    occurred_at, debit_account, credit_account, created_by, notes, source_ref
  )
  values (
    'wastage', p_item_id::text, p_warehouse_id, p_batch_id, p_quantity, p_unit,
    coalesce(v_unit_cost,0), v_total_cost, coalesce(p_occurred_at, now()),
    'shrinkage', 'inventory', v_actor, p_reason, v_movement_id::text
  );

  insert into public.system_audit_logs(action, module, details, performed_by, performed_at, metadata)
  values ('wastage.recorded', 'stock', coalesce(p_reason,''),
          v_actor, now(),
          jsonb_build_object('itemId', p_item_id, 'warehouseId', p_warehouse_id, 'batchId', p_batch_id, 'quantity', p_quantity, 'unitCost', v_unit_cost));
end;
$$;
revoke all on function public.record_wastage_light(uuid, uuid, numeric, uuid, text, text, timestamptz) from public;
grant execute on function public.record_wastage_light(uuid, uuid, numeric, uuid, text, text, timestamptz) to anon, authenticated;

-- 4) RPC: process_expiry_light (batch-level FEFO expiry to wastage)
create or replace function public.process_expiry_light(
  p_warehouse_id uuid default null,
  p_now timestamptz default now()
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid;
  v_processed integer := 0;
  v_wh uuid;
  v_row record;
  v_remaining numeric;
  v_unit_cost numeric;
  v_movement_id uuid;
begin
  v_actor := auth.uid();
  if v_actor is null then
    raise exception 'not authenticated';
  end if;
  if p_warehouse_id is null then
    select w.id into v_wh
    from public.warehouses w
    where w.is_active = true
    order by (upper(coalesce(w.code, '')) = 'MAIN') desc, w.code asc
    limit 1;
  else
    v_wh := p_warehouse_id;
  end if;
  if v_wh is null then
    raise exception 'warehouse_id is required';
  end if;

  for v_row in
    select
      im.item_id::text as item_id,
      im.batch_id,
      (im.data->>'expiryDate')::date as expiry_date
    from public.inventory_movements im
    where im.movement_type = 'purchase_in'
      and im.batch_id is not null
      and (im.data->>'expiryDate') is not null
      and (im.data->>'expiryDate')::date <= p_now::date
  loop
    select
      coalesce(sum(case when m.movement_type = 'purchase_in' then m.quantity else 0 end),0)
      - coalesce(sum(case when m.movement_type in ('sale_out','wastage_out') then m.quantity else 0 end),0)
    into v_remaining
    from public.inventory_movements m
    where m.batch_id = v_row.batch_id;

    if v_remaining is null or v_remaining <= 0 then
      continue;
    end if;

    select im.unit_cost
    into v_unit_cost
    from public.inventory_movements im
    where im.batch_id = v_row.batch_id
      and im.movement_type = 'purchase_in'
    order by im.occurred_at asc
    limit 1;

    update public.stock_management
    set available_quantity = greatest(0, available_quantity - v_remaining),
        last_updated = now(),
        updated_at = now()
    where item_id::text = v_row.item_id
      and warehouse_id = v_wh;

    insert into public.inventory_movements(
      item_id, movement_type, quantity, unit_cost, total_cost,
      reference_table, reference_id, occurred_at, created_by, data, batch_id, warehouse_id
    )
    values (
      v_row.item_id, 'wastage_out', v_remaining, coalesce(v_unit_cost,0), v_remaining * coalesce(v_unit_cost,0),
      'accounting_light_entries', null, p_now, v_actor,
      jsonb_build_object('reason','expiry','warehouseId', v_wh, 'batchId', v_row.batch_id, 'expiredOn', p_now::date),
      v_row.batch_id, v_wh
    )
    returning id into v_movement_id;
    perform public.post_inventory_movement(v_movement_id);

    insert into public.accounting_light_entries(
      entry_type, item_id, warehouse_id, batch_id, quantity, unit, unit_cost, total_cost,
      occurred_at, debit_account, credit_account, created_by, notes, source_ref
    )
    values (
      'expiry', v_row.item_id, v_wh, v_row.batch_id, v_remaining, null,
      coalesce(v_unit_cost,0), v_remaining * coalesce(v_unit_cost,0), p_now,
      'shrinkage', 'inventory', v_actor, 'expiry', v_movement_id::text
    );

    insert into public.system_audit_logs(action, module, details, performed_by, performed_at, metadata)
    values ('expiry.processed', 'stock', 'batch expired',
            v_actor, now(),
            jsonb_build_object('itemId', v_row.item_id, 'warehouseId', v_wh, 'batchId', v_row.batch_id, 'quantity', v_remaining, 'unitCost', v_unit_cost));

    v_processed := v_processed + 1;
  end loop;

  return v_processed;
end;
$$;
revoke all on function public.process_expiry_light(uuid, timestamptz) from public;
grant execute on function public.process_expiry_light(uuid, timestamptz) to anon, authenticated;

