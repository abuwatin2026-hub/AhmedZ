-- Diagnostic 2: Deep Dive into Order 34e32f7b-011d-4f06-867e-8d52d05291f6
-- and Force Fix

DO $$
DECLARE
  v_order_id uuid := '34e32f7b-011d-4f06-867e-8d52d05291f6';
  v_count int;
  v_items jsonb;
  v_wh_id uuid;
BEGIN
  -- 1. Check if ANY movement exists for this order
  SELECT COUNT(*) INTO v_count FROM public.inventory_movements 
  WHERE reference_table = 'orders' AND reference_id = v_order_id::text;
  
  RAISE NOTICE 'Order %: Total Movements Found = %', v_order_id, v_count;

  -- 2. Check Order Status and Items
  SELECT data->'items', coalesce((data->>'warehouseId')::uuid, public._resolve_default_warehouse_id())
  INTO v_items, v_wh_id
  FROM public.orders WHERE id = v_order_id;
  
  RAISE NOTICE 'Order Items: %', v_items;
  RAISE NOTICE 'Resolved Warehouse: %', v_wh_id;

  -- 3. Attempt Force Deduction
  RAISE NOTICE 'Attempting Force Deduction...';
  BEGIN
    PERFORM public.deduct_stock_on_delivery_v2(v_order_id, v_items, v_wh_id);
    RAISE NOTICE 'Deduction Function Completed Successfully.';
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'Deduction FAILED: %', SQLERRM;
  END;

  -- 4. Check Movements Again
  SELECT COUNT(*) INTO v_count FROM public.inventory_movements 
  WHERE reference_table = 'orders' AND reference_id = v_order_id::text;
  
  RAISE NOTICE 'Order %: Total Movements After Fix = %', v_order_id, v_count;

END $$;
