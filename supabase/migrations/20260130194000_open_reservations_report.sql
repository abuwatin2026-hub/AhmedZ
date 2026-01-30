create or replace function public.get_open_reservations_report(
  p_start_date timestamptz,
  p_end_date timestamptz,
  p_warehouse_id uuid default null,
  p_search text default null,
  p_limit integer default 500,
  p_offset integer default 0
)
returns table (
  order_id uuid,
  order_status text,
  order_created_at timestamptz,
  order_source text,
  customer_name text,
  delivery_zone_id uuid,
  delivery_zone_name text,
  item_id text,
  item_name jsonb,
  reserved_quantity numeric,
  warehouse_id uuid,
  warehouse_name text,
  reservation_updated_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_search text;
begin
  if not public.is_staff() then
    raise exception 'not allowed';
  end if;
  if p_start_date is null or p_end_date is null then
    raise exception 'start and end dates are required';
  end if;

  v_search := nullif(trim(p_search), '');

  return query
  with base as (
    select
      r.order_id,
      o.status::text as order_status,
      o.created_at as order_created_at,
      coalesce(nullif(o.data->>'orderSource',''), '') as order_source,
      coalesce(nullif(o.data->>'customerName',''), '') as customer_name,
      coalesce(
        o.delivery_zone_id,
        case
          when nullif(o.data->>'deliveryZoneId','') is not null
               and (o.data->>'deliveryZoneId') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
            then (o.data->>'deliveryZoneId')::uuid
          else null
        end
      ) as delivery_zone_id,
      r.item_id,
      r.quantity as reserved_quantity,
      r.warehouse_id,
      r.updated_at as reservation_updated_at
    from public.order_item_reservations r
    join public.orders o on o.id = r.order_id
    where r.quantity > 0
      and o.status not in ('delivered','cancelled')
      and o.created_at >= p_start_date
      and o.created_at <= p_end_date
      and (p_warehouse_id is null or r.warehouse_id = p_warehouse_id)
  )
  select
    b.order_id,
    b.order_status,
    b.order_created_at,
    b.order_source,
    b.customer_name,
    b.delivery_zone_id,
    coalesce(dz.name, '') as delivery_zone_name,
    b.item_id,
    coalesce(mi.data->'name', jsonb_build_object('ar', b.item_id)) as item_name,
    b.reserved_quantity,
    b.warehouse_id,
    coalesce(w.name, '') as warehouse_name,
    b.reservation_updated_at
  from base b
  left join public.delivery_zones dz on dz.id = b.delivery_zone_id
  left join public.warehouses w on w.id = b.warehouse_id
  left join public.menu_items mi on mi.id::text = b.item_id
  where (
    v_search is null
    or right(b.order_id::text, 6) ilike '%' || v_search || '%'
    or b.customer_name ilike '%' || v_search || '%'
    or coalesce(w.name, '') ilike '%' || v_search || '%'
    or coalesce(dz.name, '') ilike '%' || v_search || '%'
    or b.item_id ilike '%' || v_search || '%'
    or coalesce(mi.data->'name'->>'ar', '') ilike '%' || v_search || '%'
    or coalesce(mi.data->'name'->>'en', '') ilike '%' || v_search || '%'
  )
  order by b.reservation_updated_at desc, b.order_created_at desc
  limit greatest(1, least(p_limit, 20000))
  offset greatest(0, p_offset);
end;
$$;

revoke all on function public.get_open_reservations_report(timestamptz, timestamptz, uuid, text, integer, integer) from public;
grant execute on function public.get_open_reservations_report(timestamptz, timestamptz, uuid, text, integer, integer) to authenticated;

select pg_sleep(1);
notify pgrst, 'reload schema';
