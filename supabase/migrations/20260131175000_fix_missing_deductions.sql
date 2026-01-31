-- Migration: Fix Delivered Orders with Missing Stock Deductions
-- Date: 2026-01-31

DO $$
DECLARE
  v_order record;
  v_missing_count int := 0;
  v_items jsonb;
  v_wh_id uuid;
BEGIN
  -- Iterate over DELIVERED orders that have NO 'sale_out' movement
  FOR v_order IN
    SELECT * FROM public.orders o
    WHERE o.status = 'delivered'
      AND NOT EXISTS (
        SELECT 1 FROM public.inventory_movements im
        WHERE im.reference_table = 'orders'
          AND im.reference_id = o.id::text
          AND im.movement_type = 'sale_out'
      )
  LOOP
    -- Prepare items
    v_items := coalesce(v_order.items, v_order.data->'items');
    
    -- Skip if no items
    IF v_items IS NULL OR jsonb_array_length(v_items) = 0 THEN
       CONTINUE;
    END IF;

    -- Resolve Warehouse
    v_wh_id := coalesce((v_order.data->>'warehouseId')::uuid, public._resolve_default_warehouse_id());
    
    RAISE NOTICE 'Fixing missing deduction for order % (Warehouse: %)', v_order.id, v_wh_id;
    
    -- Apply Deduction
    BEGIN
      PERFORM public.deduct_stock_on_delivery_v2(
        v_order.id, 
        v_items,
        v_wh_id
      );
      v_missing_count := v_missing_count + 1;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'Failed to fix order %: %', v_order.id, SQLERRM;
    END;
  END LOOP;
  
  RAISE NOTICE 'Successfully retro-fixed % orders.', v_missing_count;
END $$;
