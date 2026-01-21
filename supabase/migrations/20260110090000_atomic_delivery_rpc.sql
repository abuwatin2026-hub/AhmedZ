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
BEGIN
    -- 1. Deduct Stock (Atomic)
    -- Any error here will rollback the transaction
    PERFORM public.deduct_stock_on_delivery_v2(p_order_id, p_items);

    -- 2. Update Order Status and Data
    UPDATE public.orders
    SET status = 'delivered',
        data = p_updated_data,
        updated_at = now()
    WHERE id = p_order_id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.confirm_order_delivery(uuid, jsonb, jsonb) TO authenticated;
