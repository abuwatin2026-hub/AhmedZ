create or replace function public.rebase_purchase_receipt_to_base(p_receipt_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_receipt record;
  v_po record;
  v_wh uuid;
  v_fx numeric;
  v_item record;
  v_prev record;
  v_batch uuid;
  v_removed int := 0;
  v_reposted int := 0;
  v_errors text := '';
begin
  if not (auth.role() = 'service_role' or public.has_admin_permission('accounting.manage')) then
    raise exception 'not authenticated';
  end if;
  if p_receipt_id is null then
    raise exception 'p_receipt_id is required';
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

  v_wh := coalesce(v_receipt.warehouse_id, v_po.warehouse_id, public._resolve_default_warehouse_id());
  if v_wh is null then
    raise exception 'warehouse_id is required';
  end if;

  v_fx := null;
  begin
    v_fx := coalesce(v_po.fx_rate, null);
    if not (v_fx is not null and v_fx > 0) then
      v_fx := public.get_fx_rate(coalesce(v_po.currency,'SAR'), coalesce(v_receipt.received_at, now())::date, 'accounting');
    end if;
  exception when others then
    v_fx := null;
  end;
  if v_fx is null or v_fx <= 0 then
    raise exception 'cannot resolve fx_rate';
  end if;

  for v_item in
    select 
      pri.id as receipt_item_id,
      pri.item_id::text as item_id,
      coalesce(pri.quantity, 0) as quantity,
      coalesce(pi.unit_cost_base, coalesce(pi.unit_cost_foreign, pi.unit_cost, 0) * v_fx, 0) as unit_cost_base,
      coalesce(pri.transport_cost, 0) as transport_cost,
      coalesce(pri.supply_tax_cost, 0) as supply_tax_cost
    from public.purchase_receipt_items pri
    join public.purchase_items pi on pi.purchase_order_id = v_po.id and pi.item_id::text = pri.item_id::text
    where pri.receipt_id = p_receipt_id
  loop
    update public.purchase_receipt_items
    set unit_cost = greatest(0, coalesce(v_item.unit_cost_base, 0) + coalesce(v_item.transport_cost, 0) + coalesce(v_item.supply_tax_cost, 0)),
        total_cost = greatest(0, coalesce(v_item.quantity, 0)) * greatest(0, coalesce(v_item.unit_cost_base, 0) + coalesce(v_item.transport_cost, 0) + coalesce(v_item.supply_tax_cost, 0))
    where id = v_item.receipt_item_id;
  end loop;

  for v_prev in
    select im.id, im.item_id::text as item_id, im.quantity, im.unit_cost, im.warehouse_id
    from public.inventory_movements im
    where im.reference_table = 'purchase_receipts'
      and im.reference_id = p_receipt_id::text
      and im.movement_type = 'purchase_in'
  loop
    begin
      select b.id into v_batch
      from public.batches b
      where b.receipt_id = p_receipt_id
        and b.item_id::text = v_prev.item_id
      order by b.created_at asc
      limit 1;
      insert into public.inventory_movements(
        item_id, movement_type, quantity, unit_cost, total_cost,
        reference_table, reference_id, occurred_at, created_by, data, batch_id, warehouse_id
      )
      values (
        v_prev.item_id,
        'return_out',
        v_prev.quantity,
        v_prev.unit_cost,
        (v_prev.quantity * v_prev.unit_cost),
        'purchase_receipts',
        p_receipt_id::text,
        coalesce(v_receipt.received_at, now()),
        coalesce(v_receipt.created_by, auth.uid()),
        jsonb_build_object('source','rebase_receipt_to_base','reversalOfMovementId', v_prev.id::text),
        v_batch,
        coalesce(v_prev.warehouse_id, v_wh)
      )
      returning id into v_prev.id;
      perform public.post_inventory_movement(v_prev.id);
      v_removed := v_removed + 1;
    exception when others then
      v_errors := left(trim(both from (v_errors || case when v_errors = '' then '' else E'\n' end || sqlerrm)), 2000);
    end;
  end loop;

  for v_item in
    select 
      pri.item_id::text as item_id,
      coalesce(pri.quantity, 0) as quantity,
      greatest(0, coalesce(pri.unit_cost, 0)) as unit_cost
    from public.purchase_receipt_items pri
    where pri.receipt_id = p_receipt_id
      and coalesce(pri.quantity, 0) > 0
  loop
    begin
      insert into public.inventory_movements(
        item_id, movement_type, quantity, unit_cost, total_cost,
        reference_table, reference_id, occurred_at, created_by, data, batch_id, warehouse_id
      )
      values (
        v_item.item_id,
        'purchase_in',
        v_item.quantity,
        v_item.unit_cost,
        (v_item.quantity * v_item.unit_cost),
        'purchase_receipts',
        p_receipt_id::text,
        coalesce(v_receipt.received_at, now()),
        coalesce(v_receipt.created_by, auth.uid()),
        jsonb_build_object('purchaseOrderId', v_po.id, 'purchaseReceiptId', p_receipt_id, 'warehouseId', v_wh),
        gen_random_uuid(),
        v_wh
      )
      returning id into v_prev.id;

      perform public.post_inventory_movement(v_prev.id);
      v_reposted := v_reposted + 1;
    exception when others then
      v_errors := left(trim(both from (v_errors || case when v_errors = '' then '' else E'\n' end || sqlerrm)), 2000);
    end;
  end loop;

  begin
    update public.purchase_receipts
    set posting_status = case when v_errors = '' then 'posted' else 'failed' end,
        posting_error = nullif(v_errors, ''),
        posted_at = case when v_errors = '' then now() else null end
    where id = p_receipt_id;
  exception when others then
    null;
  end;
  begin
    perform public.reconcile_purchase_order_receipt_status(v_receipt.purchase_order_id);
  exception when others then
    null;
  end;

  return jsonb_build_object(
    'status', case when v_errors = '' then 'ok' else 'failed' end,
    'receiptId', p_receipt_id::text,
    'removedMovements', v_removed,
    'repostedMovements', v_reposted,
    'errors', nullif(v_errors, '')
  );
end;
$$;

revoke all on function public.rebase_purchase_receipt_to_base(uuid) from public;
grant execute on function public.rebase_purchase_receipt_to_base(uuid) to authenticated;
