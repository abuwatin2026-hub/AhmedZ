-- 1) Tighten payments SELECT: admins/staff only
drop policy if exists payments_select_authenticated on public.payments;
drop policy if exists payments_select_admin on public.payments;
create policy payments_select_admin
on public.payments
for select
using (public.is_admin());

-- 2) Prevent direct execution of sensitive posting helpers from client roles
revoke execute on function public.post_payment(uuid) from anon;
revoke execute on function public.post_payment(uuid) from authenticated;
revoke execute on function public.post_inventory_movement(uuid) from anon;
revoke execute on function public.post_inventory_movement(uuid) from authenticated;

