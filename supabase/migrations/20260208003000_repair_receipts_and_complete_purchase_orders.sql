create or replace function public.repair_purchase_receipt_stock(p_receipt_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_receipt record;
  v_po record;
  v_wh uuid;
  v_main uuid;
  v_has_movements boolean;
  v_has_batches boolean;
  v_items_fixed int := 0;
  v_items_skipped int := 0;
  v_item record;
  v_old_qty numeric;
  v_old_avg numeric;
  v_new_qty numeric;
  v_new_avg numeric;
  v_qty numeric;
  v_unit_cost numeric;
  v_batch_id uuid;
  v_expiry date;
  v_production date;
  v_is_food boolean;
  v_expiry_required boolean;
  v_qc_status text;
  v_status text;
  v_movement_id uuid;
begin
  if p_receipt_id is null then
    raise exception 'p_receipt_id is required';
  end if;

  if not public.can_manage_stock() then
    raise exception 'not allowed';
  end if;

  select *
  into v_receipt
  from public.purchase_receipts pr
  where pr.id = p_receipt_id
  for update;

  if not found then
    raise exception 'purchase receipt not found';
  end if;

  select *
  into v_po
  from public.purchase_orders po
  where po.id = v_receipt.purchase_order_id
  for update;

  if not found then
    raise exception 'purchase order not found';
  end if;

  select public._resolve_default_warehouse_id() into v_main;
  v_wh := coalesce(v_receipt.warehouse_id, v_po.warehouse_id, v_main);
  if v_wh is null then
    raise exception 'warehouse_id is required';
  end if;

  select exists(
    select 1
    from public.inventory_movements im
    where im.reference_table = 'purchase_receipts'
      and im.reference_id = p_receipt_id::text
      and im.movement_type = 'purchase_in'
  )
  into v_has_movements;

  select exists(select 1 from public.batches b where b.receipt_id = p_receipt_id)
  into v_has_batches;

  if coalesce(v_has_movements, false) or coalesce(v_has_batches, false) then
    return jsonb_build_object(
      'status', 'skipped',
      'reason', 'already_has_stock',
      'receiptId', p_receipt_id::text,
      'warehouseId', v_wh::text
    );
  end if;

  for v_item in
    select pri.id as receipt_item_id, pri.item_id::text as item_id, coalesce(pri.quantity, 0) as quantity,
           coalesce(pri.unit_cost, 0) as unit_cost,
           coalesce(pri.transport_cost, 0) as transport_cost,
           coalesce(pri.supply_tax_cost, 0) as supply_tax_cost,
           mi.data as item_data,
           coalesce(mi.is_food, false) as is_food,
           coalesce(mi.expiry_required, false) as expiry_required
    from public.purchase_receipt_items pri
    join public.menu_items mi on mi.id::text = pri.item_id::text
    where pri.receipt_id = p_receipt_id
  loop
    v_qty := coalesce(v_item.quantity, 0);
    if v_qty <= 0 then
      v_items_skipped := v_items_skipped + 1;
      continue;
    end if;

    v_unit_cost := coalesce(v_item.unit_cost, 0) + coalesce(v_item.transport_cost, 0) + coalesce(v_item.supply_tax_cost, 0);

    v_is_food := coalesce(v_item.is_food, false);
    v_expiry_required := coalesce(v_item.expiry_required, v_is_food, false);

    begin
      v_expiry := nullif(coalesce((v_item.item_data->>'expiryDate'), ''), '')::date;
    exception when others then
      v_expiry := null;
    end;
    begin
      v_production := nullif(coalesce((v_item.item_data->>'productionDate'), (v_item.item_data->>'harvestDate'), ''), '')::date;
    exception when others then
      v_production := null;
    end;

    if v_expiry_required and v_expiry is null then
      v_items_skipped := v_items_skipped + 1;
      continue;
    end if;

    v_qc_status := case when v_expiry_required then 'pending' else 'released' end;
    v_status := 'active';

    insert into public.stock_management(item_id, warehouse_id, available_quantity, qc_hold_quantity, reserved_quantity, unit, low_stock_threshold, last_updated, data)
    select v_item.item_id, v_wh, 0, 0, 0, coalesce(mi.unit_type, 'piece'), 5, now(), '{}'::jsonb
    from public.menu_items mi
    where mi.id = v_item.item_id
    on conflict (item_id, warehouse_id) do nothing;

    select coalesce(sm.available_quantity, 0) + coalesce(sm.qc_hold_quantity, 0), coalesce(sm.avg_cost, 0)
    into v_old_qty, v_old_avg
    from public.stock_management sm
    where sm.item_id::text = v_item.item_id::text
      and sm.warehouse_id = v_wh
    for update;

    if v_old_qty < 0 then v_old_qty := 0; end if;
    if v_unit_cost < 0 then v_unit_cost := 0; end if;

    v_new_qty := v_old_qty + v_qty;
    v_new_avg := case when v_new_qty > 0 then ((v_old_qty * v_old_avg) + (v_qty * v_unit_cost)) / v_new_qty else v_old_avg end;

    update public.stock_management
    set available_quantity = available_quantity + v_qty,
        avg_cost = v_new_avg,
        last_updated = now(),
        updated_at = now()
    where item_id::text = v_item.item_id::text
      and warehouse_id = v_wh;

    v_batch_id := gen_random_uuid();

    insert into public.batch_balances(item_id, batch_id, warehouse_id, quantity, expiry_date)
    values (v_item.item_id::text, v_batch_id, v_wh, v_qty, v_expiry)
    on conflict (item_id, batch_id, warehouse_id)
    do update set
      quantity = public.batch_balances.quantity + excluded.quantity,
      expiry_date = coalesce(excluded.expiry_date, public.batch_balances.expiry_date),
      updated_at = now();

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
      qc_status,
      status,
      data
    )
    values (
      v_batch_id,
      v_item.item_id::text,
      v_item.receipt_item_id,
      p_receipt_id,
      v_wh,
      null,
      v_production,
      v_expiry,
      v_qty,
      0,
      0,
      v_unit_cost,
      v_qc_status,
      v_status,
      jsonb_build_object('source', 'repair_purchase_receipt_stock')
    )
    on conflict (id) do nothing;

    update public.menu_items
    set buying_price = greatest(0, v_unit_cost),
        cost_price = greatest(0, v_new_avg),
        updated_at = now()
    where id::text = v_item.item_id::text;

    update public.purchase_items
    set received_quantity = least(coalesce(received_quantity, 0) + v_qty, coalesce(quantity, 0)),
        updated_at = now()
    where purchase_order_id = v_receipt.purchase_order_id
      and item_id::text = v_item.item_id::text;

    insert into public.inventory_movements(
      item_id, movement_type, quantity, unit_cost, total_cost,
      reference_table, reference_id, occurred_at, created_by, data, batch_id, warehouse_id
    )
    values (
      v_item.item_id::text,
      'purchase_in',
      v_qty,
      v_unit_cost,
      (v_qty * v_unit_cost),
      'purchase_receipts',
      p_receipt_id::text,
      coalesce(v_receipt.received_at, now()),
      coalesce(v_receipt.created_by, auth.uid()),
      jsonb_build_object(
        'purchaseOrderId', v_receipt.purchase_order_id::text,
        'purchaseReceiptId', p_receipt_id::text,
        'batchId', v_batch_id::text,
        'warehouseId', v_wh::text,
        'expiryDate', case when v_expiry is null then null else to_char(v_expiry, 'YYYY-MM-DD') end,
        'harvestDate', case when v_production is null then null else to_char(v_production, 'YYYY-MM-DD') end,
        'source', 'repair_purchase_receipt_stock'
      ),
      v_batch_id,
      v_wh
    )
    returning id into v_movement_id;

    begin
      perform public.post_inventory_movement(v_movement_id);
    exception when others then
      null;
    end;

    v_items_fixed := v_items_fixed + 1;
  end loop;

  perform public.reconcile_purchase_order_receipt_status(v_receipt.purchase_order_id);

  return jsonb_build_object(
    'status', 'ok',
    'receiptId', p_receipt_id::text,
    'purchaseOrderId', v_receipt.purchase_order_id::text,
    'warehouseId', v_wh::text,
    'itemsFixed', v_items_fixed,
    'itemsSkipped', v_items_skipped
  );
