do $$
declare
  v_def text;
begin
  select pg_get_functiondef(
    'public.get_product_sales_report_v9(timestamp with time zone,timestamp with time zone,uuid,boolean)'::regprocedure
  ) into v_def;

  -- Fix: replace rs.total_gross with rs.gross_value_sum (correct column name in return_scaling CTE)
  v_def := replace(v_def, 'rs.total_gross', 'rs.gross_value_sum');

  if v_def not like '%rs.gross_value_sum%' then
    raise exception 'Column rename replacement failed';
  end if;

  execute v_def;
  raise notice 'Fixed: rs.total_gross -> rs.gross_value_sum';
end;
$$;

notify pgrst, 'reload schema';
