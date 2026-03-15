-- ============================================================================
-- Migration: Fix remaining cost issues found in final audit
-- ============================================================================

-- Item 1: شراب سفري منوع *24باكت*24حبه*9جم
-- item_id: 878310b8-d146-4684-a6b2-5cbf72961c9d
-- Current avg_cost: 0 (was never set properly)
-- Correct cost: 4.166667 (from purchase_in and sale_out)
-- Warehouse: المشتريات (7628598d)

UPDATE stock_management
SET avg_cost = 4.166667,
    updated_at = now()
WHERE item_id = '878310b8-d146-4684-a6b2-5cbf72961c9d'
  AND avg_cost < 1;

-- Item 2: شوكلاته الفيدو تايم *150جم*24باغة
-- item_id: b16e59e7-63a2-41b2-b865-9de89b444524
-- avg_cost = 4.51 per bag is CORRECT (purchase_in was 4.51/bag)
-- menu.cost_price = 103.97 is per CARTON (24 bags) — that's the reference mismatch
-- The actual cost_price should be: 103.971963 / 24 ≈ 4.33 per bag
-- BUT the avg_cost of 4.51 appears to be the real purchase price per bag
-- So avg_cost is correct. We only fix cost_price in menu_items to match.
-- Actually: the sale_out sells at 103.97 per carton unit, but stock is per bag.
-- This is a UOM display issue. The avg_cost 4.51/bag is correct.
-- No fix needed for stock_management.

notify pgrst, 'reload schema';
