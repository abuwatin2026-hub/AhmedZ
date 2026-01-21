-- إصلاح مشكلة التكرار اللانهائي (Infinite Recursion) في سياسات RLS
-- الحل هو استخدام دالة SECURITY DEFINER لفحص الصلاحيات دون تفعيل سياسات الجدول مرة أخرى

-- 1. إنشاء دالة آمنة للتحقق مما إذا كان المستخدم مالكاً (Owner)
-- SECURITY DEFINER تعني أن الدالة تنفذ بصلاحيات منشئها (غالباً المالك الحقيقي لقاعدة البيانات) وتتجاوز RLS
CREATE OR REPLACE FUNCTION public.is_admin_owner()
RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM public.admin_users
    WHERE auth_user_id = auth.uid()
    AND role = 'owner'
    AND is_active = true
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 2. إنشاء دالة آمنة للتحقق مما إذا كان المستخدم مشرفاً نشطاً (أي دور)
CREATE OR REPLACE FUNCTION public.is_active_admin()
RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM public.admin_users
    WHERE auth_user_id = auth.uid()
    AND is_active = true
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- 3. تحديث سياسات admin_users لتستخم الدوال الجديدة بدلاً من الاستعلام المباشر
DROP POLICY IF EXISTS "Owner manage all admins" ON public.admin_users;
CREATE POLICY "Owner manage all admins" ON public.admin_users
    FOR ALL
    USING ( public.is_admin_owner() );

-- سياسة التحديث الذاتي (Self update) لا تسبب تكراراً لانهائياً عادة لأنها تفحص auth.uid() فقط،
-- ولكن سنبقيها كما هي أو نحسنها. السياسة السابقة كانت:
-- USING (auth_user_id = auth.uid()) WITH CHECK (auth_user_id = auth.uid())
-- وهي سليمة.

-- 4. تحديث باقي الجداول لتستفيد من الدوال الآمنة (أسرع وأكثر أماناً)

-- orders
DROP POLICY IF EXISTS "Admin manage orders" ON public.orders;
CREATE POLICY "Admin manage orders" ON public.orders
    FOR ALL
    USING ( public.is_active_admin() );

-- stock_management
DROP POLICY IF EXISTS "Admin manage stock" ON public.stock_management;
CREATE POLICY "Admin manage stock" ON public.stock_management
    FOR ALL
    USING ( public.is_active_admin() );

-- stock_history
DROP POLICY IF EXISTS "Admin insert history" ON public.stock_history;
CREATE POLICY "Admin insert history" ON public.stock_history
    FOR INSERT
    WITH CHECK ( public.is_active_admin() );

DROP POLICY IF EXISTS "Admin read history" ON public.stock_history;
CREATE POLICY "Admin read history" ON public.stock_history
    FOR SELECT
    USING ( public.is_active_admin() );

