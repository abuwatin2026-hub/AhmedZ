create or replace function public._extract_stock_items_from_order_data(p_order_data jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_items jsonb := '[]'::jsonb;
  v_it jsonb;
  v_line jsonb;
  v_pi jsonb;
  v_item_id text;
  v_unit text;
  v_qty numeric;
begin
  if p_order_data is null then
    return '[]'::jsonb;
  end if;

  if jsonb_typeof(p_order_data->'items') = 'array' then
    for v_it in select value from jsonb_array_elements(p_order_data->'items')
    loop
      v_item_id := nullif(btrim(coalesce(v_it->>'itemId', v_it->>'id', v_it->>'menuItemId')), '');
      v_unit := lower(coalesce(nullif(v_it->>'unitType',''), nullif(v_it->>'unit',''), 'piece'));
      if v_unit in ('kg','gram') then
        v_qty := coalesce(
          nullif((v_it->>'weight')::numeric, null),
          nullif((v_it->>'quantity')::numeric, null),
          nullif((v_it->>'qty')::numeric, null),
          0
        );
      else
        v_qty := coalesce(
          nullif((v_it->>'quantity')::numeric, null),
          nullif((v_it->>'qty')::numeric, null),
          0
        );
      end if;
      if v_item_id is null or v_qty <= 0 then
        continue;
      end if;
      v_items := v_items || jsonb_build_object('itemId', v_item_id, 'quantity', v_qty);
    end loop;
  end if;

  if jsonb_typeof(p_order_data->'promotionLines') = 'array' then
    for v_line in select value from jsonb_array_elements(p_order_data->'promotionLines')
    loop
      for v_pi in select value from jsonb_array_elements(coalesce(v_line->'items', '[]'::jsonb))
      loop
        v_item_id := nullif(btrim(coalesce(v_pi->>'itemId', v_pi->>'id')), '');
        v_qty := coalesce(nullif((v_pi->>'quantity')::numeric, null), 0);
        if v_item_id is null or v_qty <= 0 then
          continue;
        end if;
        v_items := v_items || jsonb_build_object('itemId', v_item_id, 'quantity', v_qty);
      end loop;
    end loop;
  end if;

  return public._merge_stock_items(v_items);
end;
$$;

revoke all on function public._extract_stock_items_from_order_data(jsonb) from public;
grant execute on function public._extract_stock_items_from_order_data(jsonb) to authenticated;

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
      select public.check_customer_credit_limit(v_customer_id, v_amount)
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
      where id = p_order_id;
      return;
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
    else
      null;
    end if;
    update public.orders
    set status = 'delivered',
        data = v_final_data,
        updated_at = now()
    where id = p_order_id;
end;
$$;

revoke all on function public.confirm_order_delivery(uuid, jsonb, jsonb, uuid) from public;
revoke execute on function public.confirm_order_delivery(uuid, jsonb, jsonb, uuid) from anon;
grant execute on function public.confirm_order_delivery(uuid, jsonb, jsonb, uuid) to authenticated;

create or replace function public.get_order_customer_type(p_order_id uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select c.customer_type
  from public.orders o
  join public.customers c
    on c.auth_user_id::text = coalesce(o.customer_auth_user_id::text, nullif(o.data->>'customerId',''))
  where o.id = p_order_id
$$;

revoke all on function public.get_order_customer_type(uuid) from public;
revoke execute on function public.get_order_customer_type(uuid) from anon;
grant execute on function public.get_order_customer_type(uuid) to authenticated;

select pg_sleep(1);
notify pgrst, 'reload schema';
