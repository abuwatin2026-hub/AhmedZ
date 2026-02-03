do $$
begin
  if to_regclass('public.purchase_receipts') is not null then
    begin
      alter table public.purchase_receipts add column idempotency_key text;
    exception when duplicate_column then null;
    end;
    begin
      create unique index if not exists uq_purchase_receipts_idempotency
      on public.purchase_receipts(purchase_order_id, idempotency_key)
      where idempotency_key is not null and btrim(idempotency_key) <> '';
    exception when others then null;
    end;
  end if;
end $$;

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
  v_batch_id uuid;
  v_movement_id uuid;
  v_wh uuid;
  v_receipt_req_id uuid;
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

  if v_idempotency_key is not null then
    select pr.id
    into v_existing_receipt_id
    from public.purchase_receipts pr
    where pr.purchase_order_id = p_order_id
      and pr.idempotency_key = v_idempotency_key
    order by pr.created_at desc
    limit 1;
    if v_existing_receipt_id is not null then
      return v_existing_receipt_id;
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
  if v_wh is null then
    raise exception 'warehouse_id is required';
  end if;

  v_payload := jsonb_build_object('purchaseOrderId', p_order_id::text);
  v_payload_hash := encode(digest(convert_to(coalesce(v_payload::text, ''), 'utf8'), 'sha256'::text), 'hex');

  v_required_receipt := public.approval_required('receipt', coalesce(v_po.total_amount, 0));
  select ar.id
  into v_receipt_req_id
  from public.approval_requests ar
  where ar.target_table = 'purchase_orders'
    and ar.target_id = p_order_id::text
    and ar.request_type = 'receipt'
    and ar.status = 'approved'
  order by ar.created_at desc
  limit 1;

  if v_required_receipt and v_receipt_req_id is null then
    if public.is_owner() then
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
    else
      raise exception 'purchase receipt requires approval';
    end if;
  end if;

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
    case when v_receipt_req_id is null then 'pending' else 'approved' end,
    v_receipt_req_id,
    v_required_receipt,
    v_wh,
    v_import_shipment_id,
    v_idempotency_key
  )
  returning id into v_receipt_id;

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
    if (v_received + v_qty) > (v_ordered + 1e-9) then
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
      mi.category
    into v_used_transport_cost, v_used_supply_tax_cost, v_effective_unit_cost, v_category
    from public.menu_items mi
    where mi.id = v_item_id;

    if v_expiry is not null then
      if left(v_expiry, 10) !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
        raise exception 'expiryDate must be ISO date (YYYY-MM-DD) for item %', v_item_id;
      end if;
      v_expiry_iso := left(v_expiry, 10);
    end if;
    if v_harvest is not null then
      if left(v_harvest, 10) !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
        raise exception 'harvestDate must be ISO date (YYYY-MM-DD) for item %', v_item_id;
      end if;
      v_harvest_iso := left(v_harvest, 10);
    end if;
    if coalesce(v_category, '') = 'food' and v_expiry_iso is null then
      raise exception 'expiryDate is required for food item %', v_item_id;
    end if;

    v_new_qty := v_old_qty + v_qty;
    if v_new_qty <= 0 then
      v_new_avg := v_effective_unit_cost;
    else
      v_new_avg := ((v_old_qty * v_old_avg) + (v_qty * v_effective_unit_cost)) / v_new_qty;
    end if;

    v_batch_id := gen_random_uuid();

    update public.stock_management
    set available_quantity = available_quantity + v_qty,
        avg_cost = v_new_avg,
        last_updated = now(),
        updated_at = now()
    where item_id::text = v_item_id
      and warehouse_id = v_wh;

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
      v_batch_id,
      v_item_id,
      null,
      v_receipt_id,
      v_wh,
      null,
      case when v_harvest_iso is null then null else v_harvest_iso::date end,
      case when v_expiry_iso is null then null else v_expiry_iso::date end,
      v_qty,
      0,
      v_effective_unit_cost,
      jsonb_build_object('source','purchase_receipts','purchaseReceiptId', v_receipt_id, 'purchaseOrderId', p_order_id)
    )
    on conflict (id) do nothing;

    insert into public.batch_balances(item_id, batch_id, warehouse_id, quantity, expiry_date)
    values (v_item_id, v_batch_id, v_wh, v_qty, v_expiry_iso::date)
    on conflict (item_id, batch_id, warehouse_id)
    do update set
      quantity = public.batch_balances.quantity + excluded.quantity,
      expiry_date = coalesce(excluded.expiry_date, public.batch_balances.expiry_date),
      updated_at = now();

    update public.menu_items
    set buying_price = v_unit_cost,
        cost_price = v_new_avg,
        updated_at = now()
    where id = v_item_id;

    update public.purchase_items
    set received_quantity = received_quantity + v_qty
    where purchase_order_id = p_order_id
      and item_id = v_item_id;

    insert into public.purchase_receipt_items(receipt_id, item_id, quantity, unit_cost, total_cost, transport_cost, supply_tax_cost)
    values (
      v_receipt_id,
      v_item_id,
      v_qty,
      v_effective_unit_cost,
      (v_qty * v_effective_unit_cost),
      coalesce(v_used_transport_cost, 0),
      coalesce(v_used_supply_tax_cost, 0)
    );
    v_receipt_total := v_receipt_total + (v_qty * v_effective_unit_cost);

    insert into public.inventory_movements(
      item_id, movement_type, quantity, unit_cost, total_cost,
      reference_table, reference_id, occurred_at, created_by, data, batch_id, warehouse_id
    )
    values (
      v_item_id,
      'purchase_in',
      v_qty,
      v_effective_unit_cost,
      (v_qty * v_effective_unit_cost),
      'purchase_receipts',
      v_receipt_id::text,
      coalesce(p_occurred_at, now()),
      auth.uid(),
      jsonb_build_object(
        'purchaseOrderId', p_order_id,
        'purchaseReceiptId', v_receipt_id,
        'batchId', v_batch_id,
        'expiryDate', v_expiry_iso,
        'harvestDate', v_harvest_iso,
        'warehouseId', v_wh
      ),
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
