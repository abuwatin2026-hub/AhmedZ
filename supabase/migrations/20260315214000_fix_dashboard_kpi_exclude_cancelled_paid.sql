do $$
declare
  v_def text;
  v_sig regprocedure := 'public.get_dashboard_kpi_v4(timestamp with time zone,timestamp with time zone,uuid,boolean,uuid)'::regprocedure;
begin
  select pg_get_functiondef(v_sig) into v_def;
  if v_def is null then
    raise notice 'SKIPPED: get_dashboard_kpi_v4 not found (safe for fresh DB)';
  end if;

  v_def := replace(
    v_def,
    'filter (where eo.status = ''delivered'' or eo.paid_at is not null)',
    'filter (where eo.status <> ''cancelled'' and (eo.status = ''delivered'' or eo.paid_at is not null))'
  );

  v_def := replace(
    v_def,
    'where o.status = ''delivered'' or o.data->>''paidAt'' is not null',
    'where o.status <> ''cancelled'' and (o.status = ''delivered'' or o.data->>''paidAt'' is not null)'
  );

  execute v_def;
end;
$$;

notify pgrst, 'reload schema';
