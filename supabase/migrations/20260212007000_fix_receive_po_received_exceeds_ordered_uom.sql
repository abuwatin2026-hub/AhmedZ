set app.allow_ledger_ddl = '1';

do $$
begin
  if to_regprocedure('public._receive_purchase_order_partial_impl(uuid,jsonb,timestamptz)') is null
     and to_regprocedure('public.receive_purchase_order_partial(uuid,jsonb,timestamptz)') is not null
  then
    alter function public.receive_purchase_order_partial(uuid, jsonb, timestamptz)
      rename to _receive_purchase_order_partial_impl;
  end if;
end $$;

create or replace function public._receive_purchase_order_partial_impl(
  p_order_id uuid,
  p_items jsonb,
  p_occurred_at timestamptz default now()
)
returns uuid
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_po record;
  v_item jsonb;
  v_item_id text;
  v_qty numeric;
  v_unit_cost numeric;
  v_existing_qty numeric;
  v_apply_qty numeric;
  v_old_qty numeric;
  v_old_avg numeric;
  v_new_qty numeric;
  v_effective_unit_cost numeric;
  v_new_avg numeric;
  v_receipt_id uuid;
  v_receipt_total numeric := 0;
  v_all_received boolean := true;
  v_ordered numeric;
  v_received numeric;
  v_expiry text;
  v_harvest text;
  v_expiry_iso text;
  v_harvest_iso text;
  v_category text;
  v_is_food boolean;
  v_expiry_required boolean;
  v_batch_id uuid;
  v_movement_id uuid;
  v_wh uuid;
  v_receipt_req_id uuid;
  v_receipt_req_status text;
  v_receipt_requires_approval boolean;
  v_receipt_approval_status text;
  v_po_req_id uuid;
  v_payload jsonb;
  v_payload_hash text;
  v_required_receipt boolean := false;
  v_required_po boolean := false;
  v_po_approved boolean := false;
  v_qc_status text;
  v_transport_cost numeric;
  v_supply_tax_cost numeric;
  v_used_transport_cost numeric;
  v_used_supply_tax_cost numeric;
  v_import_shipment_id uuid;
  v_idempotency_key text;
  v_existing_receipt_id uuid;
  v_reuse_receipt boolean := false;
  v_post_error text := null;
  v_post_failed boolean := false;
  v_post_status text := 'pending';
  v_mark_posted boolean := false;
  v_cost_sum numeric;
  v_remaining_to_allocate numeric;
  v_take_qty numeric;
  v_line_remaining numeric;
  v_pi record;
  v_uom_id uuid;
  v_uom_code text;
  v_qty_base numeric;
