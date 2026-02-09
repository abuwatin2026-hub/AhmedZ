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
