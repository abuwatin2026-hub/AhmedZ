with new_row as (
  select gen_random_uuid() as id
)
insert into public.item_categories (id, key, data, is_active)
select
  n.id,
  'grocery',
  jsonb_build_object(
    'id', n.id::text,
    'key', 'grocery',
    'name', jsonb_build_object('ar', 'مواد غذائية', 'en', 'Groceries'),
    'isActive', true,
    'createdAt', now()::text,
    'updatedAt', now()::text
  ),
  true
from new_row n
on conflict (key) do update
set data = jsonb_set(excluded.data, '{id}', to_jsonb(public.item_categories.id::text), true),
    is_active = excluded.is_active;

with new_row as (
  select gen_random_uuid() as id
)
insert into public.item_categories (id, key, data, is_active)
select
  n.id,
  'beverages',
  jsonb_build_object(
    'id', n.id::text,
    'key', 'beverages',
    'name', jsonb_build_object('ar', 'مشروبات', 'en', 'Beverages'),
    'isActive', true,
    'createdAt', now()::text,
    'updatedAt', now()::text
  ),
  true
from new_row n
on conflict (key) do update
set data = jsonb_set(excluded.data, '{id}', to_jsonb(public.item_categories.id::text), true),
    is_active = excluded.is_active;

with new_row as (
  select gen_random_uuid() as id
)
insert into public.item_categories (id, key, data, is_active)
select
  n.id,
  'cleaning',
  jsonb_build_object(
    'id', n.id::text,
    'key', 'cleaning',
    'name', jsonb_build_object('ar', 'منظفات', 'en', 'Cleaning'),
    'isActive', true,
    'createdAt', now()::text,
    'updatedAt', now()::text
  ),
  true
from new_row n
on conflict (key) do update
set data = jsonb_set(excluded.data, '{id}', to_jsonb(public.item_categories.id::text), true),
    is_active = excluded.is_active;

with new_row as (
  select gen_random_uuid() as id
)
insert into public.item_categories (id, key, data, is_active)
select
  n.id,
  'snacks',
  jsonb_build_object(
    'id', n.id::text,
    'key', 'snacks',
    'name', jsonb_build_object('ar', 'تسالي', 'en', 'Snacks'),
    'isActive', true,
    'createdAt', now()::text,
    'updatedAt', now()::text
  ),
  true
from new_row n
on conflict (key) do update
set data = jsonb_set(excluded.data, '{id}', to_jsonb(public.item_categories.id::text), true),
    is_active = excluded.is_active;

insert into public.unit_types (key, data, is_active, is_weight_based)
values
(
  'kg',
  jsonb_build_object(
    'id', 'unit-kg',
    'key', 'kg',
    'label', jsonb_build_object('ar', 'كجم', 'en', 'kg'),
    'isActive', true,
    'isWeightBased', true,
    'createdAt', now()::text,
    'updatedAt', now()::text
  ),
  true,
  true
),
(
  'gram',
  jsonb_build_object(
    'id', 'unit-gram',
    'key', 'gram',
    'label', jsonb_build_object('ar', 'جرام', 'en', 'g'),
    'isActive', true,
    'isWeightBased', true,
    'createdAt', now()::text,
    'updatedAt', now()::text
  ),
  true,
  true
),
(
  'piece',
  jsonb_build_object(
    'id', 'unit-piece',
    'key', 'piece',
    'label', jsonb_build_object('ar', 'حبة', 'en', 'pc'),
    'isActive', true,
    'isWeightBased', false,
    'createdAt', now()::text,
    'updatedAt', now()::text
  ),
  true,
  false
),
(
  'bundle',
  jsonb_build_object(
    'id', 'unit-bundle',
    'key', 'bundle',
    'label', jsonb_build_object('ar', 'كرتون', 'en', 'carton'),
    'isActive', true,
    'isWeightBased', false,
    'createdAt', now()::text,
    'updatedAt', now()::text
  ),
  true,
  false
)
on conflict (key) do update
set data = excluded.data,
    is_active = excluded.is_active,
    is_weight_based = excluded.is_weight_based;

