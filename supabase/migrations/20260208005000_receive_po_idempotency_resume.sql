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
  v_po record;
  v_item jsonb;
  v_item_id text;
  v_qty numeric;
  v_apply_qty numeric;
  v_existing_qty numeric;
  v_unit_cost numeric;
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
    end if;
  end if;

  begin
    v_import_shipment_id := nullif(
      coalesce(
        (p_items->0->>'importShipmentId'),
        (p_items->0->>'shipmentId'),
        (p_items->0->>'import_shipment_id')
      ),
      ''
    )::uuid;
  exception when others then
    v_import_shipment_id := null;
  end;

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

  v_wh := coalesce(v_po.warehouse_id, public._resolve_default_warehouse_id());

  if v_reuse_receipt then
    select pr.warehouse_id, pr.approval_request_id, pr.requires_approval, pr.approval_status
    into v_wh, v_receipt_req_id, v_receipt_requires_approval, v_receipt_approval_status
    from public.purchase_receipts pr
    where pr.id = v_receipt_id;

    if coalesce(v_receipt_requires_approval, false) and coalesce(v_receipt_approval_status, '') <> 'approved' then
      raise exception 'RECEIPT_APPROVAL_PENDING:%', coalesce(v_receipt_req_id::text, '');
    end if;
  end if;

  if v_wh is null then
    v_wh := public._resolve_default_warehouse_id();
  end if;
  if v_wh is null then
    raise exception 'warehouse_id is required';
  end if;

  if to_regclass('public.warehouses') is not null then
    if not exists (select 1 from public.warehouses w where w.id = v_wh and coalesce(w.is_active, true) = true) then
      v_wh := public._resolve_default_warehouse_id();
      if v_wh is null then
        raise exception 'warehouse_id is required';
      end if;
      if v_reuse_receipt then
        update public.purchase_receipts
        set warehouse_id = v_wh,
            updated_at = now()
        where id = v_receipt_id;
      end if;
    end if;
  end if;

  v_payload := jsonb_build_object('purchaseOrderId', p_order_id::text);
  v_payload_hash := encode(digest(convert_to(coalesce(v_payload::text, ''), 'utf8'), 'sha256'::text), 'hex');

  if not v_reuse_receipt then
    v_required_receipt := public.approval_required('receipt', coalesce(v_po.total_amount, 0));
    select ar.id, ar.status
    into v_receipt_req_id, v_receipt_req_status
    from public.approval_requests ar
    where ar.target_table = 'purchase_orders'
      and ar.target_id = p_order_id::text
      and ar.request_type = 'receipt'
      and ar.status in ('approved','pending')
    order by ar.created_at desc
    limit 1;

    if v_receipt_req_id is null then
      select ar.id
      into v_po_req_id
      from public.approval_requests ar
      where ar.target_table = 'purchase_orders'
        and ar.target_id = p_order_id::text
        and ar.request_type = 'po'
        and ar.status = 'approved'
      order by ar.created_at desc
      limit 1;
      if v_po_req_id is not null then
        v_receipt_req_status := 'approved';
      end if;
    end if;

    if v_required_receipt then
      if v_receipt_req_id is null then
        -- إذا كانت موافقة أمر الشراء موجودة مسبقًا نعتبر موافقة الاستلام مُعتمدة
        if v_po_req_id is not null then
          v_receipt_req_id := v_po_req_id;
          v_receipt_req_status := 'approved';
        elsif public.is_owner() then
          insert into public.approval_requests(
            target_table, target_id, request_type, status,
            requested_by, approved_by, approved_at,
            payload_hash
          )
          values (
            'purchase_orders',
            p_order_id::text,
            'receipt',
            'approved',
            auth.uid(),
            auth.uid(),
            now(),
            v_payload_hash
          )
          returning id into v_receipt_req_id;

          insert into public.approval_steps(
            request_id, step_no, approver_role, status, action_by, action_at
          )
          values (v_receipt_req_id, 1, 'manager', 'approved', auth.uid(), now())
          on conflict (request_id, step_no) do nothing;
          v_receipt_req_status := 'approved';
        else
          begin
            v_receipt_req_id := public.create_approval_request(
              'purchase_orders',
              p_order_id::text,
              'receipt',
              coalesce(v_po.total_amount, 0),
              v_payload
            );
            v_receipt_req_status := 'pending';
          exception when others then
            v_receipt_req_id := null;
            v_receipt_req_status := 'pending';
          end;
          -- لا نمنع الاستلام؛ نسجل الاستلام بحالة موافقة "معلق"
        end if;
      elsif v_receipt_req_status <> 'approved' then
        raise exception 'RECEIPT_APPROVAL_PENDING:%', coalesce(v_receipt_req_id::text, '');
      end if;
    end if;

    begin
      insert into public.purchase_receipts(
        purchase_order_id,
        received_at,
        created_by,
        approval_status,
        approval_request_id,
        requires_approval,
        warehouse_id,
        import_shipment_id,
        idempotency_key
      )
      values (
        p_order_id,
        coalesce(p_occurred_at, now()),
        auth.uid(),
        case when coalesce(v_receipt_req_status,'') = 'approved' then 'approved' else 'pending' end,
        v_receipt_req_id,
        v_required_receipt,
        v_wh,
        v_import_shipment_id,
        v_idempotency_key
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
  end if;

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

    if v_item_id is null or v_item_id = '' then
      raise exception 'Invalid itemId';
    end if;
    if v_qty <= 0 then
      continue;
    end if;

    select coalesce(sum(coalesce(pri.quantity, 0)), 0)
    into v_existing_qty
    from public.purchase_receipt_items pri
    where pri.receipt_id = v_receipt_id
      and pri.item_id = v_item_id;

    v_apply_qty := greatest(v_qty - coalesce(v_existing_qty, 0), 0);
    if coalesce(v_apply_qty, 0) <= 0 then
      continue;
    end if;

    select
      coalesce(pi.quantity, 0),
      coalesce(pi.received_quantity, 0),
      coalesce(pi.unit_cost_base, pi.unit_cost, 0)
    into v_ordered, v_received, v_unit_cost
    from public.purchase_items pi
    where pi.purchase_order_id = p_order_id
      and pi.item_id = v_item_id
    for update;
    if not found then
      raise exception 'item % not found in purchase order', v_item_id;
    end if;
    if (v_received + v_apply_qty) > (v_ordered + 1e-9) then
      raise exception 'received exceeds ordered for item %', v_item_id;
    end if;

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
        'supplyTaxCost', v_used_supply_tax_cost
      )
    )
    returning id into v_batch_id;

    if v_qc_status = 'pending' then
      update public.stock_management
      set qc_hold_quantity = coalesce(qc_hold_quantity, 0) + v_apply_qty,
          avg_cost = v_new_avg,
          last_batch_id = v_batch_id,
          last_updated = now(),
          updated_at = now(),
          data = jsonb_set(
            jsonb_set(
              jsonb_set(
                jsonb_set(coalesce(data, '{}'::jsonb), '{availableQuantity}', to_jsonb(coalesce(available_quantity, 0)), true),
                '{qcHoldQuantity}', to_jsonb(coalesce(qc_hold_quantity, 0) + v_apply_qty), true
              ),
              '{avgCost}', to_jsonb(v_new_avg), true
            ),
            '{lastBatchId}', to_jsonb(v_batch_id), true
          )
      where item_id::text = v_item_id
        and warehouse_id = v_wh;
    else
      update public.stock_management
      set available_quantity = coalesce(available_quantity, 0) + v_apply_qty,
          avg_cost = v_new_avg,
          last_batch_id = v_batch_id,
          last_updated = now(),
          updated_at = now(),
          data = jsonb_set(
            jsonb_set(
              jsonb_set(
                jsonb_set(coalesce(data, '{}'::jsonb), '{availableQuantity}', to_jsonb(coalesce(available_quantity, 0) + v_apply_qty), true),
                '{qcHoldQuantity}', to_jsonb(coalesce(qc_hold_quantity, 0)), true
              ),
              '{avgCost}', to_jsonb(v_new_avg), true
            ),
            '{lastBatchId}', to_jsonb(v_batch_id), true
          )
      where item_id::text = v_item_id
        and warehouse_id = v_wh;
    end if;

    update public.purchase_items
    set received_quantity = received_quantity + v_apply_qty
    where purchase_order_id = p_order_id
      and item_id = v_item_id;

    insert into public.purchase_receipt_items(receipt_id, item_id, quantity, unit_cost, total_cost)
    values (v_receipt_id, v_item_id, v_apply_qty, v_effective_unit_cost, (v_apply_qty * v_effective_unit_cost));

    v_receipt_total := v_receipt_total + (v_apply_qty * v_effective_unit_cost);

    insert into public.inventory_movements(
      item_id, movement_type, quantity, unit_cost, total_cost,
      reference_table, reference_id, occurred_at, created_by, data, batch_id, warehouse_id
    )
    values (
      v_item_id, 'purchase_in', v_apply_qty, v_effective_unit_cost, (v_apply_qty * v_effective_unit_cost),
      'purchase_receipts', v_receipt_id::text, coalesce(p_occurred_at, now()), auth.uid(),
      jsonb_build_object('purchaseOrderId', p_order_id, 'purchaseReceiptId', v_receipt_id, 'batchId', v_batch_id, 'expiryDate', v_expiry_iso, 'harvestDate', v_harvest_iso, 'warehouseId', v_wh),
      v_batch_id,
      v_wh
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

  v_required_po := public.approval_required('po', coalesce(v_po.total_amount, 0));
  select ar.id
  into v_po_req_id
  from public.approval_requests ar
  where ar.target_table = 'purchase_orders'
    and ar.target_id = p_order_id::text
    and ar.request_type = 'po'
    and ar.status = 'approved'
  order by ar.created_at desc
  limit 1;

  if v_required_po and v_po_req_id is null and v_all_received then
    if public.is_owner() then
      insert into public.approval_requests(
        target_table, target_id, request_type, status,
        requested_by, approved_by, approved_at,
        payload_hash
      )
      values (
        'purchase_orders',
        p_order_id::text,
        'po',
        'approved',
        auth.uid(),
        auth.uid(),
        now(),
        v_payload_hash
      )
      returning id into v_po_req_id;

      insert into public.approval_steps(
        request_id, step_no, approver_role, status, action_by, action_at
      )
      values (v_po_req_id, 1, 'manager', 'approved', auth.uid(), now())
      on conflict (request_id, step_no) do nothing;

      v_po_approved := true;
    else
      insert into public.approval_requests(
        target_table, target_id, request_type, status,
        requested_by, payload_hash
      )
      values (
        'purchase_orders',
        p_order_id::text,
        'po',
        'pending',
        auth.uid(),
        v_payload_hash
      )
      returning id into v_po_req_id;

      insert into public.approval_steps(
        request_id, step_no, approver_role, status
      )
      values (v_po_req_id, 1, 'manager', 'pending')
      on conflict (request_id, step_no) do nothing;

      v_po_approved := false;
    end if;
  elsif v_po_req_id is not null then
    v_po_approved := true;
  end if;

  if v_all_received then
    if (not v_required_po) or v_po_approved then
      update public.purchase_orders
      set status = 'completed',
          updated_at = now(),
          approval_status = case when v_po_approved then 'approved' else approval_status end,
          approval_request_id = coalesce(approval_request_id, v_po_req_id)
      where id = p_order_id;
    else
      update public.purchase_orders
      set status = 'partial',
          updated_at = now(),
          approval_status = 'pending',
          approval_request_id = coalesce(approval_request_id, v_po_req_id)
      where id = p_order_id;
    end if;
  else
    update public.purchase_orders
    set status = 'partial',
        updated_at = now()
    where id = p_order_id;
  end if;

  return v_receipt_id;
end;
$$;

revoke all on function public.receive_purchase_order_partial(uuid, jsonb, timestamptz) from public;
grant execute on function public.receive_purchase_order_partial(uuid, jsonb, timestamptz) to authenticated;

select pg_sleep(0.5);
notify pgrst, 'reload schema';
