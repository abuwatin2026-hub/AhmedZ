-- =============================================================================
-- Fix: cost_price for 6 MISMATCH items
-- Sets menu_items.cost_price = weighted avg_cost from stock_management
-- for items where the difference exceeded 20%.
--
-- Group 1 (Fido YER): cost_price was set at carton/multi-pack level
--   - شوكلاتة الفيدو 1000جم × 4 باغات:    103.97 → 25.993
--   - شوكلاتة الفيدو تافي × 150جم × 24:  103.97 → 4.332
--   - شوكلاتة الفيدو اصبعين × 35جم × 6:  151.87 → 25.312
--
-- Group 2 (SAR): cost_price was manually entered below actual receipt cost
--   - شوكلاتة بيلو بار اصابع:  4.571 → 6.667
--   - كيك شوكو رومي:           4.058 → 6.000
--   - قطائر جاسيلو:            3.641 → 5.250
--
-- Applied: 2026-03-17
-- =============================================================================

WITH mismatched AS (
  SELECT
    mi.id,
    CASE WHEN sum(sm.available_quantity) > 0
         THEN sum(sm.avg_cost * sm.available_quantity) / sum(sm.available_quantity)
         ELSE max(sm.avg_cost)
    END AS new_cost_price
  FROM public.menu_items mi
  JOIN public.stock_management sm ON sm.item_id = mi.id
  WHERE mi.cost_price > 0
  GROUP BY mi.id, mi.cost_price
  HAVING abs(
    (CASE WHEN sum(sm.available_quantity) > 0
          THEN sum(sm.avg_cost * sm.available_quantity) / sum(sm.available_quantity)
          ELSE max(sm.avg_cost)
     END) - mi.cost_price
  ) > (mi.cost_price * 0.20)
)
UPDATE public.menu_items mi
SET
  cost_price = m.new_cost_price,
  updated_at = now()
FROM mismatched m
WHERE mi.id = m.id;

NOTIFY pgrst, 'reload schema';
