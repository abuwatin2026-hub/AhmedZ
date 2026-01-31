-- Migration: Final Stock Fix (Correct Items Source)
-- Date: 2026-01-31

DO $$
DECLARE
  v_order record;
  v_items jsonb;
  v_wh_id uuid;
  v_fixed_count int := 0;
  v_movement_exists boolean;
BEGIN
  RAISE NOTICE 'Starting Final Stock Deduction Fix...';

  -- 1. Loop through ALL delivered orders
  FOR v_order IN
    SELECT * FROM public.orders 
    WHERE status = 'delivered'
    ORDER BY created_at DESC
  LOOP
    
    -- Check if 'sale_out' movement exists
    SELECT EXISTS (
      SELECT 1 FROM public.inventory_movements 
      WHERE reference_table = 'orders' 
        AND reference_id = v_order.id::text
        AND movement_type = 'sale_out'
    ) INTO v_movement_exists;

    -- If no movement, FIX IT
    IF NOT v_movement_exists THEN
       -- Prioritize data->'items' because 'items' column might be empty array
       v_items := v_order.data->'items';
       
       IF v_items IS NULL OR jsonb_typeof(v_items) <> 'array' OR jsonb_array_length(v_items) = 0 THEN
          v_items := v_order.items;
       END IF;
       
       IF v_items IS NOT NULL AND jsonb_typeof(v_items) = 'array' AND jsonb_array_length(v_items) > 0 THEN
           v_wh_id := coalesce((v_order.data->>'warehouseId')::uuid, public._resolve_default_warehouse_id());
           
           RAISE NOTICE 'Fixing Order % (Items: %)', v_order.id, jsonb_array_length(v_items);
           
           BEGIN
             PERFORM public.deduct_stock_on_delivery_v2(v_order.id, v_items, v_wh_id);
             v_fixed_count := v_fixed_count + 1;
           EXCEPTION WHEN OTHERS THEN
             RAISE WARNING 'Failed to deduct order %: %', v_order.id, SQLERRM;
           END;
       ELSE
           RAISE WARNING 'Order % has NO items to deduct.', v_order.id;
       END IF;
    END IF;
  END LOOP;

  RAISE NOTICE 'Total Orders Fixed: %', v_fixed_count;

  -- 2. Recalculate Warehouse Stock
  v_wh_id := public._resolve_default_warehouse_id();
  IF v_wh_id IS NOT NULL THEN
      RAISE NOTICE 'Recalculating Stock for Warehouse %...', v_wh_id;
      PERFORM public.recalculate_warehouse_stock(v_wh_id);
  END IF;

  RAISE NOTICE 'Fix Complete.';
END $$;
