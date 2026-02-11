set app.allow_ledger_ddl = '1';

create or replace function public._resolve_main_warehouse_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select public._resolve_default_warehouse_id();
$$;

revoke all on function public._resolve_main_warehouse_id() from public;
grant execute on function public._resolve_main_warehouse_id() to authenticated;

notify pgrst, 'reload schema';
