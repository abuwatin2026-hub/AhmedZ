DO $$
BEGIN
  IF to_regclass('public.inventory_movements') IS NOT NULL
     AND EXISTS (
       SELECT 1
       FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name = 'inventory_movements'
         AND column_name = 'warehouse_id'
     )
     AND EXISTS (
       SELECT 1
       FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name = 'inventory_movements'
         AND column_name = 'batch_id'
     ) THEN
    EXECUTE 'create unique index if not exists ux_inventory_movements_sale_out_nobatch on public.inventory_movements(reference_table, reference_id, movement_type, item_id, warehouse_id) where movement_type = ''sale_out'' and batch_id is null';
    EXECUTE 'create unique index if not exists ux_inventory_movements_sale_out_batch on public.inventory_movements(reference_table, reference_id, movement_type, item_id, warehouse_id, batch_id) where movement_type = ''sale_out'' and batch_id is not null';
  END IF;
END $$;

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
  v_requested numeric;
  v_warehouse_id uuid;
  v_is_food boolean;
  v_available numeric;
  v_reserved numeric;
  v_avg_cost numeric;
  v_unit_cost numeric;
  v_movement_id uuid;
  v_existing_count integer;
  v_qty_from_res numeric;
  v_res_lines jsonb;
  v_qty_needed_free numeric;
  v_batch_id uuid;
  v_batch_expiry date;
  v_batch_qty numeric;
  v_batch_reserved numeric;
  v_batch_free numeric;
  v_alloc numeric;
  v_remaining_needed numeric;
  v_order_data jsonb;
  v_other_whs text;
