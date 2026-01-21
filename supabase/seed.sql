with new_row as (
  select gen_random_uuid() as id
)
insert into public.item_categories (id, key, data, is_active)
select
  n.id,
  'qat',
  jsonb_build_object(
    'id', n.id::text,
    'key', 'qat',
    'name', jsonb_build_object('ar', 'قات', 'en', 'Qat'),
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
    'label', jsonb_build_object('ar', 'حزمة', 'en', 'bundle'),
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
  jsonb_build_object('id', 'a0a0a0a0-0000-0000-0000-000000000001', 'name', 'منطقة تجريبية')
)
on conflict (id) do update
set name = excluded.name,
    is_active = excluded.is_active,
    delivery_fee = excluded.delivery_fee,
    data = excluded.data;

insert into public.menu_items(id, category, is_featured, unit_type, freshness_level, status, data, cost_price)
values
(
  'qat-bundle',
  'qat',
  true,
  'bundle',
  'fresh',
  'active',
  jsonb_build_object(
    'id', 'qat-bundle',
    'name', jsonb_build_object('ar', 'قات حزمة', 'en', 'Qat Bundle'),
    'price', 2500,
    'isActive', true
  ),
  1200
),
(
  'water-piece',
  'qat',
  false,
  'piece',
  'fresh',
  'active',
  jsonb_build_object(
    'id', 'water-piece',
    'name', jsonb_build_object('ar', 'ماء', 'en', 'Water'),
    'price', 300,
    'isActive', true
  ),
  150
),
(
  'qat-gram',
  'qat',
  false,
  'gram',
  'fresh',
  'active',
  jsonb_build_object(
    'id', 'qat-gram',
    'name', jsonb_build_object('ar', 'قات بالجرام', 'en', 'Qat (gram)'),
    'pricePerUnit', 8000,
    'isActive', true
  ),
  5
)
on conflict (id) do update
set category = excluded.category,
    is_featured = excluded.is_featured,
    unit_type = excluded.unit_type,
    freshness_level = excluded.freshness_level,
    status = excluded.status,
    data = excluded.data,
    cost_price = excluded.cost_price;

insert into public.stock_management(item_id, available_quantity, reserved_quantity, unit, low_stock_threshold, avg_cost, last_updated, data)
values
('qat-bundle', 50, 0, 'bundle', 5, 1200, now(), '{}'::jsonb),
('water-piece', 200, 0, 'piece', 20, 150, now(), '{}'::jsonb),
('qat-gram', 20000, 0, 'gram', 1000, 5, now(), '{}'::jsonb)
on conflict (item_id) do update
set available_quantity = excluded.available_quantity,
    reserved_quantity = excluded.reserved_quantity,
    unit = excluded.unit,
    low_stock_threshold = excluded.low_stock_threshold,
    avg_cost = excluded.avg_cost,
    last_updated = excluded.last_updated,
    data = excluded.data;

