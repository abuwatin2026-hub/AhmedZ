-- إصلاح سياسات الأمان (RLS) للمشرفين
-- هذا الملف يقوم بإعادة إنشاء السياسات لتكون أكثر مرونة وتسمح بالتحديثات بشكل صحيح

-- 1. إصلاح جدول admin_users
-- السماح للمستخدم بتحديث ملفه الشخصي دائماً طالما أن auth_user_id يطابق
DROP POLICY IF EXISTS "Self update profile" ON public.admin_users;
CREATE POLICY "Self update profile" ON public.admin_users
    FOR UPDATE
    USING (auth_user_id = auth.uid())
    WITH CHECK (auth_user_id = auth.uid());

-- السماح للمالك (Owner) بإدارة كل شيء
DROP POLICY IF EXISTS "Owner manage all admins" ON public.admin_users;
CREATE POLICY "Owner manage all admins" ON public.admin_users
    FOR ALL
    USING (
        EXISTS (
            SELECT 1 FROM public.admin_users 
            WHERE auth_user_id = auth.uid() 
            AND role = 'owner'
            AND is_active = true
        )
    );

-- 2. إصلاح جدول orders
-- السماح للمشرفين النشطين بإدارة الطلبات
DROP POLICY IF EXISTS "Admin manage orders" ON public.orders;
CREATE POLICY "Admin manage orders" ON public.orders
    FOR ALL
    USING (
        EXISTS (
            SELECT 1 FROM public.admin_users 
            WHERE auth_user_id = auth.uid() 
            AND is_active = true
        )
    );

-- 3. إصلاح جدول stock_management
-- السماح للمشرفين النشطين بإدارة المخزون
DROP POLICY IF EXISTS "Admin manage stock" ON public.stock_management;
CREATE POLICY "Admin manage stock" ON public.stock_management
    FOR ALL
    USING (
        EXISTS (
            SELECT 1 FROM public.admin_users 
            WHERE auth_user_id = auth.uid() 
            AND is_active = true
        )
    );

-- 4. إصلاح جدول stock_history (مهم جداً لتسجيل الحركات)
-- السماح للمشرفين بإدخال سجلات التاريخ
DROP POLICY IF EXISTS "Admin insert history" ON public.stock_history;
CREATE POLICY "Admin insert history" ON public.stock_history
    FOR INSERT
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.admin_users 
            WHERE auth_user_id = auth.uid() 
            AND is_active = true
        )
    );

-- السماح بقراءة التاريخ للجميع (أو للمشرفين فقط حسب الحاجة، هنا نجعله للمشرفين)
DROP POLICY IF EXISTS "Admin read history" ON public.stock_history;
CREATE POLICY "Admin read history" ON public.stock_history
    FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM public.admin_users 
            WHERE auth_user_id = auth.uid() 
            AND is_active = true
        )
    );