BEGIN
  IF NOT public.is_admin() AND NOT public.is_staff() THEN
    IF auth.role() <> 'service_role' AND NOT public.is_admin() THEN
      RAISE EXCEPTION 'not allowed';
    END IF;
  END IF;

  IF p_order_id IS NULL THEN
    RAISE EXCEPTION 'p_order_id is required';
  END IF;
  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' THEN
    RAISE EXCEPTION 'p_items must be a json array';
  END IF;

  IF p_warehouse_id IS NOT NULL THEN
    v_warehouse_id := p_warehouse_id;
  ELSE
    SELECT data INTO v_order_data FROM public.orders WHERE id = p_order_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'order not found';
    END IF;
    v_warehouse_id := coalesce((v_order_data->>'warehouseId')::uuid, public._resolve_default_warehouse_id());
  END IF;

  IF v_warehouse_id IS NULL THEN
    RAISE EXCEPTION 'warehouse_id is required';
  END IF;

  DELETE FROM public.order_item_cogs WHERE order_id = p_order_id;

  FOR v_item IN SELECT value FROM jsonb_array_elements(p_items)
  LOOP
    v_item_id_text := nullif(trim(coalesce(v_item->>'itemId', v_item->>'id')), '');
    v_requested := coalesce(nullif(v_item->>'quantity', '')::numeric, 0);

    IF v_item_id_text IS NULL THEN
      RAISE EXCEPTION 'Invalid itemId';
    END IF;
    IF v_requested <= 0 THEN
      CONTINUE;
    END IF;

    SELECT coalesce(mi.category = 'food', false)
    INTO v_is_food
    FROM public.menu_items mi
    WHERE mi.id = v_item_id_text;

    PERFORM public.recalculate_stock_item(v_item_id_text, v_warehouse_id);

    SELECT sm.available_quantity, sm.reserved_quantity, coalesce(sm.avg_cost, 0)
    INTO v_available, v_reserved, v_avg_cost
    FROM public.stock_management sm
    WHERE sm.item_id::text = v_item_id_text
      AND sm.warehouse_id = v_warehouse_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Stock record not found for item % in warehouse %', v_item_id_text, v_warehouse_id;
    END IF;

    SELECT count(*)
    INTO v_existing_count
    FROM public.inventory_movements im
    WHERE im.reference_table = 'orders'
      AND im.reference_id = p_order_id::text
      AND im.movement_type = 'sale_out'
      AND im.item_id = v_item_id_text
      AND im.warehouse_id = v_warehouse_id;

    IF v_existing_count > 0 THEN
      DELETE FROM public.reservation_lines rl
      WHERE rl.order_id = p_order_id
        AND rl.item_id = v_item_id_text
        AND rl.status = 'reserved'
        AND rl.warehouse_id = v_warehouse_id;

      INSERT INTO public.order_item_cogs(order_id, item_id, quantity, unit_cost, total_cost, created_at)
      SELECT
        p_order_id,
        im.item_id::text,
        coalesce(im.quantity, 0),
        coalesce(im.unit_cost, 0),
        coalesce(im.quantity, 0) * coalesce(im.unit_cost, 0),
        now()
      FROM public.inventory_movements im
      WHERE im.reference_table = 'orders'
        AND im.reference_id = p_order_id::text
        AND im.movement_type = 'sale_out'
        AND im.item_id = v_item_id_text
        AND im.warehouse_id = v_warehouse_id;

      PERFORM public.recalculate_stock_item(v_item_id_text, v_warehouse_id);
      CONTINUE;
    END IF;

    SELECT string_agg(distinct rl.warehouse_id::text, ',')
    INTO v_other_whs
    FROM public.reservation_lines rl
    WHERE rl.order_id = p_order_id
      AND rl.item_id = v_item_id_text
      AND rl.status = 'reserved'
      AND rl.warehouse_id <> v_warehouse_id;

    IF v_other_whs IS NOT NULL THEN
      RAISE EXCEPTION 'Reservation warehouse mismatch for item % (other warehouses: %)', v_item_id_text, v_other_whs;
    END IF;

    v_qty_from_res := 0;
    v_res_lines := '[]'::jsonb;
    WITH deleted_rows AS (
      DELETE FROM public.reservation_lines
      WHERE order_id = p_order_id
        AND item_id = v_item_id_text
        AND status = 'reserved'
        AND warehouse_id = v_warehouse_id
      RETURNING batch_id, quantity, expiry_date
    )
    SELECT
      coalesce(sum(quantity), 0),
      coalesce(jsonb_agg(jsonb_build_object('batchId', batch_id, 'qty', quantity, 'expiry', expiry_date)), '[]'::jsonb)
    INTO v_qty_from_res, v_res_lines
    FROM deleted_rows;

    v_qty_needed_free := v_requested - v_qty_from_res;

    IF v_available < v_requested THEN
      RAISE EXCEPTION 'Insufficient stock: Available %, Requested % (item % warehouse %)', v_available, v_requested, v_item_id_text, v_warehouse_id;
    END IF;

    IF NOT v_is_food THEN
      v_unit_cost := coalesce(v_avg_cost, 0);

      INSERT INTO public.inventory_movements(
        item_id, movement_type, quantity, unit_cost, total_cost,
        reference_table, reference_id, occurred_at, created_by, data, warehouse_id
      )
      VALUES (
        v_item_id_text, 'sale_out', v_requested, v_unit_cost, (v_requested * v_unit_cost),
        'orders', p_order_id::text, now(), auth.uid(),
        jsonb_build_object('orderId', p_order_id, 'warehouseId', v_warehouse_id),
        v_warehouse_id
      )
      ON CONFLICT (reference_table, reference_id, movement_type, item_id, warehouse_id) WHERE batch_id IS NULL
      DO NOTHING
      RETURNING id INTO v_movement_id;

      IF v_movement_id IS NULL THEN
        SELECT im.id, coalesce(im.unit_cost, 0), coalesce(im.quantity, 0)
        INTO v_movement_id, v_unit_cost, v_alloc
        FROM public.inventory_movements im
        WHERE im.reference_table = 'orders'
          AND im.reference_id = p_order_id::text
          AND im.movement_type = 'sale_out'
          AND im.item_id = v_item_id_text
          AND im.warehouse_id = v_warehouse_id
          AND im.batch_id IS NULL
        ORDER BY im.occurred_at DESC
        LIMIT 1;

        IF NOT FOUND THEN
          RAISE EXCEPTION 'sale_out movement missing after conflict for order % item %', p_order_id, v_item_id_text;
        END IF;
      ELSE
        v_alloc := v_requested;
      END IF;

      INSERT INTO public.order_item_cogs(order_id, item_id, quantity, unit_cost, total_cost, created_at)
      VALUES (p_order_id, v_item_id_text, v_alloc, v_unit_cost, (v_alloc * v_unit_cost), now());

      PERFORM public.post_inventory_movement(v_movement_id);
    ELSE
      IF v_qty_from_res > 0 THEN
        DECLARE
          v_r_batch jsonb;
        BEGIN
          FOR v_r_batch IN SELECT value FROM jsonb_array_elements(v_res_lines)
          LOOP
            v_batch_id := nullif(v_r_batch->>'batchId', '')::uuid;
            v_alloc := coalesce(nullif((v_r_batch->>'qty')::numeric, null), 0);
            v_batch_expiry := nullif(v_r_batch->>'expiry', '')::date;

            IF v_batch_id IS NULL OR v_alloc <= 0 THEN
              CONTINUE;
            END IF;

            SELECT b.unit_cost INTO v_unit_cost
            FROM public.batches b
            WHERE b.id = v_batch_id;

            IF v_unit_cost IS NULL THEN
              SELECT im.unit_cost INTO v_unit_cost
              FROM public.inventory_movements im
              WHERE im.batch_id = v_batch_id
                AND im.movement_type = 'purchase_in'
              ORDER BY im.occurred_at DESC
              LIMIT 1;
            END IF;
            v_unit_cost := coalesce(v_unit_cost, v_avg_cost, 0);

            INSERT INTO public.inventory_movements(
              item_id, movement_type, quantity, unit_cost, total_cost,
              reference_table, reference_id, occurred_at, created_by, data, batch_id, warehouse_id
            )
            VALUES (
              v_item_id_text, 'sale_out', v_alloc, v_unit_cost, (v_alloc * v_unit_cost),
              'orders', p_order_id::text, now(), auth.uid(),
              jsonb_build_object('orderId', p_order_id, 'batchId', v_batch_id, 'expiryDate', v_batch_expiry),
              v_batch_id, v_warehouse_id
            )
            ON CONFLICT (reference_table, reference_id, movement_type, item_id, warehouse_id, batch_id) WHERE batch_id IS NOT NULL
            DO NOTHING
            RETURNING id INTO v_movement_id;

            IF v_movement_id IS NULL THEN
              SELECT im.id, coalesce(im.unit_cost, 0), coalesce(im.quantity, 0)
              INTO v_movement_id, v_unit_cost, v_alloc
              FROM public.inventory_movements im
              WHERE im.reference_table = 'orders'
                AND im.reference_id = p_order_id::text
                AND im.movement_type = 'sale_out'
                AND im.item_id = v_item_id_text
                AND im.warehouse_id = v_warehouse_id
                AND im.batch_id = v_batch_id
              ORDER BY im.occurred_at DESC
              LIMIT 1;

              IF NOT FOUND THEN
                RAISE EXCEPTION 'sale_out movement missing after conflict for order % item % batch %', p_order_id, v_item_id_text, v_batch_id;
              END IF;
            END IF;

            INSERT INTO public.order_item_cogs(order_id, item_id, quantity, unit_cost, total_cost, created_at)
            VALUES (p_order_id, v_item_id_text, v_alloc, v_unit_cost, (v_alloc * v_unit_cost), now());

            PERFORM public.post_inventory_movement(v_movement_id);
          END LOOP;
        END;
      END IF;

      IF v_qty_needed_free > 0 THEN
        v_remaining_needed := v_qty_needed_free;

        FOR v_batch_id, v_batch_expiry, v_batch_qty IN
          SELECT
            b.id,
            b.expiry_date,
            greatest(coalesce(b.quantity_received,0) - coalesce(b.quantity_consumed,0) - coalesce(b.quantity_transferred,0), 0)
          FROM public.batches b
          WHERE b.item_id = v_item_id_text
            AND b.warehouse_id = v_warehouse_id
            AND (b.expiry_date IS NULL OR b.expiry_date >= current_date)
          ORDER BY b.expiry_date ASC NULLS LAST, b.created_at ASC
        LOOP
          EXIT WHEN v_remaining_needed <= 0;
          IF v_batch_qty <= 0 THEN
            CONTINUE;
          END IF;

          SELECT coalesce(sum(quantity), 0)
          INTO v_batch_reserved
          FROM public.reservation_lines
          WHERE batch_id = v_batch_id
            AND status = 'reserved';

          v_batch_free := greatest(0, v_batch_qty - v_batch_reserved);

          IF v_batch_free <= 0 THEN
            CONTINUE;
          END IF;

          v_alloc := least(v_remaining_needed, v_batch_free);

          SELECT b.unit_cost INTO v_unit_cost
          FROM public.batches b
          WHERE b.id = v_batch_id;

          IF v_unit_cost IS NULL THEN
            SELECT im.unit_cost INTO v_unit_cost
            FROM public.inventory_movements im
            WHERE im.batch_id = v_batch_id
              AND im.movement_type = 'purchase_in'
            ORDER BY im.occurred_at DESC
            LIMIT 1;
          END IF;
          v_unit_cost := coalesce(v_unit_cost, v_avg_cost, 0);

          INSERT INTO public.inventory_movements(
            item_id, movement_type, quantity, unit_cost, total_cost,
            reference_table, reference_id, occurred_at, created_by, data, batch_id, warehouse_id
          )
          VALUES (
            v_item_id_text, 'sale_out', v_alloc, v_unit_cost, (v_alloc * v_unit_cost),
            'orders', p_order_id::text, now(), auth.uid(),
            jsonb_build_object('orderId', p_order_id, 'batchId', v_batch_id, 'expiryDate', v_batch_expiry),
            v_batch_id, v_warehouse_id
          )
          ON CONFLICT (reference_table, reference_id, movement_type, item_id, warehouse_id, batch_id) WHERE batch_id IS NOT NULL
          DO NOTHING
          RETURNING id INTO v_movement_id;

          IF v_movement_id IS NULL THEN
            SELECT im.id, coalesce(im.unit_cost, 0), coalesce(im.quantity, 0)
            INTO v_movement_id, v_unit_cost, v_alloc
            FROM public.inventory_movements im
            WHERE im.reference_table = 'orders'
              AND im.reference_id = p_order_id::text
              AND im.movement_type = 'sale_out'
              AND im.item_id = v_item_id_text
              AND im.warehouse_id = v_warehouse_id
              AND im.batch_id = v_batch_id
            ORDER BY im.occurred_at DESC
            LIMIT 1;

            IF NOT FOUND THEN
              RAISE EXCEPTION 'sale_out movement missing after conflict for order % item % batch %', p_order_id, v_item_id_text, v_batch_id;
            END IF;
          END IF;

          INSERT INTO public.order_item_cogs(order_id, item_id, quantity, unit_cost, total_cost, created_at)
          VALUES (p_order_id, v_item_id_text, v_alloc, v_unit_cost, (v_alloc * v_unit_cost), now());

          PERFORM public.post_inventory_movement(v_movement_id);

          v_remaining_needed := v_remaining_needed - v_alloc;
        END LOOP;

        IF v_remaining_needed > 0 THEN
          RAISE EXCEPTION 'Insufficient free batch stock for item %', v_item_id_text;
        END IF;
      END IF;
    END IF;

    PERFORM public.recalculate_stock_item(v_item_id_text, v_warehouse_id);
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION public.recalculate_all_warehouses_stock()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_wh record;
BEGIN
  IF to_regclass('public.warehouses') IS NULL THEN
    RETURN;
  END IF;
  IF to_regprocedure('public.recalculate_warehouse_stock(uuid)') IS NULL THEN
    RETURN;
  END IF;
  FOR v_wh IN SELECT id FROM public.warehouses WHERE is_active = true
  LOOP
    PERFORM public.recalculate_warehouse_stock(v_wh.id);
  END LOOP;
END;
$$;

GRANT EXECUTE ON FUNCTION public.recalculate_all_warehouses_stock() TO authenticated;

DO $$
BEGIN
  PERFORM public.recalculate_all_warehouses_stock();
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;
