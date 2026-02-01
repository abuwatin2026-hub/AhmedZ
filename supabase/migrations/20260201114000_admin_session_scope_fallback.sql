create or replace function public.get_admin_session_scope()
returns table (
  company_id uuid,
  branch_id uuid,
  warehouse_id uuid
)
language sql
stable
security definer
set search_path = public
as $$
  select
    coalesce(au.company_id, public.get_default_company_id()) as company_id,
    coalesce(au.branch_id, public.get_default_branch_id()) as branch_id,
    coalesce(au.warehouse_id, public._resolve_default_admin_warehouse_id()) as warehouse_id
  from public.admin_users au
  where au.auth_user_id = auth.uid()
    and au.is_active = true
  limit 1;
$$;

do $$
declare
  v_wh uuid;
begin
  select public._resolve_default_admin_warehouse_id() into v_wh;
  update public.admin_users
  set warehouse_id = coalesce(warehouse_id, v_wh)
  where is_active = true;
end $$;

revoke all on function public.get_admin_session_scope() from public;
grant execute on function public.get_admin_session_scope() to authenticated;

select pg_sleep(0.5);
notify pgrst, 'reload schema';
