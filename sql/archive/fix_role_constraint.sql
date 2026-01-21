-- Fix the role check constraint on admin_users table
-- This allows 'employee' and 'delivery' roles which were missing

ALTER TABLE public.admin_users DROP CONSTRAINT IF EXISTS admin_users_role_check;

ALTER TABLE public.admin_users 
  ADD CONSTRAINT admin_users_role_check 
  CHECK (role IN ('owner', 'manager', 'employee', 'delivery'));

