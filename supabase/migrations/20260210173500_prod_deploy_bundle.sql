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
  v_doc_type text;
begin
  if not (auth.role() = 'service_role' or public.has_admin_permission('accounting.post') or public.has_admin_permission('accounting.manage')) then
    raise exception 'not allowed';
  end if;
  if p_movement_id is null then
    raise exception 'p_movement_id is required';
  end if;

  select * into v_mv
  from public.inventory_movements im
  where im.id = p_movement_id;
  if not found then
    raise exception 'inventory movement not found';
  end if;

  if v_mv.movement_type = 'sale_out' and v_mv.batch_id is null then
    raise exception 'SALE_OUT_REQUIRES_BATCH';
  end if;

  if v_mv.reference_table = 'production_orders' then
    return;
  end if;

  if exists (
    select 1 from public.journal_entries je
    where je.source_table = 'inventory_movements'
      and je.source_id = v_mv.id::text
      and je.source_event = v_mv.movement_type
  ) then
    return;
  end if;

  v_inventory := public.get_account_id_by_code('1410');
  v_cogs := public.get_account_id_by_code('5010');
  v_ap := public.get_account_id_by_code('2010');
  v_shrinkage := public.get_account_id_by_code('5020');
  v_gain := public.get_account_id_by_code('4021');
  v_vat_input := public.get_account_id_by_code('1420');
  v_supplier_tax_total := coalesce(nullif((v_mv.data->>'supplier_tax_total')::numeric, null), 0);

  if v_mv.movement_type in ('wastage_out','adjust_out') then
    v_doc_type := 'writeoff';
  elsif v_mv.movement_type = 'purchase_in' then
    v_doc_type := 'po';
  elsif v_mv.movement_type in ('return_out','return_in') then
    v_doc_type := 'return';
  else
    v_doc_type := 'inventory';
  end if;

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

  if v_mv.movement_type in ('purchase_in','adjust_in','return_in') then
    insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo)
    values
      (v_entry_id, v_inventory, v_mv.total_cost, 0, 'Inventory increase'),
      (v_entry_id, v_ap, 0, (v_mv.total_cost - v_supplier_tax_total), case when v_doc_type='po' then 'Accounts payable' else 'Vendor credit' end);
    if v_supplier_tax_total > 0 then
      insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo)
      values (v_entry_id, v_vat_input, v_supplier_tax_total, 0, 'VAT input (supplier tax)');
    end if;
  elsif v_mv.movement_type in ('wastage_out','expired_out','adjust_out','return_out') then
    if v_mv.movement_type = 'return_out' then
      insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo)
      values
        (v_entry_id, v_ap, v_mv.total_cost, 0, 'Reverse accounts payable (vendor credit)'),
        (v_entry_id, v_inventory, 0, v_mv.total_cost, 'Inventory decrease');
    else
      insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo)
      values
        (v_entry_id, v_shrinkage, v_mv.total_cost, 0, 'Inventory writeoff'),
        (v_entry_id, v_inventory, 0, v_mv.total_cost, 'Inventory decrease');
    end if;
  elsif v_mv.movement_type = 'sale_out' then
    insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo)
    values
      (v_entry_id, v_cogs, v_mv.total_cost, 0, 'COGS'),
      (v_entry_id, v_inventory, 0, v_mv.total_cost, 'Inventory decrease');
  end if;

  perform public.check_journal_entry_balance(v_entry_id);
end;
$$;

revoke all on function public.post_inventory_movement(uuid) from public;
grant execute on function public.post_inventory_movement(uuid) to authenticated;

