do $$
declare
  v_def text;
  v_sig regprocedure := 'public.get_product_sales_report_v9(timestamp with time zone,timestamp with time zone,uuid,boolean)'::regprocedure;
begin
  select pg_get_functiondef(v_sig) into v_def;
  if v_def is null then
    raise notice 'SKIPPED: get_product_sales_report_v9 not found (safe for fresh DB)';
  end if;

  v_def := replace(
    v_def,
    'greatest(coalesce(cg.gross_cost, 0) - coalesce(rc.returned_cost, 0), 0) as net_cost_raw',
    '(coalesce(cg.gross_cost, 0) - coalesce(rc.returned_cost, 0)) as net_cost_raw'
  );

  execute v_def;
end;
$$;

notify pgrst, 'reload schema';
