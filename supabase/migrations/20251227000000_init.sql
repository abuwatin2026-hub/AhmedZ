create schema if not exists public;
create extension if not exists pgcrypto;
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;
create table if not exists public.admin_users (
  auth_user_id uuid primary key references auth.users(id) on delete cascade,
  username text unique not null,
  full_name text,
  email text,
  phone_number text,
  avatar_url text,
  role text not null check (role in ('owner','manager','employee','delivery')),
  permissions text[] null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
drop trigger if exists trg_admin_users_updated_at on public.admin_users;
create trigger trg_admin_users_updated_at
before update on public.admin_users
for each row execute function public.set_updated_at();
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.admin_users au
    where au.auth_user_id = auth.uid()
      and au.is_active = true
  );
$$;
create or replace function public.is_staff()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_admin();
$$;
create or replace function public.is_owner()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.admin_users au
    where au.auth_user_id = auth.uid()
      and au.is_active = true
      and au.role = 'owner'
  );
$$;
create or replace function public.has_admin_permission(p text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.admin_users au
    where au.auth_user_id = auth.uid()
      and au.is_active = true
      and (
        au.role = 'owner'
        or (au.permissions is not null and p = any(au.permissions))
      )
  );
$$;
revoke all on function public.is_admin() from public;
grant execute on function public.is_admin() to anon, authenticated;
revoke all on function public.is_staff() from public;
grant execute on function public.is_staff() to anon, authenticated;
revoke all on function public.is_owner() from public;
grant execute on function public.is_owner() to anon, authenticated;
revoke all on function public.has_admin_permission(text) from public;
grant execute on function public.has_admin_permission(text) to anon, authenticated;
alter table public.admin_users enable row level security;
drop policy if exists admin_users_self_read on public.admin_users;
create policy admin_users_self_read
on public.admin_users
for select
using (auth.uid() = auth_user_id);
drop policy if exists admin_users_admin_read_all on public.admin_users;
create policy admin_users_admin_read_all
on public.admin_users
for select
using (public.is_admin());
drop policy if exists admin_users_owner_write on public.admin_users;
create policy admin_users_owner_write
on public.admin_users
for all
using (public.is_owner())
with check (public.is_owner());
create table if not exists public.customers (
  auth_user_id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  phone_number text unique,
  email text unique,
  auth_provider text,
  password_salt text,
  password_hash text,
  referral_code text unique,
  referred_by text,
  loyalty_points integer not null default 0,
  loyalty_tier text,
  total_spent numeric not null default 0,
  first_order_discount_applied boolean not null default false,
  avatar_url text,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
drop trigger if exists trg_customers_updated_at on public.customers;
create trigger trg_customers_updated_at
before update on public.customers
for each row execute function public.set_updated_at();
alter table public.customers enable row level security;
drop policy if exists customers_select_own_or_admin on public.customers;
create policy customers_select_own_or_admin
on public.customers
for select
using (auth.uid() = auth_user_id or public.is_admin());
drop policy if exists customers_insert_own on public.customers;
create policy customers_insert_own
on public.customers
for insert
with check (auth.uid() = auth_user_id);
drop policy if exists customers_update_own_or_admin on public.customers;
create policy customers_update_own_or_admin
on public.customers
for update
using (auth.uid() = auth_user_id or public.is_admin())
with check (auth.uid() = auth_user_id or public.is_admin());
create table if not exists public.menu_items (
  id text primary key,
  category text,
  is_featured boolean not null default false,
  unit_type text,
  freshness_level text,
  status text,
  data jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
drop trigger if exists trg_menu_items_updated_at on public.menu_items;
create trigger trg_menu_items_updated_at
before update on public.menu_items
for each row execute function public.set_updated_at();
create index if not exists idx_menu_items_category on public.menu_items(category);
create index if not exists idx_menu_items_featured on public.menu_items(is_featured);
create index if not exists idx_menu_items_unit_type on public.menu_items(unit_type);
create index if not exists idx_menu_items_freshness_level on public.menu_items(freshness_level);
alter table public.menu_items enable row level security;
drop policy if exists menu_items_select_all on public.menu_items;
create policy menu_items_select_all
on public.menu_items
for select
using (true);
drop policy if exists menu_items_write_admin on public.menu_items;
create policy menu_items_write_admin
on public.menu_items
for insert
with check (public.is_admin());
drop policy if exists menu_items_update_admin on public.menu_items;
create policy menu_items_update_admin
on public.menu_items
for update
using (public.is_admin())
with check (public.is_admin());
drop policy if exists menu_items_delete_admin on public.menu_items;
create policy menu_items_delete_admin
on public.menu_items
for delete
using (public.is_admin());
create table if not exists public.addons (
  id uuid primary key,
  name text,
  is_active boolean not null default true,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
drop trigger if exists trg_addons_updated_at on public.addons;
create trigger trg_addons_updated_at
before update on public.addons
for each row execute function public.set_updated_at();
create index if not exists idx_addons_name on public.addons(name);
alter table public.addons enable row level security;
drop policy if exists addons_select_all on public.addons;
create policy addons_select_all
on public.addons
for select
using (true);
drop policy if exists addons_write_admin on public.addons;
create policy addons_write_admin
on public.addons
for all
using (public.is_admin())
with check (public.is_admin());
create table if not exists public.delivery_zones (
  id uuid primary key,
  name text,
  is_active boolean not null default true,
  delivery_fee numeric not null default 0,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
drop trigger if exists trg_delivery_zones_updated_at on public.delivery_zones;
create trigger trg_delivery_zones_updated_at
before update on public.delivery_zones
for each row execute function public.set_updated_at();
create index if not exists idx_delivery_zones_active on public.delivery_zones(is_active);
alter table public.delivery_zones enable row level security;
drop policy if exists delivery_zones_select_all on public.delivery_zones;
create policy delivery_zones_select_all
on public.delivery_zones
for select
using (true);
drop policy if exists delivery_zones_write_admin on public.delivery_zones;
create policy delivery_zones_write_admin
on public.delivery_zones
for all
using (public.is_admin())
with check (public.is_admin());
create table if not exists public.coupons (
  id uuid primary key,
  code text unique not null,
  is_active boolean not null default true,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
drop trigger if exists trg_coupons_updated_at on public.coupons;
create trigger trg_coupons_updated_at
before update on public.coupons
for each row execute function public.set_updated_at();
create index if not exists idx_coupons_code on public.coupons(code);
create index if not exists idx_coupons_active on public.coupons(is_active);
alter table public.coupons enable row level security;
drop policy if exists coupons_select_active on public.coupons;
create policy coupons_select_active
on public.coupons
for select
using (is_active = true);
drop policy if exists coupons_admin_only on public.coupons;
create policy coupons_admin_only
on public.coupons
for all
using (public.is_admin())
with check (public.is_admin());
create or replace function public.get_coupon_by_code(p_code text)
returns table (id uuid, code text, is_active boolean, data jsonb)
language sql
security definer
set search_path = public
as $$
  select c.id, c.code, c.is_active, c.data
  from public.coupons c
  where lower(c.code) = lower(p_code)
  limit 1;
$$;
revoke all on function public.get_coupon_by_code(text) from public;
grant execute on function public.get_coupon_by_code(text) to anon, authenticated;
create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  customer_auth_user_id uuid references auth.users(id) on delete set null,
  status text not null,
  invoice_number text,
  data jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
drop trigger if exists trg_orders_updated_at on public.orders;
create trigger trg_orders_updated_at
before update on public.orders
for each row execute function public.set_updated_at();
create index if not exists idx_orders_customer_created on public.orders(customer_auth_user_id, created_at desc);
create index if not exists idx_orders_status on public.orders(status);
alter table public.orders enable row level security;
drop policy if exists orders_select_own_or_admin on public.orders;
create policy orders_select_own_or_admin
on public.orders
for select
using (customer_auth_user_id = auth.uid() or public.is_admin());
drop policy if exists orders_insert_own on public.orders;
create policy orders_insert_own
on public.orders
for insert
with check (
  (auth.role() = 'anon' and customer_auth_user_id is null)
  or
  (auth.role() = 'authenticated' and customer_auth_user_id = auth.uid())
);
drop policy if exists orders_update_admin on public.orders;
create policy orders_update_admin
on public.orders
for update
using (public.is_admin())
with check (public.is_admin());
drop policy if exists orders_delete_admin on public.orders;
create policy orders_delete_admin
on public.orders
for delete
using (public.is_admin());
create table if not exists public.order_events (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  action text not null,
  actor_type text not null,
  actor_id uuid,
  from_status text,
  to_status text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists idx_order_events_order_created on public.order_events(order_id, created_at desc);
create index if not exists idx_order_events_action on public.order_events(action);
alter table public.order_events enable row level security;
drop policy if exists order_events_select_own_or_admin on public.order_events;
create policy order_events_select_own_or_admin
on public.order_events
for select
using (
  public.is_admin()
  or exists (
    select 1
    from public.orders o
    where o.id = order_events.order_id
      and o.customer_auth_user_id = auth.uid()
  )
);
drop policy if exists order_events_insert_admin on public.order_events;
create policy order_events_insert_admin
on public.order_events
for insert
with check (public.is_admin());
drop policy if exists order_events_delete_admin on public.order_events;
create policy order_events_delete_admin
on public.order_events
for delete
using (public.is_admin());
create table if not exists public.reviews (
  id uuid primary key default gen_random_uuid(),
  menu_item_id text not null references public.menu_items(id) on delete cascade,
  customer_auth_user_id uuid not null references auth.users(id) on delete cascade,
  rating integer not null check (rating >= 1 and rating <= 5),
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
drop trigger if exists trg_reviews_updated_at on public.reviews;
create trigger trg_reviews_updated_at
before update on public.reviews
for each row execute function public.set_updated_at();
create index if not exists idx_reviews_item_created on public.reviews(menu_item_id, created_at desc);
create index if not exists idx_reviews_user_created on public.reviews(customer_auth_user_id, created_at desc);
alter table public.reviews enable row level security;
drop policy if exists reviews_select_all on public.reviews;
create policy reviews_select_all
on public.reviews
for select
using (true);
drop policy if exists reviews_insert_authenticated on public.reviews;
create policy reviews_insert_authenticated
on public.reviews
for insert
with check (auth.uid() = customer_auth_user_id);
drop policy if exists reviews_update_own_or_admin on public.reviews;
create policy reviews_update_own_or_admin
on public.reviews
for update
using (auth.uid() = customer_auth_user_id or public.is_admin())
with check (auth.uid() = customer_auth_user_id or public.is_admin());
drop policy if exists reviews_delete_own_or_admin on public.reviews;
create policy reviews_delete_own_or_admin
on public.reviews
for delete
using (auth.uid() = customer_auth_user_id or public.is_admin());
create table if not exists public.ads (
  id text primary key,
  status text,
  display_order integer,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
drop trigger if exists trg_ads_updated_at on public.ads;
create trigger trg_ads_updated_at
before update on public.ads
for each row execute function public.set_updated_at();
create index if not exists idx_ads_status on public.ads(status);
create index if not exists idx_ads_display_order on public.ads(display_order);
alter table public.ads enable row level security;
drop policy if exists ads_select_all on public.ads;
create policy ads_select_all
on public.ads
for select
using (true);
drop policy if exists ads_write_admin on public.ads;
create policy ads_write_admin
on public.ads
for all
using (public.is_admin())
with check (public.is_admin());
create table if not exists public.challenges (
  id uuid primary key,
  status text,
  end_date date,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
drop trigger if exists trg_challenges_updated_at on public.challenges;
create trigger trg_challenges_updated_at
before update on public.challenges
for each row execute function public.set_updated_at();
create index if not exists idx_challenges_status on public.challenges(status);
create index if not exists idx_challenges_end_date on public.challenges(end_date);
alter table public.challenges enable row level security;
drop policy if exists challenges_select_all on public.challenges;
create policy challenges_select_all
on public.challenges
for select
using (true);
drop policy if exists challenges_write_admin on public.challenges;
create policy challenges_write_admin
on public.challenges
for all
using (public.is_admin())
with check (public.is_admin());
create table if not exists public.user_challenge_progress (
  id uuid primary key default gen_random_uuid(),
  customer_auth_user_id uuid not null references auth.users(id) on delete cascade,
  challenge_id uuid not null references public.challenges(id) on delete cascade,
  is_completed boolean not null default false,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
drop trigger if exists trg_user_challenge_progress_updated_at on public.user_challenge_progress;
create trigger trg_user_challenge_progress_updated_at
before update on public.user_challenge_progress
for each row execute function public.set_updated_at();
create index if not exists idx_ucp_user_challenge on public.user_challenge_progress(customer_auth_user_id, challenge_id);
create index if not exists idx_ucp_completed on public.user_challenge_progress(is_completed);
alter table public.user_challenge_progress enable row level security;
drop policy if exists ucp_select_own_or_admin on public.user_challenge_progress;
create policy ucp_select_own_or_admin
on public.user_challenge_progress
for select
using (customer_auth_user_id = auth.uid() or public.is_admin());
drop policy if exists ucp_insert_own on public.user_challenge_progress;
create policy ucp_insert_own
on public.user_challenge_progress
for insert
with check (customer_auth_user_id = auth.uid());
drop policy if exists ucp_update_own_or_admin on public.user_challenge_progress;
create policy ucp_update_own_or_admin
on public.user_challenge_progress
for update
using (customer_auth_user_id = auth.uid() or public.is_admin())
with check (customer_auth_user_id = auth.uid() or public.is_admin());
drop policy if exists ucp_delete_admin on public.user_challenge_progress;
create policy ucp_delete_admin
on public.user_challenge_progress
for delete
using (public.is_admin());
create table if not exists public.stock_management (
  item_id text primary key references public.menu_items(id) on delete cascade,
  available_quantity numeric not null default 0,
  reserved_quantity numeric not null default 0,
  unit text not null default 'piece',
  low_stock_threshold numeric not null default 5,
  last_updated timestamptz not null default now(),
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
drop trigger if exists trg_stock_management_updated_at on public.stock_management;
create trigger trg_stock_management_updated_at
before update on public.stock_management
for each row execute function public.set_updated_at();
create index if not exists idx_stock_management_last_updated on public.stock_management(last_updated desc);
alter table public.stock_management enable row level security;
drop policy if exists stock_management_admin_only on public.stock_management;
create policy stock_management_admin_only
on public.stock_management
for all
using (public.is_admin())
with check (public.is_admin());
create table if not exists public.stock_history (
  id uuid primary key default gen_random_uuid(),
  item_id text not null references public.menu_items(id) on delete cascade,
  date date not null,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists idx_stock_history_item_date on public.stock_history(item_id, date desc);
alter table public.stock_history enable row level security;
drop policy if exists stock_history_admin_only on public.stock_history;
create policy stock_history_admin_only
on public.stock_history
for all
using (public.is_admin())
with check (public.is_admin());
create table if not exists public.price_history (
  id uuid primary key default gen_random_uuid(),
  item_id text not null references public.menu_items(id) on delete cascade,
  date date not null,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists idx_price_history_item_date on public.price_history(item_id, date desc);
alter table public.price_history enable row level security;
drop policy if exists price_history_admin_only on public.price_history;
create policy price_history_admin_only
on public.price_history
for all
using (public.is_admin())
with check (public.is_admin());
create table if not exists public.app_settings (
  id text primary key default 'singleton',
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
drop trigger if exists trg_app_settings_updated_at on public.app_settings;
create trigger trg_app_settings_updated_at
before update on public.app_settings
for each row execute function public.set_updated_at();
alter table public.app_settings enable row level security;
drop policy if exists app_settings_read_public on public.app_settings;
create policy app_settings_read_public
on public.app_settings
for select
using (true);
drop policy if exists app_settings_write_admin on public.app_settings;
create policy app_settings_write_admin
on public.app_settings
for all
using (public.is_admin())
with check (public.is_admin());
create table if not exists public.item_categories (
  id uuid primary key default gen_random_uuid(),
  key text unique not null,
  is_active boolean not null default true,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
drop trigger if exists trg_item_categories_updated_at on public.item_categories;
create trigger trg_item_categories_updated_at
before update on public.item_categories
for each row execute function public.set_updated_at();
alter table public.item_categories enable row level security;
drop policy if exists item_categories_select_all on public.item_categories;
create policy item_categories_select_all
on public.item_categories
for select
using (true);
drop policy if exists item_categories_write_admin on public.item_categories;
create policy item_categories_write_admin
on public.item_categories
for all
using (public.is_admin())
with check (public.is_admin());
create table if not exists public.unit_types (
  id uuid primary key default gen_random_uuid(),
  key text unique not null,
  is_active boolean not null default true,
  is_weight_based boolean not null default false,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
drop trigger if exists trg_unit_types_updated_at on public.unit_types;
create trigger trg_unit_types_updated_at
before update on public.unit_types
for each row execute function public.set_updated_at();
alter table public.unit_types enable row level security;
drop policy if exists unit_types_select_all on public.unit_types;
create policy unit_types_select_all
on public.unit_types
for select
using (true);
drop policy if exists unit_types_write_admin on public.unit_types;
create policy unit_types_write_admin
on public.unit_types
for all
using (public.is_admin())
with check (public.is_admin());
create table if not exists public.freshness_levels (
  id uuid primary key default gen_random_uuid(),
  key text unique not null,
  is_active boolean not null default true,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
drop trigger if exists trg_freshness_levels_updated_at on public.freshness_levels;
create trigger trg_freshness_levels_updated_at
before update on public.freshness_levels
for each row execute function public.set_updated_at();
alter table public.freshness_levels enable row level security;
drop policy if exists freshness_levels_select_all on public.freshness_levels;
create policy freshness_levels_select_all
on public.freshness_levels
for select
using (true);
drop policy if exists freshness_levels_write_admin on public.freshness_levels;
create policy freshness_levels_write_admin
on public.freshness_levels
for all
using (public.is_admin())
with check (public.is_admin());
create table if not exists public.banks (
  id text primary key,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
drop trigger if exists trg_banks_updated_at on public.banks;
create trigger trg_banks_updated_at
before update on public.banks
for each row execute function public.set_updated_at();
alter table public.banks enable row level security;
drop policy if exists banks_select_all on public.banks;
create policy banks_select_all
on public.banks
for select
using (true);
drop policy if exists banks_write_admin on public.banks;
create policy banks_write_admin
on public.banks
for all
using (public.is_admin())
with check (public.is_admin());
create table if not exists public.transfer_recipients (
  id text primary key,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
drop trigger if exists trg_transfer_recipients_updated_at on public.transfer_recipients;
create trigger trg_transfer_recipients_updated_at
before update on public.transfer_recipients
for each row execute function public.set_updated_at();
alter table public.transfer_recipients enable row level security;
drop policy if exists transfer_recipients_select_all on public.transfer_recipients;
create policy transfer_recipients_select_all
on public.transfer_recipients
for select
using (true);
drop policy if exists transfer_recipients_write_admin on public.transfer_recipients;
create policy transfer_recipients_write_admin
on public.transfer_recipients
for all
using (public.is_admin())
with check (public.is_admin());