insert into public.orders(id, status, invoice_number, data, delivery_zone_id, created_at, updated_at)
values
(
  'b0b0b0b0-0000-0000-0000-000000000001'::uuid,
  'delivered',
  'INV-T-0001',
  jsonb_build_object(
    'currency', 'YER',
    'orderSource', 'online',
    'paymentMethod', 'cash',
    'deliveryZoneId', 'a0a0a0a0-0000-0000-0000-000000000001',
    'subtotal', 5900,
    'discountAmount', 0,
    'taxAmount', 295,
    'deliveryFee', 300,
    'total', 6495,
    'paidAt', (now() - interval '5 days' - interval '1 hour')::text,
    'deliveredAt', (now() - interval '5 days')::text,
    'items', jsonb_build_array(
      jsonb_build_object(
        'itemId', 'qat-bundle',
        'name', jsonb_build_object('ar', 'قات حزمة', 'en', 'Qat Bundle'),
        'unitType', 'bundle',
        'quantity', 2,
        'price', 2500,
        'pricePerUnit', 0,
        'weight', 0,
        'selectedAddons', '{}'::jsonb
      ),
      jsonb_build_object(
        'itemId', 'water-piece',
        'name', jsonb_build_object('ar', 'ماء', 'en', 'Water'),
        'unitType', 'piece',
        'quantity', 3,
        'price', 300,
        'pricePerUnit', 0,
        'weight', 0,
        'selectedAddons', '{}'::jsonb
      )
    )
  ),
  'a0a0a0a0-0000-0000-0000-000000000001'::uuid,
  (now() - interval '5 days' - interval '2 hours'),
  (now() - interval '5 days')
),
(
  'b0b0b0b0-0000-0000-0000-000000000002'::uuid,
  'delivered',
  'INV-T-0002',
  jsonb_build_object(
    'currency', 'YER',
    'orderSource', 'in_store',
    'paymentMethod', 'network',
    'deliveryZoneId', null,
    'subtotal', 2600,
    'discountAmount', 0,
    'taxAmount', 130,
    'deliveryFee', 0,
    'total', 2730,
    'paidAt', (now() - interval '4 days' + interval '2 hours')::text,
    'deliveredAt', (now() - interval '4 days')::text,
    'invoiceSnapshot', jsonb_build_object(
      'issuedAt', (now() - interval '4 days')::text,
      'items', jsonb_build_array(
        jsonb_build_object(
          'itemId', 'qat-gram',
          'name', jsonb_build_object('ar', 'قات بالجرام', 'en', 'Qat (gram)'),
          'unitType', 'gram',
          'quantity', 0,
          'price', 0,
          'pricePerUnit', 8000,
          'weight', 250,
          'selectedAddons', '{}'::jsonb
        ),
        jsonb_build_object(
          'itemId', 'water-piece',
          'name', jsonb_build_object('ar', 'ماء', 'en', 'Water'),
          'unitType', 'piece',
          'quantity', 2,
          'price', 300,
          'pricePerUnit', 0,
          'weight', 0,
          'selectedAddons', '{}'::jsonb
        )
      )
    ),
    'items', jsonb_build_array(
      jsonb_build_object(
        'itemId', 'qat-gram',
        'name', jsonb_build_object('ar', 'قات بالجرام', 'en', 'Qat (gram)'),
        'unitType', 'gram',
        'quantity', 0,
        'price', 0,
        'pricePerUnit', 8000,
        'weight', 250,
        'selectedAddons', '{}'::jsonb
      ),
      jsonb_build_object(
        'itemId', 'water-piece',
        'name', jsonb_build_object('ar', 'ماء', 'en', 'Water'),
        'unitType', 'piece',
        'quantity', 2,
        'price', 300,
        'pricePerUnit', 0,
        'weight', 0,
        'selectedAddons', '{}'::jsonb
      )
    )
  ),
  null,
  (now() - interval '4 days' - interval '3 hours'),
  (now() - interval '4 days')
),
(
  'b0b0b0b0-0000-0000-0000-000000000003'::uuid,
  'cancelled',
  'INV-T-0003',
  jsonb_build_object(
    'currency', 'YER',
    'orderSource', 'online',
    'paymentMethod', 'cash',
    'deliveryZoneId', 'a0a0a0a0-0000-0000-0000-000000000001',
    'subtotal', 2500,
    'discountAmount', 0,
    'taxAmount', 0,
    'deliveryFee', 0,
    'total', 2500,
    'paidAt', (now() - interval '2 days')::text,
    'items', jsonb_build_array(
      jsonb_build_object(
        'itemId', 'qat-bundle',
        'name', jsonb_build_object('ar', 'قات حزمة', 'en', 'Qat Bundle'),
        'unitType', 'bundle',
        'quantity', 1,
        'price', 2500,
        'pricePerUnit', 0,
        'weight', 0,
        'selectedAddons', '{}'::jsonb
      )
    )
  ),
  'a0a0a0a0-0000-0000-0000-000000000001'::uuid,
  (now() - interval '2 days' - interval '1 hour'),
  (now() - interval '2 days' - interval '1 hour')
),
(
  'b0b0b0b0-0000-0000-0000-000000000004'::uuid,
  'delivered',
  'INV-T-0004',
  jsonb_build_object(
    'currency', 'YER',
    'orderSource', 'online',
    'paymentMethod', 'cash',
    'deliveryZoneId', 'a0a0a0a0-0000-0000-0000-000000000001',
    'subtotal', 4000,
    'discountAmount', 200,
    'taxAmount', 200,
    'deliveryFee', 500,
    'total', 4500,
    'paidAt', (now() - interval '3 days' + interval '3 hours')::text,
    'deliveredAt', (now() - interval '3 days')::text,
    'items', jsonb_build_array(
      jsonb_build_object(
        'itemId', 'qat-bundle',
        'name', jsonb_build_object('ar', 'قات حزمة', 'en', 'Qat Bundle'),
        'unitType', 'bundle',
        'quantity', 1,
        'price', 2500,
        'pricePerUnit', 0,
        'weight', 0,
        'selectedAddons', '{}'::jsonb
      ),
      jsonb_build_object(
        'itemId', 'water-piece',
        'name', jsonb_build_object('ar', 'ماء', 'en', 'Water'),
        'unitType', 'piece',
        'quantity', 5,
        'price', 300,
        'pricePerUnit', 0,
        'weight', 0,
        'selectedAddons', '{}'::jsonb
      )
    )
  ),
  'a0a0a0a0-0000-0000-0000-000000000001'::uuid,
  (now() - interval '3 days' - interval '2 hours'),
  (now() - interval '3 days')
)
on conflict (id) do nothing;

