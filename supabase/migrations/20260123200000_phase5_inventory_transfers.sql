do $$
declare
  v_constraint_name text;
begin
  if to_regclass('public.inventory_movements') is not null then
    alter table public.inventory_movements
      drop constraint if exists inventory_movements_movement_type_check;

    select c.conname
    into v_constraint_name
    from pg_constraint c
    join pg_class r on r.oid = c.conrelid
    join pg_namespace n on n.oid = r.relnamespace
    where n.nspname = 'public'
      and r.relname = 'inventory_movements'
      and c.contype = 'c'
      and pg_get_constraintdef(c.oid) ilike '%movement_type%'
      and pg_get_constraintdef(c.oid) ilike '%in (%';

    if v_constraint_name is not null then
      execute format('alter table public.inventory_movements drop constraint %I', v_constraint_name);
    end if;

    alter table public.inventory_movements
      add constraint inventory_movements_movement_type_check
      check (
        movement_type in (
          'purchase_in',
          'sale_out',
          'expired_out',
          'wastage_out',
          'transfer_out',
          'transfer_in',
          'adjust_in',
          'adjust_out',
          'return_in',
          'return_out'
        )
      );
  end if;
end $$;

create table if not exists public.inventory_transfers (
  id uuid primary key default gen_random_uuid(),
  transfer_number text unique not null,
  from_warehouse_id uuid not null references public.warehouses(id),
  to_warehouse_id uuid not null references public.warehouses(id),
  transfer_date date not null default current_date,
  state text not null check (state in ('CREATED','IN_TRANSIT','RECEIVED','CANCELLED')),
  notes text,
  payload jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users(id) on delete set null,
  dispatched_by uuid references auth.users(id) on delete set null,
  received_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  dispatched_at timestamptz,
  received_at timestamptz,
  updated_at timestamptz not null default now(),
  create_idempotency_key text unique,
  dispatch_idempotency_key text unique,
  receive_idempotency_key text unique
);

create index if not exists idx_inventory_transfers_state_date on public.inventory_transfers(state, transfer_date desc);
create index if not exists idx_inventory_transfers_from_to on public.inventory_transfers(from_warehouse_id, to_warehouse_id, created_at desc);

