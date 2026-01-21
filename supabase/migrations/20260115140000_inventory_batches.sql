alter table public.inventory_movements
add column if not exists batch_id uuid;
create index if not exists idx_inventory_movements_batch on public.inventory_movements(batch_id);
alter table public.stock_management
add column if not exists last_batch_id uuid;
create or replace function public.receive_purchase_order(p_order_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_po record;
  v_pi record;
  v_old_qty numeric;
  v_old_avg numeric;
  v_new_qty numeric;
  v_effective_unit_cost numeric;
  v_new_avg numeric;
  v_movement_id uuid;
  v_batch_id uuid;
begin
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
  for v_pi in
    select pi.item_id, pi.quantity, pi.unit_cost
    from public.purchase_items pi
    where pi.purchase_order_id = p_order_id
  loop
    v_batch_id := gen_random_uuid();
    insert into public.stock_management(item_id, available_quantity, reserved_quantity, unit, low_stock_threshold, last_updated, data, last_batch_id)
    select v_pi.item_id, 0, 0, coalesce(mi.unit_type, 'piece'), 5, now(), '{}'::jsonb, v_batch_id
    from public.menu_items mi
    where mi.id = v_pi.item_id
    on conflict (item_id) do nothing;
    select coalesce(sm.available_quantity, 0), coalesce(sm.avg_cost, 0)
    into v_old_qty, v_old_avg
    from public.stock_management sm
    where sm.item_id = v_pi.item_id
    for update;
    select (v_pi.unit_cost + coalesce(mi.transport_cost, 0) + coalesce(mi.supply_tax_cost, 0))
    into v_effective_unit_cost
    from public.menu_items mi
    where mi.id = v_pi.item_id;
    v_new_qty := v_old_qty + v_pi.quantity;
    if v_new_qty <= 0 then
      v_new_avg := v_effective_unit_cost;
    else
      v_new_avg := ((v_old_qty * v_old_avg) + (v_pi.quantity * v_effective_unit_cost)) / v_new_qty;
    end if;
    update public.stock_management
    set available_quantity = available_quantity + v_pi.quantity,
        avg_cost = v_new_avg,
        last_updated = now(),
        updated_at = now(),
        last_batch_id = v_batch_id
    where item_id = v_pi.item_id;
    update public.menu_items
    set buying_price = v_pi.unit_cost,
        cost_price = v_new_avg,
        updated_at = now()
    where id = v_pi.item_id;
    insert into public.inventory_movements(
      item_id, movement_type, quantity, unit_cost, total_cost,
      reference_table, reference_id, occurred_at, created_by, data, batch_id
    )
    values (
      v_pi.item_id, 'purchase_in', v_pi.quantity, v_effective_unit_cost, (v_pi.quantity * v_effective_unit_cost),
      'purchase_orders', p_order_id::text, now(), auth.uid(),
      jsonb_build_object(
        'purchaseOrderId', p_order_id,
        'batchId', v_batch_id,
        'supplier_tax_unit', coalesce((select mi.supply_tax_cost from public.menu_items mi where mi.id = v_pi.item_id), 0),
        'supplier_tax_total', coalesce((select mi.supply_tax_cost from public.menu_items mi where mi.id = v_pi.item_id), 0) * v_pi.quantity
      ),
      v_batch_id
    )
    returning id into v_movement_id;
    perform public.post_inventory_movement(v_movement_id);
  end loop;
  update public.purchase_orders
  set status = 'completed',
      updated_at = now()
  where id = p_order_id;
end;
$$;
revoke all on function public.receive_purchase_order(uuid) from public;
grant execute on function public.receive_purchase_order(uuid) to anon, authenticated;
create or replace function public.manage_menu_item_stock(
  p_item_id uuid,
  p_quantity numeric,
  p_unit text,
  p_reason text,
  p_user_id uuid default auth.uid(),
  p_low_stock_threshold numeric default 5,
  p_is_wastage boolean default false,
  p_batch_id uuid default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old_quantity numeric;
  v_old_reserved numeric;
  v_old_avg_cost numeric;
  v_diff numeric;
  v_history_id uuid;
  v_movement_id uuid;
  v_movement_type text;
  v_current_stock record;
begin
  select * into v_current_stock
  from public.stock_management
  where item_id = p_item_id;
  v_old_quantity := coalesce(v_current_stock.available_quantity, 0);
  v_old_reserved := coalesce(v_current_stock.reserved_quantity, 0);
  v_old_avg_cost := coalesce(v_current_stock.avg_cost, 0);
  v_diff := p_quantity - v_old_quantity;
  insert into public.stock_management (
    item_id,
    available_quantity,
    reserved_quantity,
    unit,
    low_stock_threshold,
    avg_cost,
    last_updated,
    updated_at,
    data,
    last_batch_id
  ) values (
    p_item_id,
    p_quantity,
    v_old_reserved,
    p_unit,
    p_low_stock_threshold,
    v_old_avg_cost,
    now(),
    now(),
    coalesce(v_current_stock.data, '{}'::jsonb) || jsonb_build_object(
      'availableQuantity', p_quantity,
      'unit', p_unit,
      'lowStockThreshold', p_low_stock_threshold,
      'lastUpdated', now()
    ),
    p_batch_id
  )
  on conflict (item_id) do update set
    available_quantity = excluded.available_quantity,
    unit = excluded.unit,
    low_stock_threshold = excluded.low_stock_threshold,
    last_updated = excluded.last_updated,
    updated_at = excluded.updated_at,
    data = excluded.data,
    last_batch_id = coalesce(excluded.last_batch_id, public.stock_management.last_batch_id);
  update public.menu_items
  set data = jsonb_set(
    data,
    '{availableStock}',
    to_jsonb(p_quantity)
  ),
  updated_at = now()
  where id = p_item_id::text;
  v_history_id := gen_random_uuid();
  insert into public.stock_history (
    id,
    item_id,
    quantity,
    unit,
    reason,
    date,
    data
  ) values (
    v_history_id,
    p_item_id,
    p_quantity,
    p_unit,
    p_reason,
    now(),
    jsonb_build_object(
      'changedBy', p_user_id,
      'diff', v_diff
    )
  );
  if v_diff <> 0 then
    if p_is_wastage then
        v_movement_type := 'wastage_out';
    elsif v_diff > 0 then
        v_movement_type := 'adjust_in';
    else
        v_movement_type := 'adjust_out';
    end if;
    insert into public.inventory_movements (
      item_id,
      movement_type,
      quantity,
      unit_cost,
      total_cost,
      reference_table,
      reference_id,
      occurred_at,
      created_by,
      data,
      batch_id
    ) values (
      p_item_id,
      v_movement_type,
      abs(v_diff),
      v_old_avg_cost,
      abs(v_diff) * v_old_avg_cost,
      'stock_history',
      v_history_id::text,
      now(),
      p_user_id,
      jsonb_build_object('reason', p_reason, 'fromQuantity', v_old_quantity, 'toQuantity', p_quantity, 'batchId', p_batch_id),
      p_batch_id
    )
    returning id into v_movement_id;
    perform public.post_inventory_movement(v_movement_id);
  end if;
  insert into public.system_audit_logs (
    action,
    module,
    details,
    performed_by,
    performed_at,
    metadata
  ) values (
    case when p_is_wastage then 'wastage_recorded' else 'stock_update' end,
    'stock',
    p_reason,
    p_user_id,
    now(),
    jsonb_build_object(
        'itemId', p_item_id,
        'oldQuantity', v_old_quantity,
        'newQuantity', p_quantity,
        'diff', v_diff,
        'unit', p_unit,
        'batchId', p_batch_id
    )
  );
end;
$$;
revoke all on function public.manage_menu_item_stock(uuid, numeric, text, text, uuid, numeric, boolean, uuid) from public;
grant execute on function public.manage_menu_item_stock(uuid, numeric, text, text, uuid, numeric, boolean, uuid) to anon, authenticated;
create or replace function public.deduct_stock_on_delivery_v2(p_order_id uuid, p_items jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item jsonb;
  v_item_id text;
  v_requested numeric;
  v_available numeric;
  v_reserved numeric;
  v_unit_cost numeric;
  v_total_cost numeric;
  v_movement_id uuid;
  v_batch_id uuid;
  v_item_batch_text text;
begin
  if p_order_id is null then
    raise exception 'p_order_id is required';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    raise exception 'p_items must be a json array';
  end if;
  perform 1
  from public.orders o
  where o.id = p_order_id;
  if not found then
    raise exception 'order not found';
  end if;
  delete from public.order_item_cogs where order_id = p_order_id;
  for v_item in select value from jsonb_array_elements(p_items)
  loop
    v_item_id := coalesce(v_item->>'itemId', v_item->>'id');
    v_requested := coalesce(nullif(v_item->>'quantity', '')::numeric, 0);
    if v_item_id is null or v_item_id = '' then
      raise exception 'Invalid itemId';
    end if;
    if v_requested <= 0 then
      continue;
    end if;
    select
      coalesce(sm.available_quantity, 0),
      coalesce(sm.reserved_quantity, 0),
      coalesce(sm.avg_cost, 0),
      sm.last_batch_id
    into v_available, v_reserved, v_unit_cost, v_batch_id
    from public.stock_management sm
    where sm.item_id = v_item_id
    for update;
    v_item_batch_text := nullif(v_item->>'batchId', '');
    if v_item_batch_text is not null then
      begin
        v_batch_id := v_item_batch_text::uuid;
      exception when others then
        v_batch_id := v_batch_id;
      end;
    end if;
    if v_batch_id is not null then
      select im.unit_cost
      into v_unit_cost
      from public.inventory_movements im
      where im.batch_id = v_batch_id
        and im.movement_type = 'purchase_in'
      order by im.occurred_at asc
      limit 1;
      v_unit_cost := coalesce(v_unit_cost, (select coalesce(sm2.avg_cost, 0) from public.stock_management sm2 where sm2.item_id = v_item_id));
    end if;
    if not found then
      raise exception 'Stock record not found for item %', v_item_id;
    end if;
    if (v_available + 1e-9) < v_requested then
      raise exception 'Insufficient stock for item % (available %, requested %)', v_item_id, v_available, v_requested;
    end if;
    update public.stock_management
    set available_quantity = greatest(0, available_quantity - v_requested),
        reserved_quantity = greatest(0, reserved_quantity - v_requested),
        last_updated = now(),
        updated_at = now()
    where item_id = v_item_id;
    v_total_cost := v_requested * v_unit_cost;
    insert into public.order_item_cogs(order_id, item_id, quantity, unit_cost, total_cost, created_at)
    values (p_order_id, v_item_id, v_requested, v_unit_cost, v_total_cost, now());
    insert into public.inventory_movements(
      item_id, movement_type, quantity, unit_cost, total_cost,
      reference_table, reference_id, occurred_at, created_by, data, batch_id
    )
    values (
      v_item_id, 'sale_out', v_requested, v_unit_cost, v_total_cost,
      'orders', p_order_id::text, now(), auth.uid(), jsonb_build_object('orderId', p_order_id, 'batchId', v_batch_id), v_batch_id
    )
    returning id into v_movement_id;
    perform public.post_inventory_movement(v_movement_id);
  end loop;
end;
$$;
revoke all on function public.deduct_stock_on_delivery_v2(uuid, jsonb) from public;
grant execute on function public.deduct_stock_on_delivery_v2(uuid, jsonb) to anon, authenticated;
