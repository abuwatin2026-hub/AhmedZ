do $$
declare
  r record;
begin
  -- Wipe all public tables except core settings and user accounts mapping
  for r in
    select table_schema, table_name
    from information_schema.tables
    where table_schema = 'public'
      and table_type = 'BASE TABLE'
      and table_name not in (
        'app_settings',
        'admin_users',
        'chart_of_accounts',
        'currencies',
        'fx_rates',
        'payroll_settings',
        'cost_centers'
      )
  loop
    execute format('truncate table %I.%I cascade', r.table_schema, r.table_name);
  end loop;
end $$;

notify pgrst, 'reload schema';
