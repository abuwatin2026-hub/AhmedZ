-- Phase 3: International Imports System

-- 1. جدول الشحنات (Import Shipments)
CREATE TABLE import_shipments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reference_number TEXT UNIQUE NOT NULL, -- مثل رقم البوليصة
  supplier_id UUID REFERENCES suppliers(id), -- اختياري، للشحنات المجمعة
  status TEXT NOT NULL CHECK (status IN ('draft', 'ordered', 'shipped', 'at_customs', 'cleared', 'delivered', 'cancelled')),
  origin_country TEXT,
  destination_warehouse_id UUID REFERENCES warehouses(id),
  shipping_carrier TEXT,
  tracking_number TEXT,
  departure_date DATE,
  expected_arrival_date DATE,
  actual_arrival_date DATE,
  total_weight_kg NUMERIC DEFAULT 0 CHECK (total_weight_kg >= 0),
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  created_by UUID REFERENCES auth.users(id)
);

-- 2. جدول عناصر الشحنة (Shipment Items)
CREATE TABLE import_shipments_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shipment_id UUID NOT NULL REFERENCES import_shipments(id) ON DELETE CASCADE,
  item_id TEXT NOT NULL REFERENCES menu_items(id),
  quantity NUMERIC NOT NULL CHECK (quantity > 0),
  unit_price_fob NUMERIC NOT NULL DEFAULT 0 CHECK (unit_price_fob >= 0), -- سعر الشراء من المصدر
  currency TEXT DEFAULT 'USD',
  expiry_date DATE,
  landing_cost_per_unit NUMERIC DEFAULT 0, -- سيتم حسابه لاحقاً
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. جدول مصاريف الشحنة (Shipment Expenses)
CREATE TABLE import_expenses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shipment_id UUID NOT NULL REFERENCES import_shipments(id) ON DELETE CASCADE,
  expense_type TEXT NOT NULL CHECK (expense_type IN ('shipping', 'customs', 'insurance', 'clearance', 'transport', 'other')),
  amount NUMERIC NOT NULL CHECK (amount >= 0),
  currency TEXT DEFAULT 'YER', -- العملة المدفوعة بها
  exchange_rate NUMERIC DEFAULT 1, -- سعر الصرف مقابل عملة النظام الأساسية وقت الدفع
  description TEXT,
  invoice_number TEXT,
  paid_at DATE,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE import_shipments ENABLE ROW LEVEL SECURITY;
ALTER TABLE import_shipments_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE import_expenses ENABLE ROW LEVEL SECURITY;

-- 4. RLS Policies

-- Import Shipments Policies
CREATE POLICY "Admin users can manage import_shipments" ON import_shipments
  FOR ALL
  USING (
    EXISTS (SELECT 1 FROM admin_users au WHERE au.auth_user_id = auth.uid() AND au.is_active = true)
  );

-- Import Shipment Items Policies
CREATE POLICY "Admin users can manage import_shipments_items" ON import_shipments_items
  FOR ALL
  USING (
    EXISTS (SELECT 1 FROM admin_users au WHERE au.auth_user_id = auth.uid() AND au.is_active = true)
  );

-- Import Expenses Policies
CREATE POLICY "Admin users can manage import_expenses" ON import_expenses
  FOR ALL
  USING (
    EXISTS (SELECT 1 FROM admin_users au WHERE au.auth_user_id = auth.uid() AND au.is_active = true)
  );

-- 5. Indexes for Performance
CREATE INDEX idx_import_shipments_status ON import_shipments(status);
CREATE INDEX idx_import_shipments_supplier ON import_shipments(supplier_id);
CREATE INDEX idx_import_items_shipment ON import_shipments_items(shipment_id);
CREATE INDEX idx_import_expenses_shipment ON import_expenses(shipment_id);

-- 6. RPC Function to Calculate Landed Cost (Initial Version)
-- هذه الدالة تقوم بتوزيع المصاريف على الأصناف بناءً على قيمة كل صنف (Weighted Average)
CREATE OR REPLACE FUNCTION calculate_shipment_landed_cost(p_shipment_id UUID)
RETURNS VOID AS $$
DECLARE
  v_total_fob_value NUMERIC;
  v_total_expenses NUMERIC;
  v_item RECORD;
BEGIN
  -- 1. حساب إجمالي قيمة البضاعة (FOB)
  SELECT COALESCE(SUM(quantity * unit_price_fob), 0) INTO v_total_fob_value
  FROM import_shipments_items
  WHERE shipment_id = p_shipment_id;

  IF v_total_fob_value = 0 THEN
    RETURN; -- لا يمكن الحساب بدون أصناف
  END IF;

  -- 2. حساب إجمالي المصاريف (مع تحويل العملة إذا لزم الأمر - هنا نفترض توحيد العملة مبدئياً أو أن exchange_rate مضبوط)
  SELECT COALESCE(SUM(amount * exchange_rate), 0) INTO v_total_expenses
  FROM import_expenses
  WHERE shipment_id = p_shipment_id;

  -- 3. تحديث تكلفة كل صنف
  -- Landed Cost = FOB Unit Price + (Unit Share of Expenses)
  -- Unit Share of Expenses = (Unit FOB Price / Total FOB Value) * Total Expenses
  -- أو ببساطة: Factor = Total Expenses / Total FOB Value
  -- New Unit Cost = Unit Price * (1 + Factor)
  
  FOR v_item IN (SELECT id, unit_price_fob FROM import_shipments_items WHERE shipment_id = p_shipment_id)
  LOOP
    UPDATE import_shipments_items
    SET landing_cost_per_unit = v_item.unit_price_fob * (1 + (v_total_expenses / v_total_fob_value))
    WHERE id = v_item.id;
  END LOOP;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
