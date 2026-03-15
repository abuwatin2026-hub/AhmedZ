-- ============================================================================
-- Migration: Fix carton-vs-unit cost for 2 more items in مخزن الشركة
-- ============================================================================

-- Item 1: بسكويت اني براو ستار ابو نجمة *6باكت*24حبة*60جم
-- item_id: ccfa7649-688a-4612-979d-b9339ae8cb89
-- Current avg_cost in مخزن الشركة: 212.616822 (carton cost)
-- Correct per-unit cost (from sale_out): 15.572914
-- مخزن الشركة warehouse_id: 69c3aa8a-e339-4a3d-9d06-31ac6a12f589

-- Item 2: بسكويت ابو برنس عائلي *1*12حبة*500جم
-- item_id: 98f406f7-631a-480f-997b-5dc1e3fd09d9
-- Current avg_cost in مخزن الشركة: 116.82243 (carton cost)
-- Correct per-unit cost (from sale_out): 51.339279
-- مخزن الشركة warehouse_id: 69c3aa8a-e339-4a3d-9d06-31ac6a12f589

-- ════════ Fix Item 1: بسكويت اني براو ستار ════════

-- Fix stock_management avg_cost in مخزن الشركة only
UPDATE stock_management
SET avg_cost = 15.572914,
    updated_at = now()
WHERE item_id = 'ccfa7649-688a-4612-979d-b9339ae8cb89'
  AND warehouse_id = '69c3aa8a-e339-4a3d-9d06-31ac6a12f589'
  AND avg_cost > 200;

-- Fix batches unit_cost (warehouse الشركة)
UPDATE batches
SET unit_cost = 15.572914,
    cost_per_unit = 15.572914,
    min_selling_price = 15.572914,
    updated_at = now()
WHERE item_id = 'ccfa7649-688a-4612-979d-b9339ae8cb89'
  AND warehouse_id = '69c3aa8a-e339-4a3d-9d06-31ac6a12f589'
  AND unit_cost > 200
  AND coalesce(status, 'active') = 'active';

-- ════════ Fix Item 2: بسكويت ابو برنس عائلي ════════

-- Fix stock_management avg_cost in مخزن الشركة only
UPDATE stock_management
SET avg_cost = 51.339279,
    updated_at = now()
WHERE item_id = '98f406f7-631a-480f-997b-5dc1e3fd09d9'
  AND warehouse_id = '69c3aa8a-e339-4a3d-9d06-31ac6a12f589'
  AND avg_cost > 110;

-- Fix batches unit_cost (warehouse الشركة)
UPDATE batches
SET unit_cost = 51.339279,
    cost_per_unit = 51.339279,
    min_selling_price = 51.339279,
    updated_at = now()
WHERE item_id = '98f406f7-631a-480f-997b-5dc1e3fd09d9'
  AND warehouse_id = '69c3aa8a-e339-4a3d-9d06-31ac6a12f589'
  AND unit_cost > 110
  AND coalesce(status, 'active') = 'active';

notify pgrst, 'reload schema';
