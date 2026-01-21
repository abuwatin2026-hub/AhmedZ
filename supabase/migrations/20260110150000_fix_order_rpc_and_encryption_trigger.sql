-- 1. Create Missing Columns in Orders Table (Schema Hardening)
-- The original schema relied too much on JSONB. We extract key fields to columns for performance and RPC compatibility.

ALTER TABLE public.orders 
ADD COLUMN IF NOT EXISTS customer_name text,
ADD COLUMN IF NOT EXISTS phone_number text,
ADD COLUMN IF NOT EXISTS total numeric DEFAULT 0,
ADD COLUMN IF NOT EXISTS subtotal numeric DEFAULT 0,
ADD COLUMN IF NOT EXISTS tax numeric DEFAULT 0,
ADD COLUMN IF NOT EXISTS delivery_fee numeric DEFAULT 0,
ADD COLUMN IF NOT EXISTS discount numeric DEFAULT 0,
ADD COLUMN IF NOT EXISTS items jsonb DEFAULT '[]'::jsonb,
ADD COLUMN IF NOT EXISTS payment_method text,
ADD COLUMN IF NOT EXISTS notes text,
ADD COLUMN IF NOT EXISTS address text,
ADD COLUMN IF NOT EXISTS location jsonb,
ADD COLUMN IF NOT EXISTS delivery_zone_id uuid REFERENCES public.delivery_zones(id),
ADD COLUMN IF NOT EXISTS is_scheduled boolean DEFAULT false,
ADD COLUMN IF NOT EXISTS scheduled_at timestamptz,
ADD COLUMN IF NOT EXISTS delivery_pin text,
ADD COLUMN IF NOT EXISTS points_redeemed_value numeric DEFAULT 0,
ADD COLUMN IF NOT EXISTS points_earned numeric DEFAULT 0;
CREATE OR REPLACE FUNCTION public.is_maintenance_on()
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v jsonb;
  v_on boolean;
BEGIN
  SELECT data INTO v FROM public.app_settings WHERE id = 'app';
  IF v IS NULL THEN
    SELECT data INTO v FROM public.app_settings WHERE id = 'general_settings';
  END IF;
  v_on := COALESCE((v->'settings'->>'maintenanceEnabled')::boolean, false);
  RETURN v_on;
END;
$$;
CREATE OR REPLACE FUNCTION public.is_active_admin()
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM public.admin_users
    WHERE auth_user_id = auth.uid()
    AND is_active = true
  );
