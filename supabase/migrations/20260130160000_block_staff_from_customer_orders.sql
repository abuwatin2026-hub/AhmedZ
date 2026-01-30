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
    p_coupon_code text default null,
    p_points_redeemed_value numeric default 0
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
    v_stock_items jsonb := '[]'::jsonb;
    v_item_name_ar text;
    v_item_name_en text;
begin
    v_user_id := auth.uid();
    if v_user_id is null then
        raise exception 'User not authenticated';
    end if;

    if exists (
      select 1
      from public.admin_users au
      where au.auth_user_id = v_user_id
        and au.is_active = true
      limit 1
    ) then
      raise exception 'لا يمكن لحسابات الموظفين إنشاء طلبات كعميل. استخدم شاشة الإدارة/نقطة البيع.';
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
             if v_unit_type = 'gram' and (v_menu_item.price_per_unit is not null or (v_menu_item_data->>'pricePerUnit') is not null) then
                 v_base_price := coalesce(v_menu_item.price_per_unit, (v_menu_item_data->>'pricePerUnit')::numeric) / 1000;
                 v_base_price := v_base_price * v_weight;
             else
                 v_base_price := v_menu_item.price * v_weight;
             end if;
             if v_quantity <= 0 then v_quantity := 1; end if;
        else
             v_base_price := v_menu_item.price;
             if v_quantity <= 0 then raise exception 'Quantity must be positive for item %', v_menu_item.id; end if;
        end if;

        v_grade_id := v_item_input->>'gradeId';
        v_grade_def := null;
        if v_grade_id is not null and (v_menu_item_data->'availableGrades') is not null then
             select value into v_grade_def 
             from jsonb_array_elements(v_menu_item_data->'availableGrades') 
             where value->>'id' = v_grade_id;
             
             if v_grade_def is not null then
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

        v_unit_price := v_base_price + v_addons_price;
        v_line_total := (v_base_price + v_addons_price) * v_quantity; 
        
        v_subtotal := v_subtotal + v_line_total;

        v_cart_item := v_menu_item_data || jsonb_build_object(
            'quantity', v_quantity,
            'weight', v_weight,
            'selectedAddons', v_final_selected_addons,
            'selectedGrade', v_grade_def,
            'cartItemId', gen_random_uuid()::text,
            'price', v_menu_item.price
        );
        
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
             if (v_coupon_record.data->>'usageLimit') is not null and 
                coalesce((v_coupon_record.data->>'usageCount')::int, 0) >= (v_coupon_record.data->>'usageLimit')::int then
                 raise exception 'Coupon usage limit reached';
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
             
             update public.coupons 
             set data = jsonb_set(data, '{usageCount}', (coalesce((data->>'usageCount')::int, 0) + 1)::text::jsonb)
             where id = v_coupon_record.id;
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
            'appliedCouponCode', p_coupon_code
        )
    )
    returning id into v_order_id;

    update public.orders 
    set data = jsonb_set(data, '{id}', to_jsonb(v_order_id::text))
    where id = v_order_id
    returning data into v_item_input;

    perform public.reserve_stock_for_order(v_stock_items, v_order_id);

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

grant execute on function public.create_order_secure(
  jsonb,
  uuid,
  text,
  text,
  text,
  jsonb,
  text,
  text,
  boolean,
  timestamptz,
  text,
  numeric
) to authenticated;
