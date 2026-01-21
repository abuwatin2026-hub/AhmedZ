-- Reconcile pending changes to ensure remote DB matches current app expectations
-- This migration is idempotent: uses IF NOT EXISTS and CREATE OR REPLACE

-- Cost breakdown columns on menu_items
alter table public.menu_items
  add column if not exists buying_price numeric default 0;
alter table public.menu_items
  add column if not exists transport_cost numeric default 0;
alter table public.menu_items
  add column if not exists supply_tax_cost numeric default 0;
-- Ensure avg_cost exists on stock_management
alter table public.stock_management
  add column if not exists avg_cost numeric not null default 0;
-- Inventory movements table (safe create)
create table if not exists public.inventory_movements (
  id uuid primary key default gen_random_uuid(),
  item_id text not null references public.menu_items(id) on delete cascade,
  movement_type text not null check (movement_type in ('purchase_in','sale_out','wastage_out','adjust_in','adjust_out','return_in','return_out')),
  quantity numeric not null check (quantity > 0),
  unit_cost numeric not null default 0,
  total_cost numeric not null default 0,
  reference_table text,
  reference_id text,
  occurred_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists idx_inventory_movements_item_date on public.inventory_movements(item_id, occurred_at desc);
create index if not exists idx_inventory_movements_ref on public.inventory_movements(reference_table, reference_id);
alter table public.inventory_movements enable row level security;
drop policy if exists inventory_movements_admin_only on public.inventory_movements;
create policy inventory_movements_admin_only
on public.inventory_movements
for all
using (public.is_admin())
with check (public.is_admin());
-- Purchase receipts/returns tables (safe create)
create table if not exists public.purchase_receipts (
  id uuid primary key default gen_random_uuid(),
  purchase_order_id uuid not null references public.purchase_orders(id) on delete cascade,
  received_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  notes text,
  created_at timestamptz not null default now()
);
create index if not exists idx_purchase_receipts_po on public.purchase_receipts(purchase_order_id, received_at desc);
alter table public.purchase_receipts enable row level security;
drop policy if exists purchase_receipts_admin_only on public.purchase_receipts;
create policy purchase_receipts_admin_only
on public.purchase_receipts
for all
using (public.is_admin())
with check (public.is_admin());
create table if not exists public.purchase_receipt_items (
  id uuid primary key default gen_random_uuid(),
  receipt_id uuid not null references public.purchase_receipts(id) on delete cascade,
  item_id text not null references public.menu_items(id) on delete cascade,
  quantity numeric not null check (quantity > 0),
  unit_cost numeric not null default 0,
  total_cost numeric not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists idx_purchase_receipt_items_receipt on public.purchase_receipt_items(receipt_id);
create index if not exists idx_purchase_receipt_items_item on public.purchase_receipt_items(item_id);
alter table public.purchase_receipt_items enable row level security;
drop policy if exists purchase_receipt_items_admin_only on public.purchase_receipt_items;
create policy purchase_receipt_items_admin_only
on public.purchase_receipt_items
for all
using (public.is_admin())
with check (public.is_admin());
create table if not exists public.purchase_returns (
  id uuid primary key default gen_random_uuid(),
  purchase_order_id uuid not null references public.purchase_orders(id) on delete cascade,
  returned_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  reason text,
  notes text,
  created_at timestamptz not null default now()
);
create index if not exists idx_purchase_returns_po on public.purchase_returns(purchase_order_id, returned_at desc);
alter table public.purchase_returns enable row level security;
drop policy if exists purchase_returns_admin_only on public.purchase_returns;
create policy purchase_returns_admin_only
on public.purchase_returns
for all
using (public.is_admin())
with check (public.is_admin());
create table if not exists public.purchase_return_items (
  id uuid primary key default gen_random_uuid(),
  return_id uuid not null references public.purchase_returns(id) on delete cascade,
  item_id text not null references public.menu_items(id) on delete cascade,
  quantity numeric not null check (quantity > 0),
  unit_cost numeric not null default 0,
  total_cost numeric not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists idx_purchase_return_items_return on public.purchase_return_items(return_id);
create index if not exists idx_purchase_return_items_item on public.purchase_return_items(item_id);
alter table public.purchase_return_items enable row level security;
drop policy if exists purchase_return_items_admin_only on public.purchase_return_items;
create policy purchase_return_items_admin_only
on public.purchase_return_items
for all
using (public.is_admin())
with check (public.is_admin());
-- Re-assert latest post_inventory_movement implementation
create or replace function public.post_inventory_movement(p_movement_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_mv record;
  v_entry_id uuid;
  v_inventory uuid;
  v_cogs uuid;
  v_ap uuid;
  v_shrinkage uuid;
  v_gain uuid;
begin
  if p_movement_id is null then
    raise exception 'p_movement_id is required';
  end if;

  select *
  into v_mv
  from public.inventory_movements im
  where im.id = p_movement_id;

  if not found then
    raise exception 'inventory movement not found';
  end if;

  v_inventory := public.get_account_id_by_code('1410');
  v_cogs := public.get_account_id_by_code('5010');
  v_ap := public.get_account_id_by_code('2010');
  v_shrinkage := public.get_account_id_by_code('5020');
  v_gain := public.get_account_id_by_code('4021');

  insert into public.journal_entries(entry_date, memo, source_table, source_id, source_event, created_by)
  values (
    v_mv.occurred_at,
    concat('Inventory movement ', v_mv.movement_type, ' ', v_mv.item_id),
    'inventory_movements',
    v_mv.id::text,
    v_mv.movement_type,
    v_mv.created_by
  )
  on conflict (source_table, source_id, source_event)
  do update set entry_date = excluded.entry_date, memo = excluded.memo
  returning id into v_entry_id;

  delete from public.journal_lines jl where jl.journal_entry_id = v_entry_id;

  if v_mv.movement_type = 'purchase_in' then
    insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo)
    values
      (v_entry_id, v_inventory, v_mv.total_cost, 0, 'Inventory increase'),
      (v_entry_id, v_ap, 0, v_mv.total_cost, 'Supplier payable');
  elsif v_mv.movement_type = 'sale_out' then
    insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo)
    values
      (v_entry_id, v_cogs, v_mv.total_cost, 0, 'COGS'),
      (v_entry_id, v_inventory, 0, v_mv.total_cost, 'Inventory decrease');
  elsif v_mv.movement_type = 'wastage_out' then
    insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo)
    values
      (v_entry_id, v_shrinkage, v_mv.total_cost, 0, 'Wastage'),
      (v_entry_id, v_inventory, 0, v_mv.total_cost, 'Inventory decrease');
  elsif v_mv.movement_type = 'adjust_out' then
    insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo)
    values
      (v_entry_id, v_shrinkage, v_mv.total_cost, 0, 'Adjustment out'),
      (v_entry_id, v_inventory, 0, v_mv.total_cost, 'Inventory decrease');
  elsif v_mv.movement_type = 'adjust_in' then
    insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo)
    values
      (v_entry_id, v_inventory, v_mv.total_cost, 0, 'Adjustment in'),
      (v_entry_id, v_gain, 0, v_mv.total_cost, 'Inventory gain');
  end if;
