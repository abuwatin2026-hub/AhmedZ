-- Pricing single source of truth: expose final unit price from server and use it in secure order creation

create or replace function public.get_item_price_with_discount(
  p_item_id text,
  p_customer_id uuid default null,
  p_quantity numeric default 1
)
returns numeric
language plpgsql
security definer
set search_path = public
as $$
declare
  v_customer_type text := 'retail';
  v_special_price numeric;
  v_tier_price numeric;
  v_tier_discount numeric;
  v_base_unit_price numeric;
  v_unit_type text;
  v_price_per_unit numeric;
  v_final_unit_price numeric;
begin
  if p_item_id is null or btrim(p_item_id) = '' then
    raise exception 'p_item_id is required';
  end if;
  if p_quantity is null or p_quantity <= 0 then
    p_quantity := 1;
  end if;

  select
    coalesce(mi.unit_type, 'piece'),
    coalesce(mi.price_per_unit, nullif((mi.data->>'pricePerUnit')::numeric, null)),
    coalesce(nullif((mi.data->>'price')::numeric, null), mi.price, 0)
  into v_unit_type, v_price_per_unit, v_base_unit_price
  from public.menu_items mi
  where mi.id = p_item_id;

  if not found then
    raise exception 'Item not found: %', p_item_id;
  end if;

  if v_unit_type = 'gram' and coalesce(v_price_per_unit, 0) > 0 then
    v_base_unit_price := v_price_per_unit / 1000;
  end if;

  if p_customer_id is not null then
    select coalesce(c.customer_type, 'retail')
    into v_customer_type
    from public.customers c
    where c.auth_user_id = p_customer_id;

    if not found then
      v_customer_type := 'retail';
    end if;

    select csp.special_price
    into v_special_price
    from public.customer_special_prices csp
    where csp.customer_id = p_customer_id
      and csp.item_id = p_item_id
      and csp.is_active = true
      and (csp.valid_from is null or csp.valid_from <= now())
      and (csp.valid_to is null or csp.valid_to >= now())
    order by csp.created_at desc
    limit 1;

    if v_special_price is not null then
      return v_special_price;
    end if;
  end if;

  select pt.price, pt.discount_percentage
  into v_tier_price, v_tier_discount
  from public.price_tiers pt
  where pt.item_id = p_item_id
    and pt.customer_type = v_customer_type
    and pt.is_active = true
    and pt.min_quantity <= p_quantity
    and (pt.max_quantity is null or pt.max_quantity >= p_quantity)
    and (pt.valid_from is null or pt.valid_from <= now())
    and (pt.valid_to is null or pt.valid_to >= now())
  order by pt.min_quantity desc
  limit 1;

  if v_tier_price is not null and v_tier_price > 0 then
    v_final_unit_price := v_tier_price;
  else
    v_final_unit_price := v_base_unit_price;
    if coalesce(v_tier_discount, 0) > 0 then
      v_final_unit_price := v_base_unit_price * (1 - (least(100, greatest(0, v_tier_discount)) / 100));
    end if;
  end if;

  return coalesce(v_final_unit_price, 0);
end;
$$;
revoke all on function public.get_item_price_with_discount(text, uuid, numeric) from public;
grant execute on function public.get_item_price_with_discount(text, uuid, numeric) to anon, authenticated;

