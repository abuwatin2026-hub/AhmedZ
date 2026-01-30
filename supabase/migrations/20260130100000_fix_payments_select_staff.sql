drop policy if exists payments_select_admin on public.payments;
drop policy if exists payments_select_staff on public.payments;

create policy payments_select_staff
on public.payments
for select
using (
  exists (
    select 1
    from public.admin_users au
    where au.auth_user_id = auth.uid()
      and au.is_active = true
      and au.role in ('owner','manager','employee','cashier','accountant')
  )
);
