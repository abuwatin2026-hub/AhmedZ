-- ============================================================================
-- Migration: Fix carton-vs-unit cost mismatch in stock_management and batches
--            for 2 affected items.
-- ============================================================================
-- inventory_movements are NOT updated here (protected by posted-movement trigger).
-- Historical movements keep original cost for audit trail.
-- Only stock_management and batches are corrected.

-- Item 1: شوكلاتة الفيدو علب 6علب*270جم
-- item_id: 4a2119b0-5ac1-44e9-96de-5c9f833b7f2a
-- Current avg_cost: 103.971963 (carton cost, 6 units/carton)
-- Correct per-unit cost: 103.971963/6 ≈ 17.328660

-- Item 2: شوكلاته الفيدو ويفر علب 250جم*12علبة
-- item_id: a78e6f78-f060-4abe-9e21-5f9da8700bda
-- Current avg_cost: 135.514019 (carton cost, 12 units/carton)
-- Correct per-unit cost: 135.514019/12 ≈ 11.292835

-- ════════ Fix Item 1: شوكلاتة الفيدو 6 علب ════════

UPDATE stock_management
SET avg_cost = 103.971963 / 6.0,
    updated_at = now()
WHERE item_id = '4a2119b0-5ac1-44e9-96de-5c9f833b7f2a'
  AND avg_cost > 100;

UPDATE batches
SET unit_cost = 103.971963 / 6.0,
    cost_per_unit = 103.971963 / 6.0,
    min_selling_price = 103.971963 / 6.0,
    updated_at = now()
WHERE item_id = '4a2119b0-5ac1-44e9-96de-5c9f833b7f2a'
  AND unit_cost > 100
  AND coalesce(status, 'active') = 'active';

-- ════════ Fix Item 2: شوكلاته الفيدو ويفر 12 علبة ════════

UPDATE stock_management
SET avg_cost = 135.514019 / 12.0,
    updated_at = now()
WHERE item_id = 'a78e6f78-f060-4abe-9e21-5f9da8700bda'
  AND avg_cost > 130;

UPDATE batches
SET unit_cost = 135.514019 / 12.0,
    cost_per_unit = 135.514019 / 12.0,
    min_selling_price = 135.514019 / 12.0,
    updated_at = now()
WHERE item_id = 'a78e6f78-f060-4abe-9e21-5f9da8700bda'
  AND unit_cost > 130
  AND coalesce(status, 'active') = 'active';

notify pgrst, 'reload schema';
