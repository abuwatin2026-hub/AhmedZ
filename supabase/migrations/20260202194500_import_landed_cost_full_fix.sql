do $$
begin
  if to_regclass('public.purchase_receipts') is not null and to_regclass('public.import_shipments') is not null then
    begin
      alter table public.purchase_receipts
        add column import_shipment_id uuid references public.import_shipments(id) on delete set null;
    exception when duplicate_column then
      null;
    end;
    begin
      create index if not exists idx_purchase_receipts_import_shipment on public.purchase_receipts(import_shipment_id);
    exception when others then
      null;
    end;
  end if;
end $$;

do $$
begin
  if to_regclass('public.purchase_receipt_items') is not null then
    begin
      alter table public.purchase_receipt_items
        add column transport_cost numeric not null default 0;
    exception when duplicate_column then
      null;
    end;
    begin
      alter table public.purchase_receipt_items
        add column supply_tax_cost numeric not null default 0;
    exception when duplicate_column then
      null;
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
begin
  perform public._require_staff('receive_purchase_order_partial');
  if p_order_id is null then
    raise exception 'p_order_id is required';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    raise exception 'p_items must be a json array';
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
    import_shipment_id
  )
  values (
    p_order_id,
    coalesce(p_occurred_at, now()),
    auth.uid(),
    case when v_receipt_req_id is null then 'pending' else 'approved' end,
    v_receipt_req_id,
    v_required_receipt,
    v_wh,
    v_import_shipment_id
  )
  returning id into v_receipt_id;

  for v_item in select value from jsonb_array_elements(p_items)
  loop
    v_item_id := coalesce(v_item->>'itemId', v_item->>'id');
    v_qty := coalesce(nullif(v_item->>'quantity', '')::numeric, 0);
    v_unit_cost := coalesce(nullif(v_item->>'unitCost', '')::numeric, 0);
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
      (
        v_unit_cost
        + coalesce(v_transport_cost, coalesce(mi.transport_cost, 0))
        + coalesce(v_supply_tax_cost, coalesce(mi.supply_tax_cost, 0))
      ),
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
    v_qc_status := case when coalesce(v_category,'') = 'food' then 'pending' else 'released' end;

    update public.stock_management
    set available_quantity = available_quantity + (case when v_qc_status = 'released' then v_qty else 0 end),
        qc_hold_quantity = qc_hold_quantity + (case when v_qc_status <> 'released' then v_qty else 0 end),
        avg_cost = v_new_avg,
        last_batch_id = v_batch_id,
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
      qc_status,
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
      v_qc_status,
      jsonb_build_object(
        'source','purchase_receipts',
        'purchaseReceiptId', v_receipt_id,
        'purchaseOrderId', p_order_id,
        'importShipmentId', case when v_import_shipment_id is null then null else v_import_shipment_id::text end
      )
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

    insert into public.purchase_receipt_items(
      receipt_id,
      item_id,
      quantity,
      unit_cost,
      total_cost,
      transport_cost,
      supply_tax_cost
    )
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
      v_item_id, 'purchase_in', v_qty, v_effective_unit_cost, (v_qty * v_effective_unit_cost),
      'purchase_receipts', v_receipt_id::text, coalesce(p_occurred_at, now()), auth.uid(),
      jsonb_build_object(
        'purchaseOrderId', p_order_id,
        'purchaseReceiptId', v_receipt_id,
        'batchId', v_batch_id,
        'expiryDate', v_expiry_iso,
        'harvestDate', v_harvest_iso,
        'warehouseId', v_wh,
        'qcStatus', v_qc_status,
        'transport_unit', coalesce(v_used_transport_cost, 0),
        'transport_total', coalesce(v_used_transport_cost, 0) * v_qty,
        'supplier_tax_unit', coalesce(v_used_supply_tax_cost, 0),
        'supplier_tax_total', coalesce(v_used_supply_tax_cost, 0) * v_qty,
        'importShipmentId', case when v_import_shipment_id is null then null else v_import_shipment_id::text end
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
  if v_po_req_id is not null then
    v_po_approved := true;
  end if;

  if v_required_po and (not v_po_approved) and v_all_received then
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
  end if;

  if v_all_received then
    if v_po_req_id is not null or not v_required_po then
      update public.purchase_orders
      set status = 'completed',
          updated_at = now(),
          approval_status = case when v_po_req_id is not null then 'approved' else approval_status end,
          approval_request_id = coalesce(approval_request_id, v_po_req_id)
      where id = p_order_id;
    else
      update public.purchase_orders
      set status = 'partial',
          updated_at = now()
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

create or replace function public.trg_close_import_shipment()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row record;
  v_im record;
  v_batch record;
  v_out record;
  v_qty_linked numeric;
  v_new_unit numeric;
  v_close_at timestamptz;
  v_total_delta_sold numeric := 0;
  v_total_delta_rem numeric := 0;
  v_delta numeric;
  v_entry_id uuid;
  v_accounts jsonb;
  v_inventory uuid;
  v_cogs uuid;
  v_clearing uuid;
  v_branch uuid;
  v_company uuid;
  v_order_id uuid;
  v_total_delta numeric;
  v_sm_avg numeric;
  v_rem_qty numeric;
begin
  if coalesce(new.status, '') <> 'closed' then
    return new;
  end if;
  if coalesce(old.status, '') = 'closed' then
    return new;
  end if;
  if new.destination_warehouse_id is null then
    raise exception 'destination_warehouse_id is required to close import shipment %', new.id;
  end if;
  if not exists (select 1 from public.purchase_receipts pr where pr.import_shipment_id = new.id) then
    raise exception 'No linked purchase receipts for import shipment %', new.id;
  end if;

  v_close_at := coalesce(new.actual_arrival_date::timestamptz, now());
  perform public.calculate_shipment_landed_cost(new.id);

  for v_row in
    select
      isi.item_id::text as item_id_text,
      coalesce(isi.quantity, 0) as expected_qty
    from public.import_shipments_items isi
    where isi.shipment_id = new.id
  loop
    select coalesce(sum(pri.quantity), 0)
    into v_qty_linked
    from public.purchase_receipt_items pri
    join public.purchase_receipts pr on pr.id = pri.receipt_id
    where pr.import_shipment_id = new.id
      and pr.warehouse_id = new.destination_warehouse_id
      and pri.item_id::text = v_row.item_id_text;

    if abs(coalesce(v_qty_linked, 0) - coalesce(v_row.expected_qty, 0)) > 1e-6 then
      raise exception 'Linked receipt quantity mismatch for item % (expected %, got %)', v_row.item_id_text, v_row.expected_qty, v_qty_linked;
    end if;
  end loop;

  for v_row in
    select
      pr.id as receipt_id,
      pri.id as receipt_item_id,
      pri.item_id::text as item_id_text,
      coalesce(pri.quantity, 0) as qty,
      coalesce(pri.transport_cost, 0) as transport_unit,
      coalesce(pri.supply_tax_cost, 0) as tax_unit,
      coalesce(isi.landing_cost_per_unit, 0) as landed_unit
    from public.purchase_receipts pr
    join public.purchase_receipt_items pri on pri.receipt_id = pr.id
    join public.import_shipments_items isi
      on isi.shipment_id = new.id and isi.item_id::text = pri.item_id::text
    where pr.import_shipment_id = new.id
      and pr.warehouse_id = new.destination_warehouse_id
  loop
    v_new_unit := coalesce(v_row.landed_unit, 0) + coalesce(v_row.transport_unit, 0) + coalesce(v_row.tax_unit, 0);

    select im.*
    into v_im
    from public.inventory_movements im
    where im.reference_table = 'purchase_receipts'
      and im.reference_id = v_row.receipt_id::text
      and im.item_id::text = v_row.item_id_text
      and im.movement_type = 'purchase_in'
    order by im.occurred_at asc
    limit 1
    for update;

    if not found then
      raise exception 'Missing purchase_in movement for receipt % item %', v_row.receipt_id, v_row.item_id_text;
    end if;

    if abs(coalesce(v_im.quantity, 0) - coalesce(v_row.qty, 0)) > 1e-6 then
      raise exception 'Receipt movement quantity mismatch for receipt % item % (receipt %, movement %)',
        v_row.receipt_id, v_row.item_id_text, v_row.qty, v_im.quantity;
    end if;

    select b.* into v_batch
    from public.batches b
    where b.id = v_im.batch_id
    for update;

    if not found then
      raise exception 'Batch not found for movement %', v_im.id;
    end if;

    for v_out in
      select im2.*
      from public.inventory_movements im2
      where im2.batch_id = v_im.batch_id
        and im2.movement_type in ('sale_out','wastage_out','expired_out')
        and im2.occurred_at < v_close_at
      for update
    loop
      v_delta := (v_new_unit - coalesce(v_out.unit_cost, 0)) * coalesce(v_out.quantity, 0);
      v_total_delta_sold := v_total_delta_sold + v_delta;


      if v_out.reference_table = 'orders' then
        begin
          v_order_id := nullif(v_out.reference_id, '')::uuid;
        exception when others then
          v_order_id := null;
        end;

        if v_order_id is not null and to_regclass('public.order_item_cogs') is not null then
          update public.order_item_cogs
          set total_cost = coalesce(total_cost, 0) + v_delta,
              unit_cost = case
                when coalesce(quantity, 0) > 0 then (coalesce(total_cost, 0) + v_delta) / quantity
                else unit_cost
              end
          where order_id = v_order_id
            and item_id::text = v_row.item_id_text;
        end if;
      end if;
    end loop;

    v_rem_qty := greatest(coalesce(v_batch.quantity_received, 0) - coalesce(v_batch.quantity_consumed, 0), 0);
    v_total_delta_rem := v_total_delta_rem + ((v_new_unit - coalesce(v_im.unit_cost, 0)) * v_rem_qty);


    update public.purchase_receipt_items
    set unit_cost = v_new_unit,
        total_cost = coalesce(v_row.qty, 0) * v_new_unit
    where id = v_row.receipt_item_id;

    update public.batches
    set unit_cost = v_new_unit,
        updated_at = now()
    where id = v_batch.id;
  end loop;

  for v_row in
    select distinct pri.item_id::text as item_id_text
    from public.purchase_receipt_items pri
    join public.purchase_receipts pr on pr.id = pri.receipt_id
    where pr.import_shipment_id = new.id
      and pr.warehouse_id = new.destination_warehouse_id
  loop
    select
      case when sum(greatest(coalesce(b.quantity_received,0) - coalesce(b.quantity_consumed,0), 0)) > 0 then
        sum(greatest(coalesce(b.quantity_received,0) - coalesce(b.quantity_consumed,0), 0) * coalesce(b.unit_cost,0))
        / sum(greatest(coalesce(b.quantity_received,0) - coalesce(b.quantity_consumed,0), 0))
      else 0 end
    into v_sm_avg
    from public.batches b
    where b.item_id::text = v_row.item_id_text
      and b.warehouse_id = new.destination_warehouse_id;

    update public.stock_management
    set avg_cost = coalesce(v_sm_avg, 0),
        updated_at = now(),
        last_updated = now()
    where item_id::text = v_row.item_id_text
      and warehouse_id = new.destination_warehouse_id;
  end loop;

  v_total_delta := coalesce(v_total_delta_sold, 0) + coalesce(v_total_delta_rem, 0);
  if abs(coalesce(v_total_delta, 0)) > 1e-6 then
    if exists (
      select 1
      from public.journal_entries je
      where je.source_table = 'import_shipments'
        and je.source_id = new.id::text
        and je.source_event = 'landed_cost_close'
    ) then
      if abs(coalesce(v_total_delta_sold, 0)) > 1e-6 and not exists (
        select 1
        from public.journal_entries je
        where je.source_table = 'import_shipments'
          and je.source_id = new.id::text
          and je.source_event = 'landed_cost_cogs_adjust'
      ) then
        select s.data->'settings'->'accounting_accounts'
        into v_accounts
        from public.app_settings s
        where s.id = 'app';

        if v_accounts is null then
          select s.data->'accounting_accounts'
          into v_accounts
          from public.app_settings s
          where s.id = 'singleton';
        end if;

        v_inventory := null;
        if v_accounts is not null and nullif(v_accounts->>'inventory', '') is not null then
          begin
            v_inventory := (v_accounts->>'inventory')::uuid;
          exception when others then
            v_inventory := public.get_account_id_by_code(v_accounts->>'inventory');
          end;
        end if;
        v_inventory := coalesce(v_inventory, public.get_account_id_by_code('1410'));

        v_cogs := null;
        if v_accounts is not null and nullif(v_accounts->>'cogs', '') is not null then
          begin
            v_cogs := (v_accounts->>'cogs')::uuid;
          exception when others then
            v_cogs := public.get_account_id_by_code(v_accounts->>'cogs');
          end;
        end if;
        v_cogs := coalesce(v_cogs, public.get_account_id_by_code('5010'));

        v_branch := coalesce(public.branch_from_warehouse(new.destination_warehouse_id), public.get_default_branch_id());
        v_company := coalesce(public.company_from_branch(v_branch), public.get_default_company_id());

        insert into public.journal_entries(
          id, source_table, source_id, source_event, entry_date, memo, created_by, branch_id, company_id
        )
        values (
          gen_random_uuid(),
          'import_shipments',
          new.id::text,
          'landed_cost_cogs_adjust',
          v_close_at,
          concat('Import landed cost COGS adjust ', coalesce(new.reference_number, new.id::text)),
          new.created_by,
          v_branch,
          v_company
        )
        returning id into v_entry_id;

        if v_total_delta_sold > 0 then
          insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo)
          values (v_entry_id, v_cogs, v_total_delta_sold, 0, 'Landed cost COGS adjust');
          insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo)
          values (v_entry_id, v_inventory, 0, v_total_delta_sold, 'Landed cost inventory reclass');
        else
          insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo)
          values (v_entry_id, v_cogs, 0, -v_total_delta_sold, 'Landed cost COGS adjust');
          insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo)
          values (v_entry_id, v_inventory, -v_total_delta_sold, 0, 'Landed cost inventory reclass');
        end if;

        perform public.check_journal_entry_balance(v_entry_id);
      end if;
      return new;
    end if;

    select s.data->'settings'->'accounting_accounts'
    into v_accounts
    from public.app_settings s
    where s.id = 'app';

    if v_accounts is null then
      select s.data->'accounting_accounts'
      into v_accounts
      from public.app_settings s
      where s.id = 'singleton';
    end if;

    v_inventory := null;
    if v_accounts is not null and nullif(v_accounts->>'inventory', '') is not null then
      begin
        v_inventory := (v_accounts->>'inventory')::uuid;
      exception when others then
        v_inventory := public.get_account_id_by_code(v_accounts->>'inventory');
      end;
    end if;
    v_inventory := coalesce(v_inventory, public.get_account_id_by_code('1410'));

    v_cogs := null;
    if v_accounts is not null and nullif(v_accounts->>'cogs', '') is not null then
      begin
        v_cogs := (v_accounts->>'cogs')::uuid;
      exception when others then
        v_cogs := public.get_account_id_by_code(v_accounts->>'cogs');
      end;
    end if;
    v_cogs := coalesce(v_cogs, public.get_account_id_by_code('5010'));

    v_clearing := null;
    if v_accounts is not null and nullif(v_accounts->>'landed_cost_clearing', '') is not null then
      begin
        v_clearing := (v_accounts->>'landed_cost_clearing')::uuid;
      exception when others then
        v_clearing := public.get_account_id_by_code(v_accounts->>'landed_cost_clearing');
      end;
    end if;
    v_clearing := coalesce(v_clearing, public.get_account_id_by_code('2060'));

    if v_inventory is null or v_clearing is null or v_cogs is null then
      raise exception 'Missing accounting accounts for import landed cost posting';
    end if;

    v_branch := coalesce(public.branch_from_warehouse(new.destination_warehouse_id), public.get_default_branch_id());
    v_company := coalesce(public.company_from_branch(v_branch), public.get_default_company_id());

    insert into public.journal_entries(
      id, source_table, source_id, source_event, entry_date, memo, created_by, branch_id, company_id
    )
    values (
      gen_random_uuid(),
      'import_shipments',
      new.id::text,
      'landed_cost_close',
      v_close_at,
      concat('Import landed cost adjustment ', coalesce(new.reference_number, new.id::text)),
      new.created_by,
      v_branch,
      v_company
    )
    returning id into v_entry_id;

    if abs(coalesce(v_total_delta_rem, 0)) > 1e-6 then
      if v_total_delta_rem > 0 then
        insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo)
        values (v_entry_id, v_inventory, v_total_delta_rem, 0, 'Landed cost inventory adjustment');
      else
        insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo)
        values (v_entry_id, v_inventory, 0, -v_total_delta_rem, 'Landed cost inventory adjustment');
      end if;
    end if;

    if abs(coalesce(v_total_delta_sold, 0)) > 1e-6 then
      if v_total_delta_sold > 0 then
        insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo)
        values (v_entry_id, v_cogs, v_total_delta_sold, 0, 'Landed cost COGS adjustment');
      else
        insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo)
        values (v_entry_id, v_cogs, 0, -v_total_delta_sold, 'Landed cost COGS adjustment');
      end if;
    end if;

    if v_total_delta > 0 then
      insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo)
      values (v_entry_id, v_clearing, 0, v_total_delta, 'Landed cost clearing');
    else
      insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo)
      values (v_entry_id, v_clearing, -v_total_delta, 0, 'Landed cost clearing');
    end if;

    perform public.check_journal_entry_balance(v_entry_id);
  end if;

  return new;
end;
$$;

revoke all on function public.trg_close_import_shipment() from public;
revoke execute on function public.trg_close_import_shipment() from anon;
revoke execute on function public.trg_close_import_shipment() from authenticated;
grant execute on function public.trg_close_import_shipment() to service_role;

do $$
begin
  if to_regclass('public.import_shipments') is not null then
    drop trigger if exists trg_import_shipment_close on public.import_shipments;
    create trigger trg_import_shipment_close
    after update on public.import_shipments
    for each row
    when (new.status = 'closed' and (old.status is distinct from new.status))
    execute function public.trg_close_import_shipment();
  end if;
end $$;

select pg_sleep(0.5);
notify pgrst, 'reload schema';
