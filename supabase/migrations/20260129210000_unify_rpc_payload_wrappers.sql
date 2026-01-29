create or replace function public.reserve_stock_for_order(p_payload jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_items jsonb;
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

  v_order_id_text := nullif(coalesce(p_payload->>'p_order_id', p_payload->>'order_id', p_payload->>'orderId'), '');
  if v_order_id_text is not null and v_order_id_text ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    v_order_id := v_order_id_text::uuid;
  else
    v_order_id := null;
  end if;

  v_warehouse_id_text := nullif(coalesce(p_payload->>'p_warehouse_id', p_payload->>'warehouse_id', p_payload->>'warehouseId'), '');
  if v_warehouse_id_text is not null and v_warehouse_id_text ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    v_warehouse_id := v_warehouse_id_text::uuid;
  else
    v_warehouse_id := null;
  end if;

  perform public.reserve_stock_for_order(v_items, v_order_id, v_warehouse_id);
end;
$$;

revoke all on function public.reserve_stock_for_order(jsonb) from public;
revoke execute on function public.reserve_stock_for_order(jsonb) from anon;
grant execute on function public.reserve_stock_for_order(jsonb) to authenticated;

create or replace function public.confirm_order_delivery(p_payload jsonb)
returns void
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

  perform public.confirm_order_delivery(v_order_id, v_items, v_updated_data, v_warehouse_id);
end;
$$;

revoke all on function public.confirm_order_delivery(jsonb) from public;
revoke execute on function public.confirm_order_delivery(jsonb) from anon;
grant execute on function public.confirm_order_delivery(jsonb) to authenticated;

create or replace function public.confirm_order_delivery_with_credit(p_payload jsonb)
returns void
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

  perform public.confirm_order_delivery_with_credit(v_order_id, v_items, v_updated_data, v_warehouse_id);
end;
$$;

revoke all on function public.confirm_order_delivery_with_credit(jsonb) from public;
revoke execute on function public.confirm_order_delivery_with_credit(jsonb) from anon;
grant execute on function public.confirm_order_delivery_with_credit(jsonb) to authenticated;

select pg_sleep(1);
notify pgrst, 'reload schema';
