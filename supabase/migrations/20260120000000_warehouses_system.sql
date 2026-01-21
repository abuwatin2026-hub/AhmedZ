-- Migration: نظام المخازن المتعددة
-- التاريخ: 2026-01-20
-- الوصف: إضافة دعم المخازن المتعددة لتجارة الجملة

-- ==========================================
-- 1. جدول المخازن
-- ==========================================
CREATE TABLE IF NOT EXISTS public.warehouses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('main', 'branch', 'incoming', 'cold_storage')),
  location TEXT,
  address TEXT,
  manager_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  phone TEXT,
  is_active BOOLEAN DEFAULT true,
  capacity_limit NUMERIC,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ==========================================
-- 2. جدول نقل البضائع بين المخازن
-- ==========================================
CREATE TABLE IF NOT EXISTS public.warehouse_transfers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transfer_number TEXT UNIQUE NOT NULL,
  from_warehouse_id UUID NOT NULL REFERENCES public.warehouses(id),
  to_warehouse_id UUID NOT NULL REFERENCES public.warehouses(id),
  transfer_date DATE NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'in_transit', 'completed', 'cancelled')),
  notes TEXT,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  approved_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  CHECK (from_warehouse_id != to_warehouse_id)
);

-- ==========================================
-- 3. جدول أصناف النقل
-- ==========================================
CREATE TABLE IF NOT EXISTS public.warehouse_transfer_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transfer_id UUID NOT NULL REFERENCES public.warehouse_transfers(id) ON DELETE CASCADE,
  item_id TEXT NOT NULL REFERENCES public.menu_items(id),
  quantity NUMERIC NOT NULL CHECK (quantity > 0),
  transferred_quantity NUMERIC DEFAULT 0 CHECK (transferred_quantity >= 0),
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ==========================================
-- 4. تعديل جدول المخزون لدعم المخازن
-- ==========================================

-- إضافة عمود warehouse_id (nullable في البداية)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'stock_management' AND column_name = 'warehouse_id'
  ) THEN
    ALTER TABLE public.stock_management 
    ADD COLUMN warehouse_id UUID REFERENCES public.warehouses(id) ON DELETE CASCADE;
  END IF;
END $$;

-- إنشاء مخزن افتراضي إذا لم يكن موجودًا
INSERT INTO public.warehouses (code, name, type, is_active)
VALUES ('MAIN', 'المخزن الرئيسي', 'main', true)
ON CONFLICT (code) DO NOTHING;

-- تحديث السجلات الحالية لتشير للمخزن الرئيسي
UPDATE public.stock_management 
SET warehouse_id = (SELECT id FROM public.warehouses WHERE code = 'MAIN')
WHERE warehouse_id IS NULL;

-- جعل warehouse_id إلزامي
ALTER TABLE public.stock_management 
ALTER COLUMN warehouse_id SET NOT NULL;

-- إنشاء فهرس مركب فريد
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes 
    WHERE indexname = 'idx_stock_item_warehouse'
  ) THEN
    -- حذف القيد الفريد القديم إن وجد
    ALTER TABLE public.stock_management DROP CONSTRAINT IF EXISTS stock_management_id_key;
    
    -- إنشاء فهرس فريد جديد
    CREATE UNIQUE INDEX idx_stock_item_warehouse ON public.stock_management(item_id, warehouse_id);
  END IF;
END $$;

-- ==========================================
-- 5. الفهارس
-- ==========================================
CREATE INDEX IF NOT EXISTS idx_warehouses_active ON public.warehouses(is_active);
CREATE INDEX IF NOT EXISTS idx_warehouses_type ON public.warehouses(type);
CREATE INDEX IF NOT EXISTS idx_transfers_status ON public.warehouse_transfers(status);
CREATE INDEX IF NOT EXISTS idx_transfers_date ON public.warehouse_transfers(transfer_date);
CREATE INDEX IF NOT EXISTS idx_transfer_items_transfer ON public.warehouse_transfer_items(transfer_id);

-- ==========================================
-- 6. RLS Policies
-- ==========================================

-- تفعيل RLS
ALTER TABLE public.warehouses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.warehouse_transfers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.warehouse_transfer_items ENABLE ROW LEVEL SECURITY;

-- سياسات المخازن
DROP POLICY IF EXISTS warehouses_select ON public.warehouses;
CREATE POLICY warehouses_select ON public.warehouses 
  FOR SELECT USING (true);

