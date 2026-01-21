-- ملف: force_fix_rls.sql
-- الوصف: تنظيف جذري وإجباري لجميع سياسات RLS وإعادة بنائها
-- الغرض: حل مشكلة \"Infinite recursion\" (42P17) بشكل نهائي

-- 1. تنظيف شامل (DROP ALL POLICIES via DO Block)
-- هذا الكود سيبحث عن أي سياسة موجودة على الجداول المحددة ويحذفها
DO $$
DECLARE
  pol record;
BEGIN
  FOR pol IN
    SELECT policyname, tablename
    FROM pg_policies
    WHERE schemaname = 'public'
    AND tablename IN (
        'admin_users', 
        'orders', 
        'menu_items', 
        'stock_management', 
        'stock_history', 
        'order_events', 
        'app_settings', 
        'coupons', 
        'addons', 
        'ads', 
        'delivery_zones'
    )
  LOOP
    RAISE NOTICE 'Dropping policy: % on table %', pol.policyname, pol.tablename;
    EXECUTE 'DROP POLICY IF EXISTS \"' || pol.policyname || '\" ON public.' || pol.tablename;
  END LOOP;
END $$;

-- 2. التأكد من وجود الدوال الآمنة (SECURITY DEFINER)
-- هذه الدوال تتجاوز RLS وتمنع التكرار
CREATE OR REPLACE FUNCTION public.is_active_admin()
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM public.admin_users
    WHERE auth_user_id = auth.uid()
    AND is_active = true
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.is_admin_owner()
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM public.admin_users
    WHERE auth_user_id = auth.uid()
    AND role = 'owner'
    AND is_active = true
  );
END;
$$;

-- 3. إعادة إنشاء السياسات الصحيحة

-- Admin Users
-- التحديث الذاتي آمن لأنه يستخدم auth.uid() مباشرة
CREATE POLICY \"Self update profile\" ON public.admin_users
    FOR UPDATE
    USING (auth_user_id = auth.uid());

-- المالك فقط يدير المشرفين (باستخدام الدالة الآمنة)
CREATE POLICY \"Owner manage admins\" ON public.admin_users
    FOR ALL
    USING ( public.is_admin_owner() );

-- القراءة للجميع (للتحقق من الدخول)
CREATE POLICY \"Public read admins\" ON public.admin_users
    FOR SELECT
    USING (true);


-- Stock Management
CREATE POLICY \"Admin manage stock\" ON public.stock_management
    FOR ALL
    USING ( public.is_active_admin() );

CREATE POLICY \"Public read stock\" ON public.stock_management
    FOR SELECT
    USING (true);


-- Stock History
CREATE POLICY \"Admin insert history\" ON public.stock_history
    FOR INSERT
    WITH CHECK ( public.is_active_admin() );

CREATE POLICY \"Admin read history\" ON public.stock_history
    FOR SELECT
    USING ( public.is_active_admin() );


-- Menu Items
CREATE POLICY \"Admin manage menu\" ON public.menu_items
    FOR ALL
    USING ( public.is_active_admin() );

CREATE POLICY \"Public read menu\" ON public.menu_items
    FOR SELECT
    USING (true);


-- Orders
CREATE POLICY \"Admin manage orders\" ON public.orders
    FOR ALL
    USING ( public.is_active_admin() );

CREATE POLICY \"Users see own orders\" ON public.orders
    FOR SELECT
    USING (auth.uid()::text = user_id);

CREATE POLICY \"Users create orders\" ON public.orders
    FOR INSERT
    WITH CHECK (auth.uid()::text = user_id OR user_id is null);


-- Order Events
CREATE POLICY \"Admin view events\" ON public.order_events
    FOR SELECT
    USING ( public.is_active_admin() );

CREATE POLICY \"Admin create events\" ON public.order_events
    FOR INSERT
    WITH CHECK ( public.is_active_admin() );


-- App Settings
CREATE POLICY \"Admin update settings\" ON public.app_settings
    FOR ALL
    USING ( public.is_admin_owner() );

CREATE POLICY \"Public read settings\" ON public.app_settings
    FOR SELECT
    USING (true);


-- Delivery Zones
CREATE POLICY \"Admin manage zones\" ON public.delivery_zones
    FOR ALL
    USING ( public.is_active_admin() );

CREATE POLICY \"Public read zones\" ON public.delivery_zones
    FOR SELECT
    USING (true);

-- (يمكن إضافة باقي الجداول عند الحاجة، لكن هذه هي الجداول الحرجة حالياً)

