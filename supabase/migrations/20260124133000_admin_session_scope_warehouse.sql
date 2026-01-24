create or replace function public._resolve_default_admin_warehouse_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select w.id
  from public.warehouses w
  where w.is_active = true
  order by case when upper(coalesce(w.code,'')) = 'MAIN' then 0 else 1 end,
           w.created_at asc,
           w.code asc
  limit 1;
$$;

revoke all on function public._resolve_default_admin_warehouse_id() from public;
grant execute on function public._resolve_default_admin_warehouse_id() to authenticated;

alter table public.admin_users
  add column if not exists warehouse_id uuid references public.warehouses(id);

do $$
declare
  v_company_id uuid;
  v_branch_id uuid;
  v_warehouse_id uuid;
begin
  select public.get_default_company_id() into v_company_id;
  select public.get_default_branch_id() into v_branch_id;
  select public._resolve_default_admin_warehouse_id() into v_warehouse_id;

  update public.admin_users
  set company_id = coalesce(company_id, v_company_id),
      branch_id = coalesce(branch_id, v_branch_id),
      warehouse_id = coalesce(warehouse_id, v_warehouse_id);
end $$;

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
    au.warehouse_id as warehouse_id
  from public.admin_users au
  where au.auth_user_id = auth.uid()
    and au.is_active = true
  limit 1;
$$;

revoke all on function public.get_admin_session_scope() from public;
grant execute on function public.get_admin_session_scope() to authenticated;
