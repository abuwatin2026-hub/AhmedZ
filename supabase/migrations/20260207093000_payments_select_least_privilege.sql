do $$
begin
  if to_regclass('public.payments') is null then
    return;
  end if;

  alter table public.payments enable row level security;

  drop policy if exists payments_select_authenticated on public.payments;
  drop policy if exists payments_select_staff on public.payments;
  drop policy if exists payments_admin_select on public.payments;
  drop policy if exists payments_select_admin on public.payments;
  drop policy if exists payments_select_finance on public.payments;
  drop policy if exists payments_select_least_privilege on public.payments;

  create policy payments_select_least_privilege
  on public.payments
  for select
  using (
    exists (
      select 1
      from public.admin_users au
      where au.auth_user_id = auth.uid()
        and au.is_active = true
        and au.role in ('owner','manager','accountant')
    )
    or exists (
      select 1
      from public.admin_users au
      where au.auth_user_id = auth.uid()
        and au.is_active = true
        and ('accounting.manage' = any(coalesce(au.permissions, '{}'::text[])))
    )
    or (public.payments.created_by = auth.uid())
    or (
      public.payments.reference_table = 'orders'
      and public.payments.reference_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      and exists (
        select 1
        from public.orders o
        where o.id = (public.payments.reference_id)::uuid
          and o.customer_auth_user_id = auth.uid()
      )
    )
  );
end $$;

notify pgrst, 'reload schema';
