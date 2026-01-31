-- Migration: Create cancel_order RPC
-- Date: 2026-01-31
-- Description: Implement missing cancel_order function to handle order cancellations, releasing stock reservations.

CREATE OR REPLACE FUNCTION public.cancel_order(
  p_order_id uuid,
  p_reason text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order_status text;
  v_order_data jsonb;
  v_items jsonb;
  v_warehouse_id uuid;
BEGIN
  -- 1. Validate Order
  SELECT status, data, data->'items'
  INTO v_order_status, v_order_data, v_items
  FROM public.orders
  WHERE id = p_order_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order not found';
  END IF;

  -- 2. Check Permissions (Admin or Staff)
  IF NOT public.is_admin() AND NOT public.is_staff() THEN
     RAISE EXCEPTION 'not allowed';
  END IF;

  -- 3. Idempotency check
  IF v_order_status = 'cancelled' THEN
    RETURN;
  END IF;

  IF v_order_status = 'delivered' THEN
    RAISE EXCEPTION 'Cannot cancel a delivered order. Use Return process instead.';
  END IF;

  -- 4. Release Reservations
  -- We use the newly fixed warehouse-agnostic release function
  -- We pass items from order data
  
  -- Resolve Warehouse (Just in case needed, though release is now agnostic)
  v_warehouse_id := coalesce((v_order_data->>'warehouseId')::uuid, public._resolve_default_warehouse_id());

  IF v_items IS NOT NULL AND jsonb_array_length(v_items) > 0 THEN
    PERFORM public.release_reserved_stock_for_order(
      p_items := v_items,
      p_order_id := p_order_id,
      p_warehouse_id := v_warehouse_id
    );
  END IF;

  -- 5. Update Order Status
  UPDATE public.orders
  SET status = 'cancelled',
      cancelled_at = NOW(),
      data = jsonb_set(
        coalesce(data, '{}'::jsonb), 
        '{cancellationReason}', 
        to_jsonb(coalesce(p_reason, ''))
      )
  WHERE id = p_order_id;

  -- 6. Log Audit Event (Optional, usually handled by trigger or app)
  -- We rely on the app to log the event, or the triggers on 'orders' table.

END;
$$;

GRANT EXECUTE ON FUNCTION public.cancel_order(uuid, text) TO authenticated;
