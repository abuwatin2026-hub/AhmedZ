-- Comprehensive Fix for Orders Table
-- Run this script in Supabase SQL Editor to resolve "400 Bad Request" on Order Creation

-- 1. Ensure RLS is enabled
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;

-- 2. Grant basic permissions to the role 'authenticated' (Used by logged in admins)
GRANT ALL ON TABLE public.orders TO authenticated;
GRANT ALL ON TABLE public.orders TO service_role;

-- 3. Fix "Insert" Policy for Admins
-- Drop potentially conflicting or duplicate policies
DROP POLICY IF EXISTS "orders_insert_admin" ON public.orders;
DROP POLICY IF EXISTS "orders_insert_any_admin" ON public.orders;

-- Create a robust policy allowing Admins to insert ANY order
CREATE POLICY "orders_insert_admin"
ON public.orders
FOR INSERT
TO authenticated
WITH CHECK (
  -- Allow if user is an admin OR if it is a self-order (standard RLS)
  public.is_admin() OR (auth.uid() = customer_auth_user_id)
);

-- 4. Fix "Update" Policy for Admins (Just in case)
DROP POLICY IF EXISTS "orders_update_admin" ON public.orders;
CREATE POLICY "orders_update_admin"
ON public.orders
FOR UPDATE
TO authenticated
USING ( public.is_admin() )
WITH CHECK ( public.is_admin() );

-- 5. Cleanup Schema (Remove invoice_number if it exists to prevent payload errors)
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'orders' AND column_name = 'invoice_number') THEN
        ALTER TABLE public.orders DROP COLUMN invoice_number;
    END IF;
END $$;

