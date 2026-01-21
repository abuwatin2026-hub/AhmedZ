CREATE OR REPLACE FUNCTION public.confirm_order_delivery(
    p_order_id uuid,
    p_items jsonb,
    p_updated_data jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_actor uuid;
    v_is_admin boolean;
    v_is_delivery boolean;
    v_is_cashier boolean;
    v_order record;
    v_order_source text;
BEGIN
    v_actor := auth.uid();

    SELECT * INTO v_order FROM public.orders WHERE id = p_order_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'order not found';
    END IF;

    v_is_admin := EXISTS (
        SELECT 1 FROM public.admin_users au
        WHERE au.auth_user_id = v_actor
          AND au.is_active = true
          AND au.role IN ('owner','manager','employee')
    );

    v_is_cashier := EXISTS (
        SELECT 1 FROM public.admin_users au
        WHERE au.auth_user_id = v_actor
          AND au.is_active = true
          AND au.role = 'cashier'
    );

    v_is_delivery := EXISTS (
        SELECT 1 FROM public.admin_users au
        WHERE au.auth_user_id = v_actor
          AND au.is_active = true
          AND au.role = 'delivery'
    );

    v_order_source := COALESCE(NULLIF(v_order.data->>'orderSource',''), NULLIF(p_updated_data->>'orderSource',''), '');

    IF NOT v_is_admin AND NOT (
         v_is_delivery AND (v_order.data->>'assignedDeliveryUserId') = v_actor::text
    ) AND NOT (
         v_is_cashier AND v_order.customer_auth_user_id = v_actor AND v_order_source = 'in_store'
    ) THEN
        RAISE EXCEPTION 'not authorized';
    END IF;

    PERFORM public.deduct_stock_on_delivery_v2(p_order_id, p_items);

    UPDATE public.orders
    SET status = 'delivered',
        data = p_updated_data,
        updated_at = now()
    WHERE id = p_order_id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.confirm_order_delivery(uuid, jsonb, jsonb) TO authenticated;
