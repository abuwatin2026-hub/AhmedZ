do $$
begin
  if to_regclass('public.batches') is not null then
    alter table public.batches
      add column if not exists quantity_transferred numeric not null default 0;
  end if;
end $$;

create or replace view public.v_batch_balances as
select
  b.item_id,
  b.id as batch_id,
  b.warehouse_id,
  b.expiry_date,
  greatest(
    coalesce(b.quantity_received,0)
    - coalesce(b.quantity_consumed,0)
    - coalesce(b.quantity_transferred,0),
    0
  ) as remaining_qty
from public.batches b;

drop view if exists public.v_food_batch_balances;
create view public.v_food_batch_balances as
select
  b.item_id,
  b.id as batch_id,
  b.warehouse_id,
  b.expiry_date,
  coalesce(b.quantity_received, 0) as received_qty,
  coalesce(b.quantity_consumed, 0) as consumed_qty,
  greatest(
    coalesce(b.quantity_received,0)
    - coalesce(b.quantity_consumed,0)
    - coalesce(b.quantity_transferred,0),
    0
  ) as remaining_qty
from public.batches b
where b.id is not null;

create or replace function public.inv_transfer_global_qty_invariant()
returns table(item_id text, total_qty numeric)
language sql
security definer
set search_path = public
as $$
  select
    sm.item_id::text,
    sum(sm.available_quantity) as total_qty
  from public.stock_management sm
  group by sm.item_id
  having sum(sm.available_quantity) < 0;
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
      greatest(
        coalesce(b.quantity_received,0)
        - coalesce(b.quantity_consumed,0)
        - coalesce(b.quantity_transferred,0),
        0
      ),
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
    set quantity_transferred = quantity_transferred + v_item.quantity
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
      quantity_transferred,
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

    v_new_avg := v_item.unit_cost;

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
