-- ======================================================================
-- Migration: الأرقام التسلسلية للأصناف (Serial Numbers)
-- ADDITIVE ONLY
-- ======================================================================

-- 1. Serial numbers table
CREATE TABLE IF NOT EXISTS public.item_serial_numbers (
  id               UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id          TEXT    NOT NULL REFERENCES public.menu_items(id) ON DELETE CASCADE,
  serial_number    TEXT    NOT NULL,
  batch_id         UUID    REFERENCES public.batches(id) ON DELETE SET NULL,
  warehouse_id     UUID    REFERENCES public.warehouses(id) ON DELETE SET NULL,
  status           TEXT    NOT NULL DEFAULT 'available'
                     CHECK (status IN ('available','reserved','sold','returned','scrapped','transferred')),
  -- Traceability
  purchase_order_id UUID   REFERENCES public.purchase_orders(id) ON DELETE SET NULL,
  receipt_id       UUID    REFERENCES public.purchase_receipts(id) ON DELETE SET NULL,
  order_id         UUID    REFERENCES public.orders(id) ON DELETE SET NULL,
  return_id        UUID    REFERENCES public.sales_returns(id) ON DELETE SET NULL,
  -- Dates
  received_at      TIMESTAMPTZ,
  sold_at          TIMESTAMPTZ,
  returned_at      TIMESTAMPTZ,
  scrap_reason     TEXT,
  notes            TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (item_id, serial_number)
);

CREATE INDEX IF NOT EXISTS idx_serial_item_status
  ON public.item_serial_numbers(item_id, status);
CREATE INDEX IF NOT EXISTS idx_serial_number_search
  ON public.item_serial_numbers(serial_number);
CREATE INDEX IF NOT EXISTS idx_serial_warehouse
  ON public.item_serial_numbers(warehouse_id, status);

COMMENT ON TABLE public.item_serial_numbers IS 'الأرقام التسلسلية للأصناف — تتبع كل وحدة منفردة';

-- 2. Flag which items require serial tracking
ALTER TABLE public.menu_items
  ADD COLUMN IF NOT EXISTS requires_serial BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN public.menu_items.requires_serial IS 'يتطلب تتبعاً بالأرقام التسلسلية';

-- 3. Function: register serials on purchase receipt
CREATE OR REPLACE FUNCTION public.register_serial_numbers(
  p_item_id        TEXT,
  p_serial_numbers TEXT[],
  p_warehouse_id   UUID,
  p_batch_id       UUID DEFAULT NULL,
  p_purchase_order_id UUID DEFAULT NULL,
  p_receipt_id     UUID DEFAULT NULL
)
RETURNS INT  -- number of serials registered
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_serial TEXT;
  v_count  INT := 0;
BEGIN
  FOREACH v_serial IN ARRAY p_serial_numbers LOOP
    v_serial := TRIM(v_serial);
    IF v_serial = '' THEN CONTINUE; END IF;

    INSERT INTO public.item_serial_numbers (
      item_id, serial_number, batch_id, warehouse_id, status,
      purchase_order_id, receipt_id, received_at
    ) VALUES (
      p_item_id, v_serial, p_batch_id, p_warehouse_id, 'available',
      p_purchase_order_id, p_receipt_id, now()
    )
    ON CONFLICT (item_id, serial_number) DO UPDATE
      SET warehouse_id = EXCLUDED.warehouse_id,
          batch_id     = COALESCE(EXCLUDED.batch_id, item_serial_numbers.batch_id),
          receipt_id   = COALESCE(EXCLUDED.receipt_id, item_serial_numbers.receipt_id),
          status       = 'available',
          updated_at   = now();

    v_count := v_count + 1;
  END LOOP;
  RETURN v_count;
END;
$$;

COMMENT ON FUNCTION public.register_serial_numbers IS 'يسجل أرقاماً تسلسلية عند الاستلام';

-- 4. Function: record serial sale
CREATE OR REPLACE FUNCTION public.record_serial_sale(
  p_item_id     TEXT,
  p_serial      TEXT,
  p_order_id    UUID
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_rows INT;
BEGIN
  UPDATE public.item_serial_numbers
  SET status   = 'sold',
      order_id = p_order_id,
      sold_at  = now(),
      updated_at = now()
  WHERE item_id = p_item_id
    AND serial_number = TRIM(p_serial)
    AND status IN ('available','reserved');

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows > 0;
END;
$$;

-- 5. Function: search serials
CREATE OR REPLACE FUNCTION public.search_serial_numbers(
  p_serial_query TEXT,
  p_item_id      TEXT DEFAULT NULL,
  p_status       TEXT DEFAULT NULL,
  p_limit        INT  DEFAULT 50
)
RETURNS TABLE (
  id            UUID,
  item_id       TEXT,
  item_name     TEXT,
  serial_number TEXT,
  status        TEXT,
  warehouse_id  UUID,
  sold_at       TIMESTAMPTZ,
  received_at   TIMESTAMPTZ
)
LANGUAGE SQL
STABLE
SECURITY DEFINER
AS $$
  SELECT
    sn.id, sn.item_id,
    (mi.name->>'ar') AS item_name,
    sn.serial_number, sn.status,
    sn.warehouse_id, sn.sold_at, sn.received_at
  FROM public.item_serial_numbers sn
  LEFT JOIN public.menu_items mi ON mi.id = sn.item_id
  WHERE (p_serial_query IS NULL OR sn.serial_number ILIKE '%' || p_serial_query || '%')
    AND (p_item_id IS NULL OR sn.item_id = p_item_id)
    AND (p_status IS NULL OR sn.status = p_status)
  ORDER BY sn.updated_at DESC
  LIMIT p_limit;
$$;

COMMENT ON FUNCTION public.search_serial_numbers IS 'البحث في الأرقام التسلسلية مع الفلترة';
