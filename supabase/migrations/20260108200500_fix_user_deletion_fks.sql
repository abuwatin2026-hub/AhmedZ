-- Fix User Deletion Issues by setting FKs to ON DELETE SET NULL

-- 1. Orders: assigned_delivery_user_id
-- Ensure column exists first
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'orders' AND column_name = 'assigned_delivery_user_id') THEN
        ALTER TABLE public.orders ADD COLUMN assigned_delivery_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL;
    ELSE
        -- If exists, drop old constraint and add new one
        ALTER TABLE public.orders DROP CONSTRAINT IF EXISTS orders_assigned_delivery_user_id_fkey;
        ALTER TABLE public.orders ADD CONSTRAINT orders_assigned_delivery_user_id_fkey 
            FOREIGN KEY (assigned_delivery_user_id) REFERENCES auth.users(id) ON DELETE SET NULL;
    END IF;
END $$;
-- 2. System Audit Logs: performed_by
ALTER TABLE public.system_audit_logs DROP CONSTRAINT IF EXISTS system_audit_logs_performed_by_fkey;
ALTER TABLE public.system_audit_logs ADD CONSTRAINT system_audit_logs_performed_by_fkey 
    FOREIGN KEY (performed_by) REFERENCES auth.users(id) ON DELETE SET NULL;
-- 3. Inventory Movements: created_by
-- Check constraint name first, usually inventory_movements_created_by_fkey
ALTER TABLE public.inventory_movements DROP CONSTRAINT IF EXISTS inventory_movements_created_by_fkey;
ALTER TABLE public.inventory_movements ADD CONSTRAINT inventory_movements_created_by_fkey 
    FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;
-- 4. Cash Shifts: cashier_id
-- Must allow NULL first
ALTER TABLE public.cash_shifts ALTER COLUMN cashier_id DROP NOT NULL;
ALTER TABLE public.cash_shifts DROP CONSTRAINT IF EXISTS cash_shifts_cashier_id_fkey;
ALTER TABLE public.cash_shifts ADD CONSTRAINT cash_shifts_cashier_id_fkey 
    FOREIGN KEY (cashier_id) REFERENCES auth.users(id) ON DELETE SET NULL;
-- 5. User Challenge Progress: customer_auth_user_id
-- This one is CASCADE usually, let's verify.
-- Init SQL says: customer_auth_user_id uuid not null references auth.users(id) on delete cascade
-- So this is fine.

-- 6. Reviews: customer_auth_user_id
-- Init SQL says: customer_auth_user_id uuid not null references auth.users(id) on delete cascade
-- This is fine.

-- 7. Orders: customer_auth_user_id
-- Init SQL says: references auth.users(id) on delete set null
-- This is fine.;
