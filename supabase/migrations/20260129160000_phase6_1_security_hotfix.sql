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
      v_order.customer_auth_user_id,
      nullif(v_order_data->>'customerId','')::uuid,
      nullif(p_updated_data->>'customerId','')::uuid
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

create or replace function public.confirm_order_delivery_with_credit(
  p_order_id uuid,
  p_items jsonb,
  p_updated_data jsonb,
  p_warehouse_id uuid
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_customer_id uuid;
  v_amount numeric;
  v_customer_type text;
  v_ok boolean;
begin
  if auth.role() <> 'service_role' then
    if not public.is_staff() then
      raise exception 'not allowed';
    end if;
  end if;
  select coalesce(o.customer_auth_user_id, nullif(o.data->>'customerId','')::uuid),
         coalesce(nullif((o.data->>'total')::numeric, null), nullif((p_updated_data->>'total')::numeric, null), 0)
  into v_customer_id, v_amount
  from public.orders o
  where o.id = p_order_id;
  if v_customer_id is not null then
    select customer_type
    into v_customer_type
    from public.customers
    where auth_user_id = v_customer_id;
  end if;
  if v_customer_type = 'wholesale' then
    select public.check_customer_credit_limit(v_customer_id, v_amount)
    into v_ok;
    if not v_ok then
      raise exception 'CREDIT_LIMIT_EXCEEDED';
    end if;
  end if;
  perform public.confirm_order_delivery(p_order_id, p_items, p_updated_data, p_warehouse_id);
end;
$$;

revoke all on function public.confirm_order_delivery_with_credit(uuid, jsonb, jsonb, uuid) from public;
revoke execute on function public.confirm_order_delivery_with_credit(uuid, jsonb, jsonb, uuid) from anon;
grant execute on function public.confirm_order_delivery_with_credit(uuid, jsonb, jsonb, uuid) to authenticated;

create or replace function public.cancel_order(
  p_order_id uuid,
  p_reason text default null,
  p_occurred_at timestamptz default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order record;
  v_is_cod boolean := false;
  v_wh uuid;
  v_items jsonb := '[]'::jsonb;
  v_mv record;
  v_has_sale_out boolean := false;
  v_reason text;
begin
  if auth.role() <> 'service_role' then
    if not public.is_staff() then
      raise exception 'not allowed';
    end if;
    if not (public.has_admin_permission('orders.cancel') or public.has_admin_permission('orders.updateStatus.all')) then
      raise exception 'not allowed';
    end if;
  end if;
  if p_order_id is null then
    raise exception 'p_order_id is required';
  end if;
  select *
  into v_order
  from public.orders o
  where o.id = p_order_id
  for update;
  if not found then
    raise exception 'order not found';
  end if;
  v_is_cod := public._is_cod_delivery_order(coalesce(v_order.data,'{}'::jsonb), v_order.delivery_zone_id);
  if coalesce(nullif(v_order.data->'invoiceSnapshot'->>'issuedAt',''), '') is not null then
    raise exception 'cannot_cancel_settled';
  end if;
  if v_is_cod and coalesce(nullif(v_order.data->>'paidAt',''), '') is not null then
    raise exception 'cannot_cancel_settled';
  end if;
  if exists (select 1 from public.cod_settlement_orders cso where cso.order_id = p_order_id) then
    raise exception 'cannot_cancel_settled';
  end if;
  select exists(
    select 1
    from public.inventory_movements im
    where im.reference_table = 'orders'
      and im.reference_id = p_order_id::text
      and im.movement_type = 'sale_out'
  )
  into v_has_sale_out;
  if v_has_sale_out then
    for v_mv in
      select *
      from public.inventory_movements im
      where im.reference_table = 'orders'
        and im.reference_id = p_order_id::text
        and im.movement_type = 'sale_out'
    loop
      insert into public.inventory_movements(
        item_id, movement_type, quantity, unit_cost, total_cost,
        reference_table, reference_id, occurred_at, created_by, data, batch_id, warehouse_id
      )
      values (
        v_mv.item_id,
        'return_in',
        v_mv.quantity,
        coalesce(v_mv.unit_cost, 0),
        coalesce(v_mv.quantity, 0) * coalesce(v_mv.unit_cost, 0),
        'orders',
        p_order_id::text,
        coalesce(p_occurred_at, now()),
        auth.uid(),
        jsonb_build_object('orderId', p_order_id),
        v_mv.batch_id,
        v_mv.warehouse_id
      )
      returning id into v_mv.id;
      perform public.post_inventory_movement(v_mv.id);
    end loop;
  else
    v_wh := coalesce(nullif(v_order.data->>'warehouseId','')::uuid, public._resolve_default_warehouse_id());
    for v_mv in
      select i
      from jsonb_array_elements(coalesce(v_order.data->'items','[]'::jsonb)) as t(i)
    loop
      v_items := v_items || jsonb_build_object(
        'itemId', coalesce(v_mv.i->>'itemId', v_mv.i->>'id'),
        'quantity', coalesce(nullif((v_mv.i->>'quantity')::numeric, null), 0)
      );
    end loop;
    v_items := public._merge_stock_items(v_items);
    if jsonb_array_length(v_items) > 0 then
      perform public.release_reserved_stock_for_order(v_items, p_order_id, v_wh);
    end if;
  end if;
  for v_mv in
    select p.id
    from public.payments p
    where p.reference_table = 'orders'
      and p.reference_id = p_order_id::text
      and p.direction = 'in'
  loop
    begin
      perform public.reverse_payment_journal(v_mv.id, coalesce(p_reason, 'order_cancel'));
    exception when others then
      null;
    end;
  end loop;
  v_reason := nullif(trim(coalesce(p_reason,'')),'');
  update public.orders
  set status = 'cancelled',
      data = jsonb_set(coalesce(v_order.data,'{}'::jsonb), '{cancelReason}', to_jsonb(coalesce(v_reason,'')), true),
      updated_at = now()
  where id = p_order_id;
end;
$$;

revoke all on function public.cancel_order(uuid, text, timestamptz) from public;
revoke execute on function public.cancel_order(uuid, text, timestamptz) from anon;
grant execute on function public.cancel_order(uuid, text, timestamptz) to authenticated;

create or replace function public.record_order_payment(
  p_order_id uuid,
  p_amount numeric,
  p_method text,
  p_occurred_at timestamptz,
  p_idempotency_key text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_amount numeric;
  v_method text;
  v_occurred_at timestamptz;
  v_total numeric;
  v_paid numeric;
  v_idempotency text;
  v_shift_id uuid;
begin
  if auth.role() <> 'service_role' then
    if not public.is_staff() then
      raise exception 'not allowed';
    end if;
    if not public.has_admin_permission('orders.markPaid') then
      raise exception 'not allowed';
    end if;
  end if;
  if p_order_id is null then
    raise exception 'p_order_id is required';
  end if;
  select coalesce(nullif((o.data->>'total')::numeric, null), 0)
  into v_total
  from public.orders o
  where o.id = p_order_id;
  if not found then
    raise exception 'order not found';
  end if;
  v_amount := coalesce(p_amount, 0);
  if v_amount <= 0 then
    raise exception 'invalid amount';
  end if;
  select coalesce(sum(p.amount), 0)
  into v_paid
  from public.payments p
  where p.reference_table = 'orders'
    and p.reference_id = p_order_id::text
    and p.direction = 'in';
  if v_total > 0 and (v_paid + v_amount) > (v_total + 1e-9) then
    raise exception 'paid amount exceeds total';
  end if;
  v_method := nullif(trim(coalesce(p_method, '')), '');
  if v_method is null then
    v_method := 'cash';
  end if;
  v_occurred_at := coalesce(p_occurred_at, now());
  v_idempotency := nullif(trim(coalesce(p_idempotency_key, '')), '');
  select s.id
  into v_shift_id
  from public.cash_shifts s
  where s.cashier_id = auth.uid()
    and coalesce(s.status, 'open') = 'open'
  order by s.opened_at desc
  limit 1;
  if v_method = 'cash' and v_shift_id is null then
    raise exception 'cash method requires an open cash shift';
  end if;
  if v_idempotency is null then
    insert into public.payments(direction, method, amount, currency, reference_table, reference_id, occurred_at, created_by, data, shift_id)
    values (
      'in',
      v_method,
      v_amount,
      'YER',
      'orders',
      p_order_id::text,
      v_occurred_at,
      auth.uid(),
      jsonb_build_object('orderId', p_order_id::text),
      v_shift_id
    );
  else
    insert into public.payments(direction, method, amount, currency, reference_table, reference_id, occurred_at, created_by, data, idempotency_key, shift_id)
    values (
      'in',
      v_method,
      v_amount,
      'YER',
      'orders',
      p_order_id::text,
      v_occurred_at,
      auth.uid(),
      jsonb_build_object('orderId', p_order_id::text),
      v_idempotency,
      v_shift_id
    )
    on conflict (reference_table, reference_id, direction, idempotency_key)
    do update set
      method = excluded.method,
      amount = excluded.amount,
      occurred_at = excluded.occurred_at,
      created_by = coalesce(public.payments.created_by, excluded.created_by),
      data = excluded.data,
      shift_id = coalesce(public.payments.shift_id, excluded.shift_id);
  end if;
end;
$$;

revoke all on function public.record_order_payment(uuid, numeric, text, timestamptz, text) from public;
revoke execute on function public.record_order_payment(uuid, numeric, text, timestamptz, text) from anon;
grant execute on function public.record_order_payment(uuid, numeric, text, timestamptz, text) to authenticated;
