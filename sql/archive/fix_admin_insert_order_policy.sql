-- Allow admins to insert into orders table
-- Currently, only 'orders_insert_own' exists, which fails for admins creating orders for null users (in-store sales)

DROP POLICY IF EXISTS "orders_insert_admin" ON public.orders;

CREATE POLICY "orders_insert_admin"
ON public.orders
FOR INSERT
WITH CHECK (
  public.is_admin()
);

