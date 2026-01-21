ALTER TABLE IF EXISTS public.purchase_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.purchase_items ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  BEGIN
    DROP POLICY IF EXISTS purchase_orders_manage ON public.purchase_orders;
  EXCEPTION WHEN undefined_object THEN NULL;
  END;
  BEGIN
    DROP POLICY IF EXISTS purchase_orders_select ON public.purchase_orders;
  EXCEPTION WHEN undefined_object THEN NULL;
  END;
  BEGIN
    DROP POLICY IF EXISTS purchase_orders_insert ON public.purchase_orders;
  EXCEPTION WHEN undefined_object THEN NULL;
  END;
  BEGIN
    DROP POLICY IF EXISTS purchase_orders_update ON public.purchase_orders;
  EXCEPTION WHEN undefined_object THEN NULL;
  END;
END $$;
CREATE POLICY purchase_orders_select
ON public.purchase_orders
FOR SELECT
USING (
  EXISTS (
    SELECT 1
    FROM public.admin_users au
    WHERE au.auth_user_id = auth.uid()
      AND au.is_active = true
      AND au.role IN ('owner','manager','employee')
  )
);
CREATE POLICY purchase_orders_insert
ON public.purchase_orders
FOR INSERT
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.admin_users au
    WHERE au.auth_user_id = auth.uid()
      AND au.is_active = true
      AND au.role IN ('owner','manager','employee')
  )
);
CREATE POLICY purchase_orders_update
ON public.purchase_orders
FOR UPDATE
USING (
  EXISTS (
    SELECT 1
    FROM public.admin_users au
    WHERE au.auth_user_id = auth.uid()
      AND au.is_active = true
      AND au.role IN ('owner','manager','employee')
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.admin_users au
    WHERE au.auth_user_id = auth.uid()
      AND au.is_active = true
      AND au.role IN ('owner','manager','employee')
  )
);
DO $$
BEGIN
  BEGIN
    DROP POLICY IF EXISTS purchase_items_manage ON public.purchase_items;
  EXCEPTION WHEN undefined_object THEN NULL;
  END;
  BEGIN
    DROP POLICY IF EXISTS purchase_items_select ON public.purchase_items;
  EXCEPTION WHEN undefined_object THEN NULL;
  END;
  BEGIN
    DROP POLICY IF EXISTS purchase_items_insert ON public.purchase_items;
  EXCEPTION WHEN undefined_object THEN NULL;
  END;
  BEGIN
    DROP POLICY IF EXISTS purchase_items_update ON public.purchase_items;
  EXCEPTION WHEN undefined_object THEN NULL;
  END;
END $$;
CREATE POLICY purchase_items_select
ON public.purchase_items
FOR SELECT
USING (
  EXISTS (
    SELECT 1
    FROM public.admin_users au
    WHERE au.auth_user_id = auth.uid()
      AND au.is_active = true
      AND au.role IN ('owner','manager','employee')
  )
);
CREATE POLICY purchase_items_insert
ON public.purchase_items
FOR INSERT
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.admin_users au
    WHERE au.auth_user_id = auth.uid()
      AND au.is_active = true
      AND au.role IN ('owner','manager','employee')
  )
);
CREATE POLICY purchase_items_update
ON public.purchase_items
FOR UPDATE
USING (
  EXISTS (
    SELECT 1
    FROM public.admin_users au
    WHERE au.auth_user_id = auth.uid()
      AND au.is_active = true
      AND au.role IN ('owner','manager','employee')
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.admin_users au
    WHERE au.auth_user_id = auth.uid()
      AND au.is_active = true
      AND au.role IN ('owner','manager','employee')
  )
);
