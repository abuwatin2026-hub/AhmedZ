-- Migration: نظام التسعير المتدرج
-- التاريخ: 2026-01-20
-- الوصف: إضافة نظام تسعير متدرج حسب الكمية ونوع العميل

-- ==========================================
-- 1. جدول شرائح الأسعار
-- ==========================================
CREATE TABLE IF NOT EXISTS public.price_tiers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id TEXT NOT NULL REFERENCES public.menu_items(id) ON DELETE CASCADE,
  customer_type TEXT NOT NULL CHECK (customer_type IN ('retail', 'wholesale', 'distributor', 'vip')),
  min_quantity NUMERIC NOT NULL CHECK (min_quantity >= 0),
  max_quantity NUMERIC CHECK (max_quantity IS NULL OR max_quantity >= min_quantity),
  price NUMERIC NOT NULL CHECK (price >= 0),
  discount_percentage NUMERIC CHECK (discount_percentage >= 0 AND discount_percentage <= 100),
  is_active BOOLEAN DEFAULT true,
  valid_from DATE,
  valid_to DATE,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (item_id, customer_type, min_quantity)
);

-- ==========================================
-- 2. جدول الأسعار الخاصة للعملاء
-- ==========================================
CREATE TABLE IF NOT EXISTS public.customer_special_prices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID NOT NULL REFERENCES public.customers(auth_user_id) ON DELETE CASCADE,
  item_id TEXT NOT NULL REFERENCES public.menu_items(id) ON DELETE CASCADE,
  special_price NUMERIC NOT NULL CHECK (special_price >= 0),
  valid_from DATE NOT NULL,
  valid_to DATE,
  notes TEXT,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (customer_id, item_id)
);

-- ==========================================
-- 3. تعديل جدول العملاء
-- ==========================================

-- إضافة نوع العميل
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'customers' AND column_name = 'customer_type'
  ) THEN
    ALTER TABLE public.customers 
    ADD COLUMN customer_type TEXT DEFAULT 'retail' 
    CHECK (customer_type IN ('retail', 'wholesale', 'distributor', 'vip'));
  END IF;
END $$;

-- إضافة حد الائتمان
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'customers' AND column_name = 'credit_limit'
  ) THEN
    ALTER TABLE public.customers 
    ADD COLUMN credit_limit NUMERIC DEFAULT 0 CHECK (credit_limit >= 0);
  END IF;
END $$;

-- إضافة الرصيد الحالي
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'customers' AND column_name = 'current_balance'
  ) THEN
    ALTER TABLE public.customers 
    ADD COLUMN current_balance NUMERIC DEFAULT 0;
  END IF;
END $$;

-- إضافة شروط الدفع
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'customers' AND column_name = 'payment_terms'
  ) THEN
    ALTER TABLE public.customers 
    ADD COLUMN payment_terms TEXT DEFAULT 'cash' 
    CHECK (payment_terms IN ('cash', 'net_7', 'net_15', 'net_30', 'net_60', 'net_90'));
  END IF;
END $$;

-- إضافة الرقم الضريبي
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'customers' AND column_name = 'tax_number'
  ) THEN
    ALTER TABLE public.customers 
    ADD COLUMN tax_number TEXT;
  END IF;
END $$;

-- إضافة العنوان التجاري
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'customers' AND column_name = 'business_name'
  ) THEN
    ALTER TABLE public.customers 
    ADD COLUMN business_name TEXT;
  END IF;
END $$;

-- ==========================================
-- 4. الفهارس
-- ==========================================
CREATE INDEX IF NOT EXISTS idx_price_tiers_item ON public.price_tiers(item_id);
CREATE INDEX IF NOT EXISTS idx_price_tiers_customer_type ON public.price_tiers(customer_type);
CREATE INDEX IF NOT EXISTS idx_price_tiers_active ON public.price_tiers(is_active);
CREATE INDEX IF NOT EXISTS idx_special_prices_customer ON public.customer_special_prices(customer_id);
CREATE INDEX IF NOT EXISTS idx_special_prices_item ON public.customer_special_prices(item_id);
CREATE INDEX IF NOT EXISTS idx_customers_type ON public.customers(customer_type);

-- ==========================================
-- 5. RLS Policies
-- ==========================================

-- تفعيل RLS
ALTER TABLE public.price_tiers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customer_special_prices ENABLE ROW LEVEL SECURITY;

