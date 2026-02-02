create or replace function public.get_item_suggested_sell_price(
  p_item_id text,
  p_warehouse_id uuid,
  p_cost_per_unit numeric default null,
  p_margin_pct numeric default null
)
returns table (
  cost_per_unit numeric,
  margin_pct numeric,
  suggested_price numeric
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cost numeric;
  v_margin numeric;
begin
  perform public._require_staff('get_item_suggested_sell_price');

  v_cost := coalesce(p_cost_per_unit, 0);
  if v_cost <= 0 and p_item_id is not null then
    begin
      select coalesce(sm.avg_cost, 0)
      into v_cost
      from public.stock_management sm
      where sm.item_id::text = p_item_id::text
        and (p_warehouse_id is null or sm.warehouse_id = p_warehouse_id)
      order by (sm.warehouse_id = p_warehouse_id) desc, sm.updated_at desc
      limit 1;
    exception when others then
      v_cost := coalesce(p_cost_per_unit, 0);
    end;
  end if;

  v_margin := coalesce(p_margin_pct, 0);
  if v_margin <= 0 then
    v_margin := public._resolve_default_min_margin_pct(p_item_id, p_warehouse_id);
  end if;

  cost_per_unit := public._money_round(greatest(coalesce(v_cost, 0), 0), 6);
  margin_pct := public._money_round(greatest(coalesce(v_margin, 0), 0), 6);
  suggested_price := public._money_round(cost_per_unit * (1 + (margin_pct / 100)));

  return next;
end;
$$;

revoke all on function public.get_item_suggested_sell_price(text, uuid, numeric, numeric) from public;
revoke execute on function public.get_item_suggested_sell_price(text, uuid, numeric, numeric) from anon;
grant execute on function public.get_item_suggested_sell_price(text, uuid, numeric, numeric) to authenticated;

