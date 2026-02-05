-- Supplier -> Items mapping (for replenishment & reporting)
CREATE TABLE IF NOT EXISTS public.supplier_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_id UUID NOT NULL REFERENCES public.suppliers(id) ON DELETE CASCADE,
  item_id TEXT NOT NULL REFERENCES public.menu_items(id) ON DELETE CASCADE,
  is_active BOOLEAN NOT NULL DEFAULT true,
  reorder_point NUMERIC NOT NULL DEFAULT 0,
  target_cover_days INTEGER NOT NULL DEFAULT 14,
  lead_time_days INTEGER NOT NULL DEFAULT 3,
  pack_size NUMERIC NOT NULL DEFAULT 1,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (supplier_id, item_id)
);

ALTER TABLE public.supplier_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS supplier_items_admin_select ON public.supplier_items;
DROP POLICY IF EXISTS "Enable all access for admins and managers" ON public.supplier_items;

CREATE POLICY supplier_items_admin_select ON public.supplier_items
  FOR SELECT USING (public.is_admin());

CREATE POLICY "Enable all access for admins and managers" ON public.supplier_items
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM public.admin_users
      WHERE auth_user_id = auth.uid()
        AND role IN ('owner', 'manager')
        AND is_active = true
    )
  );

CREATE INDEX IF NOT EXISTS idx_supplier_items_supplier ON public.supplier_items(supplier_id);
CREATE INDEX IF NOT EXISTS idx_supplier_items_item ON public.supplier_items(item_id);

