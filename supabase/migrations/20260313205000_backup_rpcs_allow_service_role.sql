create or replace function public._has_backup_access()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(public.has_admin_permission('system.settings'), false)
         or auth.role() = 'service_role';
$$;

revoke all on function public._has_backup_access() from public;
grant execute on function public._has_backup_access() to authenticated, service_role;

create or replace function public.admin_get_all_tables()
returns text[]
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public._has_backup_access() then
     raise exception 'Unauthorized: Requires system.settings permission';
  end if;

  return array(
     select table_name::text
     from information_schema.tables
     where table_schema = 'public'
       and table_type = 'BASE TABLE'
     order by table_name
  );
end;
$$;

revoke all on function public.admin_get_all_tables() from public;
grant execute on function public.admin_get_all_tables() to authenticated, service_role;

create or replace function public.admin_export_table_data(p_table text, p_offset int, p_limit int)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  res jsonb;
  exec_query text;
begin
  if not public._has_backup_access() then
     raise exception 'Unauthorized: Requires system.settings permission';
  end if;

  if p_table !~ '^[a-zA-Z0-9_]+$' then
     raise exception 'Invalid table name';
  end if;

  begin
    exec_query := format(
      'SELECT COALESCE(jsonb_agg(row_to_json(t)), ''[]''::jsonb) FROM (SELECT * FROM public.%I ORDER BY created_at ASC NULLS LAST LIMIT %s OFFSET %s) t',
      p_table, p_limit, p_offset
    );
    execute exec_query into res;
  exception when others then
    exec_query := format(
      'SELECT COALESCE(jsonb_agg(row_to_json(t)), ''[]''::jsonb) FROM (SELECT * FROM public.%I LIMIT %s OFFSET %s) t',
      p_table, p_limit, p_offset
    );
    execute exec_query into res;
  end;

  return coalesce(res, '[]'::jsonb);
end;
$$;

revoke all on function public.admin_export_table_data(text, int, int) from public;
grant execute on function public.admin_export_table_data(text, int, int) to authenticated, service_role;