begin
  perform public._require_staff('receive_purchase_order_partial');
  if p_order_id is null then
    raise exception 'p_order_id is required';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    raise exception 'p_items must be a json array';
  end if;

  v_idempotency_key := nullif(
    btrim(
      coalesce(
        (p_items->0->>'idempotencyKey'),
        (p_items->0->>'idempotency_key')
      )
    ),
    ''
  );

  perform pg_advisory_xact_lock(hashtext('receive_po:' || p_order_id::text));

  select * into v_po
  from public.purchase_orders
  where id = p_order_id
  for update;
  if not found then
    raise exception 'purchase order not found';
  end if;
  if v_po.status = 'cancelled' then
    raise exception 'cannot receive cancelled purchase order';
  end if;

  begin
    update public.purchase_orders
    set fx_locked = true
    where id = p_order_id
      and coalesce(fx_locked, false) = false;
  exception when undefined_column then
    null;
  end;

  select public._resolve_default_warehouse_id() into v_wh;
  v_wh := coalesce(v_po.warehouse_id, v_wh);
  if v_wh is null then
    raise exception 'warehouse_id is required';
  end if;

  if to_regclass('public.warehouses') is not null then
    if not exists (select 1 from public.warehouses w where w.id = v_wh and coalesce(w.is_active, true) = true) then
      select public._resolve_default_warehouse_id() into v_wh;
      if v_wh is null then
        raise exception 'warehouse_id is required';
      end if;
    end if;
  end if;

  begin
    v_import_shipment_id := nullif(coalesce(p_items->0->>'importShipmentId', p_items->0->>'import_shipment_id'), '')::uuid;
  exception when others then
    v_import_shipment_id := null;
  end;

  v_payload := jsonb_build_object(
    'purchaseOrderId', p_order_id::text,
    'warehouseId', v_wh::text,
    'importShipmentId', case when v_import_shipment_id is null then null else v_import_shipment_id::text end
  );
  v_payload_hash := md5(coalesce(v_payload::text, ''));

  v_required_receipt := false;
  v_receipt_req_id := null;
  v_receipt_req_status := 'approved';
  v_receipt_requires_approval := false;
  v_receipt_approval_status := 'approved';

  begin
    insert into public.purchase_receipts(
      purchase_order_id,
      received_at,
      created_by,
      approval_status,
      approval_request_id,
      requires_approval,
      warehouse_id,
      branch_id,
      company_id,
      import_shipment_id,
      idempotency_key,
      posting_status
    )
    values (
      p_order_id,
      coalesce(p_occurred_at, now()),
      auth.uid(),
      case when v_receipt_req_id is null then 'pending' else 'approved' end,
      v_receipt_req_id,
      v_required_receipt,
      v_wh,
      v_po.branch_id,
      v_po.company_id,
      v_import_shipment_id,
      v_idempotency_key,
      'pending'
    )
    returning id into v_receipt_id;
  exception when unique_violation then
    if v_idempotency_key is not null then
      select pr.id
      into v_existing_receipt_id
      from public.purchase_receipts pr
      where pr.purchase_order_id = p_order_id
        and pr.idempotency_key = v_idempotency_key
      order by pr.created_at desc
      limit 1;
      if v_existing_receipt_id is not null then
        v_receipt_id := v_existing_receipt_id;
        v_reuse_receipt := true;
      else
        raise;
      end if;
    else
      raise;
    end if;
  end;

  for v_item in select value from jsonb_array_elements(p_items)
  loop
    v_item_id := coalesce(v_item->>'itemId', v_item->>'id');
    v_qty := coalesce(nullif(v_item->>'quantity', '')::numeric, 0);
    v_transport_cost := nullif(coalesce(v_item->>'transportCost', v_item->>'transport_cost'), '')::numeric;
    v_supply_tax_cost := nullif(coalesce(v_item->>'supplyTaxCost', v_item->>'supply_tax_cost'), '')::numeric;
    v_expiry := nullif(v_item->>'expiryDate', '');
    v_harvest := nullif(coalesce(v_item->>'harvestDate', v_item->>'productionDate'), '');
    v_expiry_iso := null;
    v_harvest_iso := null;
    v_category := null;

    begin
      v_import_shipment_id := nullif(coalesce(v_item->>'importShipmentId', v_item->>'import_shipment_id'), '')::uuid;
    exception when others then
      v_import_shipment_id := null;
    end;

    if v_item_id is null or v_item_id = '' then
      raise exception 'Invalid itemId';
    end if;
    if v_qty <= 0 then
      continue;
    end if;

    v_uom_id := null;
    begin
      v_uom_id := nullif(coalesce(v_item->>'uomId', v_item->>'uom_id'), '')::uuid;
    exception when others then
      v_uom_id := null;
    end;

    v_uom_code := nullif(btrim(coalesce(v_item->>'uomCode', v_item->>'uom_code', v_item->>'uom', v_item->>'unit', v_item->>'unitType')), '');
    if v_uom_id is null and v_uom_code is not null then
      v_uom_id := public.ensure_uom_code(v_uom_code, null);
    end if;

    if v_uom_id is null then
      select base_uom_id into v_uom_id from public.item_uom where item_id = v_item_id limit 1;
    end if;
    if v_uom_id is null then
      select max(pi.uom_id) into v_uom_id
      from public.purchase_items pi
      where pi.purchase_order_id = p_order_id
        and pi.item_id = v_item_id;
    end if;

    v_qty_base := public.item_qty_to_base(v_item_id, v_qty, v_uom_id);

    select coalesce(sum(coalesce(pri.quantity, 0)), 0)
    into v_existing_qty
    from public.purchase_receipt_items pri
    where pri.receipt_id = v_receipt_id
      and pri.item_id = v_item_id;

    v_apply_qty := greatest(v_qty_base - coalesce(v_existing_qty, 0), 0);
    if coalesce(v_apply_qty, 0) <= 0 then
      continue;
    end if;

    if v_reuse_receipt then
      update public.purchase_receipts
      set posting_status = 'pending',
          posting_error = null,
          posted_at = null,
          branch_id = coalesce(branch_id, v_po.branch_id),
          company_id = coalesce(company_id, v_po.company_id),
          import_shipment_id = coalesce(import_shipment_id, v_import_shipment_id)
      where id = v_receipt_id;
    end if;

    perform 1
    from public.purchase_items pi
    where pi.purchase_order_id = p_order_id
      and pi.item_id = v_item_id
    for update;
    if not found then
      raise exception 'item % not found in purchase order', v_item_id;
    end if;

    select
      coalesce(sum(
        case
          when pi.qty_base is not null then pi.qty_base
          when pi.uom_id is not null then public.item_qty_to_base(pi.item_id, pi.quantity, pi.uom_id)
          else coalesce(pi.quantity, 0)
        end
      ), 0),
      coalesce(sum(coalesce(pi.received_quantity, 0)), 0)
    into v_ordered, v_received
    from public.purchase_items pi
    where pi.purchase_order_id = p_order_id
      and pi.item_id = v_item_id;

    if (v_received + v_apply_qty) > (v_ordered + 1e-9) then
      raise exception 'received exceeds ordered for item %', v_item_id;
    end if;

    v_cost_sum := 0;
    v_remaining_to_allocate := v_apply_qty;
    for v_pi in
      select
        pi.id,
        coalesce(
          pi.qty_base,
          case
            when pi.uom_id is not null then public.item_qty_to_base(pi.item_id, pi.quantity, pi.uom_id)
            else pi.quantity
          end,
          0
        ) as quantity,
        coalesce(pi.received_quantity, 0) as received_quantity,
        coalesce(pi.unit_cost_base, pi.unit_cost, 0) as unit_cost
      from public.purchase_items pi
      where pi.purchase_order_id = p_order_id
        and pi.item_id = v_item_id
      order by pi.created_at asc, pi.id asc
      for update
    loop
      v_line_remaining := greatest(coalesce(v_pi.quantity, 0) - coalesce(v_pi.received_quantity, 0), 0);
      if v_line_remaining <= 0 then
        continue;
      end if;
      v_take_qty := least(v_line_remaining, v_remaining_to_allocate);
      if v_take_qty <= 0 then
        exit;
      end if;

      update public.purchase_items
      set received_quantity = coalesce(received_quantity, 0) + v_take_qty
      where id = v_pi.id;

      v_cost_sum := v_cost_sum + (v_take_qty * coalesce(v_pi.unit_cost, 0));
      v_remaining_to_allocate := v_remaining_to_allocate - v_take_qty;
      exit when v_remaining_to_allocate <= 1e-9;
    end loop;

    if v_remaining_to_allocate > 1e-9 then
      raise exception 'received exceeds ordered for item %', v_item_id;
    end if;

    v_unit_cost := case when v_apply_qty > 0 then (v_cost_sum / v_apply_qty) else 0 end;

    insert into public.stock_management(item_id, warehouse_id, available_quantity, qc_hold_quantity, reserved_quantity, unit, low_stock_threshold, last_updated, data)
    select v_item_id, v_wh, 0, 0, 0, coalesce(mi.unit_type, 'piece'), 5, now(), '{}'::jsonb
    from public.menu_items mi
    where mi.id = v_item_id
    on conflict (item_id, warehouse_id) do nothing;

    select coalesce(sm.available_quantity, 0) + coalesce(sm.qc_hold_quantity, 0), coalesce(sm.avg_cost, 0)
    into v_old_qty, v_old_avg
    from public.stock_management sm
    where sm.item_id::text = v_item_id
      and sm.warehouse_id = v_wh
    for update;

    select
      coalesce(v_transport_cost, coalesce(mi.transport_cost, 0)),
      coalesce(v_supply_tax_cost, coalesce(mi.supply_tax_cost, 0)),
      (v_unit_cost + coalesce(v_transport_cost, coalesce(mi.transport_cost, 0)) + coalesce(v_supply_tax_cost, coalesce(mi.supply_tax_cost, 0))),
      mi.category,
      coalesce(mi.is_food, false),
      coalesce(mi.expiry_required, false)
    into v_used_transport_cost, v_used_supply_tax_cost, v_effective_unit_cost, v_category, v_is_food, v_expiry_required
    from public.menu_items mi
    where mi.id = v_item_id;

    if v_old_qty < 0 then v_old_qty := 0; end if;
    if v_effective_unit_cost < 0 then v_effective_unit_cost := 0; end if;

    v_new_qty := v_old_qty + v_apply_qty;
    v_new_avg := case when v_new_qty > 0 then ((v_old_qty * v_old_avg) + (v_apply_qty * v_effective_unit_cost)) / v_new_qty else v_old_avg end;

    v_is_food := coalesce(v_is_food, (coalesce(v_category,'') = 'food'), false);
    v_expiry_required := coalesce(v_expiry_required, v_is_food, false);

    if v_expiry is not null and v_expiry <> '' then
      if v_expiry ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
        v_expiry_iso := v_expiry;
      else
        raise exception 'invalid expiryDate for item %', v_item_id;
      end if;
    end if;
    if v_harvest is not null and v_harvest ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
      v_harvest_iso := v_harvest;
    end if;

    if v_expiry_required and (v_expiry_iso is null or v_expiry_iso = '') then
      raise exception 'expiryDate is required for food item %', v_item_id;
    end if;

    v_qc_status := case when v_expiry_required then 'pending' else 'released' end;

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
      gen_random_uuid(),
      v_item_id,
      null,
      v_receipt_id,
      v_wh,
      null,
      case when v_harvest_iso is null then null else v_harvest_iso::date end,
      case when v_expiry_iso is null then null else v_expiry_iso::date end,
      v_apply_qty,
      0,
      0,
      v_effective_unit_cost,
      v_qc_status,
      'active',
      jsonb_build_object(
        'purchaseOrderId', p_order_id,
        'purchaseReceiptId', v_receipt_id,
        'expiryDate', v_expiry_iso,
        'harvestDate', v_harvest_iso,
        'warehouseId', v_wh,
        'transportCost', v_used_transport_cost,
        'supplyTaxCost', v_used_supply_tax_cost,
        'importShipmentId', case when v_import_shipment_id is null then null else v_import_shipment_id::text end,
        'trxQty', v_qty,
        'trxUomId', case when v_uom_id is null then null else v_uom_id::text end
      )
    )
    returning id into v_batch_id;

    if v_qc_status = 'pending' then
      update public.stock_management
      set qc_hold_quantity = coalesce(qc_hold_quantity, 0) + v_apply_qty,
          avg_cost = v_new_avg,
          last_batch_id = v_batch_id,
          last_updated = now(),
          updated_at = now()
      where item_id::text = v_item_id
        and warehouse_id = v_wh;
    else
      update public.stock_management
      set available_quantity = coalesce(available_quantity, 0) + v_apply_qty,
          avg_cost = v_new_avg,
          last_batch_id = v_batch_id,
          last_updated = now(),
          updated_at = now()
      where item_id::text = v_item_id
        and warehouse_id = v_wh;
    end if;

    insert into public.purchase_receipt_items(receipt_id, item_id, quantity, unit_cost, total_cost, transport_cost, supply_tax_cost)
    values (v_receipt_id, v_item_id, v_apply_qty, v_effective_unit_cost, (v_apply_qty * v_effective_unit_cost), coalesce(v_used_transport_cost, 0), coalesce(v_used_supply_tax_cost, 0));

    v_receipt_total := v_receipt_total + (v_apply_qty * v_effective_unit_cost);

    insert into public.inventory_movements(
      item_id, movement_type, quantity, unit_cost, total_cost,
      reference_table, reference_id, occurred_at, created_by, data, batch_id, warehouse_id
    )
    values (
      v_item_id, 'purchase_in', v_apply_qty, v_effective_unit_cost, (v_apply_qty * v_effective_unit_cost),
      'purchase_receipts', v_receipt_id::text, coalesce(p_occurred_at, now()), auth.uid(),
      jsonb_build_object(
        'purchaseOrderId', p_order_id,
        'purchaseReceiptId', v_receipt_id,
        'batchId', v_batch_id,
        'expiryDate', v_expiry_iso,
        'harvestDate', v_harvest_iso,
        'warehouseId', v_wh,
        'importShipmentId', case when v_import_shipment_id is null then null else v_import_shipment_id::text end
      ),
      v_batch_id,
      v_wh
    )
    returning id into v_movement_id;

    begin
      perform public.post_inventory_movement(v_movement_id);
      v_mark_posted := true;
    exception when others then
      v_post_failed := true;
      v_post_error := coalesce(v_post_error, sqlerrm);
    end;
  end loop;

  if v_post_failed then
    if v_post_error ~* 'not allowed|not authorized|permission|_require_staff|accounting\\.post' then
      v_post_status := 'pending';
    else
      v_post_status := 'failed';
    end if;
    update public.purchase_receipts
    set posting_status = v_post_status,
        posting_error = left(coalesce(v_post_error, ''), 2000),
        posted_at = null
    where id = v_receipt_id;
  elsif v_mark_posted then
    update public.purchase_receipts
    set posting_status = 'posted',
        posting_error = null,
        posted_at = now()
    where id = v_receipt_id;
  end if;

  for v_item_id, v_ordered, v_received in
    select
      pi.item_id,
      coalesce(
        pi.qty_base,
        case
          when pi.uom_id is not null then public.item_qty_to_base(pi.item_id, pi.quantity, pi.uom_id)
          else pi.quantity
        end,
        0
      ),
      coalesce(pi.received_quantity, 0)
    from public.purchase_items pi
    where pi.purchase_order_id = p_order_id
  loop
    if (v_received + 1e-9) < v_ordered then
      v_all_received := false;
      exit;
    end if;
  end loop;

  v_required_po := false;
  v_po_req_id := null;
  v_po_approved := true;

  if v_all_received then
    update public.purchase_orders
    set status = 'completed',
        updated_at = now(),
        approval_status = case when v_po_approved then 'approved' else approval_status end,
        approval_request_id = coalesce(approval_request_id, v_po_req_id)
    where id = p_order_id;
  else
    update public.purchase_orders
    set status = 'partial',
        updated_at = now()
    where id = p_order_id;
  end if;

  return v_receipt_id;
end;
$$;

create or replace function public.receive_purchase_order_partial(
  p_order_id uuid,
  p_items jsonb,
  p_occurred_at timestamptz default now()
)
returns uuid
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_id uuid;
  v_constraint text;
  v_detail text;
  v_message text;
begin
  v_id := public._receive_purchase_order_partial_impl(p_order_id, p_items, p_occurred_at);
  return v_id;
exception
  when unique_violation then
    get stacked diagnostics
      v_constraint = constraint_name,
      v_detail = pg_exception_detail,
      v_message = message_text;
    raise exception 'DUPLICATE_CONSTRAINT:%:%', coalesce(v_constraint, ''), coalesce(v_detail, v_message, '')
      using errcode = 'P0001';
end;
$$;

revoke all on function public._receive_purchase_order_partial_impl(uuid, jsonb, timestamptz) from public;
revoke all on function public.receive_purchase_order_partial(uuid, jsonb, timestamptz) from public;
grant execute on function public.receive_purchase_order_partial(uuid, jsonb, timestamptz) to authenticated;

notify pgrst, 'reload schema';