end;
$$;

revoke all on function public.repair_purchase_receipt_stock(uuid) from public;
grant execute on function public.repair_purchase_receipt_stock(uuid) to authenticated;

create or replace function public.repair_purchase_order(p_order_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_receipt record;
  v_fixed int := 0;
  v_skipped int := 0;
  v_res jsonb;
begin
  if p_order_id is null then
    raise exception 'p_order_id is required';
  end if;
  if not public.can_manage_stock() then
    raise exception 'not allowed';
  end if;

  for v_receipt in
    select pr.id
    from public.purchase_receipts pr
    where pr.purchase_order_id = p_order_id
    order by pr.received_at asc, pr.created_at asc
  loop
    begin
      v_res := public.repair_purchase_receipt_stock(v_receipt.id);
      if coalesce(v_res->>'status','') = 'ok' then
        v_fixed := v_fixed + 1;
      else
        v_skipped := v_skipped + 1;
      end if;
    exception when others then
      v_skipped := v_skipped + 1;
    end;
  end loop;

  perform public.reconcile_purchase_order_receipt_status(p_order_id);
  return jsonb_build_object('purchaseOrderId', p_order_id::text, 'receiptsFixed', v_fixed, 'receiptsSkipped', v_skipped);
end;
$$;

revoke all on function public.repair_purchase_order(uuid) from public;
grant execute on function public.repair_purchase_order(uuid) to authenticated;

create or replace function public.repair_purchase_orders_bulk(p_limit int default 500)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_po_id uuid;
  v_done int := 0;
  v_failed int := 0;
begin
  if not public.can_manage_stock() then
    raise exception 'not allowed';
  end if;

  for v_po_id in
    select po.id
    from public.purchase_orders po
    where po.status in ('draft','partial')
      and po.status is distinct from 'cancelled'
      and exists(select 1 from public.purchase_receipts pr where pr.purchase_order_id = po.id)
    order by po.created_at desc
    limit greatest(coalesce(p_limit, 0), 0)
  loop
    begin
      perform public.repair_purchase_order(v_po_id);
      v_done := v_done + 1;
    exception when others then
      v_failed := v_failed + 1;
    end;
  end loop;

  return jsonb_build_object('processed', v_done, 'failed', v_failed);
end;
$$;

revoke all on function public.repair_purchase_orders_bulk(int) from public;
grant execute on function public.repair_purchase_orders_bulk(int) to authenticated;

do $$
begin
  begin
    perform public.repair_purchase_orders_bulk(2000);
  exception when others then
    null;
  end;
end;
$$;

select pg_sleep(0.5);
notify pgrst, 'reload schema';
