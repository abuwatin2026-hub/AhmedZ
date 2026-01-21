-- Secure Order Creation RPC
-- This function encapsulates the entire order creation logic to prevent price manipulation and ensure data integrity.

CREATE OR REPLACE FUNCTION public.create_order_secure(
    p_items jsonb,                 -- Array of { itemId, quantity, weight?, gradeId?, selectedAddons: { addonId: qty } }
    p_delivery_zone_id uuid,
    p_payment_method text,
    p_notes text,
    p_address text,
    p_location jsonb,              -- { lat, lng }
    p_customer_name text,
    p_phone_number text,
    p_is_scheduled boolean,
    p_scheduled_at timestamptz,
    p_coupon_code text DEFAULT NULL,
    p_points_redeemed_value numeric DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_user_id uuid;
    v_order_id uuid;
    v_item_input jsonb;
    v_menu_item record;
    v_menu_item_data jsonb;
    v_cart_item jsonb;
    v_final_items jsonb := '[]'::jsonb;
    v_subtotal numeric := 0;
    v_total numeric := 0;
    v_delivery_fee numeric := 0;
    v_discount_amount numeric := 0;
    v_tax_amount numeric := 0;
    v_tax_rate numeric := 0;
    v_points_earned numeric := 0;
    v_settings jsonb;
    v_zone_data jsonb;
    v_line_total numeric;
    v_addons_price numeric;
    v_unit_price numeric;
    v_base_price numeric;
    v_addon_key text;
    v_addon_qty numeric;
    v_addon_def jsonb;
    v_grade_id text;
    v_grade_def jsonb;
    v_weight numeric;
    v_quantity numeric;
    v_unit_type text;
    v_delivery_pin text;
    v_available_addons jsonb;
    v_selected_addons_map jsonb;
    v_final_selected_addons jsonb;
    v_points_settings jsonb;
    v_currency_val_per_point numeric;
    v_points_per_currency numeric;
    v_coupon_record record;
    v_stock_items jsonb := '[]'::jsonb;
    v_item_name_ar text;
    v_item_name_en text;
BEGIN
    v_user_id := auth.uid();
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'User not authenticated';
    END IF;

    -- 1. Fetch Settings
    SELECT data INTO v_settings FROM public.app_settings WHERE id = 'singleton';
    IF v_settings IS NULL THEN
        v_settings := '{}'::jsonb;
    END IF;

    -- 2. Process Items & Calculate Subtotal
    FOR v_item_input IN SELECT * FROM jsonb_array_elements(p_items)
    LOOP
        -- Fetch Menu Item
        SELECT * INTO v_menu_item FROM public.menu_items WHERE id = (v_item_input->>'itemId');
        IF NOT FOUND THEN
            RAISE EXCEPTION 'Item not found: %', v_item_input->>'itemId';
        END IF;
        
        v_menu_item_data := v_menu_item.data;
        v_item_name_ar := v_menu_item_data->'name'->>'ar';
        v_item_name_en := v_menu_item_data->'name'->>'en';

        v_quantity := COALESCE((v_item_input->>'quantity')::numeric, 0);
        v_weight := COALESCE((v_item_input->>'weight')::numeric, 0);
        v_unit_type := COALESCE(v_menu_item.unit_type, 'piece');
        
        -- Determine Base Price & Quantity for Calculation
        IF v_unit_type IN ('kg', 'gram') THEN
             IF v_unit_type = 'gram' AND (v_menu_item.price_per_unit IS NOT NULL OR (v_menu_item_data->>'pricePerUnit') IS NOT NULL) THEN
                 v_base_price := COALESCE(v_menu_item.price_per_unit, (v_menu_item_data->>'pricePerUnit')::numeric) / 1000;
                 v_base_price := v_base_price * v_weight;
             ELSE
                 -- Fallback: Price is per unit (e.g. per kg)
                 v_base_price := v_menu_item.price * v_weight;
             END IF;
             -- For weight based, quantity in cart logic is usually 1 line item, but weight matters
             -- If input quantity is passed, we might need to respect it if it means "2 bags of 1kg"
             -- But usually weight-based items are single lines. Let's assume quantity is 1 if weight > 0
             IF v_quantity <= 0 THEN v_quantity := 1; END IF;
        ELSE
             v_base_price := v_menu_item.price;
             IF v_quantity <= 0 THEN RAISE EXCEPTION 'Quantity must be positive for item %', v_menu_item.id; END IF;
        END IF;

        -- Apply Grade Multiplier
        v_grade_id := v_item_input->>'gradeId';
        v_grade_def := NULL;
        IF v_grade_id IS NOT NULL AND (v_menu_item_data->'availableGrades') IS NOT NULL THEN
             SELECT value INTO v_grade_def 
             FROM jsonb_array_elements(v_menu_item_data->'availableGrades') 
             WHERE value->>'id' = v_grade_id;
             
             IF v_grade_def IS NOT NULL THEN
                 v_base_price := v_base_price * COALESCE((v_grade_def->>'priceMultiplier')::numeric, 1.0);
             END IF;
        END IF;

        -- Calculate Addons
        v_addons_price := 0;
        v_available_addons := COALESCE(v_menu_item_data->'addons', '[]'::jsonb);
        v_selected_addons_map := COALESCE(v_item_input->'selectedAddons', '{}'::jsonb);
        v_final_selected_addons := '{}'::jsonb;
        
        FOR v_addon_key IN SELECT jsonb_object_keys(v_selected_addons_map)
        LOOP
            v_addon_qty := (v_selected_addons_map->>v_addon_key)::numeric;
            IF v_addon_qty > 0 THEN
                -- Find addon definition in menu item
                SELECT value INTO v_addon_def
                FROM jsonb_array_elements(v_available_addons)
                WHERE value->>'id' = v_addon_key;
                
                IF v_addon_def IS NOT NULL THEN
                    v_addons_price := v_addons_price + ((v_addon_def->>'price')::numeric * v_addon_qty);
                    
                    -- Construct the addon object for the final order JSON
                    -- expected: key: { addon: Def, quantity: qty }
                    v_final_selected_addons := jsonb_set(
                        v_final_selected_addons,
                        ARRAY[v_addon_key],
                        jsonb_build_object('addon', v_addon_def, 'quantity', v_addon_qty)
                    );
                END IF;
            END IF;
        END LOOP;

        -- Line Total
        -- Note: For weight based, v_base_price is already total for that weight. 
        -- If unit_type is 'kg', base_price = price_per_kg * weight.
        -- Addons are usually per unit (per bag?). Let's assume addons price is flat per item quantity.
        -- If quantity > 1 (e.g. 2 burgers), total = (base + addons) * qty
        -- If weight based (e.g. 1.5kg), quantity is usually 1.
        
        v_unit_price := v_base_price + v_addons_price; -- This is "Price for this line configuration"
        v_line_total := (v_base_price + v_addons_price) * v_quantity; 
        
        -- If weight based, logic might be: (unit_price_per_kg * weight) + addons.
        -- We already calculated v_base_price as (price * weight).
        -- So if quantity is 1, it works.
        -- If quantity is > 1 for weight based (e.g. 2 packs of 1.5kg), then it works too.
        
        v_subtotal := v_subtotal + v_line_total;

        -- Construct CartItem
        -- We merge the original menu item data with our calculated fields
        v_cart_item := v_menu_item_data || jsonb_build_object(
            'quantity', v_quantity,
            'weight', v_weight,
            'selectedAddons', v_final_selected_addons,
            'selectedGrade', v_grade_def,
            'cartItemId', gen_random_uuid()::text,
            'price', v_menu_item.price -- Keep original unit price for reference
        );
        
        v_final_items := v_final_items || v_cart_item;
        
        -- Prepare for Stock Reservation
        v_stock_items := v_stock_items || jsonb_build_object(
            'itemId', v_menu_item.id,
            'quantity', v_quantity
        );
    END LOOP;

    -- 3. Delivery Fee
    IF p_delivery_zone_id IS NOT NULL THEN
        SELECT data INTO v_zone_data FROM public.delivery_zones WHERE id = p_delivery_zone_id;
        IF v_zone_data IS NOT NULL AND (v_zone_data->>'isActive')::boolean THEN
             v_delivery_fee := COALESCE((v_zone_data->>'deliveryFee')::numeric, 0);
        ELSE
             v_delivery_fee := COALESCE((v_settings->'deliverySettings'->>'baseFee')::numeric, 0);
        END IF;
    ELSE
        v_delivery_fee := COALESCE((v_settings->'deliverySettings'->>'baseFee')::numeric, 0);
    END IF;

    -- Free delivery threshold
    IF (v_settings->'deliverySettings'->>'freeDeliveryThreshold') IS NOT NULL AND 
       v_subtotal >= (v_settings->'deliverySettings'->>'freeDeliveryThreshold')::numeric THEN
        v_delivery_fee := 0;
    END IF;

    -- 4. Coupon Validation & Discount
    IF p_coupon_code IS NOT NULL AND length(p_coupon_code) > 0 THEN
        SELECT * INTO v_coupon_record FROM public.coupons WHERE lower(code) = lower(p_coupon_code) AND is_active = true;
        IF FOUND THEN
             -- Check expiry
             IF (v_coupon_record.data->>'expiresAt') IS NOT NULL AND (v_coupon_record.data->>'expiresAt')::timestamptz < now() THEN
                 RAISE EXCEPTION 'Coupon expired';
             END IF;
             -- Check min order
             IF (v_coupon_record.data->>'minOrderAmount') IS NOT NULL AND v_subtotal < (v_coupon_record.data->>'minOrderAmount')::numeric THEN
                 RAISE EXCEPTION 'Order amount too low for coupon';
             END IF;
             -- Check usage limit
             IF (v_coupon_record.data->>'usageLimit') IS NOT NULL AND 
                COALESCE((v_coupon_record.data->>'usageCount')::int, 0) >= (v_coupon_record.data->>'usageLimit')::int THEN
                 RAISE EXCEPTION 'Coupon usage limit reached';
             END IF;
             
             -- Calculate Discount
             IF (v_coupon_record.data->>'type') = 'percentage' THEN
                 v_discount_amount := v_subtotal * ((v_coupon_record.data->>'value')::numeric / 100);
                 IF (v_coupon_record.data->>'maxDiscount') IS NOT NULL THEN
                     v_discount_amount := LEAST(v_discount_amount, (v_coupon_record.data->>'maxDiscount')::numeric);
                 END IF;
             ELSE
                 v_discount_amount := (v_coupon_record.data->>'value')::numeric;
             END IF;
             
             -- Ensure discount doesn't exceed subtotal
             v_discount_amount := LEAST(v_discount_amount, v_subtotal);
             
             -- Increment Usage (Simple update, race condition possible but acceptable for now)
             UPDATE public.coupons 
             SET data = jsonb_set(data, '{usageCount}', (COALESCE((data->>'usageCount')::int, 0) + 1)::text::jsonb)
             WHERE id = v_coupon_record.id;
        ELSE
             -- Coupon not found or inactive, ignore or raise? Frontend should have validated. 
             -- Let's ignore to avoid blocking order, but reset discount.
             v_discount_amount := 0;
        END IF;
    END IF;

    -- 5. Points Redemption
    IF p_points_redeemed_value > 0 THEN
        v_points_settings := v_settings->'loyaltySettings';
        IF (v_points_settings->>'enabled')::boolean THEN
             v_currency_val_per_point := COALESCE((v_points_settings->>'currencyValuePerPoint')::numeric, 0);
             IF v_currency_val_per_point > 0 THEN
                 -- Verify user has enough points
                 DECLARE
                     v_user_points int;
                     v_points_needed numeric;
                 BEGIN
                     SELECT loyalty_points INTO v_user_points FROM public.customers WHERE auth_user_id = v_user_id;
                     v_points_needed := p_points_redeemed_value / v_currency_val_per_point;
                     
                     IF COALESCE(v_user_points, 0) < v_points_needed THEN
                         RAISE EXCEPTION 'Insufficient loyalty points';
                     END IF;
                     
                     -- Deduct points
                     UPDATE public.customers 
                     SET loyalty_points = loyalty_points - v_points_needed::int
                     WHERE auth_user_id = v_user_id;
                     
                     v_discount_amount := v_discount_amount + p_points_redeemed_value;
                 END;
             END IF;
        END IF;
    END IF;

    -- 6. Tax Calculation
    IF (v_settings->'taxSettings'->>'enabled')::boolean THEN
        v_tax_rate := COALESCE((v_settings->'taxSettings'->>'rate')::numeric, 0);
        -- Tax is usually applied on (Subtotal - Discount) + Delivery? Or just items?
        -- Assuming standard: (Subtotal - Discount) * Rate
        v_tax_amount := GREATEST(0, v_subtotal - v_discount_amount) * (v_tax_rate / 100);
    END IF;

    -- 7. Calculate Final Total
    v_total := GREATEST(0, v_subtotal - v_discount_amount) + v_delivery_fee + v_tax_amount;

    -- 8. Calculate Points Earned
    v_points_settings := v_settings->'loyaltySettings';
    IF (v_points_settings->>'enabled')::boolean THEN
        v_points_per_currency := COALESCE((v_points_settings->>'pointsPerCurrencyUnit')::numeric, 0);
        v_points_earned := FLOOR(v_subtotal * v_points_per_currency);
    END IF;

    -- 9. Generate Delivery Pin
    v_delivery_pin := floor(random() * 9000 + 1000)::text;

    -- 10. Insert Order
    INSERT INTO public.orders (
        customer_auth_user_id,
        status,
        invoice_number,
        data
    )
    VALUES (
        v_user_id,
        CASE WHEN p_is_scheduled THEN 'scheduled' ELSE 'pending' END,
        NULL, -- Invoice number generated later
        jsonb_build_object(
            'id', gen_random_uuid(), -- Temp ID in data, real ID is returning
            'userId', v_user_id,
            'orderSource', 'online',
            'items', v_final_items,
            'subtotal', v_subtotal,
            'deliveryFee', v_delivery_fee,
            'discountAmount', v_discount_amount,
            'total', v_total,
            'taxAmount', v_tax_amount,
            'taxRate', v_tax_rate,
            'pointsEarned', v_points_earned,
            'pointsRedeemedValue', p_points_redeemed_value,
            'deliveryZoneId', p_delivery_zone_id,
            'paymentMethod', p_payment_method,
            'notes', p_notes,
            'address', p_address, -- Encrypted or plain, stored as passed
            'location', p_location,
            'customerName', p_customer_name,
            'phoneNumber', p_phone_number,
            'isScheduled', p_is_scheduled,
            'scheduledAt', p_scheduled_at,
            'deliveryPin', v_delivery_pin,
            'appliedCouponCode', p_coupon_code
        )
    )
    RETURNING id INTO v_order_id;

    -- Update the ID in the data JSON (circular dependency fix)
    UPDATE public.orders 
    SET data = jsonb_set(data, '{id}', to_jsonb(v_order_id::text))
    WHERE id = v_order_id
    RETURNING data INTO v_item_input; -- Reuse variable to return the final JSON data

    -- 11. Reserve Stock
    PERFORM public.reserve_stock_for_order(v_stock_items, v_order_id);

    -- 12. Log Audit
    INSERT INTO public.order_events (order_id, action, actor_type, actor_id, to_status, payload)
    VALUES (
        v_order_id,
        'order.created',
        'customer',
        v_user_id,
        CASE WHEN p_is_scheduled THEN 'scheduled' ELSE 'pending' END,
        jsonb_build_object(
            'total', v_total,
            'method', p_payment_method
        )
    );

    RETURN v_item_input;
END;
$$;
GRANT EXECUTE ON FUNCTION public.create_order_secure TO authenticated;
