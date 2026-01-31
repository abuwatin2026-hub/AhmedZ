-- Migration: Implement Reservation Ledger (INV-003)
-- Date: 2026-01-31
-- Description: Create reservation_lines table and update reservation logic to be ledger-based.

-- 1. Create reservation_lines table
CREATE TABLE IF NOT EXISTS public.reservation_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  item_id TEXT NOT NULL REFERENCES public.menu_items(id),
  warehouse_id UUID NOT NULL REFERENCES public.warehouses(id),
  batch_id UUID REFERENCES public.batches(id), -- Nullable (for non-food)
  quantity NUMERIC NOT NULL CHECK (quantity > 0),
  expiry_date DATE, -- For batch expiration tracking
  status TEXT NOT NULL DEFAULT 'reserved' CHECK (status IN ('reserved', 'released', 'consumed')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_reservation_lines_order ON public.reservation_lines(order_id);
CREATE INDEX IF NOT EXISTS idx_reservation_lines_item_warehouse ON public.reservation_lines(item_id, warehouse_id);
CREATE INDEX IF NOT EXISTS idx_reservation_lines_batch ON public.reservation_lines(batch_id);

-- RLS
ALTER TABLE public.reservation_lines ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS reservation_lines_read_staff ON public.reservation_lines;
CREATE POLICY reservation_lines_read_staff ON public.reservation_lines
  FOR SELECT USING (public.is_staff() OR EXISTS (
    SELECT 1 FROM public.orders o WHERE o.id = reservation_lines.order_id AND o.customer_auth_user_id = auth.uid()
  ));

DROP POLICY IF EXISTS reservation_lines_write_staff ON public.reservation_lines;
CREATE POLICY reservation_lines_write_staff ON public.reservation_lines
  FOR ALL USING (public.is_staff());

-- 2. Create Trigger to maintain stock_management.reserved_quantity
CREATE OR REPLACE FUNCTION public.sync_reservation_to_stock()
RETURNS TRIGGER AS $$
BEGIN
  IF (TG_OP = 'INSERT') THEN
    UPDATE public.stock_management
    SET reserved_quantity = reserved_quantity + NEW.quantity,
        last_updated = NOW()
    WHERE item_id::text = NEW.item_id 
      AND warehouse_id = NEW.warehouse_id;
  ELSIF (TG_OP = 'DELETE') THEN
    UPDATE public.stock_management
    SET reserved_quantity = GREATEST(0, reserved_quantity - OLD.quantity),
        last_updated = NOW()
    WHERE item_id::text = OLD.item_id 
      AND warehouse_id = OLD.warehouse_id;
  ELSIF (TG_OP = 'UPDATE') THEN
    -- Handle quantity change
    IF OLD.quantity <> NEW.quantity THEN
      UPDATE public.stock_management
      SET reserved_quantity = GREATEST(0, reserved_quantity - OLD.quantity + NEW.quantity),
          last_updated = NOW()
      WHERE item_id::text = NEW.item_id 
        AND warehouse_id = NEW.warehouse_id;
    END IF;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_sync_reservation_stock ON public.reservation_lines;
CREATE TRIGGER trg_sync_reservation_stock
AFTER INSERT OR UPDATE OR DELETE ON public.reservation_lines
FOR EACH ROW EXECUTE FUNCTION public.sync_reservation_to_stock();

-- 3. Migration: Move existing Food Reservations (JSON) to Ledger
--    We disable the trigger during migration to avoid double-counting reserved_quantity
ALTER TABLE public.reservation_lines DISABLE TRIGGER trg_sync_reservation_stock;

DO $$
DECLARE
  v_sm RECORD;
  v_batches JSONB;
  v_batch_id TEXT;
  v_entries JSONB;
  v_entry JSONB;
  v_order_id UUID;
  v_qty NUMERIC;
  v_expiry DATE;
BEGIN
  FOR v_sm IN 
    SELECT item_id, warehouse_id, data 
    FROM public.stock_management 
    WHERE data->'reservedBatches' IS NOT NULL 
      AND data->'reservedBatches' != '{}'::jsonb
      AND data->'reservedBatches' != 'null'::jsonb
  LOOP
    v_batches := v_sm.data->'reservedBatches';
    
    FOR v_batch_id, v_entries IN SELECT * FROM jsonb_each(v_batches)
    LOOP
      -- Ensure entries is an array
      IF jsonb_typeof(v_entries) = 'object' THEN
        v_entries := jsonb_build_array(v_entries);
      ELSIF jsonb_typeof(v_entries) != 'array' THEN
        CONTINUE;
      END IF;

      FOR v_entry IN SELECT * FROM jsonb_array_elements(v_entries)
      LOOP
        v_order_id := (v_entry->>'orderId')::uuid;
        v_qty := (v_entry->>'qty')::numeric;
        
        -- Get expiry from batch
        BEGIN
          SELECT expiry_date INTO v_expiry FROM public.batches WHERE id = v_batch_id::uuid;
        EXCEPTION WHEN OTHERS THEN
          v_expiry := NULL;
        END;

        IF v_qty > 0 AND v_order_id IS NOT NULL THEN
          INSERT INTO public.reservation_lines (
            order_id, item_id, warehouse_id, batch_id, quantity, expiry_date, status
          ) VALUES (
            v_order_id, v_sm.item_id::text, v_sm.warehouse_id, v_batch_id::uuid, v_qty, v_expiry, 'reserved'
          );
        END IF;
      END LOOP;
    END LOOP;

    -- Clear the JSON after migration
    UPDATE public.stock_management
    SET data = data - 'reservedBatches'
    WHERE item_id = v_sm.item_id AND warehouse_id = v_sm.warehouse_id;
    
  END LOOP;
END $$;

ALTER TABLE public.reservation_lines ENABLE TRIGGER trg_sync_reservation_stock;

-- 4. Update reserve_stock_for_order RPC
CREATE OR REPLACE FUNCTION public.reserve_stock_for_order(
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
  v_item_id_text text;
  v_item_id_uuid uuid;
  v_requested numeric;
  v_available numeric;
  v_reserved numeric;
  v_is_food boolean;
  v_batch_id_text text;
  v_expiry date;
  v_batch_remaining numeric;
  v_res_line_id uuid;
BEGIN
  if p_warehouse_id is null then
    raise exception 'warehouse_id is required';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    raise exception 'p_items must be a json array';
  end if;
  if p_order_id is null then
    raise exception 'p_order_id is required for reservation';
  end if;

  for v_item in select value from jsonb_array_elements(p_items)
  loop
    v_item_id_text := coalesce(v_item->>'itemId', v_item->>'id');
    v_requested := coalesce(nullif(v_item->>'quantity','')::numeric, 0);
    v_batch_id_text := nullif(v_item->>'batchId', '');

    if v_item_id_text is null or v_item_id_text = '' then
      raise exception 'Invalid itemId';
    end if;
    if v_requested <= 0 then
      continue; -- Skip invalid quantity
    end if;

    -- Check if item exists and is food
    select coalesce(mi.category = 'food', false)
    into v_is_food
    from public.menu_items mi
    where mi.id = v_item_id_text;

    -- Lock stock record
    select coalesce(sm.available_quantity, 0), coalesce(sm.reserved_quantity, 0)
    into v_available, v_reserved
    from public.stock_management sm
    where sm.item_id::text = v_item_id_text
      and sm.warehouse_id = p_warehouse_id
    for update;

    if not found then
      raise exception 'Stock record not found for item % in warehouse %', v_item_id_text, p_warehouse_id;
    end if;

    -- Check Total Availability (Global Check)
    if (v_available - v_reserved) < v_requested then
       raise exception 'Insufficient stock for item % (Available: %, Reserved: %, Requested: %)', v_item_id_text, v_available, v_reserved, v_requested;
    end if;

    -- Non-Food Reservation
    if not v_is_food then
      -- Insert into ledger (Trigger will update reserved_quantity)
      insert into public.reservation_lines (
        order_id, item_id, warehouse_id, quantity, status
      ) values (
        p_order_id, v_item_id_text, p_warehouse_id, v_requested, 'reserved'
      );
    
    -- Food Reservation (Batch Logic)
    else
      if v_batch_id_text is not null then
        -- Specific Batch Requested
        select
          greatest(coalesce(b.quantity_received,0) - coalesce(b.quantity_consumed,0) - coalesce(b.quantity_transferred,0), 0),
          b.expiry_date
        into v_batch_remaining, v_expiry
        from public.batches b
        where b.id = v_batch_id_text::uuid
          and b.item_id = v_item_id_text
          and b.warehouse_id = p_warehouse_id
        for update;

        if not found then
          raise exception 'Batch % not found', v_batch_id_text;
        end if;
        if v_expiry is not null and v_expiry < current_date then
          raise exception 'Batch % is expired', v_batch_id_text;
        end if;

        -- Check Batch Availability (considering other reservations on this batch)
        -- We need to sum reservations for this batch from reservation_lines
        declare
          v_batch_reserved numeric;
        begin
          select coalesce(sum(quantity), 0)
          into v_batch_reserved
          from public.reservation_lines
          where batch_id = v_batch_id_text::uuid
            and status = 'reserved';
          
          if (v_batch_remaining - v_batch_reserved) < v_requested then
             raise exception 'Insufficient batch stock (Remaining: %, Reserved: %, Requested: %)', v_batch_remaining, v_batch_reserved, v_requested;
          end if;
        end;

        insert into public.reservation_lines (
          order_id, item_id, warehouse_id, batch_id, quantity, expiry_date, status
        ) values (
          p_order_id, v_item_id_text, p_warehouse_id, v_batch_id_text::uuid, v_requested, v_expiry, 'reserved'
        );

      else
        -- Auto-allocate from batches (FEFO)
        declare
          v_remaining_needed numeric := v_requested;
          v_batch record;
          v_alloc numeric;
          v_b_reserved numeric;
        begin
           for v_batch in
            select b.id, b.expiry_date,
              greatest(coalesce(b.quantity_received,0) - coalesce(b.quantity_consumed,0) - coalesce(b.quantity_transferred,0), 0) as qty
            from public.batches b
            where b.item_id = v_item_id_text
              and b.warehouse_id = p_warehouse_id
              and (b.expiry_date is null or b.expiry_date >= current_date)
              and greatest(coalesce(b.quantity_received,0) - coalesce(b.quantity_consumed,0) - coalesce(b.quantity_transferred,0), 0) > 0
            order by b.expiry_date asc nulls last, b.created_at asc
            for update
          loop
            exit when v_remaining_needed <= 0;

            -- Check reservations on this batch
            select coalesce(sum(quantity), 0)
            into v_b_reserved
            from public.reservation_lines
            where batch_id = v_batch.id
              and status = 'reserved';

            v_alloc := least(v_remaining_needed, greatest(0, v_batch.qty - v_b_reserved));
            
            if v_alloc > 0 then
              insert into public.reservation_lines (
                order_id, item_id, warehouse_id, batch_id, quantity, expiry_date, status
              ) values (
                p_order_id, v_item_id_text, p_warehouse_id, v_batch.id, v_alloc, v_batch.expiry_date, 'reserved'
              );
              v_remaining_needed := v_remaining_needed - v_alloc;
            end if;
          end loop;

          if v_remaining_needed > 0 then
             raise exception 'Insufficient food stock available for reservation';
          end if;
        end;
      end if;
    end if;
  end loop;
END;
$$;

-- 5. Update release_reserved_stock_for_order RPC
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
  v_wh uuid;
  v_order record;
BEGIN
  if p_order_id is null then
    raise exception 'p_order_id is required';
  end if;

  select * into v_order from public.orders where id = p_order_id;
  if not found then raise exception 'Order not found'; end if;

  -- Resolve Warehouse
  v_wh := p_warehouse_id;
  if v_wh is null then
     v_wh := coalesce(
       (v_order.data->>'warehouseId')::uuid,
       public._resolve_default_warehouse_id()
     );
  end if;

  for v_item in select value from jsonb_array_elements(p_items)
  loop
    v_item_id := nullif(trim(coalesce(v_item->>'itemId', v_item->>'id')), '');
    v_qty := coalesce(nullif(v_item->>'quantity','')::numeric, 0);

    if v_item_id is null or v_qty <= 0 then continue; end if;

    -- FIX: Corrected logic to handle partial release properly
    DECLARE
      v_rem_to_release numeric := v_qty;
      v_rec record;
    BEGIN
      FOR v_rec IN 
        SELECT id, quantity 
        FROM public.reservation_lines
        WHERE order_id = p_order_id
          AND item_id = v_item_id
          AND warehouse_id = v_wh
          AND status = 'reserved'
        FOR UPDATE
      LOOP
        EXIT WHEN v_rem_to_release <= 0;
        
        IF v_rec.quantity <= v_rem_to_release THEN
          DELETE FROM public.reservation_lines WHERE id = v_rec.id;
          v_rem_to_release := v_rem_to_release - v_rec.quantity;
        ELSE
          UPDATE public.reservation_lines
          SET quantity = quantity - v_rem_to_release
          WHERE id = v_rec.id;
          v_rem_to_release := 0;
        END IF;
      END LOOP;
    END;

  end loop;
END;
$$;