CREATE OR REPLACE FUNCTION public.get_supplier_stock_report(
  p_supplier_id UUID,
  p_warehouse_id UUID DEFAULT NULL,
  p_days INTEGER DEFAULT 7
)
RETURNS TABLE (
  item_id TEXT,
  item_name JSONB,
  category TEXT,
  item_group TEXT,
  unit TEXT,
  current_stock NUMERIC,
  reserved_stock NUMERIC,
  available_stock NUMERIC,
  avg_daily_sales NUMERIC,
  days_cover NUMERIC,
  reorder_point NUMERIC,
  target_cover_days INTEGER,
  lead_time_days INTEGER,
  pack_size NUMERIC,
  suggested_qty NUMERIC
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.can_view_reports() THEN
    RAISE EXCEPTION 'ليس لديك صلاحية عرض التقارير';
  END IF;

  RETURN QUERY
  WITH params AS (
    SELECT GREATEST(1, COALESCE(p_days, 7))::numeric AS days_window
  ),
  supplier_items_active AS (
    SELECT
      si.item_id,
      si.reorder_point,
      si.target_cover_days,
      si.lead_time_days,
      si.pack_size
    FROM public.supplier_items si
    WHERE si.supplier_id = p_supplier_id
      AND si.is_active = true
  ),
  stock_agg AS (
    SELECT
      sm.item_id,
      COALESCE(SUM(sm.available_quantity), 0) AS current_stock,
      COALESCE(SUM(sm.reserved_quantity), 0) AS reserved_stock,
      MAX(COALESCE(sm.unit, 'piece')) AS unit
    FROM public.stock_management sm
    WHERE (p_warehouse_id IS NULL OR sm.warehouse_id = p_warehouse_id)
    GROUP BY sm.item_id
  ),
  sales_agg AS (
    SELECT
      im.item_id,
      COALESCE(SUM(im.quantity), 0) AS qty_sold
    FROM public.inventory_movements im
    WHERE im.movement_type = 'sale_out'
      AND im.occurred_at >= (NOW() - (GREATEST(1, COALESCE(p_days, 7))::text || ' days')::interval)
      AND (p_warehouse_id IS NULL OR im.warehouse_id = p_warehouse_id)
    GROUP BY im.item_id
  )
  SELECT
    mi.id AS item_id,
    mi.name AS item_name,
    mi.category AS category,
    NULLIF(COALESCE(mi.data->>'group', ''), '') AS item_group,
    COALESCE(sa.unit, COALESCE(mi.base_unit, COALESCE(mi.unit_type, 'piece'))) AS unit,
    COALESCE(sa.current_stock, 0) AS current_stock,
    COALESCE(sa.reserved_stock, 0) AS reserved_stock,
    COALESCE(sa.current_stock, 0) - COALESCE(sa.reserved_stock, 0) AS available_stock,
    (COALESCE(sla.qty_sold, 0) / (SELECT days_window FROM params)) AS avg_daily_sales,
    CASE
      WHEN (COALESCE(sla.qty_sold, 0) / (SELECT days_window FROM params)) > 0
        THEN (COALESCE(sa.current_stock, 0) - COALESCE(sa.reserved_stock, 0)) / (COALESCE(sla.qty_sold, 0) / (SELECT days_window FROM params))
      ELSE NULL
    END AS days_cover,
    COALESCE(sia.reorder_point, 0) AS reorder_point,
    COALESCE(sia.target_cover_days, 14) AS target_cover_days,
    COALESCE(sia.lead_time_days, 3) AS lead_time_days,
    COALESCE(NULLIF(sia.pack_size, 0), 1) AS pack_size,
    CASE
      WHEN (COALESCE(sla.qty_sold, 0) / (SELECT days_window FROM params)) <= 0 THEN 0
      ELSE (
        CEILING(
          GREATEST(
            0,
            (
              ((COALESCE(sia.target_cover_days, 14) + COALESCE(sia.lead_time_days, 3))::numeric)
              * (COALESCE(sla.qty_sold, 0) / (SELECT days_window FROM params))
            ) - (COALESCE(sa.current_stock, 0) - COALESCE(sa.reserved_stock, 0))
          ) / COALESCE(NULLIF(sia.pack_size, 0), 1)
        ) * COALESCE(NULLIF(sia.pack_size, 0), 1)
      )
    END AS suggested_qty
  FROM supplier_items_active sia
  JOIN public.menu_items mi ON mi.id = sia.item_id
  LEFT JOIN stock_agg sa ON sa.item_id = mi.id
  LEFT JOIN sales_agg sla ON sla.item_id = mi.id
  ORDER BY suggested_qty DESC, (COALESCE(sa.current_stock, 0) - COALESCE(sa.reserved_stock, 0)) ASC, mi.id ASC;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_inventory_stock_report(
  p_warehouse_id UUID,
  p_category TEXT DEFAULT NULL,
  p_group TEXT DEFAULT NULL,
  p_supplier_id UUID DEFAULT NULL,
  p_stock_filter TEXT DEFAULT 'all',
  p_search TEXT DEFAULT NULL,
  p_limit INTEGER DEFAULT 200,
  p_offset INTEGER DEFAULT 0
)
RETURNS TABLE (
  item_id TEXT,
  item_name JSONB,
  category TEXT,
  item_group TEXT,
  unit TEXT,
  current_stock NUMERIC,
  reserved_stock NUMERIC,
  available_stock NUMERIC,
  low_stock_threshold NUMERIC,
  supplier_ids UUID[],
  total_count INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_limit integer := greatest(1, coalesce(p_limit, 200));
  v_offset integer := greatest(0, coalesce(p_offset, 0));
BEGIN
  IF NOT public.can_view_reports() THEN
    RAISE EXCEPTION 'ليس لديك صلاحية عرض التقارير';
  END IF;

  RETURN QUERY
  WITH base AS (
    SELECT
      mi.id as item_id,
      mi.name as item_name,
      mi.category as category,
      NULLIF(COALESCE(mi.data->>'group', ''), '') AS item_group,
      COALESCE(sm.unit, COALESCE(mi.base_unit, COALESCE(mi.unit_type, 'piece'))) AS unit,
      COALESCE(sm.available_quantity, 0) AS current_stock,
      COALESCE(sm.reserved_quantity, 0) AS reserved_stock,
      COALESCE(sm.available_quantity, 0) - COALESCE(sm.reserved_quantity, 0) AS available_stock,
      COALESCE(sm.low_stock_threshold, 5) AS low_stock_threshold,
      COALESCE(array_agg(distinct si.supplier_id) filter (where si.is_active), '{}'::uuid[]) AS supplier_ids
    FROM public.menu_items mi
    LEFT JOIN public.stock_management sm
      ON sm.item_id::text = mi.id::text
      AND sm.warehouse_id = p_warehouse_id
    LEFT JOIN public.supplier_items si
      ON si.item_id::text = mi.id::text
    WHERE COALESCE(mi.status, 'active') = 'active'
    GROUP BY mi.id, mi.name, mi.category, mi.data, mi.base_unit, mi.unit_type, sm.unit, sm.available_quantity, sm.reserved_quantity, sm.low_stock_threshold
  ),
  filtered AS (
    SELECT b.*
    FROM base b
    WHERE (p_category IS NULL OR p_category = '' OR b.category = p_category)
      AND (p_group IS NULL OR p_group = '' OR b.item_group = p_group)
      AND (p_supplier_id IS NULL OR p_supplier_id = any(b.supplier_ids))
      AND (
        p_search IS NULL OR btrim(p_search) = ''
        OR b.item_id ILIKE '%' || btrim(p_search) || '%'
        OR COALESCE(b.item_name->>'ar', '') ILIKE '%' || btrim(p_search) || '%'
        OR COALESCE(b.item_name->>'en', '') ILIKE '%' || btrim(p_search) || '%'
      )
      AND (
        coalesce(p_stock_filter, 'all') = 'all'
        OR (p_stock_filter = 'in' AND b.available_stock > b.low_stock_threshold)
        OR (p_stock_filter = 'low' AND b.available_stock > 0 AND b.available_stock <= b.low_stock_threshold)
        OR (p_stock_filter = 'out' AND b.available_stock <= 0)
      )
  ),
  counted AS (
    SELECT f.*, count(*) over ()::integer AS total_count
    FROM filtered f
  )
  SELECT *
  FROM counted
  ORDER BY available_stock ASC, item_id ASC
  LIMIT v_limit
  OFFSET v_offset;
END;
$$;

REVOKE ALL ON FUNCTION public.get_supplier_stock_report(UUID, UUID, INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_supplier_stock_report(UUID, UUID, INTEGER) TO authenticated;

REVOKE ALL ON FUNCTION public.get_inventory_stock_report(UUID, TEXT, TEXT, UUID, TEXT, TEXT, INTEGER, INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_inventory_stock_report(UUID, TEXT, TEXT, UUID, TEXT, TEXT, INTEGER, INTEGER) TO authenticated;
