-- Fix RLS for orders to restrict delivery drivers visibility
-- Previously, 'is_admin()' allowed delivery drivers to see ALL orders.
-- Now, delivery drivers can only see orders assigned to them.

drop policy if exists orders_select_own_or_admin on public.orders;
create policy orders_select_permissions
on public.orders
for select
using (
  -- 1. Customer can see their own orders (if logged in)
  (auth.role() = 'authenticated' and customer_auth_user_id = auth.uid())
  OR
  -- 2. Owner/Manager/Employee can see all orders
  (exists (
    select 1 from public.admin_users au 
    where au.auth_user_id = auth.uid() 
      and au.is_active = true 
      and au.role in ('owner', 'manager', 'employee')
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
-- Also secure order_events
drop policy if exists order_events_select_own_or_admin on public.order_events;
create policy order_events_select_permissions
on public.order_events
for select
using (
  exists (
    select 1 from public.orders o
    where o.id = order_events.order_id
    -- Re-use the logic from orders policy essentially by joining
    and (
        (o.customer_auth_user_id = auth.uid())
        OR
        (exists (
            select 1 from public.admin_users au 
            where au.auth_user_id = auth.uid() 
            and au.is_active = true 
            and au.role in ('owner', 'manager', 'employee')
        ))
        OR
        (exists (
            select 1 from public.admin_users au 
            where au.auth_user_id = auth.uid() 
            and au.is_active = true 
            and au.role = 'delivery'
        ) AND ((o.data->>'assignedDeliveryUserId') = auth.uid()::text))
    )
  )
);
