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
