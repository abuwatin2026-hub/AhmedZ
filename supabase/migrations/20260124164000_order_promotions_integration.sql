create or replace function public._merge_stock_items(p_items jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item jsonb;
  v_map jsonb := '{}'::jsonb;
  v_item_id text;
  v_qty numeric;
  v_result jsonb := '[]'::jsonb;
  v_key text;
begin
  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    return '[]'::jsonb;
  end if;

  for v_item in select value from jsonb_array_elements(p_items)
  loop
    v_item_id := nullif(btrim(coalesce(v_item->>'itemId', v_item->>'id')), '');
    v_qty := coalesce(nullif((v_item->>'quantity')::numeric, null), 0);
    if v_item_id is null or v_qty <= 0 then
      continue;
    end if;
    v_map := jsonb_set(
      v_map,
      array[v_item_id],
      to_jsonb(coalesce(nullif((v_map->>v_item_id)::numeric, null), 0) + v_qty),
      true
    );
  end loop;

  for v_key in select key from jsonb_each(v_map)
  loop
    v_result := v_result || jsonb_build_object('itemId', v_key, 'quantity', (v_map->>v_key)::numeric);
  end loop;

  return v_result;
end;
$$;

revoke all on function public._merge_stock_items(jsonb) from public;
grant execute on function public._merge_stock_items(jsonb) to authenticated;

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
    v_priced_unit numeric;
    v_pricing_qty numeric;
    v_warehouse_id uuid;
    v_stock_qty numeric;
    v_has_promotions boolean := false;
    v_promotion_id uuid;
    v_bundle_qty numeric;
    v_promo_snapshot jsonb;
    v_promotion_lines jsonb := '[]'::jsonb;
    v_promo_line_id uuid;
    v_promo_item jsonb;
begin
    v_user_id := auth.uid();
    if v_user_id is null then
        raise exception 'User not authenticated';
    end if;

    v_warehouse_id := public._resolve_default_warehouse_id();

    select data into v_settings from public.app_settings where id = 'singleton';
    if v_settings is null then
        v_settings := '{}'::jsonb;
    end if;

    if p_items is null or jsonb_typeof(p_items) <> 'array' then
      raise exception 'p_items must be a json array';
    end if;

    for v_item_input in select * from jsonb_array_elements(p_items)
    loop
        v_promotion_id := public._uuid_or_null(v_item_input->>'promotionId');
        if v_promotion_id is not null or coalesce(nullif(v_item_input->>'lineType',''), '') = 'promotion' then
          v_has_promotions := true;
          v_bundle_qty := coalesce(nullif((v_item_input->>'bundleQty')::numeric, null), nullif((v_item_input->>'quantity')::numeric, null), 1);
          if v_bundle_qty <= 0 then v_bundle_qty := 1; end if;

          if p_coupon_code is not null and length(p_coupon_code) > 0 then
            raise exception 'promotion_coupon_conflict';
          end if;
          if coalesce(p_points_redeemed_value, 0) > 0 then
            raise exception 'promotion_points_conflict';
          end if;

          v_promo_snapshot := public._compute_promotion_snapshot(v_promotion_id, v_user_id, v_warehouse_id, v_bundle_qty, null, true);
          v_promo_line_id := gen_random_uuid();

          v_cart_item := jsonb_build_object(
            'lineType', 'promotion',
            'promotionId', v_promotion_id::text,
            'promotionLineId', v_promo_line_id::text,
            'name', v_promo_snapshot->>'name',
            'bundleQty', coalesce(nullif((v_promo_snapshot->>'bundleQty')::numeric, null), v_bundle_qty),
            'originalTotal', coalesce(nullif((v_promo_snapshot->>'computedOriginalTotal')::numeric, null), 0),
            'finalTotal', coalesce(nullif((v_promo_snapshot->>'finalTotal')::numeric, null), 0),
            'promotionExpense', coalesce(nullif((v_promo_snapshot->>'promotionExpense')::numeric, null), 0),
            'cartItemId', coalesce(nullif(v_item_input->>'cartItemId',''), gen_random_uuid()::text)
          );

          v_final_items := v_final_items || v_cart_item;
          v_subtotal := v_subtotal + coalesce(nullif((v_promo_snapshot->>'finalTotal')::numeric, null), 0);

          v_promotion_lines := v_promotion_lines || (v_promo_snapshot || jsonb_build_object(
            'promotionLineId', v_promo_line_id::text
          ));

          for v_promo_item in select value from jsonb_array_elements(coalesce(v_promo_snapshot->'items','[]'::jsonb))
          loop
            v_stock_items := v_stock_items || jsonb_build_object(
              'itemId', v_promo_item->>'itemId',
              'quantity', coalesce(nullif((v_promo_item->>'quantity')::numeric, null), 0)
            );
          end loop;

          continue;
        end if;

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
            if v_weight <= 0 then
              raise exception 'Weight must be positive for item %', v_menu_item.id;
            end if;
            if v_quantity <= 0 then v_quantity := 1; end if;
            v_pricing_qty := v_weight;
            v_priced_unit := public.get_item_price_with_discount(v_menu_item.id::text, v_user_id, v_pricing_qty);
            v_base_price := v_priced_unit * v_weight;
            v_stock_qty := v_weight;
        else
            if v_quantity <= 0 then raise exception 'Quantity must be positive for item %', v_menu_item.id; end if;
            v_pricing_qty := v_quantity;
            v_priced_unit := public.get_item_price_with_discount(v_menu_item.id::text, v_user_id, v_pricing_qty);
            v_base_price := v_priced_unit;
            v_stock_qty := v_quantity;
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
            'quantity', v_stock_qty
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

    if not v_has_promotions and p_coupon_code is not null and length(p_coupon_code) > 0 then
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

    if not v_has_promotions and p_points_redeemed_value > 0 then
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

    v_stock_items := public._merge_stock_items(v_stock_items);

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
            'promotionLines', case when v_has_promotions then v_promotion_lines else '[]'::jsonb end,
            'subtotal', public._money_round(v_subtotal),
            'deliveryFee', public._money_round(v_delivery_fee),
            'discountAmount', public._money_round(v_discount_amount),
            'total', public._money_round(v_total),
            'taxAmount', public._money_round(v_tax_amount),
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

    if v_has_promotions then
      for v_promo_snapshot in select value from jsonb_array_elements(v_promotion_lines)
      loop
        insert into public.promotion_usage(
          promotion_id,
          promotion_line_id,
          order_id,
          bundle_qty,
          channel,
          warehouse_id,
          snapshot,
          created_by
        )
        values (
          (v_promo_snapshot->>'promotionId')::uuid,
          (v_promo_snapshot->>'promotionLineId')::uuid,
          v_order_id,
          coalesce(nullif((v_promo_snapshot->>'bundleQty')::numeric, null), 1),
          'online',
          v_warehouse_id,
          v_promo_snapshot,
          v_user_id
        );
      end loop;
    end if;

    insert into public.order_events (order_id, action, actor_type, actor_id, to_status, payload)
    values (
        v_order_id,
        'order.created',
        'customer',
        v_user_id,
        case when p_is_scheduled then 'scheduled' else 'pending' end,
        jsonb_build_object('total', public._money_round(v_total), 'method', p_payment_method)
    );

    return v_item_input;
end;
$$;

revoke all on function public.create_order_secure(jsonb, uuid, text, text, text, jsonb, text, text, boolean, timestamptz, text, numeric) from public;
grant execute on function public.create_order_secure(jsonb, uuid, text, text, text, jsonb, text, text, boolean, timestamptz, text, numeric) to authenticated;

create or replace function public.confirm_order_delivery(
    p_order_id uuid,
    p_items jsonb,
    p_updated_data jsonb,
    p_warehouse_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
    v_order record;
    v_order_data jsonb;
    v_promos jsonb;
    v_line jsonb;
    v_snapshot jsonb;
    v_items_all jsonb := '[]'::jsonb;
    v_item jsonb;
    v_final_data jsonb;
begin
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

    v_order_data := coalesce(v_order.data, '{}'::jsonb);

    if p_items is null or jsonb_typeof(p_items) <> 'array' then
      p_items := '[]'::jsonb;
    end if;

    v_items_all := p_items;

    v_promos := coalesce(v_order_data->'promotionLines', '[]'::jsonb);
    if jsonb_typeof(v_promos) = 'array' and jsonb_array_length(v_promos) > 0 then
      if nullif(btrim(coalesce(v_order_data->>'appliedCouponCode', '')), '') is not null then
        raise exception 'promotion_coupon_conflict';
      end if;
      if coalesce(nullif((v_order_data->>'pointsRedeemedValue')::numeric, null), 0) > 0 then
        raise exception 'promotion_points_conflict';
      end if;

      for v_line in select value from jsonb_array_elements(v_promos)
      loop
        v_snapshot := public._compute_promotion_snapshot(
          (v_line->>'promotionId')::uuid,
          null,
          p_warehouse_id,
          coalesce(nullif((v_line->>'bundleQty')::numeric, null), 1),
          null,
          true
        );
        v_snapshot := v_snapshot || jsonb_build_object('promotionLineId', v_line->>'promotionLineId');

        for v_item in select value from jsonb_array_elements(coalesce(v_snapshot->'items','[]'::jsonb))
        loop
          v_items_all := v_items_all || jsonb_build_object(
            'itemId', v_item->>'itemId',
            'quantity', coalesce(nullif((v_item->>'quantity')::numeric, null), 0)
          );
        end loop;

        insert into public.promotion_usage(
          promotion_id,
          promotion_line_id,
          order_id,
          bundle_qty,
          channel,
          warehouse_id,
          snapshot,
          created_by
        )
        values (
          (v_snapshot->>'promotionId')::uuid,
          (v_snapshot->>'promotionLineId')::uuid,
          p_order_id,
          coalesce(nullif((v_snapshot->>'bundleQty')::numeric, null), 1),
          'in_store',
          p_warehouse_id,
          v_snapshot,
          auth.uid()
        )
        on conflict (promotion_line_id) do nothing;
      end loop;

      v_items_all := public._merge_stock_items(v_items_all);
    else
      v_items_all := public._merge_stock_items(v_items_all);
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
      where id = p_order_id;
      return;
    end if;

    perform public.deduct_stock_on_delivery_v2(p_order_id, v_items_all, p_warehouse_id);

    v_final_data := coalesce(p_updated_data, v_order_data);
    if jsonb_typeof(v_promos) = 'array' and jsonb_array_length(v_promos) > 0 then
      v_final_data := jsonb_set(v_final_data, '{promotionLines}', v_promos, true);
    end if;

    update public.orders
    set status = 'delivered',
        data = v_final_data,
        updated_at = now()
    where id = p_order_id;
end;
$$;

grant execute on function public.confirm_order_delivery(uuid, jsonb, jsonb, uuid) to authenticated;

