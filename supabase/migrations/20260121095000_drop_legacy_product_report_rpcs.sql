do $$
declare
  r record;
begin
  for r in
    select
      n.nspname as schema_name,
      p.proname as function_name,
      pg_get_function_identity_arguments(p.oid) as args
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and (
        p.proname ~ '^get_product_sales_report_v[0-8]$'
        or p.proname in (
          'get_product_sales_report',
          'get_product_sales_report_unified',
          'get_product_sales_report_accounting',
          'get_product_sales_report_v7_core'
        )
      )
  loop
    execute format('drop function if exists %I.%I(%s);', r.schema_name, r.function_name, r.args);
  end loop;
end $$;

