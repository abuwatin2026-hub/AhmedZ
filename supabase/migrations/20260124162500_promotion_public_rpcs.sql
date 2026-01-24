create or replace function public._compute_promotion_price_only(
  p_promotion_id uuid,
  p_customer_id uuid,
  p_bundle_qty numeric
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_bundle_qty numeric;
  v_promo record;
  v_item record;
  v_required_qty numeric;
  v_unit_price numeric;
  v_line_gross numeric;
  v_items jsonb := '[]'::jsonb;
  v_original_total numeric := 0;
  v_final_total numeric := 0;
  v_promo_expense numeric := 0;
begin
  if p_promotion_id is null then
    raise exception 'p_promotion_id is required';
  end if;

  v_bundle_qty := coalesce(p_bundle_qty, 1);
  if v_bundle_qty <= 0 then
    v_bundle_qty := 1;
  end if;

  select *
  into v_promo
  from public.promotions p
  where p.id = p_promotion_id;
  if not found then
    raise exception 'promotion_not_found';
  end if;

  for v_item in
    select
      pi.item_id,
      pi.quantity
    from public.promotion_items pi
    where pi.promotion_id = p_promotion_id
    order by pi.sort_order asc, pi.created_at asc, pi.id asc
  loop
    v_required_qty := public._money_round(coalesce(v_item.quantity, 0) * v_bundle_qty, 6);
    if v_required_qty <= 0 then
      continue;
    end if;

    v_unit_price := public.get_item_price_with_discount(v_item.item_id, p_customer_id, v_required_qty);
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
    'items', v_items
  );
end;
$$;

revoke all on function public._compute_promotion_price_only(uuid, uuid, numeric) from public;
grant execute on function public._compute_promotion_price_only(uuid, uuid, numeric) to authenticated;

create or replace function public.get_active_promotions(
  p_customer_id uuid default null,
  p_warehouse_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid;
  v_customer_id uuid;
  v_now timestamptz := now();
  v_result jsonb := '[]'::jsonb;
  v_promo record;
begin
  v_actor := auth.uid();
  if v_actor is null then
    raise exception 'not authenticated';
  end if;

  v_customer_id := coalesce(p_customer_id, v_actor);

  for v_promo in
    select p.*
    from public.promotions p
    where p.is_active = true
      and p.approval_status = 'approved'
      and v_now >= p.start_at
      and v_now <= p.end_at
    order by p.end_at asc, p.created_at desc
  loop
    v_result := v_result || public._compute_promotion_price_only(v_promo.id, v_customer_id, 1);
  end loop;

  return v_result;
end;
$$;

revoke all on function public.get_active_promotions(uuid, uuid) from public;
grant execute on function public.get_active_promotions(uuid, uuid) to authenticated;

