create or replace function public.release_reserved_stock_for_order(
  p_items jsonb,
  p_order_id uuid default null,
  p_warehouse_id uuid default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid;
  v_item jsonb;
  v_item_id text;
  v_qty numeric;
  v_to_release numeric;
  v_row record;
  v_is_food boolean;
begin
  v_actor := auth.uid();
  if v_actor is null then
    raise exception 'not authenticated';
  end if;
  if p_order_id is null then
    raise exception 'p_order_id is required';
  end if;
  if p_warehouse_id is null then
    raise exception 'warehouse_id is required';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    raise exception 'p_items must be a json array';
  end if;

  if not exists (select 1 from public.orders o where o.id = p_order_id) then
    raise exception 'order not found';
  end if;

  if not public.is_staff() then
    if not exists (
      select 1
      from public.orders o
      where o.id = p_order_id
        and o.customer_auth_user_id = v_actor
    ) then
      raise exception 'not allowed';
    end if;
  end if;

  for v_item in select value from jsonb_array_elements(coalesce(p_items, '[]'::jsonb))
  loop
    v_item_id := nullif(trim(coalesce(v_item->>'itemId', v_item->>'id')), '');
    v_qty := coalesce(nullif(v_item->>'quantity','')::numeric, nullif(v_item->>'qty','')::numeric, 0);
    if v_item_id is null or v_qty <= 0 then
      continue;
    end if;

    v_to_release := v_qty;
    for v_row in
      select r.id, r.quantity
      from public.order_item_reservations r
      where r.order_id = p_order_id
        and r.item_id::text = v_item_id::text
        and r.warehouse_id = p_warehouse_id
        and r.quantity > 0
      order by r.created_at asc, r.id asc
    loop
      exit when v_to_release <= 0;
      if coalesce(v_row.quantity, 0) <= 0 then
        continue;
      end if;
      update public.order_item_reservations
      set quantity = quantity - least(v_to_release, quantity),
          updated_at = now()
      where id = v_row.id;
      v_to_release := v_to_release - least(v_to_release, coalesce(v_row.quantity, 0));
    end loop;

    delete from public.order_item_reservations r
    where r.order_id = p_order_id
      and r.item_id::text = v_item_id::text
      and r.warehouse_id = p_warehouse_id
      and r.quantity <= 0;

    select (coalesce(mi.category,'') = 'food')
    into v_is_food
    from public.menu_items mi
    where mi.id::text = v_item_id::text;

    update public.stock_management sm
    set reserved_quantity = coalesce((
          select sum(r2.quantity)
          from public.order_item_reservations r2
          where r2.item_id::text = v_item_id::text
            and r2.warehouse_id = p_warehouse_id
        ), 0),
        available_quantity = coalesce((
          select sum(
            greatest(
              coalesce(b.quantity_received,0)
              - coalesce(b.quantity_consumed,0)
              - coalesce(b.quantity_transferred,0),
              0
            )
          )
          from public.batches b
          where b.item_id::text = v_item_id::text
            and b.warehouse_id = p_warehouse_id
            and coalesce(b.status,'active') = 'active'
            and coalesce(b.qc_status,'') = 'released'
            and not exists (
              select 1 from public.batch_recalls br
              where br.batch_id = b.id and br.status = 'active'
            )
            and (
              not coalesce(v_is_food, false)
              or (b.expiry_date is not null and b.expiry_date >= current_date)
            )
        ), 0),
        last_updated = now(),
        updated_at = now()
    where sm.item_id::text = v_item_id::text
      and sm.warehouse_id = p_warehouse_id;
  end loop;
end;
$$;

create or replace function public.release_reserved_stock_for_order(
  p_items jsonb,
  p_order_id uuid default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_wh uuid;
begin
  if p_order_id is null then
    raise exception 'p_order_id is required';
  end if;
  select
    coalesce(
      o.warehouse_id,
      case
        when nullif(o.data->>'warehouseId','') is not null
             and (o.data->>'warehouseId') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
          then (o.data->>'warehouseId')::uuid
        else null
      end
    )
  into v_wh
  from public.orders o
  where o.id = p_order_id;

  if v_wh is null then
    begin
      v_wh := public._resolve_default_warehouse_id();
    exception when others then
      v_wh := null;
    end;
  end if;

  if v_wh is null then
    raise exception 'warehouse_id is required';
  end if;

  perform public.release_reserved_stock_for_order(p_items, p_order_id, v_wh);
end;
$$;

revoke all on function public.release_reserved_stock_for_order(jsonb, uuid, uuid) from public;
revoke execute on function public.release_reserved_stock_for_order(jsonb, uuid, uuid) from anon;
grant execute on function public.release_reserved_stock_for_order(jsonb, uuid, uuid) to authenticated;

revoke all on function public.release_reserved_stock_for_order(jsonb, uuid) from public;
revoke execute on function public.release_reserved_stock_for_order(jsonb, uuid) from anon;
grant execute on function public.release_reserved_stock_for_order(jsonb, uuid) to authenticated;

select pg_sleep(0.5);
notify pgrst, 'reload schema';
