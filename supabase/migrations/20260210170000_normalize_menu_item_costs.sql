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
