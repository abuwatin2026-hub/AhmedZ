-- Force apply fixes for Reservation Ledger policies and Deduct Stock function
-- This ensures the DB is correct even if previous migrations were marked as applied but failed or were partial.

-- 1. Fix Policies for reservation_lines
DO $$
BEGIN
    IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'reservation_lines') THEN
        DROP POLICY IF EXISTS reservation_lines_read_staff ON public.reservation_lines;
        CREATE POLICY reservation_lines_read_staff ON public.reservation_lines
          FOR SELECT USING (public.is_staff() OR EXISTS (
            SELECT 1 FROM public.orders o WHERE o.id = reservation_lines.order_id AND o.customer_auth_user_id = auth.uid()
          ));

        DROP POLICY IF EXISTS reservation_lines_write_staff ON public.reservation_lines;
        CREATE POLICY reservation_lines_write_staff ON public.reservation_lines
          FOR ALL USING (public.is_staff());
    END IF;
END $$;

-- 2. Fix deduct_stock_on_delivery_v2 function (Scalar variable error fix)
CREATE OR REPLACE FUNCTION public.deduct_stock_on_delivery_v2(p_order_id uuid, p_items jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_item jsonb;
  v_item_id_text text;
  v_item_id_uuid uuid;
  v_requested numeric;
  v_warehouse_id uuid;
  v_is_food boolean;
  v_stock_id uuid;
  v_available numeric;
  v_reserved numeric;
  v_avg_cost numeric;
  v_unit_cost numeric;
  v_total_cost numeric;
  v_movement_id uuid;
  
  -- Reservation vars
  v_res_lines jsonb;
  v_qty_from_res numeric;
  v_qty_needed_free numeric;
  
  -- Batch vars
  v_batch_id uuid;
  v_batch_expiry date;
  v_batch_qty numeric;
  v_batch_reserved numeric;
  v_batch_free numeric;
  v_alloc numeric;
  v_remaining_needed numeric;
  
  v_order_data jsonb;
BEGIN
  -- 1. Validation & Setup
  if not public.is_admin() and not public.is_staff() then
     if auth.role() != 'service_role' and not public.is_admin() then
        raise exception 'not allowed';
     end if;
  end if;

  if p_order_id is null then raise exception 'p_order_id is required'; end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' then raise exception 'p_items must be a json array'; end if;

  -- Get Order Info (Warehouse)
  select data into v_order_data from public.orders where id = p_order_id;
  if not found then raise exception 'order not found'; end if;
  
  v_warehouse_id := coalesce((v_order_data->>'warehouseId')::uuid, public._resolve_default_warehouse_id());
  
  -- Clear existing COGS for this order to avoid duplication if run multiple times (though usually run once)
  delete from public.order_item_cogs where order_id = p_order_id;

  -- 2. Process Items
  for v_item in select value from jsonb_array_elements(p_items)
  loop
    v_item_id_text := coalesce(v_item->>'itemId', v_item->>'id');
    v_requested := coalesce(nullif(v_item->>'quantity', '')::numeric, 0);

    if v_item_id_text is null or v_item_id_text = '' then raise exception 'Invalid itemId'; end if;
    if v_requested <= 0 then continue; end if;

    -- Check if Item is Food
    select coalesce(mi.category = 'food', false) into v_is_food
    from public.menu_items mi where mi.id = v_item_id_text;

    -- Lock Stock Record
    -- Try UUID first
    begin
      v_item_id_uuid := v_item_id_text::uuid;
    exception when others then
      v_item_id_uuid := null;
    end;

    if v_item_id_uuid is not null then
       select available_quantity, reserved_quantity, avg_cost
       into v_available, v_reserved, v_avg_cost
       from public.stock_management
       where item_id = v_item_id_uuid and warehouse_id = v_warehouse_id
       for update;
    else
       select available_quantity, reserved_quantity, avg_cost
       into v_available, v_reserved, v_avg_cost
       from public.stock_management
       where item_id::text = v_item_id_text and warehouse_id = v_warehouse_id
       for update;
    end if;

    if not found then raise exception 'Stock record not found for item %', v_item_id_text; end if;
    
    -- 3. Consume Reservations (Ledger)
    v_qty_from_res := 0;
    
    -- Find and Delete Reservation Lines for this Order/Item
    -- We use a CTE to delete and return the deleted rows
    WITH deleted_rows AS (
      DELETE FROM public.reservation_lines
      WHERE order_id = p_order_id
        AND item_id = v_item_id_text
        AND warehouse_id = v_warehouse_id
        AND status = 'reserved'
      RETURNING batch_id, quantity, expiry_date
    )
    SELECT 
      coalesce(sum(quantity), 0),
      coalesce(jsonb_agg(jsonb_build_object('batchId', batch_id, 'qty', quantity, 'expiry', expiry_date)), '[]'::jsonb)
    INTO v_qty_from_res, v_res_lines
    FROM deleted_rows;
    
    -- Refresh Stock Variables
    if v_item_id_uuid is not null then
       select available_quantity, reserved_quantity
       into v_available, v_reserved
       from public.stock_management
       where item_id = v_item_id_uuid and warehouse_id = v_warehouse_id;
    else
       select available_quantity, reserved_quantity
       into v_available, v_reserved
       from public.stock_management
       where item_id::text = v_item_id_text and warehouse_id = v_warehouse_id;
    end if;

    -- 4. Calculate Remaining Needed from Free Stock
    v_qty_needed_free := v_requested - v_qty_from_res;
    
    if v_qty_needed_free > 0 then
       -- Check Free Stock Availability
       -- Free Stock = Available - Reserved (Total Reserved for everyone)
       -- If POS (in_store), we strictly respect reservations now (INV-004 fix).
       if (v_available - v_reserved) < v_qty_needed_free then
          raise exception 'Insufficient free stock for item %. Needed: %, Free: % (Available: %, Reserved: %)', 
            v_item_id_text, v_qty_needed_free, (v_available - v_reserved), v_available, v_reserved;
       end if;
    end if;
    
    -- 5. Update Available Quantity
    if v_item_id_uuid is not null then
       UPDATE public.stock_management
       SET available_quantity = available_quantity - v_requested,
           last_updated = now()
       WHERE item_id = v_item_id_uuid and warehouse_id = v_warehouse_id;
    else
       UPDATE public.stock_management
       SET available_quantity = available_quantity - v_requested,
           last_updated = now()
       WHERE item_id::text = v_item_id_text and warehouse_id = v_warehouse_id;
    end if;

    -- 6. Generate Movements & COGS
    
    -- A. Non-Food Item
    if not v_is_food then
       v_unit_cost := v_avg_cost;
       v_total_cost := v_requested * v_unit_cost;
       
       -- Insert COGS
       insert into public.order_item_cogs(order_id, item_id, quantity, unit_cost, total_cost, created_at)
       values (p_order_id, v_item_id_text, v_requested, v_unit_cost, v_total_cost, now());
       
       -- Insert Movement
       insert into public.inventory_movements(
        item_id, movement_type, quantity, unit_cost, total_cost,
        reference_table, reference_id, occurred_at, created_by, data, warehouse_id
       ) values (
        v_item_id_text, 'sale_out', v_requested, v_unit_cost, v_total_cost,
        'orders', p_order_id::text, now(), auth.uid(), 
        jsonb_build_object('orderId', p_order_id, 'warehouseId', v_warehouse_id), 
        v_warehouse_id
       ) returning id into v_movement_id;
       
       perform public.post_inventory_movement(v_movement_id);
       
    -- B. Food Item (Batch Management)
    else
       -- Process "Reserved" Batches first
       if v_qty_from_res > 0 then
          declare
             v_r_batch jsonb;
          begin
             for v_r_batch in select value from jsonb_array_elements(v_res_lines)
             loop
                v_batch_id := (v_r_batch->>'batchId')::uuid;
                v_alloc := (v_r_batch->>'qty')::numeric;
                
                -- Get Cost
                select im.unit_cost into v_unit_cost
                from public.inventory_movements im
                where im.batch_id = v_batch_id and im.movement_type = 'purchase_in'
                limit 1;
                v_unit_cost := coalesce(v_unit_cost, v_avg_cost);
                
                -- Insert COGS
                insert into public.order_item_cogs(order_id, item_id, quantity, unit_cost, total_cost, created_at)
                values (p_order_id, v_item_id_text, v_alloc, v_unit_cost, v_alloc * v_unit_cost, now());
                
                -- Insert Movement
                insert into public.inventory_movements(
                  item_id, movement_type, quantity, unit_cost, total_cost,
                  reference_table, reference_id, occurred_at, created_by, data, batch_id, warehouse_id
                ) values (
                  v_item_id_text, 'sale_out', v_alloc, v_unit_cost, v_alloc * v_unit_cost,
                  'orders', p_order_id::text, now(), auth.uid(),
                  jsonb_build_object('orderId', p_order_id, 'batchId', v_batch_id, 'expiryDate', v_r_batch->>'expiry'),
                  v_batch_id, v_warehouse_id
                ) returning id into v_movement_id;
                
                perform public.post_inventory_movement(v_movement_id);
             end loop;
          end;
       end if;
       
       -- Process "Free" Batches (FEFO)
       if v_qty_needed_free > 0 then
          v_remaining_needed := v_qty_needed_free;
          
          for v_batch_id, v_batch_expiry, v_batch_qty in
             select b.id, b.expiry_date,
               greatest(coalesce(b.quantity_received,0) - coalesce(b.quantity_consumed,0) - coalesce(b.quantity_transferred,0), 0)
             from public.batches b
             where b.item_id = v_item_id_text
               and b.warehouse_id = v_warehouse_id
               and (b.expiry_date is null or b.expiry_date >= current_date)
             order by b.expiry_date asc nulls last, b.created_at asc
          loop
             exit when v_remaining_needed <= 0;
             if v_batch_qty <= 0 then continue; end if;
             
             -- Calculate Free Qty on this batch (Batch Total - Batch Reserved)
             select coalesce(sum(quantity), 0) into v_batch_reserved
             from public.reservation_lines
             where batch_id = v_batch_id and status = 'reserved';
             
             v_batch_free := greatest(0, v_batch_qty - v_batch_reserved);
             
             if v_batch_free > 0 then
                v_alloc := least(v_remaining_needed, v_batch_free);
                
                -- Get Cost
                select im.unit_cost into v_unit_cost
                from public.inventory_movements im
                where im.batch_id = v_batch_id and im.movement_type = 'purchase_in'
                limit 1;
                v_unit_cost := coalesce(v_unit_cost, v_avg_cost);
                
                -- Insert COGS
                insert into public.order_item_cogs(order_id, item_id, quantity, unit_cost, total_cost, created_at)
                values (p_order_id, v_item_id_text, v_alloc, v_unit_cost, v_alloc * v_unit_cost, now());
                
                -- Insert Movement
                insert into public.inventory_movements(
                  item_id, movement_type, quantity, unit_cost, total_cost,
                  reference_table, reference_id, occurred_at, created_by, data, batch_id, warehouse_id
                ) values (
                  v_item_id_text, 'sale_out', v_alloc, v_unit_cost, v_alloc * v_unit_cost,
                  'orders', p_order_id::text, now(), auth.uid(),
                  jsonb_build_object('orderId', p_order_id, 'batchId', v_batch_id, 'expiryDate', v_batch_expiry),
                  v_batch_id, v_warehouse_id
                ) returning id into v_movement_id;
                
                perform public.post_inventory_movement(v_movement_id);
                
                v_remaining_needed := v_remaining_needed - v_alloc;
             end if;
          end loop;
          
          if v_remaining_needed > 0 then
             raise exception 'Insufficient free batch stock for item %', v_item_id_text;
          end if;
       end if;
    end if; -- End Food/Non-Food
    
  end loop; -- End Items Loop
END;
$$;