END;
$$;
-- 2. Fix the Secure Order Creation RPC to handle JSONB data correctly
CREATE OR REPLACE FUNCTION public.create_order_secure(
    p_items jsonb,                 -- Array of { itemId, quantity, weight?, selectedAddons: { addonId: qty } }
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
    v_points_earned numeric := 0;
    v_zone_data jsonb;
    v_line_total numeric;
    v_addons_price numeric;
    v_unit_price numeric;
    v_base_price numeric;
    v_addon_key text;
    v_addon_qty numeric;
    v_addon_def jsonb;
    v_weight numeric;
    v_quantity numeric;
    v_unit_type text;
    v_delivery_pin text;
    v_coupon_record record;
BEGIN
    -- Check if user is authenticated (optional, can be guest)
    v_user_id := auth.uid();

    IF public.is_maintenance_on() AND NOT public.is_active_admin() THEN
      RAISE EXCEPTION 'Service unavailable during maintenance' USING errcode = 'U0001';
    END IF;

    -- Calculate Delivery Fee
    IF p_delivery_zone_id IS NOT NULL THEN
       SELECT data INTO v_zone_data FROM public.delivery_zones WHERE id = p_delivery_zone_id;
       v_delivery_fee := COALESCE((v_zone_data->>'deliveryFee')::numeric, 0);
    END IF;

    -- Process Items
    FOR v_item_input IN SELECT * FROM jsonb_array_elements(p_items)
    LOOP
        -- Fetch item details
        SELECT * INTO v_menu_item FROM public.menu_items WHERE id = (v_item_input->>'itemId');
        
        IF NOT FOUND THEN
            RAISE EXCEPTION 'Item not found: %', (v_item_input->>'itemId');
        END IF;

        IF v_menu_item.status <> 'active' THEN
             RAISE EXCEPTION 'Item is not active: %', (v_menu_item.data->>'name');
        END IF;

        -- Extract Price from JSONB data (FIXED: was v_menu_item.price)
        v_base_price := COALESCE((v_menu_item.data->>'price')::numeric, 0);
        v_unit_type := v_menu_item.unit_type;
        
        v_quantity := COALESCE((v_item_input->>'quantity')::numeric, 0);
        v_weight := COALESCE((v_item_input->>'weight')::numeric, 0);

        -- Handle Weight-based pricing
        IF v_unit_type IN ('kg', 'gram') THEN
             IF v_unit_type = 'gram' AND (v_menu_item.data->>'pricePerUnit') IS NOT NULL THEN
                 v_base_price := (v_menu_item.data->>'pricePerUnit')::numeric / 1000;
             END IF;

             v_unit_price := v_base_price;
             IF v_weight > 0 THEN
                v_line_total := v_unit_price * v_weight;
             ELSE
                v_line_total := v_unit_price * v_quantity;
             END IF;
        ELSE
             v_unit_price := v_base_price;
             v_line_total := v_unit_price * v_quantity;
        END IF;

        -- Calculate Addons
        v_addons_price := 0;
        IF (v_item_input->'selectedAddons') IS NOT NULL THEN
            FOR v_addon_key, v_addon_qty IN SELECT * FROM jsonb_each_text(v_item_input->'selectedAddons')
            LOOP
                 -- Find addon price in item data
                 SELECT value INTO v_addon_def 
                 FROM jsonb_array_elements(v_menu_item.data->'addons') 
                 WHERE value->>'id' = v_addon_key;

                 IF v_addon_def IS NOT NULL THEN
                     v_addons_price := v_addons_price + (COALESCE((v_addon_def->>'price')::numeric, 0) * v_addon_qty);
                 END IF;
            END LOOP;
        END IF;
        
        v_line_total := v_line_total + v_addons_price;
        v_subtotal := v_subtotal + v_line_total;

        -- Construct Final Item JSON
        v_cart_item := v_item_input || jsonb_build_object(
            'unitPrice', v_unit_price,
            'total', v_line_total,
            'name', v_menu_item.data->'name'
        );
        v_final_items := v_final_items || v_cart_item;
    END LOOP;

    IF v_user_id IS NOT NULL THEN
      PERFORM 1 FROM public.customers c WHERE c.auth_user_id = v_user_id;
      IF NOT FOUND THEN
        INSERT INTO public.customers(auth_user_id, full_name, phone_number, data)
        VALUES (v_user_id, NULLIF(p_customer_name, ''), NULLIF(p_phone_number, ''), jsonb_build_object('address', NULLIF(p_address, '')))
        ON CONFLICT (auth_user_id) DO NOTHING;
      END IF;
    END IF;

    IF p_coupon_code IS NOT NULL AND length(p_coupon_code) > 0 THEN
      SELECT * INTO v_coupon_record
      FROM public.coupons
      WHERE lower(code) = lower(p_coupon_code) AND is_active = true
      FOR UPDATE;
      IF FOUND THEN
        IF (v_coupon_record.data->>'expiresAt') IS NOT NULL AND (v_coupon_record.data->>'expiresAt')::timestamptz < now() THEN
          RAISE EXCEPTION 'Coupon expired';
        END IF;
        IF (v_coupon_record.data->>'minOrderAmount') IS NOT NULL AND v_subtotal < (v_coupon_record.data->>'minOrderAmount')::numeric THEN
          RAISE EXCEPTION 'Order amount too low for coupon';
        END IF;
        IF (v_coupon_record.data->>'usageLimit') IS NOT NULL AND COALESCE((v_coupon_record.data->>'usageCount')::int, 0) >= (v_coupon_record.data->>'usageLimit')::int THEN
          RAISE EXCEPTION 'Coupon usage limit reached';
        END IF;
        IF (v_coupon_record.data->>'type') = 'percentage' THEN
          v_discount_amount := v_subtotal * ((v_coupon_record.data->>'value')::numeric / 100);
          IF (v_coupon_record.data->>'maxDiscount') IS NOT NULL THEN
            v_discount_amount := LEAST(v_discount_amount, (v_coupon_record.data->>'maxDiscount')::numeric);
          END IF;
        ELSE
          v_discount_amount := (v_coupon_record.data->>'value')::numeric;
        END IF;
        v_discount_amount := LEAST(v_discount_amount, v_subtotal);
        UPDATE public.coupons 
        SET data = jsonb_set(
          data,
          '{usageCount}',
          to_jsonb(COALESCE((data->>'usageCount')::int, 0) + 1)
        )
        WHERE id = v_coupon_record.id
          AND (
            (v_coupon_record.data->>'usageLimit') IS NULL
            OR COALESCE((v_coupon_record.data->>'usageCount')::int, 0) < (v_coupon_record.data->>'usageLimit')::int
          );
        IF NOT FOUND THEN
          RAISE EXCEPTION 'Coupon usage limit reached';
        END IF;
      ELSE
        v_discount_amount := 0;
      END IF;
    END IF;

    -- Points Redemption
    v_discount_amount := v_discount_amount + COALESCE(p_points_redeemed_value, 0);

    -- Calculate Totals
    v_total := v_subtotal - v_discount_amount + v_delivery_fee;

    -- Generate Delivery Pin
    v_delivery_pin := floor(random() * (9999 - 1000 + 1) + 1000)::text;

    -- Insert Order (Now uses actual columns)
    INSERT INTO public.orders (
        customer_auth_user_id, -- Changed from user_id to customer_auth_user_id
        items,
        subtotal,
        delivery_fee,
        tax,
        discount,
        total,
        payment_method,
        notes,
        address,
        location,
        delivery_zone_id,
        customer_name,
        phone_number,
        is_scheduled,
        scheduled_at,
        delivery_pin,
        status,
        points_redeemed_value,
        points_earned,
        data -- Populate JSONB data for backward compatibility
    ) VALUES (
        v_user_id,
        v_final_items,
        v_subtotal,
        v_delivery_fee,
        0,
        v_discount_amount,
        v_total,
        p_payment_method,
        p_notes,
        p_address,
        p_location,
        p_delivery_zone_id,
        p_customer_name,
        p_phone_number,
        p_is_scheduled,
        p_scheduled_at,
        v_delivery_pin,
        'pending',
        p_points_redeemed_value,
        floor(v_total)::numeric,
        jsonb_build_object( -- Data JSON construction moved here
            'id', gen_random_uuid(), -- Temp ID placeholder, will be updated
            'userId', v_user_id,
            'orderSource', 'online',
            'items', v_final_items,
            'subtotal', v_subtotal,
            'deliveryFee', v_delivery_fee,
            'discountAmount', v_discount_amount,
            'total', v_total,
            'pointsEarned', floor(v_total),
            'pointsRedeemedValue', p_points_redeemed_value,
            'deliveryZoneId', p_delivery_zone_id,
            'paymentMethod', p_payment_method,
            'notes', p_notes,
            'address', p_address,
            'location', p_location,
            'customerName', p_customer_name,
            'phoneNumber', p_phone_number,
            'isScheduled', p_is_scheduled,
            'scheduledAt', p_scheduled_at,
            'deliveryPin', v_delivery_pin,
            'appliedCouponCode', p_coupon_code
        )
    ) RETURNING id INTO v_order_id;

    -- Update the ID in the data JSON (circular dependency fix)
    UPDATE public.orders 
    SET data = jsonb_set(data, '{id}', to_jsonb(v_order_id::text))
    WHERE id = v_order_id;

    -- Reserve Stock for ordered items (atomic reservation, deduction occurs on delivery)
    PERFORM public.reserve_stock_for_order(
      (
        SELECT jsonb_agg(
          jsonb_build_object(
            'itemId', it->>'itemId',
            'quantity', COALESCE(NULLIF(it->>'quantity','')::numeric, 0)
          )
        )
        FROM jsonb_array_elements(p_items) AS it
      ),
      v_order_id
    );

    RETURN jsonb_build_object('id', v_order_id, 'total', v_total);
END;
$$;
-- 3. Create Trigger for Automatic Encryption
CREATE OR REPLACE FUNCTION public.trigger_encrypt_customer_data()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = extensions, public
AS $$
BEGIN
  -- Encrypt Phone if changed
  IF NEW.phone_number IS NOT NULL AND (OLD.phone_number IS NULL OR NEW.phone_number <> OLD.phone_number) THEN
    NEW.phone_encrypted := public.encrypt_text(NEW.phone_number);
  END IF;

  -- Encrypt Address if changed (assuming address is in data->>'address')
  IF (NEW.data->>'address') IS NOT NULL AND (OLD.data IS NULL OR (NEW.data->>'address') <> (OLD.data->>'address')) THEN
    NEW.address_encrypted := public.encrypt_text(NEW.data->>'address');
  END IF;

  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_encrypt_customer_data ON public.customers;
CREATE TRIGGER trg_encrypt_customer_data
BEFORE INSERT OR UPDATE ON public.customers
FOR EACH ROW
EXECUTE FUNCTION public.trigger_encrypt_customer_data();
CREATE OR REPLACE FUNCTION public.block_writes_during_maintenance()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF public.is_maintenance_on() AND NOT public.is_active_admin() THEN
    RAISE EXCEPTION 'Service unavailable during maintenance' USING errcode = 'U0001';
  END IF;
  IF TG_OP = 'INSERT' OR TG_OP = 'UPDATE' THEN
    RETURN NEW;
  ELSE
    RETURN OLD;
  END IF;
END;
$$;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'trg_orders_block_writes_during_maintenance'
  ) THEN
    CREATE TRIGGER trg_orders_block_writes_during_maintenance
    BEFORE INSERT OR UPDATE ON public.orders
    FOR EACH ROW EXECUTE FUNCTION public.block_writes_during_maintenance();
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables 
    WHERE table_schema = 'public' AND table_name = 'payments'
  ) AND NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'trg_payments_block_writes_during_maintenance'
  ) THEN
    CREATE TRIGGER trg_payments_block_writes_during_maintenance
    BEFORE INSERT OR UPDATE ON public.payments
    FOR EACH ROW EXECUTE FUNCTION public.block_writes_during_maintenance();
  END IF;