insert into public.payments(id, direction, method, amount, currency, reference_table, reference_id, occurred_at, created_by, data)
values
(
  'c0c0c0c0-0000-0000-0000-000000000001'::uuid,
  'in',
  'cash',
  6495,
  'YER',
  'orders',
  'b0b0b0b0-0000-0000-0000-000000000001',
  (now() - interval '5 days' - interval '1 hour'),
  null,
  jsonb_build_object('orderId', 'b0b0b0b0-0000-0000-0000-000000000001')
),
(
  'c0c0c0c0-0000-0000-0000-000000000002'::uuid,
  'in',
  'network',
  2730,
  'YER',
  'orders',
  'b0b0b0b0-0000-0000-0000-000000000002',
  (now() - interval '4 days' + interval '2 hours'),
  null,
  jsonb_build_object('orderId', 'b0b0b0b0-0000-0000-0000-000000000002')
),
(
  'c0c0c0c0-0000-0000-0000-000000000003'::uuid,
  'in',
  'cash',
  2500,
  'YER',
  'orders',
  'b0b0b0b0-0000-0000-0000-000000000003',
  (now() - interval '2 days'),
  null,
  jsonb_build_object('orderId', 'b0b0b0b0-0000-0000-0000-000000000003')
),
(
  'c0c0c0c0-0000-0000-0000-000000000004'::uuid,
  'in',
  'cash',
  2000,
  'YER',
  'orders',
  'b0b0b0b0-0000-0000-0000-000000000004',
  (now() - interval '3 days' - interval '1 hour'),
  null,
  jsonb_build_object('orderId', 'b0b0b0b0-0000-0000-0000-000000000004')
),
(
  'c0c0c0c0-0000-0000-0000-000000000005'::uuid,
  'in',
  'network',
  2500,
  'YER',
  'orders',
  'b0b0b0b0-0000-0000-0000-000000000004',
  (now() - interval '3 days' + interval '3 hours'),
  null,
  jsonb_build_object('orderId', 'b0b0b0b0-0000-0000-0000-000000000004')
)
on conflict (id) do nothing;

select public.post_order_delivery('b0b0b0b0-0000-0000-0000-000000000001'::uuid);
select public.post_order_delivery('b0b0b0b0-0000-0000-0000-000000000002'::uuid);
select public.post_order_delivery('b0b0b0b0-0000-0000-0000-000000000004'::uuid);

update public.stock_management
set available_quantity = greatest(0, available_quantity - 2)
where item_id = 'qat-bundle';
update public.stock_management
set available_quantity = greatest(0, available_quantity - 3)
where item_id = 'water-piece';

insert into public.order_item_cogs(id, order_id, item_id, quantity, unit_cost, total_cost, created_at)
values
(
  'd0d0d0d0-0000-0000-0000-000000000001'::uuid,
  'b0b0b0b0-0000-0000-0000-000000000001'::uuid,
  'qat-bundle',
  2,
  1200,
  2400,
  (now() - interval '5 days')
),
(
  'd0d0d0d0-0000-0000-0000-000000000002'::uuid,
  'b0b0b0b0-0000-0000-0000-000000000001'::uuid,
  'water-piece',
  3,
  150,
  450,
  (now() - interval '5 days')
)
on conflict (id) do nothing;

insert into public.inventory_movements(id, item_id, movement_type, quantity, unit_cost, total_cost, reference_table, reference_id, occurred_at, created_by, data)
values
(
  'e0e0e0e0-0000-0000-0000-000000000001'::uuid,
  'qat-bundle',
  'sale_out',
  2,
  1200,
  2400,
  'orders',
  'b0b0b0b0-0000-0000-0000-000000000001',
  (now() - interval '5 days'),
  null,
  jsonb_build_object('orderId', 'b0b0b0b0-0000-0000-0000-000000000001')
),
(
  'e0e0e0e0-0000-0000-0000-000000000002'::uuid,
  'water-piece',
  'sale_out',
  3,
  150,
  450,
  'orders',
  'b0b0b0b0-0000-0000-0000-000000000001',
  (now() - interval '5 days'),
  null,
  jsonb_build_object('orderId', 'b0b0b0b0-0000-0000-0000-000000000001')
)
on conflict (id) do nothing;

update public.stock_management
set available_quantity = greatest(0, available_quantity - 250)
where item_id = 'qat-gram';
update public.stock_management
set available_quantity = greatest(0, available_quantity - 2)
where item_id = 'water-piece';

