-- ملف: fix_rls_final.sql
-- الوصف: إصلاح شامل ونهائي لمشكلة "Infinite Recursion" في سياسات RLS
-- التعليمات: قم بتشغيل هذا الملف كاملاً في Supabase SQL Editor

-- ========================================================
-- 1. إنشاء دوال آمنة (Security Definer Functions)
-- ========================================================
-- هذه الدوال تتجاوز RLS لأنها تعمل بصلاحيات المنشئ (postgres)
-- وتضمن عدم حدوث تكرار لانهائي عند فحص جدول admin_users

CREATE OR REPLACE FUNCTION public.is_active_admin()
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public -- حماية أمنية مهمة
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

-- ========================================================
-- 2. حذف السياسات القديمة (التي تسبب المشاكل)
-- ========================================================

-- menu_items
DROP POLICY IF EXISTS "Admin manage menu" ON public.menu_items;

-- orders
DROP POLICY IF EXISTS "Admin manage orders" ON public.orders;

-- order_events
DROP POLICY IF EXISTS "Admin view events" ON public.order_events;
DROP POLICY IF EXISTS "Admin create events" ON public.order_events;

-- admin_users
DROP POLICY IF EXISTS "Owner manage admins" ON public.admin_users;
DROP POLICY IF EXISTS "Owner manage all admins" ON public.admin_users; -- مسح أي نسخ سابقة

-- app_settings
DROP POLICY IF EXISTS "Admin update settings" ON public.app_settings;

-- coupons
DROP POLICY IF EXISTS "Admin manage coupons" ON public.coupons;

-- addons
DROP POLICY IF EXISTS "Admin manage addons" ON public.addons;

-- ads
DROP POLICY IF EXISTS "Admin manage ads" ON public.ads;

-- delivery_zones
DROP POLICY IF EXISTS "Admin manage zones" ON public.delivery_zones;

-- stock_management
DROP POLICY IF EXISTS "Admin manage stock" ON public.stock_management;

-- stock_history (قد تكون أنشئت سابقاً بأسماء مختلفة)
DROP POLICY IF EXISTS "Admin insert history" ON public.stock_history;
DROP POLICY IF EXISTS "Admin read history" ON public.stock_history;
DROP POLICY IF EXISTS "Admin manage stock history" ON public.stock_history;

-- storage objects (اختياري، للدقة)
-- DROP POLICY IF EXISTS "Admin Upload Menu Images" ON storage.objects;

-- ========================================================
-- 3. إعادة إنشاء السياسات باستخدام الدوال الآمنة
-- ========================================================

-- 3.1 Menu Items
CREATE POLICY "Admin manage menu" ON public.menu_items
    FOR ALL
    USING ( public.is_active_admin() );

-- 3.2 Orders
CREATE POLICY "Admin manage orders" ON public.orders
    FOR ALL
    USING ( public.is_active_admin() );

-- 3.3 Order Events
CREATE POLICY "Admin view events" ON public.order_events
    FOR SELECT
    USING ( public.is_active_admin() );

CREATE POLICY "Admin create events" ON public.order_events
    FOR INSERT
    WITH CHECK ( public.is_active_admin() );

-- 3.4 Admin Users
-- ملاحظة: للتحديث الذاتي (Self update) نستخدم auth.uid مباشرة وهذا آمن
-- للمالك، نستخدم الدالة الآمنة لكسر التكرار
CREATE POLICY "Owner manage admins" ON public.admin_users
    FOR ALL
    USING ( public.is_admin_owner() );

-- 3.5 App Settings
CREATE POLICY "Admin update settings" ON public.app_settings
    FOR ALL
    USING ( public.is_admin_owner() );

-- 3.6 Coupons
CREATE POLICY "Admin manage coupons" ON public.coupons
    FOR ALL
    USING ( public.is_active_admin() );

-- 3.7 Addons
CREATE POLICY "Admin manage addons" ON public.addons
    FOR ALL
    USING ( public.is_active_admin() );

-- 3.8 Ads
CREATE POLICY "Admin manage ads" ON public.ads
    FOR ALL
    USING ( public.is_active_admin() );

-- 3.9 Delivery Zones
CREATE POLICY "Admin manage zones" ON public.delivery_zones
    FOR ALL
    USING ( public.is_active_admin() );

-- 3.10 Stock Management
CREATE POLICY "Admin manage stock" ON public.stock_management
    FOR ALL
    USING ( public.is_active_admin() );

-- 3.11 Stock History
CREATE POLICY "Admin insert history" ON public.stock_history
    FOR INSERT
    WITH CHECK ( public.is_active_admin() );

CREATE POLICY "Admin read history" ON public.stock_history
    FOR SELECT
    USING ( public.is_active_admin() );

-- 3.12 Storage Objects (إعادة إنشاء سياسة الصور)
DROP POLICY IF EXISTS "Admin Upload Menu Images" ON storage.objects;
CREATE POLICY "Admin Upload Menu Images" ON storage.objects
    FOR INSERT
    WITH CHECK (
        bucket_id = 'menu-images'
        AND public.is_active_admin()
    );

DROP POLICY IF EXISTS "Admin Update Menu Images" ON storage.objects;
CREATE POLICY "Admin Update Menu Images" ON storage.objects
    FOR UPDATE
    USING (
        bucket_id = 'menu-images'
        AND public.is_active_admin()
    );

DROP POLICY IF EXISTS "Admin Delete Menu Images" ON storage.objects;
CREATE POLICY "Admin Delete Menu Images" ON storage.objects
    FOR DELETE
    USING (
        bucket_id = 'menu-images'
        AND public.is_active_admin()
    );