END $$;
-- Permissions hardening: prevent customers from calling deduct functions directly
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc WHERE proname = 'deduct_stock_on_delivery_v2'
  ) THEN
    REVOKE EXECUTE ON FUNCTION public.deduct_stock_on_delivery_v2(uuid, jsonb) FROM anon, authenticated;
    GRANT EXECUTE ON FUNCTION public.deduct_stock_on_delivery_v2(uuid, jsonb) TO service_role;
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_proc WHERE proname = 'deduct_stock_on_delivery'
  ) THEN
    REVOKE EXECUTE ON FUNCTION public.deduct_stock_on_delivery(jsonb) FROM anon, authenticated;
    GRANT EXECUTE ON FUNCTION public.deduct_stock_on_delivery(jsonb) TO service_role;
  END IF;
END $$;
-- Cancellation flow: cancel order and release reserved stock
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
  v_order record;
  v_actor uuid;
  v_items jsonb;
  v_payload jsonb;
  v_payment_id uuid;
BEGIN
  v_actor := auth.uid();
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'order not found';
  END IF;

  IF v_order.status IN ('delivered','cancelled') THEN
    RAISE EXCEPTION 'cannot cancel order in status %', v_order.status;
  END IF;

  IF NOT EXISTS (
      SELECT 1 FROM public.admin_users au
      WHERE au.auth_user_id = v_actor
        AND au.is_active = true
        AND au.role IN ('owner','manager','employee')
    )
    AND v_order.customer_auth_user_id <> v_actor
  THEN
    RAISE EXCEPTION 'not authorized';
  END IF;

  v_items := COALESCE(v_order.items, v_order.data->'items');
  IF v_items IS NULL OR jsonb_typeof(v_items) <> 'array' THEN
    v_items := '[]'::jsonb;
  END IF;

  PERFORM public.release_reserved_stock_for_order(
    (
      SELECT jsonb_agg(
        jsonb_build_object(
          'itemId', COALESCE(it->>'itemId', it->>'id'),
          'quantity', COALESCE(NULLIF(it->>'quantity','')::numeric, 0)
        )
      )
      FROM jsonb_array_elements(v_items) AS it
    ),
    p_order_id
  );

  -- Reverse any posted payment journals linked to this order (prepaid before delivery)
  FOR v_payment_id IN
    SELECT p.id
    FROM public.payments p
    WHERE p.reference_table = 'orders'
      AND p.reference_id = p_order_id::text
      AND p.direction = 'in'
  LOOP
    PERFORM public.reverse_payment_journal(v_payment_id, COALESCE(p_reason, 'ORDER_CANCELLED'));
  END LOOP;

  UPDATE public.orders
  SET status = 'cancelled',
      data = jsonb_set(
        COALESCE(data, '{}'::jsonb),
        '{cancellationReason}',
        to_jsonb(COALESCE(p_reason, '')),
        true
      ),
      updated_at = now()
  WHERE id = p_order_id;

  v_payload := jsonb_build_object('reason', p_reason);
  INSERT INTO public.order_events(order_id, action, actor_type, actor_id, to_status, payload)
  VALUES (
    p_order_id,
    'order.cancelled',
    CASE WHEN v_order.customer_auth_user_id = v_actor THEN 'customer' ELSE 'admin' END,
    v_actor,
    'cancelled',
    v_payload
  );
