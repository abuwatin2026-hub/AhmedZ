drop function if exists public.confirm_order_delivery_with_credit(jsonb);
drop function if exists public.confirm_order_delivery(jsonb);
drop function if exists public.confirm_order_delivery_with_credit(uuid, jsonb, jsonb, uuid);
drop function if exists public.confirm_order_delivery(uuid, jsonb, jsonb, uuid);

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
  v_amount numeric;
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
  v_order_source := '';
  if auth.role() <> 'service_role' then
    if not public.is_staff() then
      raise exception 'not allowed';
    end if;
  end if;

  select *
  into v_order
  from public.orders o
  where o.id = p_order_id
  for update;

  if not found then
    raise exception 'order not found';
  end if;

  if lower(coalesce(v_order.status, '')) = 'delivered' then
    return jsonb_build_object(
      'orderId', p_order_id::text,
      'status', 'delivered',
      'data', coalesce(v_order.data, '{}'::jsonb),
      'updatedAt', coalesce(v_order.updated_at, now())
    );
  end if;

  v_order_data := coalesce(v_order.data, '{}'::jsonb);
  v_order_source := coalesce(nullif(v_order_data->>'orderSource',''), nullif(p_updated_data->>'orderSource',''), '');
  if auth.role() <> 'service_role' then
    if v_order_source = 'in_store' then
      if not public.has_admin_permission('orders.markPaid') then
        raise exception 'not allowed';
      end if;
    else
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
  v_amount := coalesce(nullif((v_order_data->>'total')::numeric, null), nullif((p_updated_data->>'total')::numeric, null), 0);
  if v_customer_id is not null then
    select c.customer_type
    into v_customer_type
    from public.customers c
    where c.auth_user_id = v_customer_id;
  end if;
  if v_customer_type = 'wholesale' then
    v_delivered_at := now();
    select coalesce(sum(p.amount), 0)
    into v_deposits_paid
    from public.payments p
    where p.reference_table = 'orders'
      and p.reference_id = p_order_id::text
      and p.direction = 'in'
      and p.occurred_at < v_delivered_at;
    v_deposits_paid := least(greatest(coalesce(v_amount, 0), 0), greatest(coalesce(v_deposits_paid, 0), 0));
    v_net_ar := greatest(0, coalesce(v_amount, 0) - v_deposits_paid);

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

  if jsonb_array_length(v_items_all) = 0 then
    v_items_all := public._extract_stock_items_from_order_data(v_order_data);
  end if;
  if jsonb_array_length(v_items_all) = 0 then
    raise exception 'no deliverable items';
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
    returning status::text, data, updated_at
    into v_status, v_data, v_updated_at;

    return jsonb_build_object(
      'orderId', p_order_id::text,
      'status', coalesce(v_status, 'delivered'),
      'data', coalesce(v_data, '{}'::jsonb),
      'updatedAt', coalesce(v_updated_at, now())
    );
  end if;

  perform public.deduct_stock_on_delivery_v2(p_order_id, v_items_all, p_warehouse_id);

  v_final_data := coalesce(p_updated_data, v_order_data);
  if jsonb_array_length(v_promos_fixed) > 0 then
    v_final_data := jsonb_set(v_final_data, '{promotionLines}', v_promos_fixed, true);
  end if;

  if v_is_cod then
    v_final_data := v_final_data - 'paidAt';
    v_driver_id := nullif(v_final_data->>'deliveredBy','')::uuid;
    if v_driver_id is null then
      v_driver_id := nullif(v_final_data->>'assignedDeliveryUserId','')::uuid;
    end if;
    if v_driver_id is not null then
      v_delivered_at := coalesce(nullif(v_final_data->>'deliveredAt','')::timestamptz, now());
      perform public.cod_post_delivery(p_order_id, v_driver_id, v_delivered_at);
    end if;
  end if;

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