-- سياسات شرائح الأسعار
DROP POLICY IF EXISTS price_tiers_select ON public.price_tiers;
CREATE POLICY price_tiers_select ON public.price_tiers 
  FOR SELECT USING (true);

DROP POLICY IF EXISTS price_tiers_manage ON public.price_tiers;
CREATE POLICY price_tiers_manage ON public.price_tiers 
  FOR ALL USING (
    public.has_admin_permission('prices.manage')
  );

-- سياسات الأسعار الخاصة
DROP POLICY IF EXISTS special_prices_select ON public.customer_special_prices;
CREATE POLICY special_prices_select ON public.customer_special_prices 
  FOR SELECT USING (
    auth.uid() = customer_id OR 
    public.is_admin()
  );

DROP POLICY IF EXISTS special_prices_manage ON public.customer_special_prices;
CREATE POLICY special_prices_manage ON public.customer_special_prices 
  FOR ALL USING (
    public.has_admin_permission('prices.manage')
  );

-- ==========================================
-- 6. دالة حساب السعر
-- ==========================================
CREATE OR REPLACE FUNCTION public.get_item_price(
  p_item_id TEXT,
  p_quantity NUMERIC,
  p_customer_id UUID DEFAULT NULL
) RETURNS NUMERIC AS $$
DECLARE
  v_customer_type TEXT;
  v_special_price NUMERIC;
  v_tier_price NUMERIC;
  v_base_price NUMERIC;
BEGIN
  -- إذا لم يكن هناك عميل، استخدم سعر التجزئة
  IF p_customer_id IS NULL THEN
    v_customer_type := 'retail';
  ELSE
    IF auth.uid() IS NULL THEN
      v_customer_type := 'retail';
    ELSIF p_customer_id <> auth.uid() AND not public.is_admin() THEN
      v_customer_type := 'retail';
    ELSE
    -- الحصول على نوع العميل
    SELECT COALESCE(customer_type, 'retail') INTO v_customer_type 
    FROM public.customers WHERE auth_user_id = p_customer_id;
    
    IF NOT FOUND THEN
      v_customer_type := 'retail';
    END IF;
    
    -- التحقق من السعر الخاص
    SELECT special_price INTO v_special_price
    FROM public.customer_special_prices
    WHERE customer_id = p_customer_id 
      AND item_id = p_item_id
      AND (valid_from IS NULL OR valid_from <= CURRENT_DATE)
      AND (valid_to IS NULL OR valid_to >= CURRENT_DATE);
    
    IF v_special_price IS NOT NULL THEN
      RETURN v_special_price;
    END IF;
    END IF;
  END IF;
  
  -- التحقق من شريحة السعر
  SELECT price INTO v_tier_price
  FROM public.price_tiers
  WHERE item_id = p_item_id
    AND customer_type = v_customer_type
    AND min_quantity <= p_quantity
    AND (max_quantity IS NULL OR max_quantity >= p_quantity)
    AND is_active = true
    AND (valid_from IS NULL OR valid_from <= CURRENT_DATE)
    AND (valid_to IS NULL OR valid_to >= CURRENT_DATE)
  ORDER BY min_quantity DESC
  LIMIT 1;
  
  IF v_tier_price IS NOT NULL THEN
    RETURN v_tier_price;
  END IF;
  
  -- السعر الأساسي من menu_items
  SELECT (data->>'price')::NUMERIC INTO v_base_price
  FROM public.menu_items WHERE id = p_item_id;
  
  RETURN COALESCE(v_base_price, 0);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ==========================================
-- 7. دالة حساب الخصم
-- ==========================================
CREATE OR REPLACE FUNCTION public.get_item_discount(
  p_item_id TEXT,
  p_quantity NUMERIC,
  p_customer_id UUID DEFAULT NULL
) RETURNS NUMERIC AS $$
DECLARE
  v_customer_type TEXT;
  v_discount NUMERIC;
  v_base_price NUMERIC;
  v_tier_price NUMERIC;