create table if not exists public.inventory_transfer_items (
  id uuid primary key default gen_random_uuid(),
  transfer_id uuid not null references public.inventory_transfers(id) on delete cascade,
  item_id text not null references public.menu_items(id) on delete cascade,
  source_batch_id uuid not null references public.batches(id) on delete restrict,
  quantity numeric not null check (quantity > 0),
  unit_cost numeric not null default 0,
  total_cost numeric not null default 0,
  dispatched_qty numeric not null default 0,
  received_qty numeric not null default 0,
  received_batch_id uuid references public.batches(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_inventory_transfer_items_transfer on public.inventory_transfer_items(transfer_id);
create index if not exists idx_inventory_transfer_items_source_batch on public.inventory_transfer_items(source_batch_id);
create index if not exists idx_inventory_transfer_items_received_batch on public.inventory_transfer_items(received_batch_id);

do $$
begin
  if to_regclass('public.set_updated_at') is not null then
    drop trigger if exists trg_inventory_transfers_updated_at on public.inventory_transfers;
    create trigger trg_inventory_transfers_updated_at
    before update on public.inventory_transfers
    for each row execute function public.set_updated_at();

    drop trigger if exists trg_inventory_transfer_items_updated_at on public.inventory_transfer_items;
    create trigger trg_inventory_transfer_items_updated_at
    before update on public.inventory_transfer_items
    for each row execute function public.set_updated_at();
  end if;
end $$;

alter table public.inventory_transfers enable row level security;
alter table public.inventory_transfer_items enable row level security;

drop policy if exists inventory_transfers_admin_all on public.inventory_transfers;
create policy inventory_transfers_admin_all
on public.inventory_transfers
for all
using (public.is_admin())
with check (public.is_admin());

drop policy if exists inventory_transfer_items_admin_all on public.inventory_transfer_items;
create policy inventory_transfer_items_admin_all
on public.inventory_transfer_items
for all
using (public.is_admin())
with check (public.is_admin());

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
  v_vat_input uuid;
  v_supplier_tax_total numeric;
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

  if v_mv.reference_table = 'production_orders' then
    return;
  end if;

  if v_mv.movement_type in ('transfer_out', 'transfer_in') then
    return;
  end if;

  v_inventory := public.get_account_id_by_code('1410');
  v_cogs := public.get_account_id_by_code('5010');
  v_ap := public.get_account_id_by_code('2010');
  v_shrinkage := public.get_account_id_by_code('5020');
  v_gain := public.get_account_id_by_code('4021');
  v_vat_input := public.get_account_id_by_code('1420');

  v_supplier_tax_total := coalesce(nullif((v_mv.data->>'supplier_tax_total')::numeric, null), 0);

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
    if v_supplier_tax_total > 0 and v_vat_input is not null then
      insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo)
      values
        (v_entry_id, v_inventory, v_mv.total_cost, 0, 'Inventory increase (net)'),
        (v_entry_id, v_vat_input, v_supplier_tax_total, 0, 'VAT recoverable'),
        (v_entry_id, v_ap, 0, v_mv.total_cost + v_supplier_tax_total, 'Supplier payable');
    else
      insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo)
      values
        (v_entry_id, v_inventory, v_mv.total_cost, 0, 'Inventory increase'),
        (v_entry_id, v_ap, 0, v_mv.total_cost, 'Supplier payable');
    end if;
  elsif v_mv.movement_type = 'sale_out' then
    insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo)
    values
      (v_entry_id, v_cogs, v_mv.total_cost, 0, 'COGS'),
      (v_entry_id, v_inventory, 0, v_mv.total_cost, 'Inventory decrease');
  elsif v_mv.movement_type = 'expired_out' then
    insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo)
    values
      (v_entry_id, v_cogs, v_mv.total_cost, 0, 'Expired (COGS)'),
      (v_entry_id, v_inventory, 0, v_mv.total_cost, 'Inventory decrease');
  elsif v_mv.movement_type = 'wastage_out' then
    insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo)
    values
      (v_entry_id, v_cogs, v_mv.total_cost, 0, 'Wastage (COGS)'),
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
  elsif v_mv.movement_type = 'return_out' then
    insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo)
    values
      (v_entry_id, v_ap, v_mv.total_cost, 0, 'Vendor credit'),
      (v_entry_id, v_inventory, 0, v_mv.total_cost, 'Inventory decrease');
  elsif v_mv.movement_type = 'return_in' then
    insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo)
    values
      (v_entry_id, v_inventory, v_mv.total_cost, 0, 'Inventory restore (return)'),
      (v_entry_id, v_cogs, 0, v_mv.total_cost, 'Reverse COGS');
  end if;
end;
$$;