END;
$$;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables 
    WHERE table_schema = 'public' AND table_name = 'inventory_movements'
  ) AND NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'trg_inventory_movements_block_writes_during_maintenance'
  ) THEN
    CREATE TRIGGER trg_inventory_movements_block_writes_during_maintenance
    BEFORE INSERT OR UPDATE ON public.inventory_movements
    FOR EACH ROW EXECUTE FUNCTION public.block_writes_during_maintenance();
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables 
    WHERE table_schema = 'public' AND table_name = 'reviews'
  ) AND NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'trg_reviews_block_writes_during_maintenance'
  ) THEN
    CREATE TRIGGER trg_reviews_block_writes_during_maintenance
    BEFORE INSERT OR UPDATE ON public.reviews
    FOR EACH ROW EXECUTE FUNCTION public.block_writes_during_maintenance();
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables 
    WHERE table_schema = 'public' AND table_name = 'customers'
  ) AND NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'trg_customers_block_writes_during_maintenance'
  ) THEN
    CREATE TRIGGER trg_customers_block_writes_during_maintenance
    BEFORE INSERT OR UPDATE ON public.customers
    FOR EACH ROW EXECUTE FUNCTION public.block_writes_during_maintenance();
  END IF;
END $$;
CREATE OR REPLACE FUNCTION public.get_catalog_with_stock(
  p_category text DEFAULT NULL,
  p_search text DEFAULT NULL
)
RETURNS TABLE(
  item_id text,
  name jsonb,
  unit_type text,
  status text,
  price numeric,
  is_out_of_stock boolean,
  is_low_stock boolean,
  data jsonb
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    mi.id AS item_id,
    mi.data->'name' AS name,
    mi.unit_type,
    mi.status,
    COALESCE((mi.data->>'price')::numeric, 0) AS price,
    (COALESCE(sm.available_quantity, 0) <= 0) AS is_out_of_stock,
    (COALESCE(sm.available_quantity, 0) <= COALESCE(sm.low_stock_threshold, 5)) AS is_low_stock,
    mi.data AS data
  FROM public.menu_items mi
  LEFT JOIN public.stock_management sm ON sm.item_id::text = mi.id
  WHERE (p_category IS NULL OR mi.category = p_category)
    AND (
      p_search IS NULL OR
      lower(mi.data->'name'->>'ar') LIKE '%' || lower(p_search) || '%' OR
      lower(mi.data->'name'->>'en') LIKE '%' || lower(p_search) || '%'
    )
    AND mi.status = 'active';
$$;
GRANT EXECUTE ON FUNCTION public.get_catalog_with_stock(text, text) TO anon, authenticated;
