-- ======================================================================
-- Migration: الأصناف المركبة — Kitting / Assembly (BOM)
-- Creates item_bom, kitting_operations tables and assemble/disassemble functions
-- ADDITIVE ONLY
-- ======================================================================

-- 1. Bill of Materials (BOM) — قوائم المكونات
CREATE TABLE IF NOT EXISTS public.item_bom (
  id               UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_item_id   UUID    NOT NULL REFERENCES public.menu_items(id) ON DELETE CASCADE,
  component_item_id UUID   NOT NULL REFERENCES public.menu_items(id) ON DELETE CASCADE,
  quantity         NUMERIC(15,6) NOT NULL DEFAULT 1 CHECK (quantity > 0),
  uom_code         TEXT,   -- وحدة قياس المكوّن
  notes            TEXT,
  is_active        BOOLEAN NOT NULL DEFAULT true,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (parent_item_id, component_item_id)
);

CREATE INDEX IF NOT EXISTS idx_item_bom_parent
  ON public.item_bom(parent_item_id);
CREATE INDEX IF NOT EXISTS idx_item_bom_component
  ON public.item_bom(component_item_id);

COMMENT ON TABLE public.item_bom IS 'قائمة المكونات — تعريف الأصناف المركبة ومكوّناتها';

-- 2. Kitting operations log
CREATE TABLE IF NOT EXISTS public.kitting_operations (
  id              UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  operation_type  TEXT    NOT NULL CHECK (operation_type IN ('assemble','disassemble')),
  kit_item_id     UUID    NOT NULL REFERENCES public.menu_items(id) ON DELETE RESTRICT,
  warehouse_id    UUID    NOT NULL REFERENCES public.warehouses(id) ON DELETE RESTRICT,
  quantity        NUMERIC(15,6) NOT NULL DEFAULT 1 CHECK (quantity > 0),
  status          TEXT    NOT NULL DEFAULT 'completed'
                    CHECK (status IN ('draft','completed','reversed')),
  journal_entry_id UUID   REFERENCES public.journal_entries(id) ON DELETE SET NULL,
  performed_by    UUID    REFERENCES public.admin_users(id) ON DELETE SET NULL,
  notes           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_kitting_kit_item
  ON public.kitting_operations(kit_item_id, created_at DESC);

COMMENT ON TABLE public.kitting_operations IS 'سجل عمليات التجميع والتفكيك للأصناف المركبة';

-- 3. Mark items as composite
ALTER TABLE public.menu_items
  ADD COLUMN IF NOT EXISTS is_composite BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN public.menu_items.is_composite IS 'صنف مركب يُجمَّع من مكونات أخرى';

-- 4. Function: assemble kit
-- Consumes components from warehouse, creates assembled kit units
CREATE OR REPLACE FUNCTION public.assemble_kit(
  p_kit_item_id  UUID,
  p_quantity     NUMERIC,
  p_warehouse_id UUID,
  p_performed_by UUID DEFAULT NULL,
  p_notes        TEXT DEFAULT NULL
)
RETURNS UUID  -- returns kitting_operation id
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_op_id    UUID := gen_random_uuid();
  v_bom      RECORD;
  v_consume_qty NUMERIC;
  v_kit_name TEXT;
BEGIN
  -- Validate kit exists and is composite
  SELECT name INTO v_kit_name FROM public.menu_items WHERE id = p_kit_item_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'الصنف المركب غير موجود: %', p_kit_item_id;
  END IF;

  -- Validate BOM exists
  IF NOT EXISTS (SELECT 1 FROM public.item_bom WHERE parent_item_id = p_kit_item_id AND is_active = true) THEN
    RAISE EXCEPTION 'لا توجد قائمة مكونات (BOM) لهذا الصنف: %', v_kit_name;
  END IF;

  -- Insert kitting operation
  INSERT INTO public.kitting_operations (
    id, operation_type, kit_item_id, warehouse_id, quantity,
    status, performed_by, notes
  ) VALUES (
    v_op_id, 'assemble', p_kit_item_id, p_warehouse_id, p_quantity,
    'completed', p_performed_by, p_notes
  );

  -- Consume each component from inventory (create sale_out movement)
  FOR v_bom IN
    SELECT * FROM public.item_bom
    WHERE parent_item_id = p_kit_item_id AND is_active = true
  LOOP
    v_consume_qty := v_bom.quantity * p_quantity;
    -- Record inventory movement: consume component
    INSERT INTO public.inventory_movements (
      item_id, warehouse_id, movement_type, quantity_change,
      quantity_change_base, notes, reference_id, reference_type
    ) VALUES (
      v_bom.component_item_id, p_warehouse_id, 'kit_consume',
      -v_consume_qty, -v_consume_qty,
      COALESCE(p_notes, 'تجميع صنف مركب'),
      v_op_id, 'kitting_operations'
    );
  END LOOP;

  -- Create assembled kit units (purchase_in equivalent)
  INSERT INTO public.inventory_movements (
    item_id, warehouse_id, movement_type, quantity_change,
    quantity_change_base, notes, reference_id, reference_type
  ) VALUES (
    p_kit_item_id, p_warehouse_id, 'kit_produce',
    p_quantity, p_quantity,
    COALESCE(p_notes, 'إنتاج صنف مركب'),
    v_op_id, 'kitting_operations'
  );

  RETURN v_op_id;
END;
$$;

COMMENT ON FUNCTION public.assemble_kit IS 'تجميع صنف مركب من مكوناته في المستودع';

-- 5. Function: disassemble kit (reverse)
CREATE OR REPLACE FUNCTION public.disassemble_kit(
  p_kit_item_id  UUID,
  p_quantity     NUMERIC,
  p_warehouse_id UUID,
  p_performed_by UUID DEFAULT NULL,
  p_notes        TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_op_id       UUID := gen_random_uuid();
  v_bom         RECORD;
  v_return_qty  NUMERIC;
BEGIN
  INSERT INTO public.kitting_operations (
    id, operation_type, kit_item_id, warehouse_id, quantity,
    status, performed_by, notes
  ) VALUES (
    v_op_id, 'disassemble', p_kit_item_id, p_warehouse_id, p_quantity,
    'completed', p_performed_by, p_notes
  );

  -- Remove assembled units
  INSERT INTO public.inventory_movements (
    item_id, warehouse_id, movement_type, quantity_change, quantity_change_base,
    notes, reference_id, reference_type
  ) VALUES (
    p_kit_item_id, p_warehouse_id, 'kit_disassemble_out',
    -p_quantity, -p_quantity,
    COALESCE(p_notes, 'تفكيك صنف مركب'),
    v_op_id, 'kitting_operations'
  );

  -- Return components
  FOR v_bom IN
    SELECT * FROM public.item_bom
    WHERE parent_item_id = p_kit_item_id AND is_active = true
  LOOP
    v_return_qty := v_bom.quantity * p_quantity;
    INSERT INTO public.inventory_movements (
      item_id, warehouse_id, movement_type, quantity_change, quantity_change_base,
      notes, reference_id, reference_type
    ) VALUES (
      v_bom.component_item_id, p_warehouse_id, 'kit_disassemble_in',
      v_return_qty, v_return_qty,
      COALESCE(p_notes, 'إرجاع مكونات تفكيك'),
      v_op_id, 'kitting_operations'
    );
  END LOOP;

  RETURN v_op_id;
END;
$$;

COMMENT ON FUNCTION public.disassemble_kit IS 'تفكيك صنف مركب وإرجاع مكوناته للمستودع';
