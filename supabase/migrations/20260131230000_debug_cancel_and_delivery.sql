-- Migration: Debug Cancel Order and Confirm Delivery with RETURNING check
-- Date: 2026-01-31
-- Description: Add diagnostics to cancel_order and confirm_order_delivery to detect silent update failures or trigger reversions.

-- 1. Enhanced cancel_order with diagnostics
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
  v_new_status text;
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
  WHERE id = p_order_id
  RETURNING status INTO v_new_status;

  IF v_new_status IS NULL THEN
    RAISE EXCEPTION 'Update failed: 0 rows affected. Check RLS or Triggers.';
  END IF;

  IF v_new_status <> 'cancelled' THEN
    RAISE EXCEPTION 'Update failed: Status remained % after update. A trigger might be reverting changes.', v_new_status;
  END IF;

END;
$$;

-- 2. Enhanced confirm_order_delivery with diagnostics
CREATE OR REPLACE FUNCTION public.confirm_order_delivery(
    p_order_id uuid,
    p_items jsonb,
    p_updated_data jsonb,
    p_warehouse_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_order record;
    v_new_status text;
BEGIN
    if p_warehouse_id is null then
      raise exception 'warehouse_id is required';
    end if;

    select *
    into v_order
    from public.orders o
    where o.id = p_order_id
    for update;

    if not found then
      raise exception 'order not found';
    end if;

    -- Idempotency: If already delivered, just return (or update data)
    if v_order.status = 'delivered' then
       UPDATE public.orders
       SET data = p_updated_data,
           updated_at = now()
       WHERE id = p_order_id;
       RETURN;
    end if;

    if exists (
      select 1
      from public.inventory_movements im
      where im.reference_table = 'orders'
      and im.reference_id = p_order_id::text
      and im.movement_type = 'sale_out'
    ) then
      update public.orders
      set status = 'delivered',
          data = p_updated_data,
          updated_at = now()
      where id = p_order_id
      RETURNING status INTO v_new_status;
      
      IF v_new_status IS NULL THEN
         RAISE EXCEPTION 'Update (Idempotent) failed: 0 rows affected.';
      END IF;
      return;
    end if;

    PERFORM public.deduct_stock_on_delivery_v2(p_order_id, p_items, p_warehouse_id);
    
    update public.orders
    set status = 'delivered',
        data = p_updated_data,
        updated_at = now()
    where id = p_order_id
    RETURNING status INTO v_new_status;
    
    IF v_new_status IS NULL THEN
         RAISE EXCEPTION 'Update (Delivery) failed: 0 rows affected.';
    END IF;

    IF v_new_status <> 'delivered' THEN
        RAISE EXCEPTION 'Update (Delivery) failed: Status remained % after update.', v_new_status;
    END IF;
end;
$$;