create or replace function public.create_order_secure(
    p_items jsonb,
    p_delivery_zone_id uuid,
    p_payment_method text,
    p_notes text,
    p_address text,
    p_location jsonb,
    p_customer_name text,
    p_phone_number text,
    p_is_scheduled boolean,
    p_scheduled_at timestamptz,
    p_coupon_code text DEFAULT NULL,
    p_points_redeemed_value numeric DEFAULT 0
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
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
    v_coupon_updated int;
    v_stock_items jsonb := '[]'::jsonb;
    v_item_name_ar text;
    v_item_name_en text;
    v_priced_unit numeric;
    v_pricing_qty numeric;
    v_warehouse_id uuid;
begin
    v_user_id := auth.uid();
    if v_user_id is null then
        raise exception 'User not authenticated';
    end if;

    select w.id
    into v_warehouse_id
    from public.warehouses w
    where w.is_active = true
    order by (upper(coalesce(w.code, '')) = 'MAIN') desc, w.code asc
    limit 1;

    if v_warehouse_id is null then
      raise exception 'No active warehouse found';
    end if;

    select data into v_settings from public.app_settings where id = 'singleton';
    if v_settings is null then
        v_settings := '{}'::jsonb;
    end if;

    for v_item_input in select * from jsonb_array_elements(p_items)
    loop
        select * into v_menu_item from public.menu_items where id = (v_item_input->>'itemId');
        if not found then
            raise exception 'Item not found: %', v_item_input->>'itemId';
        end if;
        
        v_menu_item_data := v_menu_item.data;
        v_item_name_ar := v_menu_item_data->'name'->>'ar';
        v_item_name_en := v_menu_item_data->'name'->>'en';

        v_quantity := coalesce((v_item_input->>'quantity')::numeric, 0);
        v_weight := coalesce((v_item_input->>'weight')::numeric, 0);
        v_unit_type := coalesce(v_menu_item.unit_type, 'piece');

        if v_unit_type in ('kg', 'gram') then
            if v_quantity <= 0 then v_quantity := 1; end if;
            v_pricing_qty := case when v_weight > 0 then v_weight else v_quantity end;
            v_priced_unit := public.get_item_price_with_discount(v_menu_item.id::text, v_user_id, v_pricing_qty);
            v_base_price := v_priced_unit * v_weight;
        else
            if v_quantity <= 0 then raise exception 'Quantity must be positive for item %', v_menu_item.id; end if;
            v_pricing_qty := v_quantity;
            v_priced_unit := public.get_item_price_with_discount(v_menu_item.id::text, v_user_id, v_pricing_qty);
            v_base_price := v_priced_unit;
        end if;

        v_grade_id := v_item_input->>'gradeId';
        v_grade_def := null;
        if v_grade_id is not null and (v_menu_item_data->'availableGrades') is not null then
            select value into v_grade_def
            from jsonb_array_elements(v_menu_item_data->'availableGrades')
            where value->>'id' = v_grade_id;
            
            if v_grade_def is not null then
                v_priced_unit := v_priced_unit * coalesce((v_grade_def->>'priceMultiplier')::numeric, 1.0);
                v_base_price := v_base_price * coalesce((v_grade_def->>'priceMultiplier')::numeric, 1.0);
            end if;
        end if;

        v_addons_price := 0;
        v_available_addons := coalesce(v_menu_item_data->'addons', '[]'::jsonb);
        v_selected_addons_map := coalesce(v_item_input->'selectedAddons', '{}'::jsonb);
        v_final_selected_addons := '{}'::jsonb;
        
        for v_addon_key in select jsonb_object_keys(v_selected_addons_map)
        loop
            v_addon_qty := (v_selected_addons_map->>v_addon_key)::numeric;
            if v_addon_qty > 0 then
                select value into v_addon_def
                from jsonb_array_elements(v_available_addons)
                where value->>'id' = v_addon_key;
                
                if v_addon_def is not null then
                    v_addons_price := v_addons_price + ((v_addon_def->>'price')::numeric * v_addon_qty);
                    v_final_selected_addons := jsonb_set(
                        v_final_selected_addons,
                        array[v_addon_key],
                        jsonb_build_object('addon', v_addon_def, 'quantity', v_addon_qty)
                    );
                end if;
            end if;
        end loop;

        if v_unit_type in ('kg', 'gram') then
            v_unit_price := v_base_price + v_addons_price;
            v_line_total := (v_base_price + v_addons_price) * v_quantity;
        else
            v_unit_price := v_priced_unit + v_addons_price;
            v_line_total := (v_priced_unit + v_addons_price) * v_quantity;
        end if;
        
        v_subtotal := v_subtotal + v_line_total;

        v_cart_item := v_menu_item_data || jsonb_build_object(
            'quantity', v_quantity,
            'weight', v_weight,
            'selectedAddons', v_final_selected_addons,
            'selectedGrade', v_grade_def,
            'cartItemId', gen_random_uuid()::text,
            'price', v_priced_unit
        );
        if v_unit_type = 'gram' then
          v_cart_item := v_cart_item || jsonb_build_object('pricePerUnit', (v_priced_unit * 1000));
        end if;
        
        v_final_items := v_final_items || v_cart_item;
        
        v_stock_items := v_stock_items || jsonb_build_object(
            'itemId', v_menu_item.id,
            'quantity', v_quantity
        );
    end loop;

    if p_delivery_zone_id is not null then
        select data into v_zone_data from public.delivery_zones where id = p_delivery_zone_id;
        if v_zone_data is not null and (v_zone_data->>'isActive')::boolean then
            v_delivery_fee := coalesce((v_zone_data->>'deliveryFee')::numeric, 0);
        else
            v_delivery_fee := coalesce((v_settings->'deliverySettings'->>'baseFee')::numeric, 0);
        end if;
    else
        v_delivery_fee := coalesce((v_settings->'deliverySettings'->>'baseFee')::numeric, 0);
    end if;

    if (v_settings->'deliverySettings'->>'freeDeliveryThreshold') is not null and
       v_subtotal >= (v_settings->'deliverySettings'->>'freeDeliveryThreshold')::numeric then
        v_delivery_fee := 0;
    end if;

    if p_coupon_code is not null and length(p_coupon_code) > 0 then
        select * into v_coupon_record from public.coupons where lower(code) = lower(p_coupon_code) and is_active = true;
        if found then
            if (v_coupon_record.data->>'expiresAt') is not null and (v_coupon_record.data->>'expiresAt')::timestamptz < now() then
                raise exception 'Coupon expired';
            end if;
            if (v_coupon_record.data->>'minOrderAmount') is not null and v_subtotal < (v_coupon_record.data->>'minOrderAmount')::numeric then
                raise exception 'Order amount too low for coupon';
            end if;
            
            if (v_coupon_record.data->>'type') = 'percentage' then
                v_discount_amount := v_subtotal * ((v_coupon_record.data->>'value')::numeric / 100);
                if (v_coupon_record.data->>'maxDiscount') is not null then
                    v_discount_amount := least(v_discount_amount, (v_coupon_record.data->>'maxDiscount')::numeric);
                end if;
            else
                v_discount_amount := (v_coupon_record.data->>'value')::numeric;
            end if;
            
            v_discount_amount := least(v_discount_amount, v_subtotal);
            
            v_coupon_updated := null;
            update public.coupons
            set data = jsonb_set(
              data,
              '{usageCount}',
              to_jsonb(coalesce(nullif(data->>'usageCount','')::int, 0) + 1),
              true
            )
            where id = v_coupon_record.id
              and (
                case
                  when nullif(data->>'usageLimit','') is null then true
                  when (data->>'usageLimit') ~ '^[0-9]+$' then coalesce(nullif(data->>'usageCount','')::int, 0) < (data->>'usageLimit')::int
                  else true
                end
              )
            returning 1 into v_coupon_updated;

            if v_coupon_updated is null then
              raise exception 'Coupon usage limit reached';
            end if;
        else
            v_discount_amount := 0;
        end if;
    end if;

    if p_points_redeemed_value > 0 then
        v_points_settings := v_settings->'loyaltySettings';
        if (v_points_settings->>'enabled')::boolean then
            v_currency_val_per_point := coalesce((v_points_settings->>'currencyValuePerPoint')::numeric, 0);
            if v_currency_val_per_point > 0 then
                declare
                    v_user_points int;
                    v_points_needed numeric;
                begin
                    select loyalty_points into v_user_points from public.customers where auth_user_id = v_user_id;
                    v_points_needed := p_points_redeemed_value / v_currency_val_per_point;
                    
                    if coalesce(v_user_points, 0) < v_points_needed then
                        raise exception 'Insufficient loyalty points';
                    end if;
                    
                    update public.customers
                    set loyalty_points = loyalty_points - v_points_needed::int
                    where auth_user_id = v_user_id;
                    
                    v_discount_amount := v_discount_amount + p_points_redeemed_value;
                end;
            end if;
        end if;
    end if;

    if (v_settings->'taxSettings'->>'enabled')::boolean then
        v_tax_rate := coalesce((v_settings->'taxSettings'->>'rate')::numeric, 0);
        v_tax_amount := greatest(0, v_subtotal - v_discount_amount) * (v_tax_rate / 100);
    end if;

    v_total := greatest(0, v_subtotal - v_discount_amount) + v_delivery_fee + v_tax_amount;

    v_points_settings := v_settings->'loyaltySettings';
    if (v_points_settings->>'enabled')::boolean then
        v_points_per_currency := coalesce((v_points_settings->>'pointsPerCurrencyUnit')::numeric, 0);
        v_points_earned := floor(v_subtotal * v_points_per_currency);
    end if;

    v_delivery_pin := floor(random() * 9000 + 1000)::text;

    insert into public.orders (
        customer_auth_user_id,
        status,
        invoice_number,
        data
    )
    values (
        v_user_id,
        case when p_is_scheduled then 'scheduled' else 'pending' end,
        null,
        jsonb_build_object(
            'id', gen_random_uuid(),
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
            'address', p_address,
            'location', p_location,
            'customerName', p_customer_name,
            'phoneNumber', p_phone_number,
            'isScheduled', p_is_scheduled,
            'scheduledAt', p_scheduled_at,
            'deliveryPin', v_delivery_pin,
            'appliedCouponCode', p_coupon_code,
            'warehouseId', v_warehouse_id
        )
    )
    returning id into v_order_id;

    update public.orders
    set data = jsonb_set(data, '{id}', to_jsonb(v_order_id::text))
    where id = v_order_id
    returning data into v_item_input;

    perform public.reserve_stock_for_order(v_stock_items, v_order_id, v_warehouse_id);

    insert into public.order_events (order_id, action, actor_type, actor_id, to_status, payload)
    values (
        v_order_id,
        'order.created',
        'customer',
        v_user_id,
        case when p_is_scheduled then 'scheduled' else 'pending' end,
        jsonb_build_object(
            'total', v_total,
            'method', p_payment_method
        )
    );

    return v_item_input;
end;
$$;
grant execute on function public.create_order_secure(jsonb, uuid, text, text, text, jsonb, text, text, boolean, timestamptz, text, numeric) to authenticated;