create or replace function public.confirm_order_delivery_with_credit(
  p_order_id uuid,
  p_items jsonb,
  p_updated_data jsonb,
  p_warehouse_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.role() <> 'service_role' then
    if not public.is_staff() then
      raise exception 'not allowed';
    end if;
  end if;

  return public.confirm_order_delivery(p_order_id, p_items, p_updated_data, p_warehouse_id);
end;
$$;

revoke all on function public.confirm_order_delivery_with_credit(uuid, jsonb, jsonb, uuid) from public;
revoke execute on function public.confirm_order_delivery_with_credit(uuid, jsonb, jsonb, uuid) from anon;
grant execute on function public.confirm_order_delivery_with_credit(uuid, jsonb, jsonb, uuid) to authenticated;

create or replace function public.confirm_order_delivery(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_items jsonb;
  v_updated_data jsonb;
  v_order_id_text text;
  v_warehouse_id_text text;
  v_order_id uuid;
  v_warehouse_id uuid;
begin
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    raise exception 'p_payload must be a json object';
  end if;

  v_items := p_payload->'p_items';
  if v_items is null then
    v_items := p_payload->'items';
  end if;
  if v_items is null then
    v_items := '[]'::jsonb;
  end if;

  v_updated_data := p_payload->'p_updated_data';
  if v_updated_data is null then
    v_updated_data := p_payload->'updated_data';
  end if;
  if v_updated_data is null then
    v_updated_data := '{}'::jsonb;
  end if;

  v_order_id_text := nullif(coalesce(p_payload->>'p_order_id', p_payload->>'order_id', p_payload->>'orderId'), '');
  if v_order_id_text is null or v_order_id_text !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    raise exception 'p_order_id is required';
  end if;
  v_order_id := v_order_id_text::uuid;

  v_warehouse_id_text := nullif(coalesce(p_payload->>'p_warehouse_id', p_payload->>'warehouse_id', p_payload->>'warehouseId'), '');
  if v_warehouse_id_text is null or v_warehouse_id_text !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    raise exception 'p_warehouse_id is required';
  end if;
  v_warehouse_id := v_warehouse_id_text::uuid;

  return public.confirm_order_delivery(v_order_id, v_items, v_updated_data, v_warehouse_id);
end;
$$;

revoke all on function public.confirm_order_delivery(jsonb) from public;
revoke execute on function public.confirm_order_delivery(jsonb) from anon;
grant execute on function public.confirm_order_delivery(jsonb) to authenticated;

create or replace function public.confirm_order_delivery_with_credit(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_items jsonb;
  v_updated_data jsonb;
  v_order_id_text text;
  v_warehouse_id_text text;
  v_order_id uuid;
  v_warehouse_id uuid;
begin
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    raise exception 'p_payload must be a json object';
  end if;

  v_items := p_payload->'p_items';
  if v_items is null then
    v_items := p_payload->'items';
  end if;
  if v_items is null then
    v_items := '[]'::jsonb;
  end if;

  v_updated_data := p_payload->'p_updated_data';
  if v_updated_data is null then
    v_updated_data := p_payload->'updated_data';
  end if;
  if v_updated_data is null then
    v_updated_data := '{}'::jsonb;
  end if;

  v_order_id_text := nullif(coalesce(p_payload->>'p_order_id', p_payload->>'order_id', p_payload->>'orderId'), '');
  if v_order_id_text is null or v_order_id_text !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    raise exception 'p_order_id is required';
  end if;
  v_order_id := v_order_id_text::uuid;

  v_warehouse_id_text := nullif(coalesce(p_payload->>'p_warehouse_id', p_payload->>'warehouse_id', p_payload->>'warehouseId'), '');
  if v_warehouse_id_text is null or v_warehouse_id_text !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    raise exception 'p_warehouse_id is required';
  end if;
  v_warehouse_id := v_warehouse_id_text::uuid;

  return public.confirm_order_delivery_with_credit(v_order_id, v_items, v_updated_data, v_warehouse_id);
end;
$$;

revoke all on function public.confirm_order_delivery_with_credit(jsonb) from public;
revoke execute on function public.confirm_order_delivery_with_credit(jsonb) from anon;
grant execute on function public.confirm_order_delivery_with_credit(jsonb) to authenticated;

select pg_sleep(0.5);
notify pgrst, 'reload schema';