DROP POLICY IF EXISTS warehouses_manage ON public.warehouses;
CREATE POLICY warehouses_manage ON public.warehouses 
  FOR ALL USING (
    EXISTS (SELECT 1 FROM public.admin_users WHERE auth_user_id = auth.uid() AND is_active = true)
  );

-- سياسات نقل البضائع
DROP POLICY IF EXISTS transfers_select ON public.warehouse_transfers;
CREATE POLICY transfers_select ON public.warehouse_transfers 
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.admin_users WHERE auth_user_id = auth.uid() AND is_active = true)
  );

DROP POLICY IF EXISTS transfers_manage ON public.warehouse_transfers;
CREATE POLICY transfers_manage ON public.warehouse_transfers 
  FOR ALL USING (
    EXISTS (SELECT 1 FROM public.admin_users WHERE auth_user_id = auth.uid() AND is_active = true)
  );

-- سياسات أصناف النقل
DROP POLICY IF EXISTS transfer_items_select ON public.warehouse_transfer_items;
CREATE POLICY transfer_items_select ON public.warehouse_transfer_items 
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.admin_users WHERE auth_user_id = auth.uid() AND is_active = true)
  );

DROP POLICY IF EXISTS transfer_items_manage ON public.warehouse_transfer_items;
CREATE POLICY transfer_items_manage ON public.warehouse_transfer_items 
  FOR ALL USING (
    EXISTS (SELECT 1 FROM public.admin_users WHERE auth_user_id = auth.uid() AND is_active = true)
  );

-- ==========================================
-- 7. دالة إتمام النقل
-- ==========================================
CREATE OR REPLACE FUNCTION public.complete_warehouse_transfer(
  p_transfer_id UUID
) RETURNS VOID AS $$
DECLARE
  v_item RECORD;
  v_from_warehouse UUID;
  v_to_warehouse UUID;
  v_transfer_date DATE;