create or replace function public.receive_purchase_order(p_order_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_po record;
  v_wh uuid;
  v_fx numeric;
  v_pi record;
  v_old_qty numeric;
  v_old_avg numeric;
  v_new_qty numeric;
  v_new_avg numeric;
  v_unit_cost_base numeric;
  v_effective_unit_cost numeric;
  v_batch_id uuid;
  v_movement_id uuid;
begin
  if p_order_id is null then
    raise exception 'order_id is required';
  end if;

  select *
  into v_po
  from public.purchase_orders po
  where po.id = p_order_id
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

  v_fx := coalesce(v_po.fx_rate, null);
  if not (v_fx is not null and v_fx > 0) then
    v_fx := public.get_fx_rate(coalesce(v_po.currency,'SAR'), coalesce(v_po.created_at, now())::date, 'accounting');
  end if;
  if v_fx is null or v_fx <= 0 then
    raise exception 'cannot resolve fx_rate';
  end if;

  for v_pi in
    select pi.item_id, pi.quantity, pi.unit_cost, pi.unit_cost_base, pi.unit_cost_foreign, pi.transport_cost, pi.supply_tax_cost
    from public.purchase_items pi
    where pi.purchase_order_id = p_order_id
  loop
    select coalesce(sm.available_quantity, 0), coalesce(sm.avg_cost, 0)
    into v_old_qty, v_old_avg
    from public.stock_management sm
    where sm.item_id::text = v_pi.item_id::text
      and sm.warehouse_id = v_wh
    for update;

    v_unit_cost_base := greatest(0, coalesce(v_pi.unit_cost_base, coalesce(v_pi.unit_cost_foreign, v_pi.unit_cost, 0) * v_fx));
    v_effective_unit_cost := greatest(0, v_unit_cost_base + coalesce(v_pi.transport_cost, 0) + coalesce(v_pi.supply_tax_cost, 0));

    v_new_qty := coalesce(v_old_qty, 0) + coalesce(v_pi.quantity, 0);
    if v_new_qty <= 0 then
      v_new_avg := v_effective_unit_cost;
    else
      v_new_avg := ((coalesce(v_old_qty, 0) * coalesce(v_old_avg, 0)) + (coalesce(v_pi.quantity, 0) * v_effective_unit_cost)) / v_new_qty;
    end if;

    update public.stock_management
    set available_quantity = coalesce(available_quantity, 0) + coalesce(v_pi.quantity, 0),
        avg_cost = v_new_avg,
        last_updated = now(),
        updated_at = now()
    where item_id::text = v_pi.item_id::text
      and warehouse_id = v_wh;

    v_batch_id := gen_random_uuid();

    insert into public.batch_balances(item_id, batch_id, warehouse_id, quantity, expiry_date)
    values (v_pi.item_id::text, v_batch_id, v_wh, coalesce(v_pi.quantity, 0), null)
    on conflict (item_id, batch_id, warehouse_id)
    do update set
      quantity = public.batch_balances.quantity + excluded.quantity,
      updated_at = now();

    update public.menu_items
    set buying_price = v_unit_cost_base,
        cost_price = v_new_avg,
        updated_at = now()
    where id = v_pi.item_id;

    insert into public.inventory_movements(
      item_id, movement_type, quantity, unit_cost, total_cost,
      reference_table, reference_id, occurred_at, created_by, data, batch_id, warehouse_id
    )
    values (
      v_pi.item_id, 'purchase_in', coalesce(v_pi.quantity, 0), v_effective_unit_cost, (coalesce(v_pi.quantity, 0) * v_effective_unit_cost),
      'purchase_orders', p_order_id::text, now(), auth.uid(), jsonb_build_object('purchaseOrderId', p_order_id, 'batchId', v_batch_id, 'warehouseId', v_wh),
      v_batch_id, v_wh
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
grant execute on function public.receive_purchase_order(uuid) to authenticated;

create or replace function public.repair_item_batches_pricing(p_item_id text)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count int := 0;
begin
  if nullif(btrim(coalesce(p_item_id, '')), '') is null then
    raise exception 'p_item_id required';
  end if;

  update public.batches
  set
    cost_per_unit = case
      when cost_per_unit <= 0 then coalesce(unit_cost, 0)
      else cost_per_unit
    end,
    min_margin_pct = greatest(0, coalesce(min_margin_pct, 0)),
    min_selling_price = public._money_round(
      case
        when greatest(0, coalesce(min_margin_pct, 0)) > 0 then
          coalesce(case when cost_per_unit > 0 then cost_per_unit else unit_cost end, 0) * (1 + (greatest(0, coalesce(min_margin_pct, 0)) / 100))
        else
          coalesce(case when cost_per_unit > 0 then cost_per_unit else unit_cost end, 0)
      end
    )
  where item_id::text = p_item_id::text
    and coalesce(status, 'active') = 'active';
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.repair_item_batches_pricing(text) from public;
grant execute on function public.repair_item_batches_pricing(text) to authenticated;

create or replace function public.normalize_menu_item_costs()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cnt int := 0;
  v_item record;
  v_last_base numeric;
  v_avg numeric;
begin
  for v_item in
    select mi.id as item_id
    from public.menu_items mi
    where coalesce(mi.status, 'active') = 'active'
  loop
    select
      coalesce(pi.unit_cost_base,
               coalesce(pi.unit_cost_foreign, pi.unit_cost, 0)
                 * coalesce(po.fx_rate, public.get_fx_rate(coalesce(po.currency,'SAR'), coalesce(po.created_at, now())::date, 'accounting')))
    into v_last_base
    from public.purchase_items pi
    join public.purchase_orders po on po.id = pi.purchase_order_id
    where pi.item_id = v_item.item_id
    order by coalesce(po.updated_at, po.created_at) desc
    limit 1;

    if v_last_base is null then
      select im.unit_cost
      into v_last_base
      from public.inventory_movements im
      where im.item_id::text = v_item.item_id::text
        and im.movement_type = 'purchase_in'
      order by im.occurred_at desc
      limit 1;
    end if;

    select sm.avg_cost
    into v_avg
    from public.stock_management sm
    where sm.item_id::text = v_item.item_id::text
    order by sm.updated_at desc
    limit 1;

    update public.menu_items
    set buying_price = public._money_round(greatest(0, coalesce(v_last_base, buying_price))),
        cost_price = public._money_round(greatest(0, coalesce(v_avg, coalesce(v_last_base, cost_price)))),
        updated_at = now()
    where id = v_item.item_id;
    v_cnt := v_cnt + 1;
  end loop;

  return v_cnt;
end;
$$;

revoke all on function public.normalize_menu_item_costs() from public;
grant execute on function public.normalize_menu_item_costs() to authenticated;

create or replace function public.repair_all_batches_costs()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cnt int := 0;
begin
  update public.batches
  set cost_per_unit = case
        when coalesce(cost_per_unit, 0) <= 0 then coalesce(unit_cost, 0)
        else cost_per_unit
      end,
      min_margin_pct = greatest(0, coalesce(min_margin_pct, 0)),
      min_selling_price = public._money_round(
        case
          when greatest(0, coalesce(min_margin_pct, 0)) > 0 then coalesce(case when coalesce(cost_per_unit,0) > 0 then cost_per_unit else unit_cost end, 0) * (1 + (greatest(0, coalesce(min_margin_pct, 0)) / 100))
          else coalesce(case when coalesce(cost_per_unit,0) > 0 then cost_per_unit else unit_cost end, 0)
        end
      )
  where coalesce(status, 'active') = 'active';
  get diagnostics v_cnt = row_count;
  return v_cnt;
end;
$$;

revoke all on function public.repair_all_batches_costs() from public;
grant execute on function public.repair_all_batches_costs() to authenticated;

create or replace function public.reclass_return_out_to_ap(p_receipt_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_mv record;
  v_entry uuid;
  v_done int := 0;
begin
  if not (public.has_admin_permission('accounting.manage') and public.has_admin_permission('accounting.approve')) then
    raise exception 'not allowed';
  end if;
  if p_receipt_id is null then
    raise exception 'p_receipt_id required';
  end if;

  for v_mv in
    select im.id, im.total_cost
    from public.inventory_movements im
    where im.reference_table = 'purchase_receipts'
      and im.reference_id = p_receipt_id::text
      and im.movement_type = 'return_out'
  loop
    v_entry := public.create_manual_journal_entry(
      now(),
      concat('Reclass return_out to AP for receipt ', p_receipt_id::text),
      jsonb_build_array(
        jsonb_build_object('accountCode','2010','debit', coalesce(v_mv.total_cost,0)),
        jsonb_build_object('accountCode','5020','credit', coalesce(v_mv.total_cost,0))
      )
    );
    perform public.approve_journal_entry(v_entry);
    v_done := v_done + 1;
  end loop;

  return jsonb_build_object('reclassCount', v_done);
end;
$$;

revoke all on function public.reclass_return_out_to_ap(uuid) from public;
grant execute on function public.reclass_return_out_to_ap(uuid) to authenticated;
