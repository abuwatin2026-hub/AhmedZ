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
alter table public.stock_management enable row level security;
drop policy if exists stock_management_admin_only on public.stock_management;
create policy stock_management_admin_only
on public.stock_management
for all
using (public.is_admin())
with check (public.is_admin());
alter table public.stock_history enable row level security;
drop policy if exists stock_history_admin_only on public.stock_history;
create policy stock_history_admin_only
on public.stock_history
for all
using (public.is_admin())
with check (public.is_admin());
alter table public.price_history enable row level security;
drop policy if exists price_history_admin_only on public.price_history;
create policy price_history_admin_only
on public.price_history
for all
using (public.is_admin())
with check (public.is_admin());
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
insert into storage.buckets (id, name, public)
values ('menu-images', 'menu-images', true)
on conflict (id) do update set name = excluded.name, public = excluded.public;
-- The following lines are commented out or removed because they require superuser/owner permissions on storage schema
-- alter table storage.objects enable row level security;
-- drop policy if exists "Public Access Menu Images" on storage.objects;
-- create policy "Public Access Menu Images" ...;
