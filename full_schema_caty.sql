-- ملف: full_schema.sql
-- الوصف: إنشاء كافة الجداول والصلاحيات لنظام AZTA على Supabase
-- تعليمات الاستخدام:
-- 1. اذهب إلى Supabase Dashboard -> SQL Editor
-- 2. انسخ محتوى هذا الملف بالكامل
-- 3. اضغط Run
-- 4. بعد الانتهاء، قم بإنشاء مستخدم المالك يدوياً من قائمة Authentication -> Users
-- 5. انسخ User UID للمستخدم الجديد ونفذ أمر Insert الموجود في نهاية الملف (بعد تعديل الـ UID)

-- ==========================================
-- 1. تنظيف (اختياري - احذر عند الاستخدام في الإنتاج)
-- ==========================================
-- DROP TABLE IF EXISTS public.order_events;
-- DROP TABLE IF EXISTS public.orders;
-- DROP TABLE IF EXISTS public.cart_items; -- إذا كان مفصولاً
-- DROP TABLE IF EXISTS public.menu_items;
-- DROP TABLE IF EXISTS public.customers;
-- DROP TABLE IF EXISTS public.reviews;
-- DROP TABLE IF EXISTS public.coupons;
-- DROP TABLE IF EXISTS public.addons;
-- DROP TABLE IF EXISTS public.ads;
-- DROP TABLE IF EXISTS public.stock_management;
-- DROP TABLE IF EXISTS public.stock_history;
-- DROP TABLE IF EXISTS public.price_history;
-- DROP TABLE IF EXISTS public.delivery_zones;
-- DROP TABLE IF EXISTS public.admin_users;
-- DROP TABLE IF EXISTS public.app_settings;
-- DROP TABLE IF EXISTS public.item_categories;
-- DROP TABLE IF EXISTS public.unit_types;
-- DROP TABLE IF EXISTS public.freshness_levels;

-- ==========================================
-- 2. إنشاء الجداول (Tables)
-- ==========================================

