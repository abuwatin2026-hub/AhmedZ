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
  v_final_unit_price numeric;
begin
  if p_item_id is null or btrim(p_item_id) = '' then
    raise exception 'p_item_id is required';
  end if;
  if p_quantity is null or p_quantity <= 0 then
    p_quantity := 1;
  end if;

  select mi.price
  into v_base_unit_price
  from public.menu_items mi
  where mi.id = p_item_id;

  if not found then
    raise exception 'Item not found: %', p_item_id;
  end if;

  if p_customer_id is not null then
    select coalesce(c.customer_type, 'retail')
    into v_customer_type
    from public.customers c
    where c.auth_user_id::text = p_customer_id::text;

    if not found then
      v_customer_type := 'retail';
    end if;

    select csp.special_price
    into v_special_price
    from public.customer_special_prices csp
    where csp.customer_id::text = p_customer_id::text
      and csp.item_id = p_item_id
      and csp.is_active = true
      and (csp.valid_from is null or csp.valid_from <= current_date)
      and (csp.valid_to is null or csp.valid_to >= current_date)
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
    and (pt.valid_from is null or pt.valid_from <= current_date)
    and (pt.valid_to is null or pt.valid_to >= current_date)
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

select pg_sleep(1);
notify pgrst, 'reload schema';
