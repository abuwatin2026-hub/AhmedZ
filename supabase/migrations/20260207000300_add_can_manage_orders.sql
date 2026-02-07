set app.allow_ledger_ddl = '1';

create or replace function public.can_manage_orders()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.has_admin_permission('orders.markPaid')
      or public.has_admin_permission('orders.updateStatus.all')
      or public.has_admin_permission('orders.createInStore');
$$;

revoke all on function public.can_manage_orders() from public;
revoke execute on function public.can_manage_orders() from anon;
grant execute on function public.can_manage_orders() to authenticated;