BEGIN
  -- إذا لم يكن هناك عميل، لا خصم
  IF p_customer_id IS NULL THEN
    RETURN 0;
  END IF;

  IF auth.uid() IS NULL THEN
    RETURN 0;
  END IF;

  IF p_customer_id <> auth.uid() AND not public.is_admin() THEN
    RETURN 0;
  END IF;
  
  -- الحصول على نوع العميل
  SELECT COALESCE(customer_type, 'retail') INTO v_customer_type 
  FROM public.customers WHERE auth_user_id = p_customer_id;
  
  IF NOT FOUND THEN
    RETURN 0;
  END IF;
  
  -- التحقق من نسبة الخصم في شريحة السعر
  SELECT discount_percentage INTO v_discount
  FROM public.price_tiers
  WHERE item_id = p_item_id
    AND customer_type = v_customer_type
    AND min_quantity <= p_quantity
    AND (max_quantity IS NULL OR max_quantity >= p_quantity)
    AND is_active = true
    AND (valid_from IS NULL OR valid_from <= CURRENT_DATE)
    AND (valid_to IS NULL OR valid_to >= CURRENT_DATE)
    AND discount_percentage IS NOT NULL
  ORDER BY min_quantity DESC
  LIMIT 1;
  
  RETURN COALESCE(v_discount, 0);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ==========================================
-- 8. دالة الحصول على جميع الأسعار لمنتج
-- ==========================================
CREATE OR REPLACE FUNCTION public.get_item_all_prices(
  p_item_id TEXT
) RETURNS TABLE (
  customer_type TEXT,
  min_qty NUMERIC,
  max_qty NUMERIC,
  price NUMERIC,
  discount_pct NUMERIC
) AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'not allowed';
  END IF;

  RETURN QUERY
  SELECT 
    pt.customer_type,
    pt.min_quantity,
    pt.max_quantity,
    pt.price,
    pt.discount_percentage
  FROM public.price_tiers pt
  WHERE pt.item_id = p_item_id
    AND pt.is_active = true
    AND (pt.valid_from IS NULL OR pt.valid_from <= CURRENT_DATE)
    AND (pt.valid_to IS NULL OR pt.valid_to >= CURRENT_DATE)
  ORDER BY pt.customer_type, pt.min_quantity;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ==========================================
-- 9. دالة التحقق من حد الائتمان
-- ==========================================
CREATE OR REPLACE FUNCTION public.check_customer_credit_limit(
  p_customer_id UUID,
  p_order_amount NUMERIC
) RETURNS BOOLEAN AS $$
DECLARE
  v_credit_limit NUMERIC;
  v_current_balance NUMERIC;
  v_payment_terms TEXT;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN false;
  END IF;

  IF p_customer_id <> auth.uid() AND not public.is_admin() THEN
    RETURN false;
  END IF;

  -- الحصول على معلومات العميل
  SELECT 
    COALESCE(credit_limit, 0),
    COALESCE(current_balance, 0),
    COALESCE(payment_terms, 'cash')
  INTO v_credit_limit, v_current_balance, v_payment_terms
  FROM public.customers 
  WHERE auth_user_id = p_customer_id;
  
  IF NOT FOUND THEN
    RETURN false;
  END IF;
  
  -- إذا كان الدفع نقدي، لا حاجة للتحقق
  IF v_payment_terms = 'cash' THEN
    RETURN true;
  END IF;
  
  -- التحقق من أن الرصيد + المبلغ الجديد لا يتجاوز الحد
  IF (v_current_balance + p_order_amount) > v_credit_limit THEN
    RETURN false;
  END IF;
  
  RETURN true;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ==========================================
-- 10. Trigger لتحديث updated_at
-- ==========================================
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_price_tiers_updated_at ON public.price_tiers;
CREATE TRIGGER trg_price_tiers_updated_at
  BEFORE UPDATE ON public.price_tiers
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS trg_special_prices_updated_at ON public.customer_special_prices;
CREATE TRIGGER trg_special_prices_updated_at
  BEFORE UPDATE ON public.customer_special_prices
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- ==========================================
-- 11. بيانات افتراضية - أمثلة لشرائح الأسعار
-- ==========================================
-- يمكن إضافة بيانات تجريبية هنا إذا لزم الأمر

-- ==========================================
-- 12. تسجيل في سجل التدقيق
-- ==========================================
DO $$
BEGIN
  INSERT INTO public.system_audit_log (id, action, module, details, performed_by, performed_at)
  VALUES (
    gen_random_uuid(),
    'pricing_system_installed',
    'settings',
    'Installed tiered pricing system with customer types and special prices',
    NULL,
    NOW()
  );
EXCEPTION WHEN OTHERS THEN
  -- تجاهل الخطأ إذا كان جدول التدقيق غير موجود
  NULL;
END $$;
