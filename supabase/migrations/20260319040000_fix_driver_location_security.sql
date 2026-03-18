-- ================================================================
-- Fix: Driver Location Tracking Improvements
-- 1. Secure get_active_driver_locations() — staff only
-- 2. Rate limit upsert_driver_location() — max 1 per 5 seconds
-- 3. Add orders linkage to the locations view
-- ================================================================

-- Drop old version (return type changed — added active_orders columns)
drop function if exists public.get_active_driver_locations();

-- 1. Secure get_active_driver_locations — admin/staff only, not customer
create or replace function public.get_active_driver_locations()
returns table (
  driver_id   uuid,
  driver_name text,
  latitude    double precision,
  longitude   double precision,
  accuracy    double precision,
  heading     double precision,
  speed       double precision,
  is_active   boolean,
  updated_at  timestamptz,
  seconds_ago bigint,
  active_orders_count bigint,
  active_orders       jsonb
)
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Enforce: caller must be staff (admin user), not a customer
  if not public.is_staff() then
    raise exception 'not allowed';
  end if;

  return query
  select
    dl.driver_id,
    dl.driver_name,
    dl.latitude,
    dl.longitude,
    dl.accuracy,
    dl.heading,
    dl.speed,
    dl.is_active,
    dl.updated_at,
    extract(epoch from (now() - dl.updated_at))::bigint as seconds_ago,
    -- Count active orders assigned to this driver
    count(distinct o.id) as active_orders_count,
    -- Compact order info for map popup
    coalesce(
      jsonb_agg(
        jsonb_build_object(
          'orderId', o.id,
          'status',  o.status,
          'orderNo', coalesce(o.data->>'orderNo', o.id::text)
        )
      ) filter (where o.id is not null),
      '[]'::jsonb
    ) as active_orders
  from public.driver_locations dl
  left join public.orders o
    on  (o.data->>'assignedDeliveryUserId') = dl.driver_id::text
    and o.status in ('confirmed','preparing','out_for_delivery','ready')
  where dl.updated_at > now() - interval '30 minutes'
  group by
    dl.driver_id, dl.driver_name, dl.latitude, dl.longitude,
    dl.accuracy, dl.heading, dl.speed, dl.is_active, dl.updated_at
  order by dl.updated_at desc;
end;
$$;

grant execute on function public.get_active_driver_locations() to authenticated;

-- 2. Rate-limit upsert: reject if last update was less than 5 seconds ago
-- (prevents GPS spam from buggy clients)
create or replace function public.upsert_driver_location(
  p_latitude  double precision,
  p_longitude double precision,
  p_accuracy  double precision default null,
  p_heading   double precision default null,
  p_speed     double precision default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text;
  v_last_update timestamptz;
begin
  -- Enforce: only staff (delivery agents are admin users with delivery role)
  if not public.is_staff() then
    raise exception 'not allowed';
  end if;

  -- Rate limit: max 1 update per 5 seconds
  select updated_at into v_last_update
  from public.driver_locations
  where driver_id = auth.uid();

  if found and v_last_update > now() - interval '5 seconds' then
    return; -- silently skip, not an error
  end if;

  -- Get driver name
  select coalesce(full_name, email, 'مندوب') into v_name
  from public.admin_users
  where auth_user_id = auth.uid()
  limit 1;

  insert into public.driver_locations (
    driver_id, latitude, longitude, accuracy, heading, speed,
    driver_name, is_active, updated_at
  )
  values (
    auth.uid(), p_latitude, p_longitude, p_accuracy, p_heading, p_speed,
    v_name, true, now()
  )
  on conflict (driver_id) do update set
    latitude    = excluded.latitude,
    longitude   = excluded.longitude,
    accuracy    = excluded.accuracy,
    heading     = excluded.heading,
    speed       = excluded.speed,
    driver_name = coalesce(excluded.driver_name, driver_locations.driver_name),
    is_active   = true,
    updated_at  = now();
end;
$$;

grant execute on function public.upsert_driver_location(double precision, double precision, double precision, double precision, double precision) to authenticated;

-- 3. set_driver_offline also needs staff check
create or replace function public.set_driver_offline()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_staff() then
    raise exception 'not allowed';
  end if;

  update public.driver_locations
  set is_active = false, updated_at = now()
  where driver_id = auth.uid();
end;
$$;

grant execute on function public.set_driver_offline() to authenticated;

notify pgrst, 'reload schema';
