do $$
begin
  begin
    drop policy if exists orders_select_permissions on public.orders;
  exception
    when undefined_object then null;
  end;
  begin
    drop policy if exists orders_select_own_or_admin on public.orders;
  exception
    when undefined_object then null;
  end;

  create policy orders_select_permissions
  on public.orders
  for select
  using (
    (auth.role() = 'authenticated' and customer_auth_user_id = auth.uid())
    or (
      exists (
        select 1
        from public.admin_users au
        where au.auth_user_id = auth.uid()
          and au.is_active = true
          and au.role <> 'delivery'
      )
      and public.has_admin_permission('orders.view')
    )
    or (
      exists (
        select 1
        from public.admin_users au
        where au.auth_user_id = auth.uid()
          and au.is_active = true
          and au.role = 'delivery'
      )
      and public._uuid_or_null(data->>'assignedDeliveryUserId') = auth.uid()
    )
  );

  begin
    drop policy if exists order_events_select_permissions on public.order_events;
  exception
    when undefined_object then null;
  end;
  begin
    drop policy if exists order_events_select_own_or_admin on public.order_events;
  exception
    when undefined_object then null;
  end;

  create policy order_events_select_permissions
  on public.order_events
  for select
  using (
    exists (
      select 1
      from public.orders o
      where o.id = order_events.order_id
        and (
          (o.customer_auth_user_id = auth.uid())
          or (
            exists (
              select 1
              from public.admin_users au
              where au.auth_user_id = auth.uid()
                and au.is_active = true
                and au.role <> 'delivery'
            )
            and public.has_admin_permission('orders.view')
          )
          or (
            exists (
              select 1
              from public.admin_users au
              where au.auth_user_id = auth.uid()
                and au.is_active = true
                and au.role = 'delivery'
            )
            and public._uuid_or_null(o.data->>'assignedDeliveryUserId') = auth.uid()
          )
        )
    )
  );
end $$;

select pg_sleep(1);
notify pgrst, 'reload schema';
