-- ================================================================
-- Live Driver Location Tracking
-- GPS location updates from delivery agents, read by admin map
-- ================================================================

-- Store live driver locations (upserted every 15 sec from driver app)
create table if not exists public.driver_locations (
  driver_id       uuid primary key references auth.users(id) on delete cascade,
  latitude        double precision not null,
  longitude       double precision not null,
  accuracy        double precision,          -- GPS accuracy in meters
  heading         double precision,          -- direction 0-360 degrees
  speed           double precision,          -- m/s
  driver_name     text,
  is_active       boolean not null default true,
  updated_at      timestamptz not null default now()
);

-- Enable Row Level Security
alter table public.driver_locations enable row level security;

-- Delivery agents can only update their own location
drop policy if exists "drivers can upsert own location" on public.driver_locations;
create policy "drivers can upsert own location"
  on public.driver_locations for all
  using (auth.uid() = driver_id)
  with check (auth.uid() = driver_id);

-- Admin/manager can read all locations
drop policy if exists "admins can read all locations" on public.driver_locations;
create policy "admins can read all locations"
  on public.driver_locations for select
  using (
    exists (
      select 1 from public.admin_users au
      where au.auth_user_id = auth.uid()
        and au.role in ('owner', 'manager', 'employee', 'cashier', 'accountant')
        and au.is_active = true
    )
    or auth.uid() = driver_id
  );

-- Enable Realtime for live updates
alter publication supabase_realtime add table public.driver_locations;

-- RPC: upsert driver location (called by driver app)
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
begin
  -- Get driver name from admin_users
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

-- RPC: mark driver as offline (called on app close/logout)
create or replace function public.set_driver_offline()
returns void
language sql
security definer
set search_path = public
as $$
  update public.driver_locations
  set is_active = false, updated_at = now()
  where driver_id = auth.uid();
$$;

grant execute on function public.set_driver_offline() to authenticated;

-- RPC: get all active driver locations (admin only)
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
  seconds_ago bigint
)
language sql
security definer
set search_path = public
as $$
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
    extract(epoch from (now() - dl.updated_at))::bigint as seconds_ago
  from public.driver_locations dl
  where dl.updated_at > now() - interval '30 minutes'
  order by dl.updated_at desc;
$$;

grant execute on function public.get_active_driver_locations() to authenticated;

notify pgrst, 'reload schema';
