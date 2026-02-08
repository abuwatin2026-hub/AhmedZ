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

    v_expiry := null;
    v_production := null;

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
        'expiryDate', null,
        'harvestDate', null,
        'qcStatus', v_qc_status,
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

select pg_sleep(0.5);
notify pgrst, 'reload schema';