insert into public.order_item_cogs(id, order_id, item_id, quantity, unit_cost, total_cost, created_at)
values
(
  'd0d0d0d0-0000-0000-0000-000000000003'::uuid,
  'b0b0b0b0-0000-0000-0000-000000000002'::uuid,
  'qat-gram',
  250,
  5,
  1250,
  (now() - interval '4 days')
),
(
  'd0d0d0d0-0000-0000-0000-000000000004'::uuid,
  'b0b0b0b0-0000-0000-0000-000000000002'::uuid,
  'water-piece',
  2,
  150,
  300,
  (now() - interval '4 days')
)
on conflict (id) do nothing;

insert into public.inventory_movements(id, item_id, movement_type, quantity, unit_cost, total_cost, reference_table, reference_id, occurred_at, created_by, data)
values
(
  'e0e0e0e0-0000-0000-0000-000000000003'::uuid,
  'qat-gram',
  'sale_out',
  250,
  5,
  1250,
  'orders',
  'b0b0b0b0-0000-0000-0000-000000000002',
  (now() - interval '4 days'),
  null,
  jsonb_build_object('orderId', 'b0b0b0b0-0000-0000-0000-000000000002')
),
(
  'e0e0e0e0-0000-0000-0000-000000000004'::uuid,
  'water-piece',
  'sale_out',
  2,
  150,
  300,
  'orders',
  'b0b0b0b0-0000-0000-0000-000000000002',
  (now() - interval '4 days'),
  null,
  jsonb_build_object('orderId', 'b0b0b0b0-0000-0000-0000-000000000002')
)
on conflict (id) do nothing;

update public.stock_management
set available_quantity = greatest(0, available_quantity - 1)
where item_id = 'qat-bundle';
update public.stock_management
set available_quantity = greatest(0, available_quantity - 5)
where item_id = 'water-piece';

insert into public.order_item_cogs(id, order_id, item_id, quantity, unit_cost, total_cost, created_at)
values
(
  'd0d0d0d0-0000-0000-0000-000000000005'::uuid,
  'b0b0b0b0-0000-0000-0000-000000000004'::uuid,
  'qat-bundle',
  1,
  1200,
  1200,
  (now() - interval '3 days')
),
(
  'd0d0d0d0-0000-0000-0000-000000000006'::uuid,
  'b0b0b0b0-0000-0000-0000-000000000004'::uuid,
  'water-piece',
  5,
  150,
  750,
  (now() - interval '3 days')
)
on conflict (id) do nothing;

insert into public.inventory_movements(id, item_id, movement_type, quantity, unit_cost, total_cost, reference_table, reference_id, occurred_at, created_by, data)
values
(
  'e0e0e0e0-0000-0000-0000-000000000005'::uuid,
  'qat-bundle',
  'sale_out',
  1,
  1200,
  1200,
  'orders',
  'b0b0b0b0-0000-0000-0000-000000000004',
  (now() - interval '3 days'),
  null,
  jsonb_build_object('orderId', 'b0b0b0b0-0000-0000-0000-000000000004')
),
(
  'e0e0e0e0-0000-0000-0000-000000000006'::uuid,
  'water-piece',
  'sale_out',
  5,
  150,
  750,
  'orders',
  'b0b0b0b0-0000-0000-0000-000000000004',
  (now() - interval '3 days'),
  null,
  jsonb_build_object('orderId', 'b0b0b0b0-0000-0000-0000-000000000004')
)
on conflict (id) do nothing;

insert into public.expenses(id, title, amount, category, date, notes, created_by)
values (
  'f0f0f0f0-0000-0000-0000-000000000001'::uuid,
  'مصروفات تجريبية (كهرباء)',
  12000,
  'utilities',
  (now() - interval '6 days')::date,
  'بيانات اختبار',
  null
)
on conflict (id) do nothing;

insert into public.payments(id, direction, method, amount, currency, reference_table, reference_id, occurred_at, created_by, data)
values (
  'c0c0c0c0-0000-0000-0000-000000000006'::uuid,
  'out',
  'cash',
  12000,
  'YER',
  'expenses',
  'f0f0f0f0-0000-0000-0000-000000000001',
  (now() - interval '6 days' + interval '2 hours'),
  null,
  jsonb_build_object('expenseId', 'f0f0f0f0-0000-0000-0000-000000000001')
)
on conflict (id) do nothing;

insert into public.sales_returns(id, order_id, return_date, reason, refund_method, total_refund_amount, items, status, created_by, created_at, updated_at)
values (
  'ab000000-0000-0000-0000-000000000001'::uuid,
  'b0b0b0b0-0000-0000-0000-000000000001'::uuid,
  (now() - interval '1 days'),
  'اختبار مرتجع',
  'network',
  2500,
  jsonb_build_array(
    jsonb_build_object('itemId', 'qat-bundle', 'quantity', 1)
  ),
  'draft',
  null,
  (now() - interval '1 days'),
  (now() - interval '1 days')
)
on conflict (id) do nothing;

select public.process_sales_return('ab000000-0000-0000-0000-000000000001'::uuid);
