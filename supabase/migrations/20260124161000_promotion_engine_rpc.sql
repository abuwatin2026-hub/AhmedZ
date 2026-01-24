create or replace function public._uuid_or_null(p_value text)
returns uuid
language plpgsql
immutable
as $$
begin
  if p_value is null or nullif(btrim(p_value), '') is null then
    return null;
  end if;
  if btrim(p_value) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    return btrim(p_value)::uuid;
  end if;
  return null;
end;
$$;

create or replace function public._resolve_default_warehouse_id()
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_warehouse_id uuid;
begin
  select w.id
  into v_warehouse_id
  from public.warehouses w
  where w.is_active = true
  order by (upper(coalesce(w.code, '')) = 'MAIN') desc, w.code asc
  limit 1;

  if v_warehouse_id is null then
    raise exception 'No active warehouse found';
  end if;
  return v_warehouse_id;
end;
$$;

revoke all on function public._resolve_default_warehouse_id() from public;
grant execute on function public._resolve_default_warehouse_id() to authenticated;

create or replace function public.apply_promotion_to_cart(
  p_cart_payload jsonb,
  p_promotion_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid;
  v_customer_id uuid;
  v_warehouse_id uuid;
  v_bundle_qty numeric;
  v_coupon_code text;
  v_promo record;
  v_item record;
  v_item_input jsonb;
  v_required_qty numeric;
  v_unit_price numeric;
  v_line_gross numeric;
  v_items jsonb := '[]'::jsonb;
  v_original_total numeric := 0;
  v_final_total numeric := 0;
  v_promo_expense numeric := 0;
  v_alloc jsonb := '[]'::jsonb;
  v_alloc_item jsonb;
  v_alloc_total_gross numeric := 0;
  v_gross_share numeric;
  v_alloc_rev numeric;
  v_alloc_rev_sum numeric := 0;
  v_now timestamptz := now();
  v_stock_available numeric;
  v_stock_reserved numeric;
  v_is_food boolean;
begin
  v_actor := auth.uid();
  if v_actor is null then
    raise exception 'not authenticated';
  end if;

  if p_promotion_id is null then
    raise exception 'p_promotion_id is required';
  end if;

  if p_cart_payload is null then
    p_cart_payload := '{}'::jsonb;
  end if;

  v_customer_id := public._uuid_or_null(p_cart_payload->>'customerId');
  v_warehouse_id := public._uuid_or_null(p_cart_payload->>'warehouseId');
  if v_warehouse_id is null then
    v_warehouse_id := public._resolve_default_warehouse_id();
  end if;

  v_bundle_qty := coalesce(nullif((p_cart_payload->>'bundleQty')::numeric, null), 1);
  if v_bundle_qty <= 0 then
    v_bundle_qty := 1;
  end if;

  v_coupon_code := nullif(btrim(coalesce(p_cart_payload->>'couponCode', '')), '');

  select *
  into v_promo
  from public.promotions p
  where p.id = p_promotion_id;
  if not found then
    raise exception 'promotion_not_found';
  end if;
  if not v_promo.is_active then
    raise exception 'promotion_inactive';
  end if;
  if v_promo.approval_status <> 'approved' then
    raise exception 'promotion_requires_approval';
  end if;
  if v_now < v_promo.start_at or v_now > v_promo.end_at then
    raise exception 'promotion_outside_time_window';
  end if;
  if v_promo.exclusive_with_coupon and v_coupon_code is not null then
    raise exception 'promotion_coupon_conflict';
  end if;

  for v_item in
    select
      pi.item_id,
      pi.quantity,
      coalesce(mi.is_food, false) as is_food
    from public.promotion_items pi
    join public.menu_items mi on mi.id = pi.item_id
    where pi.promotion_id = p_promotion_id
    order by pi.sort_order asc, pi.created_at asc, pi.id asc
  loop
    v_required_qty := public._money_round(coalesce(v_item.quantity, 0) * v_bundle_qty, 6);
    if v_required_qty <= 0 then
      continue;
    end if;

    if not v_item.is_food then
      select coalesce(sm.available_quantity, 0), coalesce(sm.reserved_quantity, 0)
      into v_stock_available, v_stock_reserved
      from public.stock_management sm
      where sm.item_id::text = v_item.item_id
        and sm.warehouse_id = v_warehouse_id;

      if (coalesce(v_stock_available, 0) - coalesce(v_stock_reserved, 0)) + 1e-9 < v_required_qty then
        raise exception 'Insufficient stock for item % in warehouse %', v_item.item_id, v_warehouse_id;
      end if;
    else
      select coalesce(sum(greatest(coalesce(b.quantity_received,0) - coalesce(b.quantity_consumed,0), 0)), 0)
      into v_stock_available
      from public.batches b
      where b.item_id = v_item.item_id
        and b.warehouse_id = v_warehouse_id
        and (b.expiry_date is null or b.expiry_date >= current_date);

      if coalesce(v_stock_available, 0) + 1e-9 < v_required_qty then
        raise exception 'Insufficient FEFO stock for item % in warehouse %', v_item.item_id, v_warehouse_id;
      end if;
    end if;

    v_unit_price := public.get_item_price_with_discount(v_item.item_id, v_customer_id, v_required_qty);
    v_unit_price := public._money_round(v_unit_price);
    v_line_gross := public._money_round(v_unit_price * v_required_qty);

    v_items := v_items || jsonb_build_object(
      'itemId', v_item.item_id,
      'quantity', v_required_qty,
      'unitPrice', v_unit_price,
      'grossTotal', v_line_gross
    );

    v_original_total := v_original_total + v_line_gross;
  end loop;

  if jsonb_array_length(v_items) = 0 then
    raise exception 'promotion_has_no_items';
  end if;

  v_original_total := public._money_round(v_original_total);

  if v_promo.discount_mode = 'fixed_total' then
    v_final_total := public._money_round(coalesce(v_promo.fixed_total, 0) * v_bundle_qty);
  else
    v_final_total := public._money_round(v_original_total * (1 - (coalesce(v_promo.percent_off, 0) / 100.0)));
  end if;

  v_final_total := greatest(0, least(v_final_total, v_original_total));
  v_promo_expense := public._money_round(v_original_total - v_final_total);

  v_alloc_total_gross := greatest(v_original_total, 0);
  v_alloc_rev_sum := 0;

  for v_item_input in
    select value from jsonb_array_elements(v_items)
  loop
    v_line_gross := coalesce(nullif((v_item_input->>'grossTotal')::numeric, null), 0);
    if v_alloc_total_gross > 0 then
      v_gross_share := greatest(0, v_line_gross) / v_alloc_total_gross;
    else
      v_gross_share := 0;
    end if;
    v_alloc_rev := public._money_round(v_original_total * v_gross_share);
    v_alloc_rev_sum := v_alloc_rev_sum + v_alloc_rev;

    v_alloc_item := jsonb_build_object(
      'itemId', v_item_input->>'itemId',
      'quantity', coalesce(nullif((v_item_input->>'quantity')::numeric, null), 0),
      'unitPrice', coalesce(nullif((v_item_input->>'unitPrice')::numeric, null), 0),
      'grossTotal', v_line_gross,
      'allocatedRevenue', v_alloc_rev,
      'allocatedRevenuePct', v_gross_share
    );
    v_alloc := v_alloc || v_alloc_item;
  end loop;

  if abs(v_alloc_rev_sum - v_original_total) > 0.02 and jsonb_array_length(v_alloc) > 0 then
    v_alloc_item := v_alloc->(jsonb_array_length(v_alloc) - 1);
    v_alloc_item := jsonb_set(
      v_alloc_item,
      '{allocatedRevenue}',
      to_jsonb(public._money_round(coalesce(nullif((v_alloc_item->>'allocatedRevenue')::numeric, null), 0) + (v_original_total - v_alloc_rev_sum))),
      true
    );
    v_alloc := jsonb_set(v_alloc, array[(jsonb_array_length(v_alloc) - 1)::text], v_alloc_item, true);
  end if;

  return jsonb_build_object(
    'promotionId', v_promo.id::text,
    'name', v_promo.name,
    'startAt', v_promo.start_at,
    'endAt', v_promo.end_at,
    'bundleQty', public._money_round(v_bundle_qty, 6),
    'displayOriginalTotal', v_promo.display_original_total,
    'computedOriginalTotal', v_original_total,
    'finalTotal', v_final_total,
    'promotionExpense', v_promo_expense,
    'items', v_items,
    'revenueAllocation', v_alloc,
    'warehouseId', v_warehouse_id::text,
    'customerId', case when v_customer_id is null then null else v_customer_id::text end,
    'appliedAt', v_now
  );
end;
$$;

revoke all on function public.apply_promotion_to_cart(jsonb, uuid) from public;
grant execute on function public.apply_promotion_to_cart(jsonb, uuid) to authenticated;

