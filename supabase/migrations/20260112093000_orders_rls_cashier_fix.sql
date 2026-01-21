-- Extend orders visibility to include 'cashier' role for admin panel
-- and keep delivery drivers restricted to assigned orders only.
-- Also update order_events policy to mirror orders visibility.

drop policy if exists orders_select_permissions on public.orders;
create policy orders_select_permissions
on public.orders
for select
using (
  -- 1. Customer can see their own orders
  (auth.role() = 'authenticated' and customer_auth_user_id = auth.uid())
  OR
  -- 2. Admin roles (owner, manager, employee, cashier) can see all orders
  (exists (
    select 1 from public.admin_users au 
    where au.auth_user_id = auth.uid() 
      and au.is_active = true 
      and au.role in ('owner', 'manager', 'employee', 'cashier')
  ))
  OR
  -- 3. Delivery driver can see ONLY assigned orders
  (exists (
    select 1 from public.admin_users au 
    where au.auth_user_id = auth.uid() 
      and au.is_active = true 
      and au.role = 'delivery'
  ) AND ((data->>'assignedDeliveryUserId') = auth.uid()::text))
);
drop policy if exists order_events_select_permissions on public.order_events;
create policy order_events_select_permissions
on public.order_events
for select
using (
  exists (
    select 1 
    from public.orders o
    where o.id = order_events.order_id
      and (
        -- 1. Customer sees their own order events
        (o.customer_auth_user_id = auth.uid())
        OR
        -- 2. Admin roles (owner, manager, employee, cashier) see all events
        (exists (
          select 1 from public.admin_users au 
          where au.auth_user_id = auth.uid() 
            and au.is_active = true 
            and au.role in ('owner', 'manager', 'employee', 'cashier')
        ))
        OR
        -- 3. Delivery sees events for assigned orders only
        (exists (
          select 1 from public.admin_users au 
          where au.auth_user_id = auth.uid() 
            and au.is_active = true 
            and au.role = 'delivery'
        ) AND ((o.data->>'assignedDeliveryUserId') = auth.uid()::text))
      )
  )
);
