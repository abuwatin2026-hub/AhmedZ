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
  v_available numeric;
  v_reserved numeric;
  v_unit_cost numeric;
  v_total_cost numeric;
  v_movement_id uuid;
  v_stock_item_id_is_uuid boolean;
  v_is_in_store boolean;
BEGIN
  IF p_order_id IS NULL THEN
    RAISE EXCEPTION 'p_order_id is required';
  END IF;

  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' THEN
    RAISE EXCEPTION 'p_items must be a json array';
  END IF;

  SELECT (t.typname = 'uuid')
  INTO v_stock_item_id_is_uuid
  FROM pg_attribute a
  JOIN pg_class c ON a.attrelid = c.oid
  JOIN pg_namespace n ON c.relnamespace = n.oid
  JOIN pg_type t ON a.atttypid = t.oid
  WHERE n.nspname = 'public'
    AND c.relname = 'stock_management'
    AND a.attname = 'item_id'
    AND a.attnum > 0
    AND NOT a.attisdropped;

  SELECT (COALESCE(NULLIF(o.data->>'orderSource',''), '') = 'in_store')
  INTO v_is_in_store
  FROM public.orders o
  WHERE o.id = p_order_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'order not found';
  END IF;

  DELETE FROM public.order_item_cogs WHERE order_id = p_order_id;

  FOR v_item IN SELECT value FROM jsonb_array_elements(p_items)
  LOOP
    v_item_id_text := coalesce(v_item->>'itemId', v_item->>'id');
    v_requested := coalesce(nullif(v_item->>'quantity', '')::numeric, 0);

    IF v_item_id_text IS NULL OR v_item_id_text = '' THEN
      RAISE EXCEPTION 'Invalid itemId';
    END IF;

    IF v_requested <= 0 THEN
      CONTINUE;
    END IF;

    IF coalesce(v_stock_item_id_is_uuid, false) THEN
      BEGIN
        v_item_id_uuid := v_item_id_text::uuid;
      EXCEPTION WHEN others THEN
        RAISE EXCEPTION 'Invalid itemId %', v_item_id_text;
      END;

      SELECT
        coalesce(sm.available_quantity, 0),
        coalesce(sm.reserved_quantity, 0),
        coalesce(sm.avg_cost, 0)
      INTO v_available, v_reserved, v_unit_cost
      FROM public.stock_management sm
      WHERE sm.item_id = v_item_id_uuid
      FOR UPDATE;
    ELSE
      SELECT
        coalesce(sm.available_quantity, 0),
        coalesce(sm.reserved_quantity, 0),
        coalesce(sm.avg_cost, 0)
      INTO v_available, v_reserved, v_unit_cost
      FROM public.stock_management sm
      WHERE sm.item_id::text = v_item_id_text
      FOR UPDATE;
    END IF;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Stock record not found for item %', v_item_id_text;
    END IF;

    IF (v_available + 1e-9) < v_requested THEN
      RAISE EXCEPTION 'Insufficient stock for item % (available %, requested %)', v_item_id_text, v_available, v_requested;
    END IF;

    IF NOT coalesce(v_is_in_store, false) THEN
      IF (v_reserved + 1e-9) < v_requested THEN
        RAISE EXCEPTION 'Insufficient reserved stock for item % (reserved %, requested %)', v_item_id_text, v_reserved, v_requested;
      END IF;
    END IF;

    IF coalesce(v_stock_item_id_is_uuid, false) THEN
      UPDATE public.stock_management
      SET available_quantity = greatest(0, available_quantity - v_requested),
          reserved_quantity = greatest(0, reserved_quantity - v_requested),
          last_updated = now(),
          updated_at = now()
      WHERE item_id = v_item_id_uuid;
    ELSE
      UPDATE public.stock_management
      SET available_quantity = greatest(0, available_quantity - v_requested),
          reserved_quantity = greatest(0, reserved_quantity - v_requested),
          last_updated = now(),
          updated_at = now()
      WHERE item_id::text = v_item_id_text;
    END IF;

    v_total_cost := v_requested * v_unit_cost;

    INSERT INTO public.order_item_cogs(order_id, item_id, quantity, unit_cost, total_cost, created_at)
    VALUES (p_order_id, v_item_id_text, v_requested, v_unit_cost, v_total_cost, now());

    INSERT INTO public.inventory_movements(
      item_id, movement_type, quantity, unit_cost, total_cost,
      reference_table, reference_id, occurred_at, created_by, data
    )
    VALUES (
      v_item_id_text, 'sale_out', v_requested, v_unit_cost, v_total_cost,
      'orders', p_order_id::text, now(), auth.uid(), jsonb_build_object('orderId', p_order_id)
    )
    RETURNING id INTO v_movement_id;

    PERFORM public.post_inventory_movement(v_movement_id);
  END LOOP;
END;
$$;
REVOKE ALL ON FUNCTION public.deduct_stock_on_delivery_v2(uuid, jsonb) FROM public;
GRANT EXECUTE ON FUNCTION public.deduct_stock_on_delivery_v2(uuid, jsonb) TO anon, authenticated;
