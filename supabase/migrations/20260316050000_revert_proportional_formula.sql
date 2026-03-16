do $$
declare
  v_def text;
begin
  select pg_get_functiondef(
    'public.get_product_sales_report_v9(timestamp with time zone,timestamp with time zone,uuid,boolean)'::regprocedure
  ) into v_def;

  -- The current formula (proportional refund) is causing massive losses.
  -- Revert to the simple working formula: sum(gross_value * fx_rate_effective)
  -- The original working formula was: sum(case when return_amount > 0 then gross_value * fx else 0)
  -- But the simplest correct formula is: sum(gross_value * fx_rate_effective) [always deduct]
  
  v_def := replace(
    v_def,
    'sum(case when rigv.return_amount > 0 and rs.gross_value_sum > 0 then rigv.return_amount * rigv.fx_rate_effective * (rigv.gross_value / rs.gross_value_sum) else rigv.gross_value * rigv.fx_rate_effective end) as returned_sales',
    'sum(rigv.gross_value * rigv.fx_rate_effective) as returned_sales'
  );

  if v_def not like '%sum(rigv.gross_value * rigv.fx_rate_effective) as returned_sales%' then
    raise exception 'Revert replacement failed';
  end if;

  execute v_def;
  raise notice 'Reverted returned_sales to simple gross_value * fx_rate_effective formula';
end;
$$;

notify pgrst, 'reload schema';
