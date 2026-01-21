-- Fix User Deletion Blockers
-- Problem: purchase_orders.created_by references auth.users(id) without ON DELETE SET NULL.
-- This prevents deleting any user who created a purchase order.

DO $$
BEGIN
    -- 1. Purchase Orders: created_by
    IF EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'purchase_orders_created_by_fkey') THEN
        ALTER TABLE public.purchase_orders DROP CONSTRAINT purchase_orders_created_by_fkey;
    END IF;

    -- Re-add with ON DELETE SET NULL
    ALTER TABLE public.purchase_orders
    ADD CONSTRAINT purchase_orders_created_by_fkey
    FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;

    -- 2. Notifications: user_id (Just to be safe, usually cascade)
    -- Check if notifications table exists
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'notifications') THEN
        -- Usually notifications should be CASCADED (delete notification if user deleted)
        -- Let's check constraint name (usually notifications_user_id_fkey)
        IF EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'notifications_user_id_fkey') THEN
             ALTER TABLE public.notifications DROP CONSTRAINT notifications_user_id_fkey;
             ALTER TABLE public.notifications
             ADD CONSTRAINT notifications_user_id_fkey
             FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
        END IF;
    END IF;

END $$;
