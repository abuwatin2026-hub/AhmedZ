-- Migration: Definitive Fix for Missing Stock Deductions & Recalculation
-- Date: 2026-01-31

DO $$
DECLARE
  v_order record;
  v_items jsonb;
  v_wh_id uuid;
  v_fixed_count int := 0;
  v_movement_exists boolean;
BEGIN
  RAISE NOTICE 'Starting Global Stock Deduction Fix...';

  -- 1. Loop through ALL delivered orders
  FOR v_order IN
    SELECT * FROM public.orders 
    WHERE status = 'delivered'
    ORDER BY created_at DESC
  LOOP
    
    -- Check if 'sale_out' movement exists for this order
    SELECT EXISTS (
      SELECT 1 FROM public.inventory_movements 
      WHERE reference_table = 'orders' 
        AND reference_id = v_order.id::text
        AND movement_type = 'sale_out'
    ) INTO v_movement_exists;

    -- If no movement, FIX IT
    IF NOT v_movement_exists THEN
       v_items := coalesce(v_order.items, v_order.data->'items');
       
       IF v_items IS NOT NULL AND jsonb_array_length(v_items) > 0 THEN
           v_wh_id := coalesce((v_order.data->>'warehouseId')::uuid, public._resolve_default_warehouse_id());
           
           RAISE NOTICE 'Fixing Order % (Items: %)', v_order.id, jsonb_array_length(v_items);
           
           BEGIN
             PERFORM public.deduct_stock_on_delivery_v2(v_order.id, v_items, v_wh_id);
             v_fixed_count := v_fixed_count + 1;
           EXCEPTION WHEN OTHERS THEN
             RAISE WARNING 'Failed to deduct order %: %', v_order.id, SQLERRM;
           END;
       END IF;
    END IF;
  END LOOP;

  RAISE NOTICE 'Total Orders Fixed: %', v_fixed_count;

  -- 2. Recalculate Warehouse Stock (to update UI numbers)
  v_wh_id := public._resolve_default_warehouse_id();
  IF v_wh_id IS NOT NULL THEN
      RAISE NOTICE 'Recalculating Stock for Warehouse %...', v_wh_id;
      PERFORM public.recalculate_warehouse_stock(v_wh_id);
  END IF;

  RAISE NOTICE 'Fix Complete.';
END $$;
