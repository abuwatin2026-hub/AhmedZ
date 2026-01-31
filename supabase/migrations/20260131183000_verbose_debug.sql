-- Diagnostic 3: Verbose Loop Debug
DO $$
DECLARE
  v_order record;
  v_count_delivered int;
  v_count_movements int;
  v_should_fix boolean;
BEGIN
  -- 1. Count Delivered Orders
  SELECT COUNT(*) INTO v_count_delivered FROM public.orders WHERE status = 'delivered';
  RAISE NOTICE 'Total Delivered Orders: %', v_count_delivered;

  -- 2. Check a sample order that we know is broken (from previous log)
  -- Order 38a538c3-6991-418c-8e37-15853a07bf4f
  FOR v_order IN SELECT * FROM public.orders WHERE id = '38a538c3-6991-418c-8e37-15853a07bf4f' LOOP
      RAISE NOTICE 'Checking Sample Order %', v_order.id;
      
      SELECT COUNT(*) INTO v_count_movements 
      FROM public.inventory_movements 
      WHERE reference_table = 'orders' 
        AND reference_id = v_order.id::text
        AND movement_type = 'sale_out';
        
      RAISE NOTICE '  Movements Found: %', v_count_movements;
      
      IF v_count_movements = 0 THEN
         RAISE NOTICE '  -> NEEDS FIX';
         -- Try fixing it here directly
         PERFORM public.deduct_stock_on_delivery_v2(
            v_order.id, 
            coalesce(v_order.items, v_order.data->'items'),
            coalesce((v_order.data->>'warehouseId')::uuid, public._resolve_default_warehouse_id())
         );
         RAISE NOTICE '  -> FIX ATTEMPTED';
      ELSE
         RAISE NOTICE '  -> OK';
      END IF;
  END LOOP;

  -- 3. Run the Loop for 5 orders to see what happens
  FOR v_order IN SELECT * FROM public.orders WHERE status = 'delivered' LIMIT 5 LOOP
      SELECT COUNT(*) INTO v_count_movements 
      FROM public.inventory_movements 
      WHERE reference_table = 'orders' 
        AND reference_id = v_order.id::text
        AND movement_type = 'sale_out';
      
      RAISE NOTICE 'Loop Order %: Mvts %', v_order.id, v_count_movements;
  END LOOP;

END $$;
