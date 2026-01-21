-- إصلاح سياسات RLS لأوامر الشراء وبنودها للسماح بالإدراج والتحديث لموظفي الإدارة

-- purchase_orders: إسقاط السياسات القديمة وإضافة سياسة شاملة مع WITH CHECK
DO $$
BEGIN
  BEGIN
    DROP POLICY IF EXISTS purchase_orders_admin_select ON public.purchase_orders;
  EXCEPTION WHEN undefined_object THEN NULL;
  END;
  BEGIN
    DROP POLICY IF EXISTS "Enable read access for authenticated users" ON public.purchase_orders;
  EXCEPTION WHEN undefined_object THEN NULL;
  END;
  BEGIN
    DROP POLICY IF EXISTS "Enable insert/update for admins and managers" ON public.purchase_orders;
  EXCEPTION WHEN undefined_object THEN NULL;
  END;
END $$;
CREATE POLICY purchase_orders_manage
ON public.purchase_orders
FOR ALL
USING (
  EXISTS (
    SELECT 1 FROM public.admin_users au
    WHERE au.auth_user_id = auth.uid()
      AND au.is_active = true
      AND au.role IN ('owner','manager','employee')
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.admin_users au
    WHERE au.auth_user_id = auth.uid()
      AND au.is_active = true
      AND au.role IN ('owner','manager','employee')
  )
);
-- purchase_items: إسقاط السياسات القديمة وإضافة سياسة شاملة مع WITH CHECK
DO $$
BEGIN
  BEGIN
    DROP POLICY IF EXISTS purchase_items_admin_select ON public.purchase_items;
  EXCEPTION WHEN undefined_object THEN NULL;
  END;
  BEGIN
    DROP POLICY IF EXISTS "Enable read access for authenticated users" ON public.purchase_items;
  EXCEPTION WHEN undefined_object THEN NULL;
  END;
  BEGIN
    DROP POLICY IF EXISTS "Enable all access for admins and managers" ON public.purchase_items;
  EXCEPTION WHEN undefined_object THEN NULL;
  END;
END $$;
CREATE POLICY purchase_items_manage
ON public.purchase_items
FOR ALL
USING (
  EXISTS (
    SELECT 1 FROM public.admin_users au
    WHERE au.auth_user_id = auth.uid()
      AND au.is_active = true
      AND au.role IN ('owner','manager','employee')
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.admin_users au
    WHERE au.auth_user_id = auth.uid()
      AND au.is_active = true
      AND au.role IN ('owner','manager','employee')
  )
);
