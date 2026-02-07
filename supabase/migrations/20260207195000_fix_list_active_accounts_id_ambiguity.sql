set app.allow_ledger_ddl = '1';

create or replace function public.list_active_accounts()
returns table (
  id uuid,
  code text,
  name text,
  account_type text,
  normal_balance text
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.has_admin_permission('accounting.view') then
    raise exception 'not allowed';
  end if;
  return query
  select
    coa.id,
    coa.code,
    coa.name,
    coa.account_type,
    coa.normal_balance
  from public.chart_of_accounts coa
  where coa.is_active = true
  order by coa.code asc;
end;
$$;

revoke all on function public.list_active_accounts() from public;
grant execute on function public.list_active_accounts() to authenticated;

notify pgrst, 'reload schema';