insert into public.freshness_levels (key, data, is_active)
values
(
  'fresh',
  jsonb_build_object(
    'id', 'fresh-fresh',
    'key', 'fresh',
    'label', jsonb_build_object('ar', 'طازج', 'en', 'Fresh'),
    'isActive', true,
    'tone', 'green',
    'createdAt', now()::text,
    'updatedAt', now()::text
  ),
  true
),
(
  'good',
  jsonb_build_object(
    'id', 'fresh-good',
    'key', 'good',
    'label', jsonb_build_object('ar', 'جيد', 'en', 'Good'),
    'isActive', true,
    'tone', 'blue',
    'createdAt', now()::text,
    'updatedAt', now()::text
  ),
  true
),
(
  'acceptable',
  jsonb_build_object(
    'id', 'fresh-acceptable',
    'key', 'acceptable',
    'label', jsonb_build_object('ar', 'مقبول', 'en', 'OK'),
    'isActive', true,
    'tone', 'yellow',
    'createdAt', now()::text,
    'updatedAt', now()::text
  ),
  true
)
on conflict (key) do update
set data = excluded.data,
    is_active = excluded.is_active;

insert into public.delivery_zones(id, name, is_active, delivery_fee, data)
values (
  'a0a0a0a0-0000-0000-0000-000000000001'::uuid,
  'منطقة تجريبية',
  true,
  300,
  jsonb_build_object(
    'id', 'a0a0a0a0-0000-0000-0000-000000000001',
    'name', 'منطقة تجريبية',
    'coordinates', jsonb_build_object('lat', 15.0, 'lng', 44.0, 'radius', 100000)
  )
)
on conflict (id) do update
set name = excluded.name,
    is_active = excluded.is_active,
    delivery_fee = excluded.delivery_fee,
    data = excluded.data;

insert into public.menu_items(id, category, is_featured, unit_type, freshness_level, status, data, cost_price)
values
(
  'rice-bag-10kg',
  'grocery',
  true,
  'piece',
  'good',
  'active',
  jsonb_build_object(
    'id', 'rice-bag-10kg',
    'name', jsonb_build_object('ar', 'أرز بسمتي 10 كجم', 'en', 'Basmati Rice 10kg'),
    'description', jsonb_build_object('ar', 'جودة ممتازة للتجزئة والجملة.', 'en', 'Premium quality for retail and wholesale.'),
    'price', 14500,
    'isActive', true
  ),
  12800
),
(
  'water-pack-24',
  'beverages',
  false,
  'piece',
  'fresh',
  'active',
  jsonb_build_object(
    'id', 'water-pack-24',
    'name', jsonb_build_object('ar', 'مياه شرب (كرتون 24)', 'en', 'Drinking Water (24 pack)'),
    'description', jsonb_build_object('ar', 'مناسب للمتاجر والمطاعم.', 'en', 'Suitable for shops and restaurants.'),
    'price', 2200,
    'isActive', true
  ),
  1800
),
(
  'detergent-5l',
  'cleaning',
  false,
  'piece',
  'good',
  'active',
  jsonb_build_object(
    'id', 'detergent-5l',
    'name', jsonb_build_object('ar', 'سائل غسيل 5 لتر', 'en', 'Laundry Detergent 5L'),
    'description', jsonb_build_object('ar', 'تركيز عالي ورائحة ثابتة.', 'en', 'High concentration and long-lasting scent.'),
    'price', 5200,
    'isActive', true
  ),
  4300
)
on conflict (id) do update
set category = excluded.category,
    is_featured = excluded.is_featured,
    unit_type = excluded.unit_type,
    freshness_level = excluded.freshness_level,
    status = excluded.status,
    data = excluded.data,
    cost_price = excluded.cost_price;

insert into public.stock_management(item_id, warehouse_id, available_quantity, reserved_quantity, unit, low_stock_threshold, avg_cost, last_updated, data)
values
('rice-bag-10kg', (select id from public.warehouses where code = 'MAIN' limit 1), 25, 0, 'piece', 5, 12800, now(), '{}'::jsonb),
('water-pack-24', (select id from public.warehouses where code = 'MAIN' limit 1), 60, 0, 'piece', 10, 1800, now(), '{}'::jsonb),
('detergent-5l', (select id from public.warehouses where code = 'MAIN' limit 1), 40, 0, 'piece', 5, 4300, now(), '{}'::jsonb)
on conflict (item_id, warehouse_id) do update
set available_quantity = excluded.available_quantity,
    reserved_quantity = excluded.reserved_quantity,
    unit = excluded.unit,
    low_stock_threshold = excluded.low_stock_threshold,
    avg_cost = excluded.avg_cost,
    last_updated = excluded.last_updated,
    data = excluded.data;
