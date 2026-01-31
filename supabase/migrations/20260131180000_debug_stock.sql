-- Diagnostic Script: Check Stock State for 'Flour' and Orders
-- Save output to verify state

DO $$
DECLARE
  v_item_id text;
  v_wh_id uuid;
  v_order record;
  v_stock record;
  v_movements_count int;
  v_sales_count int;
BEGIN
  -- 1. Find the Item "Flour" (طحين)
  SELECT id INTO v_item_id FROM public.menu_items 
  WHERE data->>'name' ILIKE '%طحين%' OR data->'name'->>'ar' ILIKE '%طحين%'
  LIMIT 1;

  IF v_item_id IS NULL THEN
    RAISE NOTICE 'Item Flour not found. Listing top 5 items...';
    FOR v_item_id IN SELECT id FROM public.menu_items LIMIT 5 LOOP
        RAISE NOTICE 'Item: %', v_item_id;
    END LOOP;
    RETURN;
  END IF;

  RAISE NOTICE 'Found Item: %', v_item_id;

  -- 2. Check Stock Management
  FOR v_stock IN SELECT * FROM public.stock_management WHERE item_id::text = v_item_id LOOP
    RAISE NOTICE 'Stock: Warehouse %, Avail %, Rsrv %, LastUpd %', 
      v_stock.warehouse_id, v_stock.available_quantity, v_stock.reserved_quantity, v_stock.last_updated;
  END LOOP;

  -- 3. Check Inventory Movements (Sale Out)
  SELECT COUNT(*), SUM(quantity) INTO v_movements_count, v_sales_count
  FROM public.inventory_movements
  WHERE item_id = v_item_id AND movement_type = 'sale_out';
  
  RAISE NOTICE 'Movements: Count %, Total Qty %', v_movements_count, v_sales_count;

  -- 4. Check Orders containing this item
  -- We look for orders created recently
  FOR v_order IN 
    SELECT id, status, created_at, delivery_zone_id, data
    FROM public.orders
    WHERE created_at > now() - interval '7 days'
  LOOP
    -- Check if item is in order items (simple check)
    IF (v_order.data->'items')::text LIKE '%' || v_item_id || '%' THEN
        RAISE NOTICE 'Order % (Status: %): Contains Item. Data Items: %', v_order.id, v_order.status, jsonb_array_length(v_order.data->'items');
        
        -- Check if movement exists for this order
        PERFORM 1 FROM public.inventory_movements 
        WHERE reference_table = 'orders' AND reference_id = v_order.id::text AND item_id = v_item_id;
        
        IF FOUND THEN
            RAISE NOTICE '  -> Movement EXISTS';
        ELSE
            RAISE NOTICE '  -> Movement MISSING';
        END IF;
    END IF;
  END LOOP;

END $$;
