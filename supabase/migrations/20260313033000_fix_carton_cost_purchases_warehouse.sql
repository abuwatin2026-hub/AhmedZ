-- ============================================================================
-- Migration: Fix carton-vs-unit cost for 2 items in مخزن المشتريات
-- ============================================================================
-- The avg_cost in المشتريات was corrupted because transfer_out/in movements
-- carried the wrong carton cost (212.62 and 116.82), which skewed the
-- weighted average calculation.

-- المشتريات warehouse_id: 7628598d (from earlier audit)

-- Item 1: بسكويت اني براو ستار
-- item_id: ccfa7649-688a-4612-979d-b9339ae8cb89
-- Current avg_cost: 115.1739 (corrupted by carton transfer)
-- Correct per-unit cost: 15.5729 (from sale_out and last purchase_in)

UPDATE stock_management
SET avg_cost = 15.572914,
    updated_at = now()
WHERE item_id = 'ccfa7649-688a-4612-979d-b9339ae8cb89'
  AND avg_cost > 100;

UPDATE batches
SET unit_cost = 15.572914,
    cost_per_unit = 15.572914,
    min_selling_price = 15.572914,
    updated_at = now()
WHERE item_id = 'ccfa7649-688a-4612-979d-b9339ae8cb89'
  AND unit_cost > 100
  AND coalesce(status, 'active') = 'active';

-- Item 2: بسكويت ابو برنس عائلي
-- item_id: 98f406f7-631a-480f-997b-5dc1e3fd09d9
-- Current avg_cost: 87.7188 (corrupted by carton transfer)
-- Correct per-unit cost: 51.3393 (from sale_out and last purchase_in)

UPDATE stock_management
SET avg_cost = 51.339279,
    updated_at = now()
WHERE item_id = '98f406f7-631a-480f-997b-5dc1e3fd09d9'
  AND avg_cost > 80;

UPDATE batches
SET unit_cost = 51.339279,
    cost_per_unit = 51.339279,
    min_selling_price = 51.339279,
    updated_at = now()
WHERE item_id = '98f406f7-631a-480f-997b-5dc1e3fd09d9'
  AND unit_cost > 80
  AND coalesce(status, 'active') = 'active';

notify pgrst, 'reload schema';
