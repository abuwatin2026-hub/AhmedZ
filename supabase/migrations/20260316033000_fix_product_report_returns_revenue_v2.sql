-- Fix returns_sales in product report v9: returned_sales was nearly zero for YER orders
-- because total_refund_amount was 0 or tiny. Use proportional item value directly.

do $$
declare
  v_def text;
  v_sig regprocedure := 'public.get_product_sales_report_v9(timestamp with time zone,timestamp with time zone,uuid,boolean)'::regprocedure;
  v_old_pattern text;
  v_new_replacement text;
begin
  select pg_get_functiondef(v_sig) into v_def;
  if v_def is null then
    raise exception 'get_product_sales_report_v9 not found';
  end if;

  -- Use regexp_replace to handle any whitespace differences
  -- Match the pattern: sum( case when rs.gross_value_sum > 0 then rigv.gross_value * (rs.return_amount / rs.gross_value_sum) * rs.fx_rate_effective else 0 end ) as returned_sales
  v_def := regexp_replace(
    v_def,
    'sum\(\s*case\s+when\s+rs\.gross_value_sum\s*>\s*0\s+then\s+rigv\.gross_value\s*\*\s*\(rs\.return_amount\s*/\s*rs\.gross_value_sum\)\s*\*\s*rs\.fx_rate_effective\s+else\s+0\s+end\s*\)\s*as\s+returned_sales',
    'sum(rigv.gross_value * rigv.fx_rate_effective) as returned_sales',
    'i'
  );

  -- Verify the replacement happened
  if v_def like '%rs.return_amount / rs.gross_value_sum%' then
    raise exception 'replacement did not work — old pattern still present';
  end if;

  if v_def not like '%sum(rigv.gross_value * rigv.fx_rate_effective) as returned_sales%' then
    raise exception 'replacement did not work — new pattern not found';
  end if;

  execute v_def;
  raise notice 'Successfully replaced returns_sales calculation';
end;
$$;

notify pgrst, 'reload schema';
