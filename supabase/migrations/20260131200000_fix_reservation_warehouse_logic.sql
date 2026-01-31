-- Migration: Fix Reservation Warehouse Logic (Allow Cross-Warehouse Release/Deduction)
-- Date: 2026-01-31
-- Description: 
-- 1. Update release_reserved_stock_for_order to release reservations regardless of warehouse (since Order is the scope).
-- 2. Update deduct_stock_on_delivery_v2 to consume reservations from ANY warehouse (to prevent leaks).

CREATE OR REPLACE FUNCTION public.release_reserved_stock_for_order(
  p_items jsonb,
  p_order_id uuid default null,
  p_warehouse_id uuid default null
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_item jsonb;
  v_item_id text;
  v_qty numeric;
  v_rem_to_release numeric;
  v_rec record;
BEGIN
  if p_order_id is null then raise exception 'p_order_id is required'; end if;
  
  -- Iterate items
  for v_item in select value from jsonb_array_elements(p_items)
  loop
    v_item_id := nullif(trim(coalesce(v_item->>'itemId', v_item->>'id')), '');
    v_qty := coalesce(nullif(v_item->>'quantity','')::numeric, 0);

    if v_item_id is null or v_qty <= 0 then continue; end if;

    v_rem_to_release := v_qty;

    -- Find reservations for this Order + Item (Any Warehouse)
    FOR v_rec IN 
      SELECT id, quantity, warehouse_id
      FROM public.reservation_lines
      WHERE order_id = p_order_id
        AND item_id = v_item_id
        AND status = 'reserved'
      FOR UPDATE
    LOOP
      EXIT WHEN v_rem_to_release <= 0;
      
      IF v_rec.quantity <= v_rem_to_release THEN
        -- Fully release this line
        DELETE FROM public.reservation_lines WHERE id = v_rec.id;
        v_rem_to_release := v_rem_to_release - v_rec.quantity;
      ELSE
        -- Partially release
        UPDATE public.reservation_lines
        SET quantity = quantity - v_rem_to_release
        WHERE id = v_rec.id;
        v_rem_to_release := 0;
      END IF;
    END LOOP;

  end loop;
END;
$$;

CREATE OR REPLACE FUNCTION public.deduct_stock_on_delivery_v2(
  p_order_id uuid,
  p_items jsonb,
  p_warehouse_id uuid DEFAULT NULL
)
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

  -- Resolve Warehouse ID (Target Warehouse for Deduction)
  if p_warehouse_id is not null then
    v_warehouse_id := p_warehouse_id;
  else
    select data into v_order_data from public.orders where id = p_order_id;
    if not found then raise exception 'order not found'; end if;
    v_warehouse_id := coalesce((v_order_data->>'warehouseId')::uuid, public._resolve_default_warehouse_id());
  end if;
  
  -- Clear existing COGS for this order (Idempotency)
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

    -- Self-Healing Idempotency: Delete existing 'sale_out' to avoid double count
    DELETE FROM public.inventory_movements
    WHERE reference_table = 'orders'
      AND reference_id = p_order_id::text
      AND item_id = v_item_id_text
      AND movement_type = 'sale_out';
      
    -- Recalculate stock to ensure clean state
    PERFORM public.recalculate_stock_item(v_item_id_text, v_warehouse_id);

    -- Lock Stock Record (Target Warehouse)
    begin
      v_item_id_uuid := v_item_id_text::uuid;
    exception when others then
      v_item_id_uuid := null;
    end;

    if v_item_id_uuid is not null then
       select available_quantity, reserved_quantity, coalesce(avg_cost, 0)
       into v_available, v_reserved, v_avg_cost
       from public.stock_management
       where item_id = v_item_id_uuid and warehouse_id = v_warehouse_id
       for update;
    else
       select available_quantity, reserved_quantity, coalesce(avg_cost, 0)
       into v_available, v_reserved, v_avg_cost
       from public.stock_management
       where item_id::text = v_item_id_text and warehouse_id = v_warehouse_id
       for update;
    end if;

    if not found then raise exception 'Stock record not found for item % in warehouse %', v_item_id_text, v_warehouse_id; end if;
    
    -- Ensure avg_cost is not null
    v_avg_cost := coalesce(v_avg_cost, 0);

    -- 3. Consume Reservations (Ledger) - ANY Warehouse
    -- We delete reservations for this order/item globally to ensure we use what was reserved
    v_qty_from_res := 0;
    
    WITH deleted_rows AS (
      DELETE FROM public.reservation_lines
      WHERE order_id = p_order_id
        AND item_id = v_item_id_text
        AND status = 'reserved'
        -- Removed 'AND warehouse_id = v_warehouse_id' to allow cross-warehouse consumption
      RETURNING batch_id, quantity, expiry_date, warehouse_id
    )
    SELECT 
      coalesce(sum(quantity), 0),
      coalesce(jsonb_agg(jsonb_build_object('batchId', batch_id, 'qty', quantity, 'expiry', expiry_date, 'wh', warehouse_id)), '[]'::jsonb)
    INTO v_qty_from_res, v_res_lines
    FROM deleted_rows;
    
    -- 4. Calculate Remaining Needed from Free Stock
    v_qty_needed_free := v_requested - v_qty_from_res;
    
    if v_qty_needed_free > 0 then
       -- Check Free Stock Availability in TARGET Warehouse
       -- Free = Available - Reserved (in Target Warehouse)
       -- Note: v_reserved read earlier includes reservations in Target Warehouse.
       -- If we just deleted reservations in Target Warehouse, the trigger reduced v_reserved!
       -- Wait, trigger runs AFTER statement? Or per row?
       -- If DELETE runs, Trigger runs. `stock_management` is updated.
       -- But we hold a lock on `stock_management` (SELECT FOR UPDATE).
       -- Does DELETE block? No, it's same transaction.
       -- But `v_reserved` variable is stale if trigger ran.
       
       -- Actually, we should check availability AFTER consumption?
       -- Or simpler: We know how much we consumed from reservation (v_qty_from_res).
       -- If that reservation was in Target Warehouse, then `v_reserved` included it.
       -- If it was in Other Warehouse, `v_reserved` did NOT include it.
       
       -- This complicates "Free Stock" calc.
       -- Let's re-read stock after DELETE?
       -- Or: Trust `available_quantity`?
       -- `available_quantity` is the physical stock.
       -- If we are deducting `v_requested`, we need `v_requested` amount of `available_quantity`.
       -- `reserved_quantity` is just a "hold".
       -- If we are fulfilling the order, we are "un-holding" and "reducing available".
       
       -- So:
       -- 1. We removed reservation (so reserved_qty goes down).
       -- 2. We check if `available_quantity >= v_requested`.
       --    Wait, if reservation was ensuring availability, then `available` MUST be >= reserved.
       --    So `available` >= `v_qty_from_res`.
       --    We need `available >= v_requested`.
       
       -- So we don't need to check "Free Stock" (Available - Reserved) specifically for the reserved part.
       -- We only need to check Free Stock for the EXTRA part (`v_qty_needed_free`).
       
       -- BUT, we need to know if the reservation was in THIS warehouse.
       -- `v_res_lines` has `wh`.
       -- Let's sum `qty` where `wh = v_warehouse_id`.
       
       DECLARE
         v_reserved_in_target numeric;
       BEGIN
         SELECT coalesce(sum((x->>'qty')::numeric), 0)
         INTO v_reserved_in_target
         FROM jsonb_array_elements(v_res_lines) x
         WHERE (x->>'wh')::uuid = v_warehouse_id;
         
         -- Free Stock in Target = (Current Available - Current Reserved)
         -- Current Reserved (in DB) = v_reserved (from SELECT FOR UPDATE) - v_reserved_in_target (deleted just now).
         -- Wait, if trigger ran, DB is already updated.
         -- If we re-select, we get fresh values.
         
         SELECT available_quantity, reserved_quantity
         INTO v_available, v_reserved
         FROM public.stock_management
         WHERE item_id::text = v_item_id_text and warehouse_id = v_warehouse_id;
         
         -- Now check availability
         -- We need to deduct `v_requested` from `available`.
         if v_available < v_requested then
            raise exception 'Insufficient stock: Available %, Requested %', v_available, v_requested;
         end if;
         
         -- We also need to ensure we aren't using someone else's reservation.
         -- Free Stock = Available - Reserved.
         -- We need `v_qty_needed_free` from Free Stock.
         if (v_available - v_reserved) < v_qty_needed_free then
            raise exception 'Insufficient free stock (Reserved for others). Free: %, Needed: %', (v_available - v_reserved), v_qty_needed_free;
         end if;
         
       END;
    else
       -- Fully covered by reservation.
       -- Check if we have enough physical stock in Target Warehouse?
       -- If reservation was in Other Warehouse, and we deduct from Target.
       -- Target might not have items!
       SELECT available_quantity INTO v_available
       FROM public.stock_management
       WHERE item_id::text = v_item_id_text and warehouse_id = v_warehouse_id;
       
       if v_available < v_requested then
          raise exception 'Insufficient physical stock in target warehouse (Reservation was cross-warehouse?). Available: %, Requested: %', v_available, v_requested;
       end if;
    end if;
    
    -- 5. Update Available Quantity (Deduct Physical Stock)
    if v_item_id_uuid is not null then
       UPDATE public.stock_management
       SET available_quantity = available_quantity - v_requested,
           -- reserved_quantity was already updated by DELETE trigger on reservation_lines
           last_updated = now()
       WHERE item_id = v_item_id_uuid and warehouse_id = v_warehouse_id;
    else
       UPDATE public.stock_management
       SET available_quantity = available_quantity - v_requested,
           last_updated = now()
       WHERE item_id::text = v_item_id_text and warehouse_id = v_warehouse_id;
    end if;

    -- 6. Generate Movements & COGS
    if not v_is_food then
       v_unit_cost := v_avg_cost;
       v_total_cost := v_requested * v_unit_cost;
       
       insert into public.order_item_cogs(order_id, item_id, quantity, unit_cost, total_cost, created_at)
       values (p_order_id, v_item_id_text, v_requested, v_unit_cost, v_total_cost, now());
       
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
       
    else
       -- Food: Reserved Batches
       if v_qty_from_res > 0 then
          declare
             v_r_batch jsonb;
          begin
             for v_r_batch in select value from jsonb_array_elements(v_res_lines)
             loop
                v_batch_id := (v_r_batch->>'batchId')::uuid;
                v_alloc := (v_r_batch->>'qty')::numeric;
                
                select im.unit_cost into v_unit_cost
                from public.inventory_movements im
                where im.batch_id = v_batch_id and im.movement_type = 'purchase_in'
                limit 1;
                v_unit_cost := coalesce(v_unit_cost, v_avg_cost, 0);
                
                insert into public.order_item_cogs(order_id, item_id, quantity, unit_cost, total_cost, created_at)
                values (p_order_id, v_item_id_text, v_alloc, v_unit_cost, v_alloc * v_unit_cost, now());
                
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
       
       -- Food: Free Batches
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
             
             select coalesce(sum(quantity), 0) into v_batch_reserved
             from public.reservation_lines
             where batch_id = v_batch_id and status = 'reserved';
             
             v_batch_free := greatest(0, v_batch_qty - v_batch_reserved);
             
             if v_batch_free > 0 then
                v_alloc := least(v_remaining_needed, v_batch_free);
                
                select im.unit_cost into v_unit_cost
                from public.inventory_movements im
                where im.batch_id = v_batch_id and im.movement_type = 'purchase_in'
                limit 1;
                v_unit_cost := coalesce(v_unit_cost, v_avg_cost, 0);
                
                insert into public.order_item_cogs(order_id, item_id, quantity, unit_cost, total_cost, created_at)
                values (p_order_id, v_item_id_text, v_alloc, v_unit_cost, v_alloc * v_unit_cost, now());
                
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