create or replace function public.create_inventory_transfer(
  p_from_warehouse_id uuid,
  p_to_warehouse_id uuid,
  p_items jsonb,
  p_transfer_date date default current_date,
  p_notes text default null,
  p_idempotency_key text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid;
  v_existing_id uuid;
  v_transfer_id uuid;
  v_transfer_number text;
  v_item jsonb;
  v_item_id text;
  v_batch_id text;
  v_qty numeric;
  v_batch record;
begin
  v_actor := auth.uid();
  if not public.is_admin() then
    raise exception 'not allowed';
  end if;

  if p_from_warehouse_id is null or p_to_warehouse_id is null then
    raise exception 'warehouse ids are required';
  end if;
  if p_from_warehouse_id = p_to_warehouse_id then
    raise exception 'from and to warehouses must differ';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    raise exception 'p_items must be a json array';
  end if;

  if p_idempotency_key is not null and btrim(p_idempotency_key) <> '' then
    select it.id
    into v_existing_id
    from public.inventory_transfers it
    where it.create_idempotency_key = p_idempotency_key;
    if found then
      return v_existing_id;
    end if;
  end if;

  v_transfer_id := gen_random_uuid();
  v_transfer_number := 'IT-' || to_char(now(), 'YYYYMMDD-HH24MISS') || '-' || right(v_transfer_id::text, 6);

  insert into public.inventory_transfers(
    id,
    transfer_number,
    from_warehouse_id,
    to_warehouse_id,
    transfer_date,
    state,
    notes,
    payload,
    created_by,
    created_at,
    updated_at,
    create_idempotency_key
  )
  values (
    v_transfer_id,
    v_transfer_number,
    p_from_warehouse_id,
    p_to_warehouse_id,
    coalesce(p_transfer_date, current_date),
    'CREATED',
    p_notes,
    '{}'::jsonb,
    v_actor,
    now(),
    now(),
    nullif(btrim(p_idempotency_key), '')
  );

  for v_item in select value from jsonb_array_elements(p_items)
  loop
    v_item_id := coalesce(v_item->>'itemId', v_item->>'id');
    v_batch_id := nullif(v_item->>'batchId', '');
    v_qty := coalesce(nullif(v_item->>'quantity', '')::numeric, 0);
    if v_item_id is null or v_item_id = '' then
      raise exception 'Invalid itemId';
    end if;
    if v_batch_id is null then
      raise exception 'batchId is required';
    end if;
    if v_qty <= 0 then
      raise exception 'quantity must be > 0';
    end if;

    select b.id, b.item_id, b.warehouse_id, b.unit_cost, b.expiry_date
    into v_batch
    from public.batches b
    where b.id = v_batch_id::uuid
      and b.item_id::text = v_item_id
      and b.warehouse_id = p_from_warehouse_id
    for update;

    if not found then
      raise exception 'Batch % not found in source warehouse', v_batch_id;
    end if;

    insert into public.inventory_transfer_items(
      transfer_id,
      item_id,
      source_batch_id,
      quantity,
      unit_cost,
      total_cost,
      created_at,
      updated_at
    )
    values (
      v_transfer_id,
      v_item_id,
      v_batch.id,
      v_qty,
      coalesce(v_batch.unit_cost, 0),
      v_qty * coalesce(v_batch.unit_cost, 0),
      now(),
      now()
    );
  end loop;

  return v_transfer_id;
end;
$$;

create or replace function public.dispatch_inventory_transfer(
  p_transfer_id uuid,
  p_idempotency_key text default null,
  p_cancel boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid;
  v_transfer record;
  v_item record;
  v_sm record;
  v_reserved_batches jsonb;
  v_reserved_list jsonb;
  v_reserved_sum numeric;
  v_remaining numeric;
  v_expiry_date date;
  v_movement_id uuid;
begin
  v_actor := auth.uid();
  if not public.is_admin() then
    raise exception 'not allowed';
  end if;
  if p_transfer_id is null then
    raise exception 'p_transfer_id is required';
  end if;

  perform pg_advisory_xact_lock(hashtext(p_transfer_id::text));

  select *
  into v_transfer
  from public.inventory_transfers it
  where it.id = p_transfer_id
  for update;

  if not found then
    raise exception 'transfer not found';
  end if;

  if p_idempotency_key is not null and btrim(p_idempotency_key) <> '' then
    if v_transfer.dispatch_idempotency_key is not null and v_transfer.dispatch_idempotency_key = p_idempotency_key then
      return jsonb_build_object('status', v_transfer.state, 'transferId', p_transfer_id::text);
    end if;
  end if;

  if v_transfer.state = 'CANCELLED' then
    return jsonb_build_object('status', 'CANCELLED', 'transferId', p_transfer_id::text);
  end if;

  if p_cancel then
    if v_transfer.state <> 'CREATED' then
      raise exception 'cannot cancel transfer in state %', v_transfer.state;
    end if;
    update public.inventory_transfers
    set state = 'CANCELLED',
        updated_at = now(),
        dispatch_idempotency_key = nullif(btrim(p_idempotency_key), '')
    where id = p_transfer_id;
    return jsonb_build_object('status', 'CANCELLED', 'transferId', p_transfer_id::text);
  end if;

  if v_transfer.state <> 'CREATED' then
    return jsonb_build_object('status', v_transfer.state, 'transferId', p_transfer_id::text);
  end if;

  for v_item in
    select *
    from public.inventory_transfer_items iti
    where iti.transfer_id = p_transfer_id
    order by iti.created_at asc, iti.id asc
  loop
    select *
    into v_sm
    from public.stock_management sm
    where sm.item_id::text = v_item.item_id
      and sm.warehouse_id = v_transfer.from_warehouse_id
    for update;

    if not found then
      raise exception 'Stock record not found for item % in source warehouse', v_item.item_id;
    end if;

    if (coalesce(v_sm.available_quantity,0) - coalesce(v_sm.reserved_quantity,0)) + 1e-9 < v_item.quantity then
      raise exception 'Insufficient non-reserved stock for item % in source warehouse', v_item.item_id;
    end if;

    select
      greatest(coalesce(b.quantity_received,0) - coalesce(b.quantity_consumed,0), 0),
      b.expiry_date
    into v_remaining, v_expiry_date
    from public.batches b
    where b.id = v_item.source_batch_id
      and b.warehouse_id = v_transfer.from_warehouse_id
    for update;

    if not found then
      raise exception 'Batch not found for transfer item';
    end if;

    if v_expiry_date is not null and v_expiry_date < current_date then
      raise exception 'BATCH_EXPIRED';
    end if;

    v_reserved_batches := coalesce(v_sm.data->'reservedBatches', '{}'::jsonb);
    v_reserved_list := v_reserved_batches->(v_item.source_batch_id::text);
    if v_reserved_list is not null then
      v_reserved_list :=
        case
          when jsonb_typeof(v_reserved_list) = 'array' then v_reserved_list
          when jsonb_typeof(v_reserved_list) = 'object' then jsonb_build_array(v_reserved_list)
          else '[]'::jsonb
        end;
      select coalesce(sum(coalesce(nullif(x->>'qty','')::numeric, 0)), 0)
      into v_reserved_sum
      from jsonb_array_elements(v_reserved_list) as x;
      if coalesce(v_reserved_sum,0) > 0 then
        raise exception 'Cannot transfer reserved batch stock';
      end if;
    end if;

    if coalesce(v_remaining,0) + 1e-9 < v_item.quantity then
      raise exception 'Insufficient batch remaining for transfer';
    end if;

    update public.batches
    set quantity_consumed = quantity_consumed + v_item.quantity
    where id = v_item.source_batch_id;

    update public.stock_management
    set available_quantity = greatest(0, available_quantity - v_item.quantity),
        last_updated = now(),
        updated_at = now()
    where item_id::text = v_item.item_id
      and warehouse_id = v_transfer.from_warehouse_id;

    insert into public.inventory_movements(
      item_id, movement_type, quantity, unit_cost, total_cost,
      reference_table, reference_id, occurred_at, created_by, data, batch_id, warehouse_id
    )
    values (
      v_item.item_id,
      'transfer_out',
      v_item.quantity,
      v_item.unit_cost,
      v_item.quantity * v_item.unit_cost,
      'inventory_transfers',
      p_transfer_id::text,
      now(),
      v_actor,
      jsonb_build_object(
        'transferId', p_transfer_id,
        'direction', 'out',
        'fromWarehouseId', v_transfer.from_warehouse_id,
        'toWarehouseId', v_transfer.to_warehouse_id,
        'sourceBatchId', v_item.source_batch_id
      ),
      v_item.source_batch_id,
      v_transfer.from_warehouse_id
    )
    returning id into v_movement_id;

    perform public.post_inventory_movement(v_movement_id);

    update public.inventory_transfer_items
    set dispatched_qty = quantity,
        updated_at = now()
    where id = v_item.id;
  end loop;

  update public.inventory_transfers
  set state = 'IN_TRANSIT',
      dispatched_by = v_actor,
      dispatched_at = now(),
      updated_at = now(),
      dispatch_idempotency_key = nullif(btrim(p_idempotency_key), '')
  where id = p_transfer_id;

  return jsonb_build_object('status', 'IN_TRANSIT', 'transferId', p_transfer_id::text);
end;
$$;

create or replace function public.receive_inventory_transfer(
  p_transfer_id uuid,
  p_idempotency_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid;
  v_transfer record;
  v_item record;
  v_source_batch record;
  v_dest_batch_id uuid;
  v_sm record;
  v_old_qty numeric;
  v_old_avg numeric;
  v_new_qty numeric;
  v_new_avg numeric;
  v_movement_id uuid;
begin
  v_actor := auth.uid();
  if not public.is_admin() then
    raise exception 'not allowed';
  end if;
  if p_transfer_id is null then
    raise exception 'p_transfer_id is required';
  end if;

  perform pg_advisory_xact_lock(hashtext(p_transfer_id::text));

  select *
  into v_transfer
  from public.inventory_transfers it
  where it.id = p_transfer_id
  for update;

  if not found then
    raise exception 'transfer not found';
  end if;

  if p_idempotency_key is not null and btrim(p_idempotency_key) <> '' then
    if v_transfer.receive_idempotency_key is not null and v_transfer.receive_idempotency_key = p_idempotency_key then
      return jsonb_build_object('status', v_transfer.state, 'transferId', p_transfer_id::text);
    end if;
  end if;

  if v_transfer.state = 'RECEIVED' then
    return jsonb_build_object('status', 'RECEIVED', 'transferId', p_transfer_id::text);
  end if;

  if v_transfer.state <> 'IN_TRANSIT' then
    raise exception 'cannot receive transfer in state %', v_transfer.state;
  end if;

  for v_item in
    select *
    from public.inventory_transfer_items iti
    where iti.transfer_id = p_transfer_id
    order by iti.created_at asc, iti.id asc
  loop
    select *
    into v_source_batch
    from public.batches b
    where b.id = v_item.source_batch_id
    for update;

    if not found then
      raise exception 'source batch not found';
    end if;

    v_dest_batch_id := gen_random_uuid();

    insert into public.batches(
      id,
      item_id,
      receipt_item_id,
      receipt_id,
      warehouse_id,
      batch_code,
      production_date,
      expiry_date,
      quantity_received,
      quantity_consumed,
      unit_cost,
      data
    )
    values (
      v_dest_batch_id,
      v_item.item_id,
      null,
      null,
      v_transfer.to_warehouse_id,
      v_source_batch.batch_code,
      v_source_batch.production_date,
      v_source_batch.expiry_date,
      v_item.quantity,
      0,
      v_item.unit_cost,
      jsonb_build_object(
        'source', 'inventory_transfer',
        'transferId', p_transfer_id,
        'sourceBatchId', v_item.source_batch_id,
        'fromWarehouseId', v_transfer.from_warehouse_id
      )
    );

    select coalesce(sm.available_quantity,0), coalesce(sm.avg_cost,0)
    into v_old_qty, v_old_avg
    from public.stock_management sm
    where sm.item_id::text = v_item.item_id
      and sm.warehouse_id = v_transfer.to_warehouse_id
    for update;

    if not found then
      insert into public.stock_management(item_id, warehouse_id, available_quantity, reserved_quantity, unit, low_stock_threshold, avg_cost, last_updated, updated_at, data)
      select mi.id, v_transfer.to_warehouse_id, 0, 0, coalesce(mi.unit_type,'piece'), 5, 0, now(), now(), '{}'::jsonb
      from public.menu_items mi
      where mi.id = v_item.item_id
      on conflict (item_id, warehouse_id) do nothing;

      select coalesce(sm.available_quantity,0), coalesce(sm.avg_cost,0)
      into v_old_qty, v_old_avg
      from public.stock_management sm
      where sm.item_id::text = v_item.item_id
        and sm.warehouse_id = v_transfer.to_warehouse_id
      for update;
    end if;

    v_new_qty := v_old_qty + v_item.quantity;
    if v_new_qty <= 0 then
      v_new_avg := v_item.unit_cost;
    else
      v_new_avg := ((v_old_qty * v_old_avg) + (v_item.quantity * v_item.unit_cost)) / v_new_qty;
    end if;

    update public.stock_management
    set available_quantity = available_quantity + v_item.quantity,
        avg_cost = v_new_avg,
        last_updated = now(),
        updated_at = now()
    where item_id::text = v_item.item_id
      and warehouse_id = v_transfer.to_warehouse_id;

    insert into public.inventory_movements(
      item_id, movement_type, quantity, unit_cost, total_cost,
      reference_table, reference_id, occurred_at, created_by, data, batch_id, warehouse_id
    )
    values (
      v_item.item_id,
      'transfer_in',
      v_item.quantity,
      v_item.unit_cost,
      v_item.quantity * v_item.unit_cost,
      'inventory_transfers',
      p_transfer_id::text,
      now(),
      v_actor,
      jsonb_build_object(
        'transferId', p_transfer_id,
        'direction', 'in',
        'fromWarehouseId', v_transfer.from_warehouse_id,
        'toWarehouseId', v_transfer.to_warehouse_id,
        'sourceBatchId', v_item.source_batch_id
      ),
      v_dest_batch_id,
      v_transfer.to_warehouse_id
    )
    returning id into v_movement_id;

    perform public.post_inventory_movement(v_movement_id);

    update public.inventory_transfer_items
    set received_qty = quantity,
        received_batch_id = v_dest_batch_id,
        updated_at = now()
    where id = v_item.id;
  end loop;

  update public.inventory_transfers
  set state = 'RECEIVED',
      received_by = v_actor,
      received_at = now(),
      updated_at = now(),
      receive_idempotency_key = nullif(btrim(p_idempotency_key), '')
  where id = p_transfer_id;

  return jsonb_build_object('status', 'RECEIVED', 'transferId', p_transfer_id::text);
end;
$$;

revoke all on function public.create_inventory_transfer(uuid, uuid, jsonb, date, text, text) from public;
grant execute on function public.create_inventory_transfer(uuid, uuid, jsonb, date, text, text) to authenticated;
revoke all on function public.dispatch_inventory_transfer(uuid, text, boolean) from public;
grant execute on function public.dispatch_inventory_transfer(uuid, text, boolean) to authenticated;
revoke all on function public.receive_inventory_transfer(uuid, text) from public;
grant execute on function public.receive_inventory_transfer(uuid, text) to authenticated;

create or replace function public.inv_transfer_qty_mismatch()
returns table(
  transfer_id uuid,
  item_id text,
  source_batch_id uuid,
  qty_out numeric,
  qty_in numeric
)
language sql
security definer
set search_path = public
as $$
  with out_mv as (
    select
      im.reference_id::uuid as transfer_id,
      im.item_id,
      im.batch_id as source_batch_id,
      sum(im.quantity) as qty_out
    from public.inventory_movements im
    where im.reference_table = 'inventory_transfers'
      and im.movement_type = 'transfer_out'
    group by 1,2,3
  ),
  in_mv as (
    select
      im.reference_id::uuid as transfer_id,
      im.item_id,
      (im.data->>'sourceBatchId')::uuid as source_batch_id,
      sum(im.quantity) as qty_in
    from public.inventory_movements im
    where im.reference_table = 'inventory_transfers'
      and im.movement_type = 'transfer_in'
      and (im.data ? 'sourceBatchId')
    group by 1,2,3
  )
  select
    coalesce(o.transfer_id, i.transfer_id) as transfer_id,
    coalesce(o.item_id, i.item_id) as item_id,
    coalesce(o.source_batch_id, i.source_batch_id) as source_batch_id,
    coalesce(o.qty_out, 0) as qty_out,
    coalesce(i.qty_in, 0) as qty_in
  from out_mv o
  full join in_mv i
    on i.transfer_id = o.transfer_id
   and i.item_id = o.item_id
   and i.source_batch_id = o.source_batch_id
  where coalesce(o.qty_out, 0) <> coalesce(i.qty_in, 0);
$$;

create or replace function public.inv_transfer_unit_cost_mismatch()
returns table(
  transfer_id uuid,
  item_id text,
  source_batch_id uuid,
  expected_unit_cost numeric,
  source_batch_unit_cost numeric,
  received_batch_unit_cost numeric
)
language sql
security definer
set search_path = public
as $$
  select
    iti.transfer_id,
    iti.item_id,
    iti.source_batch_id,
    iti.unit_cost as expected_unit_cost,
    b_src.unit_cost as source_batch_unit_cost,
    b_dst.unit_cost as received_batch_unit_cost
  from public.inventory_transfer_items iti
  join public.batches b_src on b_src.id = iti.source_batch_id
  left join public.batches b_dst on b_dst.id = iti.received_batch_id
  where b_src.unit_cost is distinct from iti.unit_cost
     or (iti.received_batch_id is not null and b_dst.unit_cost is distinct from iti.unit_cost);
$$;

create or replace function public.inv_transfer_movements_in_cogs()
returns table(
  movement_id uuid,
  movement_type text
)
language sql
security definer
set search_path = public
as $$
  select im.id, im.movement_type
  from public.v_cogs_movements im
  where im.movement_type in ('transfer_out','transfer_in');
$$;

create or replace function public.inv_transfer_batch_lineage_mismatch()
returns table(
  transfer_id uuid,
  item_id text,
  source_batch_id uuid,
  received_batch_id uuid,
  expected_expiry_date date,
  received_expiry_date date
)
language sql
security definer
set search_path = public
as $$
  select
    iti.transfer_id,
    iti.item_id,
    iti.source_batch_id,
    iti.received_batch_id,
    b_src.expiry_date as expected_expiry_date,
    b_dst.expiry_date as received_expiry_date
  from public.inventory_transfer_items iti
  join public.batches b_src on b_src.id = iti.source_batch_id
  join public.batches b_dst on b_dst.id = iti.received_batch_id
  where coalesce((b_dst.data->>'sourceBatchId')::uuid, '00000000-0000-0000-0000-000000000000'::uuid) <> iti.source_batch_id
     or b_dst.expiry_date is distinct from b_src.expiry_date
     or b_dst.unit_cost is distinct from iti.unit_cost;
$$;
