create or replace function public.reserve_stock_for_order(p_items jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item jsonb;
  v_item_id text;
  v_requested numeric;
  v_available numeric;
  v_reserved numeric;
begin
  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    raise exception 'p_items must be a json array';
  end if;

  for v_item in select value from jsonb_array_elements(p_items)
  loop
    v_item_id := coalesce(v_item->>'itemId', v_item->>'id');
    v_requested := coalesce(nullif(v_item->>'quantity','')::numeric, 0);

    if v_item_id is null or v_item_id = '' then
      raise exception 'Invalid itemId';
    end if;
    if v_requested <= 0 then
      raise exception 'Invalid requested quantity for item %', v_item_id;
    end if;

    select
      coalesce(sm.available_quantity, 0),
      coalesce(sm.reserved_quantity, 0)
    into v_available, v_reserved
    from public.stock_management sm
    where sm.item_id = v_item_id
    for update;

    if not found then
      raise exception 'Stock record not found for item %', v_item_id;
    end if;

    if (v_available - v_reserved) + 1e-9 < v_requested then
      raise exception 'Insufficient stock for item % (available %, reserved %, requested %)', v_item_id, v_available, v_reserved, v_requested;
    end if;

    update public.stock_management
    set reserved_quantity = reserved_quantity + v_requested,
        last_updated = now(),
        updated_at = now()
    where item_id = v_item_id;
  end loop;
end;
$$;
create or replace function public.release_reserved_stock_for_order(p_items jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item jsonb;
  v_item_id text;
  v_requested numeric;
begin
  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    raise exception 'p_items must be a json array';
  end if;

  for v_item in select value from jsonb_array_elements(p_items)
  loop
    v_item_id := coalesce(v_item->>'itemId', v_item->>'id');
    v_requested := coalesce(nullif(v_item->>'quantity','')::numeric, 0);

    if v_item_id is null or v_item_id = '' then
      raise exception 'Invalid itemId';
    end if;
    if v_requested <= 0 then
      continue;
    end if;

    update public.stock_management
    set reserved_quantity = greatest(0, reserved_quantity - v_requested),
        last_updated = now(),
        updated_at = now()
    where item_id = v_item_id;
  end loop;
end;
$$;
create or replace function public.deduct_stock_on_delivery(p_items jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item jsonb;
  v_item_id text;
  v_requested numeric;
begin
  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    raise exception 'p_items must be a json array';
  end if;

  for v_item in select value from jsonb_array_elements(p_items)
  loop
    v_item_id := coalesce(v_item->>'itemId', v_item->>'id');
    v_requested := coalesce(nullif(v_item->>'quantity','')::numeric, 0);

    if v_item_id is null or v_item_id = '' then
      raise exception 'Invalid itemId';
    end if;
    if v_requested <= 0 then
      continue;
    end if;

    update public.stock_management
    set available_quantity = greatest(0, available_quantity - v_requested),
        reserved_quantity = greatest(0, reserved_quantity - v_requested),
        last_updated = now(),
        updated_at = now()
    where item_id = v_item_id;
  end loop;
end;
$$;
revoke all on function public.reserve_stock_for_order(jsonb) from public;
revoke all on function public.release_reserved_stock_for_order(jsonb) from public;
revoke all on function public.deduct_stock_on_delivery(jsonb) from public;
grant execute on function public.reserve_stock_for_order(jsonb) to anon, authenticated;
grant execute on function public.release_reserved_stock_for_order(jsonb) to anon, authenticated;
grant execute on function public.deduct_stock_on_delivery(jsonb) to anon, authenticated;
