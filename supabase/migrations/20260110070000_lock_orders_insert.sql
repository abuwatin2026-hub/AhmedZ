-- Lock Orders Insert: Revoke direct insert for customers, allow only via RPC or Admins.

ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;
-- Drop the policy that allows customers to insert directly
DROP POLICY IF EXISTS orders_insert_own ON public.orders;
-- Ensure Admins can still insert (for In-Store Sales or management)
DROP POLICY IF EXISTS orders_insert_admin ON public.orders;
CREATE POLICY orders_insert_admin
ON public.orders
FOR INSERT
WITH CHECK (public.is_admin());
-- Customers now MUST use create_order_secure RPC.;