BEGIN
  -- الحصول على معلومات النقل
  SELECT from_warehouse_id, to_warehouse_id, transfer_date
  INTO v_from_warehouse, v_to_warehouse, v_transfer_date
  FROM public.warehouse_transfers 
  WHERE id = p_transfer_id AND status = 'pending';
  
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Transfer not found or not pending';
  END IF;
  
  -- نقل الأصناف
  FOR v_item IN 
    SELECT item_id, quantity 
    FROM public.warehouse_transfer_items 
    WHERE transfer_id = p_transfer_id
  LOOP
    -- التحقق من توفر الكمية في المخزن المصدر
    IF NOT EXISTS (
      SELECT 1 FROM public.stock_management
      WHERE item_id = v_item.item_id 
        AND warehouse_id = v_from_warehouse
        AND available_quantity >= v_item.quantity
    ) THEN
      RAISE EXCEPTION 'Insufficient stock for item % in source warehouse', v_item.item_id;
    END IF;
    
    -- خصم من المخزن المصدر
    UPDATE public.stock_management
    SET 
      available_quantity = available_quantity - v_item.quantity,
      last_updated = NOW()
    WHERE item_id = v_item.item_id 
      AND warehouse_id = v_from_warehouse;
    
    -- إضافة للمخزن الوجهة
    INSERT INTO public.stock_management (id, item_id, warehouse_id, available_quantity, unit, reserved_quantity, last_updated)
    SELECT 
      gen_random_uuid(),
      v_item.item_id,
      v_to_warehouse,
      v_item.quantity,
      sm.unit,
      0,
      NOW()
    FROM public.stock_management sm
    WHERE sm.item_id = v_item.item_id AND sm.warehouse_id = v_from_warehouse
    LIMIT 1
    ON CONFLICT (item_id, warehouse_id) 
    DO UPDATE SET 
      available_quantity = public.stock_management.available_quantity + v_item.quantity,
      last_updated = NOW();
    
    -- تسجيل حركة المخزون - خروج من المصدر
    INSERT INTO public.inventory_movements (
      id, item_id, movement_type, quantity, unit_cost, total_cost,
      reference_table, reference_id, occurred_at, created_by, created_at
    )
    SELECT 
      gen_random_uuid(),
      v_item.item_id,
      'adjust_out',
      v_item.quantity,
      COALESCE(sm.avg_cost, 0),
      COALESCE(sm.avg_cost, 0) * v_item.quantity,
      'warehouse_transfers',
      p_transfer_id::text,
      v_transfer_date::timestamptz,
      auth.uid(),
      NOW()
    FROM public.stock_management sm
    WHERE sm.item_id = v_item.item_id AND sm.warehouse_id = v_from_warehouse
    LIMIT 1;
    
    -- تسجيل حركة المخزون - دخول للوجهة
    INSERT INTO public.inventory_movements (
      id, item_id, movement_type, quantity, unit_cost, total_cost,
      reference_table, reference_id, occurred_at, created_by, created_at
    )
    SELECT 
      gen_random_uuid(),
      v_item.item_id,
      'adjust_in',
      v_item.quantity,
      COALESCE(sm.avg_cost, 0),
      COALESCE(sm.avg_cost, 0) * v_item.quantity,
      'warehouse_transfers',
      p_transfer_id::text,
      v_transfer_date::timestamptz,
      auth.uid(),
      NOW()
    FROM public.stock_management sm
    WHERE sm.item_id = v_item.item_id AND sm.warehouse_id = v_from_warehouse
    LIMIT 1;
    
    -- تحديث الكمية المنقولة
    UPDATE public.warehouse_transfer_items
    SET transferred_quantity = v_item.quantity
    WHERE transfer_id = p_transfer_id AND item_id = v_item.item_id;
  END LOOP;
  
  -- تحديث حالة النقل
  UPDATE public.warehouse_transfers
  SET 
    status = 'completed', 
    completed_at = NOW(),
    approved_by = auth.uid()
  WHERE id = p_transfer_id;
  
  -- تسجيل في سجل التدقيق
  INSERT INTO public.system_audit_log (id, action, module, details, performed_by, performed_at)
  VALUES (
    gen_random_uuid(),
    'warehouse_transfer_completed',
    'inventory',
    format('Completed transfer %s from warehouse %s to %s', p_transfer_id, v_from_warehouse, v_to_warehouse),
    auth.uid()::text,
    NOW()
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ==========================================
-- 8. دالة إلغاء النقل
-- ==========================================
CREATE OR REPLACE FUNCTION public.cancel_warehouse_transfer(
  p_transfer_id UUID,
  p_reason TEXT DEFAULT NULL
) RETURNS VOID AS $$
BEGIN
  -- التحقق من أن النقل قيد الانتظار
  IF NOT EXISTS (
    SELECT 1 FROM public.warehouse_transfers 
    WHERE id = p_transfer_id AND status = 'pending'
  ) THEN
    RAISE EXCEPTION 'Transfer not found or cannot be cancelled';
  END IF;
  
  -- تحديث الحالة
  UPDATE public.warehouse_transfers
  SET 
    status = 'cancelled',
    notes = COALESCE(notes || E'\n', '') || 'ملغي: ' || COALESCE(p_reason, 'بدون سبب')
  WHERE id = p_transfer_id;
  
  -- تسجيل في سجل التدقيق
  INSERT INTO public.system_audit_log (id, action, module, details, performed_by, performed_at)
  VALUES (
    gen_random_uuid(),
    'warehouse_transfer_cancelled',
    'inventory',
    format('Cancelled transfer %s. Reason: %s', p_transfer_id, COALESCE(p_reason, 'No reason')),
    auth.uid()::text,
    NOW()
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ==========================================
-- 9. دالة توليد رقم النقل
-- ==========================================
CREATE OR REPLACE FUNCTION public.generate_transfer_number()
RETURNS TEXT AS $$
DECLARE
  v_date TEXT;
  v_seq INT;
  v_number TEXT;
BEGIN
  v_date := TO_CHAR(CURRENT_DATE, 'YYYYMMDD');
  
  SELECT COALESCE(MAX(
    CASE 
      WHEN transfer_number LIKE 'TRF-' || v_date || '-%' 
      THEN SUBSTRING(transfer_number FROM LENGTH('TRF-' || v_date || '-') + 1)::INT
      ELSE 0
    END
  ), 0) + 1
  INTO v_seq
  FROM public.warehouse_transfers;
  
  v_number := 'TRF-' || v_date || '-' || LPAD(v_seq::TEXT, 4, '0');
  
  RETURN v_number;
END;
$$ LANGUAGE plpgsql;

-- ==========================================
-- 10. Trigger لتوليد رقم النقل تلقائيًا
-- ==========================================
CREATE OR REPLACE FUNCTION public.set_transfer_number()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.transfer_number IS NULL OR NEW.transfer_number = '' THEN
    NEW.transfer_number := public.generate_transfer_number();
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_set_transfer_number ON public.warehouse_transfers;
CREATE TRIGGER trg_set_transfer_number
  BEFORE INSERT ON public.warehouse_transfers
  FOR EACH ROW
  EXECUTE FUNCTION public.set_transfer_number();
