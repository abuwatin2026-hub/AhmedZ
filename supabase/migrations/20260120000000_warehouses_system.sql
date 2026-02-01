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

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'warehouse_transfer_items' AND column_name = 'batch_id'
  ) THEN
    ALTER TABLE public.warehouse_transfer_items
      ADD COLUMN batch_id UUID;
  END IF;
END $$;

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

-- Clean install: لا يتم إنشاء مخزن افتراضي

-- إبقاء العمود، ويمكن جعله إلزامياً بعد وجود بيانات

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

DO $$
BEGIN
  IF to_regclass('public.inventory_movements') is not null
     AND NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'inventory_movements' AND column_name = 'warehouse_id'
     ) THEN
    ALTER TABLE public.inventory_movements
      ADD COLUMN warehouse_id UUID REFERENCES public.warehouses(id) ON DELETE SET NULL;
    CREATE INDEX IF NOT EXISTS idx_inventory_movements_warehouse_item_date
      ON public.inventory_movements(warehouse_id, item_id, occurred_at desc);
    CREATE INDEX IF NOT EXISTS idx_inventory_movements_warehouse_batch
      ON public.inventory_movements(warehouse_id, batch_id);
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
  v_sm_from record;
  v_is_food boolean;
  v_reserved_batches jsonb;
  v_remaining numeric;
  v_batch record;
  v_batch_reserved numeric;
  v_free numeric;
  v_alloc numeric;
  v_unit_cost numeric;
  v_movement_out uuid;
  v_movement_in uuid;
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
    SELECT id, item_id, quantity, batch_id
    FROM public.warehouse_transfer_items 
    WHERE transfer_id = p_transfer_id
  LOOP
    select *
    into v_sm_from
    from public.stock_management sm
    where sm.item_id = v_item.item_id
      and sm.warehouse_id = v_from_warehouse
    for update;

    if not found then
      raise exception 'Stock record not found for item % in source warehouse', v_item.item_id;
    end if;

    select coalesce(mi.category = 'food', false)
    into v_is_food
    from public.menu_items mi
    where mi.id = v_item.item_id;

    v_is_food := coalesce(v_is_food, false);

    if coalesce(v_sm_from.available_quantity, 0) + 1e-9 < v_item.quantity then
      raise exception 'Insufficient stock for item % in source warehouse', v_item.item_id;
    end if;
    
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
    
    if not v_is_food then
      INSERT INTO public.inventory_movements (
        id, item_id, movement_type, quantity, unit_cost, total_cost,
        reference_table, reference_id, occurred_at, created_by, created_at, warehouse_id, data
      )
      VALUES (
        gen_random_uuid(),
        v_item.item_id,
        'adjust_out',
        v_item.quantity,
        COALESCE(v_sm_from.avg_cost, 0),
        COALESCE(v_sm_from.avg_cost, 0) * v_item.quantity,
        'warehouse_transfers',
        p_transfer_id::text,
        v_transfer_date::timestamptz,
        auth.uid(),
        NOW(),
        v_from_warehouse,
        jsonb_build_object('warehouseId', v_from_warehouse, 'toWarehouseId', v_to_warehouse)
      )
      returning id into v_movement_out;

      INSERT INTO public.inventory_movements (
        id, item_id, movement_type, quantity, unit_cost, total_cost,
        reference_table, reference_id, occurred_at, created_by, created_at, warehouse_id, data
      )
      VALUES (
        gen_random_uuid(),
        v_item.item_id,
        'adjust_in',
        v_item.quantity,
        COALESCE(v_sm_from.avg_cost, 0),
        COALESCE(v_sm_from.avg_cost, 0) * v_item.quantity,
        'warehouse_transfers',
        p_transfer_id::text,
        v_transfer_date::timestamptz,
        auth.uid(),
        NOW(),
        v_to_warehouse,
        jsonb_build_object('warehouseId', v_to_warehouse, 'fromWarehouseId', v_from_warehouse)
      )
      returning id into v_movement_in;
    else
      v_reserved_batches := coalesce(v_sm_from.data->'reservedBatches', '{}'::jsonb);
      v_remaining := v_item.quantity;

      if v_item.batch_id is not null then
        select im.unit_cost
        into v_unit_cost
        from public.inventory_movements im
        where im.batch_id = v_item.batch_id
          and im.movement_type = 'purchase_in'
        order by im.occurred_at asc
        limit 1;

        v_unit_cost := coalesce(v_unit_cost, v_sm_from.avg_cost, 0);

        select
          coalesce(sum(coalesce(nullif(x->>'qty','')::numeric, 0)), 0)
        into v_batch_reserved
        from jsonb_array_elements(
          case
            when jsonb_typeof(v_reserved_batches -> (v_item.batch_id::text)) = 'array' then (v_reserved_batches -> (v_item.batch_id::text))
            when jsonb_typeof(v_reserved_batches -> (v_item.batch_id::text)) = 'object' then jsonb_build_array(v_reserved_batches -> (v_item.batch_id::text))
            when jsonb_typeof(v_reserved_batches -> (v_item.batch_id::text)) = 'number' then jsonb_build_array(jsonb_build_object('qty', (v_reserved_batches -> (v_item.batch_id::text))))
            else '[]'::jsonb
          end
        ) as x;

        select greatest(coalesce(b.remaining_qty, 0) - coalesce(v_batch_reserved, 0), 0)
        into v_free
        from public.v_food_batch_balances b
        where b.item_id::text = v_item.item_id
          and b.batch_id = v_item.batch_id
          and b.warehouse_id = v_from_warehouse;

        if coalesce(v_free, 0) + 1e-9 < v_item.quantity then
          raise exception 'Insufficient non-reserved batch stock for item % batch % in source warehouse', v_item.item_id, v_item.batch_id;
        end if;

        insert into public.inventory_movements (
          id, item_id, movement_type, quantity, unit_cost, total_cost,
          reference_table, reference_id, occurred_at, created_by, created_at, warehouse_id, data, batch_id
        )
        values (
          gen_random_uuid(),
          v_item.item_id,
          'adjust_out',
          v_item.quantity,
          v_unit_cost,
          v_unit_cost * v_item.quantity,
          'warehouse_transfers',
          p_transfer_id::text,
          v_transfer_date::timestamptz,
          auth.uid(),
          now(),
          v_from_warehouse,
          jsonb_build_object('warehouseId', v_from_warehouse, 'toWarehouseId', v_to_warehouse, 'batchId', v_item.batch_id),
          v_item.batch_id
        )
        returning id into v_movement_out;

        insert into public.inventory_movements (
          id, item_id, movement_type, quantity, unit_cost, total_cost,
          reference_table, reference_id, occurred_at, created_by, created_at, warehouse_id, data, batch_id
        )
        values (
          gen_random_uuid(),
          v_item.item_id,
          'adjust_in',
          v_item.quantity,
          v_unit_cost,
          v_unit_cost * v_item.quantity,
          'warehouse_transfers',
          p_transfer_id::text,
          v_transfer_date::timestamptz,
          auth.uid(),
          now(),
          v_to_warehouse,
          jsonb_build_object('warehouseId', v_to_warehouse, 'fromWarehouseId', v_from_warehouse, 'batchId', v_item.batch_id),
          v_item.batch_id
        )
        returning id into v_movement_in;
      else
        for v_batch in
          select
            b.batch_id,
            b.expiry_date,
            b.remaining_qty
          from public.v_food_batch_balances b
          where b.item_id::text = v_item.item_id
            and b.warehouse_id = v_from_warehouse
            and b.batch_id is not null
            and b.expiry_date is not null
            and b.expiry_date >= current_date
            and coalesce(b.remaining_qty, 0) > 0
          order by b.expiry_date asc, b.batch_id asc
        loop
          if v_remaining <= 0 then
            exit;
          end if;

          select
            coalesce(sum(coalesce(nullif(x->>'qty','')::numeric, 0)), 0)
          into v_batch_reserved
          from jsonb_array_elements(
            case
              when jsonb_typeof(v_reserved_batches -> (v_batch.batch_id::text)) = 'array' then (v_reserved_batches -> (v_batch.batch_id::text))
              when jsonb_typeof(v_reserved_batches -> (v_batch.batch_id::text)) = 'object' then jsonb_build_array(v_reserved_batches -> (v_batch.batch_id::text))
              when jsonb_typeof(v_reserved_batches -> (v_batch.batch_id::text)) = 'number' then jsonb_build_array(jsonb_build_object('qty', (v_reserved_batches -> (v_batch.batch_id::text))))
              else '[]'::jsonb
            end
          ) as x;

          v_free := greatest(coalesce(v_batch.remaining_qty, 0) - coalesce(v_batch_reserved, 0), 0);
          v_alloc := least(v_remaining, v_free);
          if v_alloc <= 0 then
            continue;
          end if;

          select im.unit_cost
          into v_unit_cost
          from public.inventory_movements im
          where im.batch_id = v_batch.batch_id
            and im.movement_type = 'purchase_in'
          order by im.occurred_at asc
          limit 1;

          v_unit_cost := coalesce(v_unit_cost, v_sm_from.avg_cost, 0);

          insert into public.inventory_movements (
            id, item_id, movement_type, quantity, unit_cost, total_cost,
            reference_table, reference_id, occurred_at, created_by, created_at, warehouse_id, data, batch_id
          )
          values (
            gen_random_uuid(),
            v_item.item_id,
            'adjust_out',
            v_alloc,
            v_unit_cost,
            v_unit_cost * v_alloc,
            'warehouse_transfers',
            p_transfer_id::text,
            v_transfer_date::timestamptz,
            auth.uid(),
            now(),
            v_from_warehouse,
            jsonb_build_object('warehouseId', v_from_warehouse, 'toWarehouseId', v_to_warehouse, 'batchId', v_batch.batch_id),
            v_batch.batch_id
          )
          returning id into v_movement_out;

          insert into public.inventory_movements (
            id, item_id, movement_type, quantity, unit_cost, total_cost,
            reference_table, reference_id, occurred_at, created_by, created_at, warehouse_id, data, batch_id
          )
          values (
            gen_random_uuid(),
            v_item.item_id,
            'adjust_in',
            v_alloc,
            v_unit_cost,
            v_unit_cost * v_alloc,
            'warehouse_transfers',
            p_transfer_id::text,
            v_transfer_date::timestamptz,
            auth.uid(),
            now(),
            v_to_warehouse,
            jsonb_build_object('warehouseId', v_to_warehouse, 'fromWarehouseId', v_from_warehouse, 'batchId', v_batch.batch_id),
            v_batch.batch_id
          )
          returning id into v_movement_in;

          v_remaining := v_remaining - v_alloc;
        end loop;

        if v_remaining > 0 then
          raise exception 'Insufficient non-expired non-reserved batch stock for item % in source warehouse', v_item.item_id;
        end if;
      end if;
    end if;
    
    -- تحديث الكمية المنقولة
    UPDATE public.warehouse_transfer_items
    SET transferred_quantity = v_item.quantity
    WHERE id = v_item.id;
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
