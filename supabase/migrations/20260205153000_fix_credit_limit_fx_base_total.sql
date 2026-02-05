create or replace function public.confirm_order_delivery(
  p_order_id uuid,
  p_items jsonb,
  p_updated_data jsonb,
  p_warehouse_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid;
  v_order record;
  v_order_data jsonb;
  v_promos jsonb;
  v_promos_fixed jsonb := '[]'::jsonb;
  v_line jsonb;
  v_snapshot jsonb;
  v_items_all jsonb := '[]'::jsonb;
  v_item jsonb;
  v_final_data jsonb;
  v_is_cod boolean := false;
  v_driver_id uuid;
  v_delivered_at timestamptz;
  v_order_source text;
  v_customer_id uuid;
  v_amount_foreign numeric;
  v_amount_base numeric;
  v_customer_type text;
  v_ok boolean;
  v_deposits_paid numeric := 0;
  v_net_ar numeric := 0;
  v_status text;
  v_data jsonb;
  v_updated_at timestamptz;
begin
  if p_warehouse_id is null then
    raise exception 'warehouse_id is required';
  end if;
  v_actor := auth.uid();

  select *
  into v_order
  from public.orders o
  where o.id = p_order_id
  for update;

  if not found then
    raise exception 'order not found';
  end if;

  v_order_data := coalesce(v_order.data, '{}'::jsonb);
  v_order_source := coalesce(v_order_data->>'orderSource', '');

  if auth.role() <> 'service_role' then
    if not public.is_staff() then
      raise exception 'not allowed';
    end if;
    if v_order_source = 'online' then
      if not (public.has_admin_permission('orders.updateStatus.all') or public.has_admin_permission('orders.updateStatus.delivery')) then
        raise exception 'not allowed';
      end if;
      if public.has_admin_permission('orders.updateStatus.delivery') and not public.has_admin_permission('orders.updateStatus.all') then
        if (v_order_data->>'assignedDeliveryUserId') is distinct from v_actor::text then
          raise exception 'not allowed';
        end if;
      end if;
    end if;
  end if;

  v_customer_id := coalesce(
    nullif(v_order_data->>'customerId','')::uuid,
    nullif(p_updated_data->>'customerId','')::uuid,
    (select c.auth_user_id from public.customers c where c.auth_user_id = v_order.customer_auth_user_id limit 1)
  );

  v_amount_foreign := coalesce(
    nullif((v_order_data->>'total')::numeric, null),
    nullif((p_updated_data->>'total')::numeric, null),
    coalesce(v_order.total, 0),
    0
  );
  v_amount_base := coalesce(
    v_order.base_total,
    greatest(0, coalesce(v_amount_foreign, 0)) * coalesce(v_order.fx_rate, 1),
    0
  );

  if v_customer_id is not null then
    select c.customer_type
    into v_customer_type
    from public.customers c
    where c.auth_user_id = v_customer_id;
  end if;

  if v_customer_type = 'wholesale' then
    v_delivered_at := now();
    select coalesce(sum(coalesce(p.base_amount, (p.amount * coalesce(p.fx_rate, 1)), p.amount)), 0)
    into v_deposits_paid
    from public.payments p
    where p.reference_table = 'orders'
      and p.reference_id = p_order_id::text
      and p.direction = 'in'
      and p.occurred_at < v_delivered_at;

    v_deposits_paid := least(greatest(coalesce(v_amount_base, 0), 0), greatest(coalesce(v_deposits_paid, 0), 0));
    v_net_ar := greatest(0, coalesce(v_amount_base, 0) - v_deposits_paid);

    select public.check_customer_credit_limit(v_customer_id, v_net_ar)
    into v_ok;
    if not v_ok then
      raise exception 'CREDIT_LIMIT_EXCEEDED';
    end if;
  end if;

  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    p_items := '[]'::jsonb;
  end if;
  v_items_all := p_items;
  v_promos := coalesce(v_order_data->'promotionLines', '[]'::jsonb);
  v_is_cod := public._is_cod_delivery_order(v_order_data, v_order.delivery_zone_id);
  if v_is_cod then
    v_driver_id := nullif(coalesce(p_updated_data->>'deliveredBy', p_updated_data->>'assignedDeliveryUserId', v_order_data->>'deliveredBy', v_order_data->>'assignedDeliveryUserId'),'')::uuid;
    if v_driver_id is null then
      raise exception 'delivery_driver_required';
    end if;
  end if;

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
      v_promos_fixed := v_promos_fixed || v_snapshot;
      for v_item in select value from jsonb_array_elements(coalesce(v_snapshot->'items','[]'::jsonb))
      loop
        v_items_all := v_items_all || jsonb_build_object(
          'itemId', v_item->>'itemId',
          'quantity', coalesce(nullif((v_item->>'quantity')::numeric, null), 0)
        );
      end loop;
    end loop;

    if jsonb_array_length(v_promos_fixed) > 0 then
      v_order_data := jsonb_set(v_order_data, '{promotionLines}', v_promos_fixed, true);
    end if;
  end if;

  v_final_data := v_order_data || coalesce(p_updated_data, '{}'::jsonb);
  v_final_data := jsonb_set(v_final_data, '{status}', to_jsonb('delivered'::text), true);

  if v_is_cod then
    v_final_data := v_final_data - 'paidAt';
    v_delivered_at := coalesce(nullif(v_final_data->>'deliveredAt','')::timestamptz, now());
    perform public.cod_post_delivery(p_order_id, v_driver_id, v_delivered_at);
  end if;

  perform public.deduct_stock_on_delivery_v2(v_items_all, p_order_id, p_warehouse_id);

  update public.orders
  set status = 'delivered',
      data = v_final_data,
      updated_at = now()
  where id = p_order_id
  returning status::text, data, updated_at
  into v_status, v_data, v_updated_at;

  return jsonb_build_object(
    'orderId', p_order_id::text,
    'status', coalesce(v_status, 'delivered'),
    'data', coalesce(v_data, '{}'::jsonb),
    'updatedAt', coalesce(v_updated_at, now())
  );
end;
$$;

revoke all on function public.confirm_order_delivery(uuid, jsonb, jsonb, uuid) from public;
revoke execute on function public.confirm_order_delivery(uuid, jsonb, jsonb, uuid) from anon;
grant execute on function public.confirm_order_delivery(uuid, jsonb, jsonb, uuid) to authenticated;

notify pgrst, 'reload schema';
