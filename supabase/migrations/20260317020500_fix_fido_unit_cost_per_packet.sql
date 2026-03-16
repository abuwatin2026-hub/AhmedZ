-- =================================================================
-- Fix: شوكلاتة الفيدو unit_cost correction (unit = باكت, no sub-unit)
-- item_id: 81e85ebf-1415-49a3-b9fa-0fcae3af6b8a
--
-- Root cause: avg_cost was divided by 12 in a previous migration that
-- assumed a carton-to-pack UOM conversion, but this item's basic
-- unit IS the باكت (confirmed by user). No sub-units exist.
--
-- Correct cost per باكت = 12.15 SAR (from Feb 2026 purchase receipt)
-- Applied: 2026-03-17
-- =================================================================

-- 1. Fix all batches for this item
UPDATE public.batches
SET 
  unit_cost      = 12.15,
  cost_per_unit  = 12.15,
  updated_at     = now()
WHERE item_id = '81e85ebf-1415-49a3-b9fa-0fcae3af6b8a'
  AND unit_cost < 13
  AND unit_cost > 0;

-- 2. Fix stock_management avg_cost
UPDATE public.stock_management
SET 
  avg_cost   = 12.15,
  updated_at = now()
WHERE item_id = '81e85ebf-1415-49a3-b9fa-0fcae3af6b8a';

-- 3. Fix historical order_item_cogs using the wrong unit_cost  
UPDATE public.order_item_cogs oic
SET 
  unit_cost  = 12.15,
  total_cost = 12.15 * oic.quantity
WHERE oic.item_id = '81e85ebf-1415-49a3-b9fa-0fcae3af6b8a'
  AND oic.unit_cost BETWEEN 11 AND 12.5
  AND oic.unit_cost <> 12.15;

NOTIFY pgrst, 'reload schema';