-- 2.1 جدول عناصر القائمة (Menu Items)
create table if not exists public.menu_items (
  id text primary key,
  data jsonb not null, -- يخزن كل بيانات الصنف كـ JSON
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- 2.2 جدول الطلبات (Orders)
create table if not exists public.orders (
  id text primary key,
  user_id text, -- يمكن أن يكون null للزوار
  status text not null,
  total numeric not null,
  data jsonb not null, -- يخزن تفاصيل الطلب كاملة
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- 2.3 جدول سجل أحداث الطلبات (Order Events / Audit)
create table if not exists public.order_events (
  id text primary key,
  order_id text references public.orders(id) on delete cascade,
  action text not null,
  actor_type text not null,
  actor_id text,
  payload jsonb,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- 2.4 جدول العملاء (Customers)
create table if not exists public.customers (
  id text primary key, -- عادة يطابق auth.users.id
  phone_number text,
  email text,
  full_name text,
  data jsonb, -- لتخزين النقاط، العنوان، الخ
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- 2.5 جدول المراجعات (Reviews)
create table if not exists public.reviews (
  id text primary key,
  menu_item_id text references public.menu_items(id) on delete cascade,
  user_id text references public.customers(id) on delete set null,
  rating integer not null check (rating >= 1 and rating <= 5),
  comment text,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- 2.6 جدول الكوبونات (Coupons)
create table if not exists public.coupons (
  id text primary key,
  code text unique not null,
  type text not null, -- percentage / fixed
  value numeric not null,
  data jsonb, -- قيود الاستخدام، تاريخ الانتهاء
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- 2.7 جدول الإضافات (Addons)
create table if not exists public.addons (
  id text primary key,
  name text not null,
  price numeric not null,
  data jsonb,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- 2.8 جدول الإعلانات (Ads)
create table if not exists public.ads (
  id text primary key,
  title text,
  image_url text,
  status text default 'active',
  data jsonb,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- 2.9 إدارة المخزون (Stock Management)
create table if not exists public.stock_management (
  id text primary key, -- عادة يطابق menu_items.id
  item_id text references public.menu_items(id) on delete cascade,
  available_quantity numeric default 0,
  unit text,
  reserved_quantity numeric default 0,
  last_updated timestamp with time zone default timezone('utc'::text, now()) not null
);

-- 2.10 سجل المخزون (Stock History)
create table if not exists public.stock_history (
  id text primary key,
  item_id text references public.menu_items(id) on delete cascade,
  quantity numeric,
  unit text,
  reason text,
  changed_by text,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- 2.11 سجل الأسعار (Price History)
create table if not exists public.price_history (
  id text primary key,
  item_id text references public.menu_items(id) on delete cascade,
  price numeric,
  reason text,
  changed_by text,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- 2.12 مناطق التوصيل (Delivery Zones)
create table if not exists public.delivery_zones (
  id text primary key,
  name text,
  delivery_fee numeric,
  is_active boolean default true,
  data jsonb, -- الاحداثيات
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- 2.13 إعدادات التطبيق (App Settings)
create table if not exists public.app_settings (
  id text primary key, -- عادة صف واحد 'app'
  settings jsonb not null,
  updated_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- 2.14 المستخدمين المسؤولين (Admin Users)
-- هذا الجدول يربط بين Supabase Auth وجدول المسؤولين الداخلي
create table if not exists public.admin_users (
  auth_user_id uuid primary key references auth.users(id) on delete cascade,
  username text unique,
  full_name text,
  role text, -- owner, employee, delivery
  permissions text[], -- مصفوفة صلاحيات
  is_active boolean default true,
  email text,
  phone_number text,
  avatar_url text,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  updated_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- ==========================================
-- 3. تفعيل الحماية (Row Level Security - RLS)
-- ==========================================

alter table public.menu_items enable row level security;
alter table public.orders enable row level security;
alter table public.order_events enable row level security;
alter table public.customers enable row level security;
alter table public.reviews enable row level security;
alter table public.coupons enable row level security;
alter table public.addons enable row level security;
alter table public.ads enable row level security;
alter table public.stock_management enable row level security;
alter table public.stock_history enable row level security;
alter table public.price_history enable row level security;
alter table public.delivery_zones enable row level security;
alter table public.app_settings enable row level security;
alter table public.admin_users enable row level security;

-- ==========================================
-- 4. سياسات الوصول (Policies)
-- ==========================================

-- 4.1 سياسات Menu Items
create policy "Public read menu" on public.menu_items for select using (true);
create policy "Admin manage menu" on public.menu_items for all using (
  exists (select 1 from public.admin_users where auth_user_id = auth.uid() and is_active = true)
);

-- 4.2 سياسات Orders
-- العميل يرى طلباته فقط، المسؤول يرى كل الطلبات
create policy "Users see own orders" on public.orders for select using (
  auth.uid()::text = user_id
);
create policy "Users create orders" on public.orders for insert with check (
  auth.uid()::text = user_id OR user_id is null -- السماح للزوار بإنشاء طلبات
);
create policy "Admin manage orders" on public.orders for all using (
  exists (select 1 from public.admin_users where auth_user_id = auth.uid() and is_active = true)
);

-- 4.3 سياسات Order Events
create policy "Admin view events" on public.order_events for select using (
  exists (select 1 from public.admin_users where auth_user_id = auth.uid() and is_active = true)
);
create policy "Admin create events" on public.order_events for insert with check (
  exists (select 1 from public.admin_users where auth_user_id = auth.uid() and is_active = true)
);

-- 4.4 سياسات Admin Users
-- الجميع يقرأ (للتحقق عند الدخول)، المالك فقط يعدل
create policy "Public read admins" on public.admin_users for select using (true);
create policy "Owner manage admins" on public.admin_users for all using (
  exists (select 1 from public.admin_users where auth_user_id = auth.uid() and role = 'owner')
);
-- السماح للمستخدم بتعديل بياناته الشخصية
create policy "Self update profile" on public.admin_users for update using (
  auth_user_id = auth.uid()
);

-- 4.5 سياسات App Settings
create policy "Public read settings" on public.app_settings for select using (true);
create policy "Admin update settings" on public.app_settings for all using (
  exists (select 1 from public.admin_users where auth_user_id = auth.uid() and role = 'owner')
);

-- 4.6 سياسات عامة للقراءة فقط للعامة (أو للمسؤولين للكتابة)
-- Coupons
create policy "Public read coupons" on public.coupons for select using (true);
create policy "Admin manage coupons" on public.coupons for all using (
  exists (select 1 from public.admin_users where auth_user_id = auth.uid() and is_active = true)
);

-- Addons
create policy "Public read addons" on public.addons for select using (true);
create policy "Admin manage addons" on public.addons for all using (
  exists (select 1 from public.admin_users where auth_user_id = auth.uid() and is_active = true)
);

-- Ads
create policy "Public read ads" on public.ads for select using (true);
create policy "Admin manage ads" on public.ads for all using (
  exists (select 1 from public.admin_users where auth_user_id = auth.uid() and is_active = true)
);

-- Delivery Zones
create policy "Public read zones" on public.delivery_zones for select using (true);
create policy "Admin manage zones" on public.delivery_zones for all using (
  exists (select 1 from public.admin_users where auth_user_id = auth.uid() and is_active = true)
);

-- Stock Management
create policy "Public read stock" on public.stock_management for select using (true);
create policy "Admin manage stock" on public.stock_management for all using (
  exists (select 1 from public.admin_users where auth_user_id = auth.uid() and is_active = true)
);

-- ==========================================
-- 5. إعداد التخزين (Storage Buckets) - اختياري
-- ==========================================
insert into storage.buckets (id, name, public) 
values ('menu-images', 'menu-images', true)
on conflict (id) do nothing;

create policy "Public Access Menu Images" on storage.objects for select using ( bucket_id = 'menu-images' );
create policy "Admin Upload Menu Images" on storage.objects for insert with check (
  bucket_id = 'menu-images' 
  and exists (select 1 from public.admin_users where auth_user_id = auth.uid() and is_active = true)
);

-- ==========================================
-- 6. خطوة ما بعد التنفيذ (يدوية)
-- ==========================================
