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
