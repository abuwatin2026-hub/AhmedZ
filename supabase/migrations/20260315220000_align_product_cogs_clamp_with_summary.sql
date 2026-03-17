do $$
declare
  v_def text;
  v_sig regprocedure := 'public.get_product_sales_report_v9(timestamp with time zone,timestamp with time zone,uuid,boolean)'::regprocedure;
begin
  select pg_get_functiondef(v_sig) into v_def;
  if v_def is null then
    raise notice 'SKIPPED: get_product_sales_report_v9 not found (safe for fresh DB)';
  end if;

  v_def := regexp_replace(
    v_def,
    'greatest\s*\(\s*cg\.gross_cost\s*-\s*rc\.returned_cost\s*,\s*0\s*\)::numeric\s+as\s+net_cost_raw',
    '(cg.gross_cost - rc.returned_cost)::numeric as net_cost_raw',
    'gi'
  );

  execute v_def;
end;
$$;

notify pgrst, 'reload schema';
