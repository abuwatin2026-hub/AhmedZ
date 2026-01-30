-- Force recreation of the pricing function to ensure signature is correct
-- This fixes the PGRST202 error where the schema cache is stale or signature is mismatched

DROP FUNCTION IF EXISTS public.get_item_price_with_discount(uuid, uuid, numeric);
DROP FUNCTION IF EXISTS public.get_item_price_with_discount(text, uuid, numeric);

-- Create new function with correct UUID signature
CREATE OR REPLACE FUNCTION public.get_item_price_with_discount(
  p_item_id uuid,
  p_customer_id uuid default null,
  p_quantity numeric default 1
)
RETURNS numeric
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_customer_type text := 'retail';
  v_special_price numeric;
  v_tier_price numeric;
  v_tier_discount numeric;
  v_base_unit_price numeric;
  v_unit_type text;
  v_price_per_unit numeric;
  v_final_unit_price numeric;
BEGIN
  IF p_item_id IS NULL THEN
    RAISE EXCEPTION 'p_item_id is required';
  END IF;
  
  IF p_quantity IS NULL OR p_quantity <= 0 THEN
    p_quantity := 1;
  END IF;

  SELECT
    COALESCE(mi.unit_type, 'piece'),
    COALESCE(NULLIF((mi.data->>'pricePerUnit')::numeric, NULL), 0),
    COALESCE(NULLIF((mi.data->>'price')::numeric, NULL), mi.price, 0)
  INTO v_unit_type, v_price_per_unit, v_base_unit_price
  FROM public.menu_items mi
  WHERE mi.id = p_item_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Item not found: %', p_item_id;
  END IF;

  IF v_unit_type = 'gram' AND COALESCE(v_price_per_unit, 0) > 0 THEN
    v_base_unit_price := v_price_per_unit / 1000;
  END IF;

  IF p_customer_id IS NOT NULL THEN
    SELECT COALESCE(c.customer_type, 'retail')
    INTO v_customer_type
    FROM public.customers c
    WHERE c.auth_user_id = p_customer_id;

    IF NOT FOUND THEN
      v_customer_type := 'retail';
    END IF;

    SELECT csp.special_price
    INTO v_special_price
    FROM public.customer_special_prices csp
    WHERE csp.customer_id = p_customer_id
      AND csp.item_id = p_item_id
      AND csp.is_active = true
      AND (csp.valid_from IS NULL OR csp.valid_from <= now())
      AND (csp.valid_to IS NULL OR csp.valid_to >= now())
    ORDER BY csp.created_at DESC
    LIMIT 1;

    IF v_special_price IS NOT NULL THEN
      RETURN v_special_price;
    END IF;
  END IF;

  SELECT pt.price, pt.discount_percentage
  INTO v_tier_price, v_tier_discount
  FROM public.price_tiers pt
  WHERE pt.item_id = p_item_id
    AND pt.customer_type = v_customer_type
    AND pt.is_active = true
    AND pt.min_quantity <= p_quantity
    AND (pt.max_quantity IS NULL OR pt.max_quantity >= p_quantity)
    AND (pt.valid_from IS NULL OR pt.valid_from <= now())
    AND (pt.valid_to IS NULL OR pt.valid_to >= now())
  ORDER BY pt.min_quantity DESC
  LIMIT 1;

  IF v_tier_price IS NOT NULL AND v_tier_price > 0 THEN
    v_final_unit_price := v_tier_price;
  ELSE
    v_final_unit_price := v_base_unit_price;
    IF COALESCE(v_tier_discount, 0) > 0 THEN
      v_final_unit_price := v_base_unit_price * (1 - (LEAST(100, GREATEST(0, v_tier_discount)) / 100));
    END IF;
  END IF;

  RETURN COALESCE(v_final_unit_price, 0);
END;
$$;