end;
$$;
revoke all on function public.post_inventory_movement(uuid) from public;
grant execute on function public.post_inventory_movement(uuid) to anon, authenticated;
-- Re-assert latest receive_purchase_order_partial implementation
create or replace function public.receive_purchase_order_partial(
  p_order_id uuid,
  p_items jsonb,
  p_occurred_at timestamptz default now()
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_po record;
  v_item jsonb;
  v_item_id text;
  v_qty numeric;
  v_unit_cost numeric;
  v_effective_unit_cost numeric;
  v_old_qty numeric;
  v_old_avg numeric;
  v_new_qty numeric;
  v_new_avg numeric;
  v_ordered numeric;
  v_received numeric;
  v_receipt_id uuid;
  v_receipt_total numeric := 0;
  v_movement_id uuid;
  v_all_received boolean := true;
begin
  if not public.is_admin() then
    raise exception 'not allowed';
  end if;

  if p_order_id is null then
    raise exception 'p_order_id is required';
  end if;

  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    raise exception 'p_items must be a json array';
  end if;

  select *
  into v_po
  from public.purchase_orders
  where id = p_order_id
  for update;

  if not found then
    raise exception 'purchase order not found';
  end if;

  if v_po.status = 'cancelled' then
    raise exception 'cannot receive cancelled purchase order';
  end if;

  insert into public.purchase_receipts(purchase_order_id, received_at, created_by)
  values (p_order_id, coalesce(p_occurred_at, now()), auth.uid())
  returning id into v_receipt_id;

  for v_item in select value from jsonb_array_elements(p_items)
  loop
    v_item_id := coalesce(v_item->>'itemId', v_item->>'id');
    v_qty := coalesce(nullif(v_item->>'quantity', '')::numeric, 0);
    v_unit_cost := coalesce(nullif(v_item->>'unitCost', '')::numeric, 0);

    if v_item_id is null or v_item_id = '' then
      raise exception 'Invalid itemId';
    end if;

    if v_qty <= 0 then
      continue;
    end if;

    select coalesce(pi.quantity, 0), coalesce(pi.received_quantity, 0), coalesce(pi.unit_cost, 0)
    into v_ordered, v_received, v_unit_cost
    from public.purchase_items pi
    where pi.purchase_order_id = p_order_id
      and pi.item_id = v_item_id
    for update;

    if not found then
      raise exception 'item % not found in purchase order', v_item_id;
    end if;

    if (v_received + v_qty) > (v_ordered + 1e-9) then
      raise exception 'received exceeds ordered for item % (ordered %, received %, add %)', v_item_id, v_ordered, v_received, v_qty;
    end if;

    insert into public.stock_management(item_id, available_quantity, reserved_quantity, unit, low_stock_threshold, last_updated, data)
    select v_item_id, 0, 0, coalesce(mi.unit_type, 'piece'), 5, now(), '{}'::jsonb
    from public.menu_items mi
    where mi.id = v_item_id
    on conflict (item_id) do nothing;

    select coalesce(sm.available_quantity, 0), coalesce(sm.avg_cost, 0)
    into v_old_qty, v_old_avg
    from public.stock_management sm
    where sm.item_id = v_item_id
    for update;

    select (v_unit_cost + coalesce(mi.transport_cost, 0))
    into v_effective_unit_cost
    from public.menu_items mi
    where mi.id = v_item_id;

    v_new_qty := v_old_qty + v_qty;
    if v_new_qty <= 0 then
      v_new_avg := v_effective_unit_cost;
    else
      v_new_avg := ((v_old_qty * v_old_avg) + (v_qty * v_effective_unit_cost)) / v_new_qty;
    end if;

    update public.stock_management
    set available_quantity = available_quantity + v_qty,
        avg_cost = v_new_avg,
        last_updated = now(),
        updated_at = now()
    where item_id = v_item_id;

    update public.menu_items
    set buying_price = v_unit_cost,
        cost_price = v_new_avg,
        updated_at = now()
    where id = v_item_id;

    update public.purchase_items
    set received_quantity = received_quantity + v_qty
    where purchase_order_id = p_order_id
      and item_id = v_item_id;

    insert into public.purchase_receipt_items(receipt_id, item_id, quantity, unit_cost, total_cost)
    values (v_receipt_id, v_item_id, v_qty, v_effective_unit_cost, (v_qty * v_effective_unit_cost));

    v_receipt_total := v_receipt_total + (v_qty * v_effective_unit_cost);

    insert into public.inventory_movements(
      item_id, movement_type, quantity, unit_cost, total_cost,
      reference_table, reference_id, occurred_at, created_by, data
    )
    values (
      v_item_id, 'purchase_in', v_qty, v_effective_unit_cost, (v_qty * v_effective_unit_cost),
      'purchase_receipts', v_receipt_id::text, coalesce(p_occurred_at, now()), auth.uid(),
      jsonb_build_object(
        'purchaseOrderId', p_order_id,
        'purchaseReceiptId', v_receipt_id,
        'supplier_tax_unit', coalesce((select mi.supply_tax_cost from public.menu_items mi where mi.id = v_item_id), 0),
        'supplier_tax_total', coalesce((select mi.supply_tax_cost from public.menu_items mi where mi.id = v_item_id), 0) * v_qty
      )
    )
    returning id into v_movement_id;

    perform public.post_inventory_movement(v_movement_id);
  end loop;

  for v_item_id, v_ordered, v_received in
    select pi.item_id, coalesce(pi.quantity, 0), coalesce(pi.received_quantity, 0)
    from public.purchase_items pi
    where pi.purchase_order_id = p_order_id
  loop
    if (v_received + 1e-9) < v_ordered then
      v_all_received := false;
      exit;
    end if;
  end loop;

  update public.purchase_orders
  set status = case when v_all_received then 'completed' else 'partial' end,
      updated_at = now()
  where id = p_order_id;

  return v_receipt_id;
end;
$$;
revoke all on function public.receive_purchase_order_partial(uuid, jsonb, timestamptz) from public;
grant execute on function public.receive_purchase_order_partial(uuid, jsonb, timestamptz) to anon, authenticated;
-- Re-assert latest create_purchase_return implementation
create or replace function public.create_purchase_return(
  p_order_id uuid,
  p_items jsonb,
  p_reason text default null,
  p_occurred_at timestamptz default now()
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_po record;
  v_item jsonb;
  v_item_id text;
  v_qty numeric;
  v_unit_cost numeric;
  v_total_cost numeric;
  v_return_total numeric := 0;
  v_new_total numeric;
  v_return_id uuid;
  v_movement_id uuid;
begin
  if not public.is_admin() then
    raise exception 'not allowed';
  end if;

  if p_order_id is null then
    raise exception 'p_order_id is required';
  end if;

  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    raise exception 'p_items must be a json array';
  end if;

  select *
  into v_po
  from public.purchase_orders
  where id = p_order_id
  for update;

  if not found then
    raise exception 'purchase order not found';
  end if;

  if v_po.status = 'cancelled' then
    raise exception 'cannot return for cancelled purchase order';
  end if;

  insert into public.purchase_returns(purchase_order_id, returned_at, created_by, reason)
  values (p_order_id, coalesce(p_occurred_at, now()), auth.uid(), p_reason)
  returning id into v_return_id;

  for v_item in select value from jsonb_array_elements(p_items)
  loop
    v_item_id := coalesce(v_item->>'itemId', v_item->>'id');
    v_qty := coalesce(nullif(v_item->>'quantity', '')::numeric, 0);

    if v_item_id is null or v_item_id = '' then
      raise exception 'Invalid itemId';
    end if;

    if v_qty <= 0 then
      continue;
    end if;

    select coalesce(sm.avg_cost, 0)
    into v_unit_cost
    from public.stock_management sm
    where sm.item_id = v_item_id
    for update;

    if not found then
      raise exception 'Stock record not found for item %', v_item_id;
    end if;

    v_total_cost := v_qty * v_unit_cost;
    v_return_total := v_return_total + v_total_cost;

    update public.stock_management
    set available_quantity = greatest(0, available_quantity - v_qty),
        last_updated = now(),
        updated_at = now()
    where item_id = v_item_id;

    insert into public.purchase_return_items(return_id, item_id, quantity, unit_cost, total_cost)
    values (v_return_id, v_item_id, v_qty, v_unit_cost, v_total_cost);

    insert into public.inventory_movements(
      item_id, movement_type, quantity, unit_cost, total_cost,
      reference_table, reference_id, occurred_at, created_by, data
    )
    values (
      v_item_id, 'return_out', v_qty, v_unit_cost, v_total_cost,
      'purchase_returns', v_return_id::text, coalesce(p_occurred_at, now()), auth.uid(),
      jsonb_build_object('purchaseOrderId', p_order_id, 'purchaseReturnId', v_return_id)
    )
    returning id into v_movement_id;

    perform public.post_inventory_movement(v_movement_id);
  end loop;

  if coalesce(v_po.total_amount, 0) > 0 and v_return_total > 0 then
    v_new_total := greatest(0, coalesce(v_po.total_amount, 0) - v_return_total);
    update public.purchase_orders
    set total_amount = v_new_total,
        paid_amount = least(coalesce(paid_amount, 0), v_new_total),
        updated_at = now()
    where id = p_order_id;
  end if;

  return v_return_id;
end;
$$;
revoke all on function public.create_purchase_return(uuid, jsonb, text, timestamptz) from public;
grant execute on function public.create_purchase_return(uuid, jsonb, text, timestamptz) to anon, authenticated;
