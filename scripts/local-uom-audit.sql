select set_config('request.jwt.claim.role','authenticated', false);
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001', false);

insert into auth.users(id, aud, role, email, email_confirmed_at, created_at, updated_at)
values (
  '00000000-0000-0000-0000-000000000001',
  'authenticated',
  'authenticated',
  'local-admin@example.com',
  now(),
  now(),
  now()
)
on conflict (id) do nothing;

drop table if exists tmp_uom_audit;
create temp table tmp_uom_audit(
  order_id uuid not null,
  warehouse_id uuid not null,
  order_data jsonb not null
);

with ctx as (
  select
    (select id from public.companies order by created_at asc limit 1) as company_id,
    (select id from public.branches order by created_at asc limit 1) as branch_id
),
wh as (
  insert into public.warehouses(code, name, type, company_id, branch_id, is_active)
  select 'MAIN', 'Main Warehouse', 'main', company_id, branch_id, true
  from ctx
  on conflict (code) do update set is_active = true
  returning id
),
wh2 as (
  select id as warehouse_id from wh
  union all
  select id as warehouse_id from public.warehouses where code = 'MAIN' limit 1
),
item as (
  insert into public.menu_items(id, status, name, data, base_unit, unit_type, price, cost_price)
  values (
    'item_uom_test_choco',
    'active',
    jsonb_build_object('ar','شوكولاتة اختبار UOM','en','UOM Test Chocolate'),
    jsonb_build_object('group','UOM_TEST'),
    'piece',
    'piece',
    1,
    0.5
  )
  on conflict (id) do update set
    status = excluded.status,
    name = excluded.name,
    data = excluded.data,
    base_unit = excluded.base_unit,
    unit_type = excluded.unit_type,
    price = excluded.price
  returning id
),
uom as (
  select public.upsert_item_packaging_uom('item_uom_test_choco', 12, 24) as result
),
admin_seed as (
  insert into public.admin_users(auth_user_id, username, role, is_active, company_id, branch_id, warehouse_id)
  select
    '00000000-0000-0000-0000-000000000001'::uuid,
    'local_admin',
    'manager',
    true,
    (select company_id from ctx),
    (select branch_id from ctx),
    (select warehouse_id from wh2)
  on conflict (auth_user_id) do update set is_active = true, role = 'manager', warehouse_id = excluded.warehouse_id
  returning 1
),
seed_stock as (
  insert into public.stock_management(item_id, warehouse_id, available_quantity, reserved_quantity, unit, avg_cost, data)
  select 'item_uom_test_choco', warehouse_id, 5000, 0, 'piece', 0.5, '{}'::jsonb
  from wh2
  on conflict (item_id, warehouse_id) do update set
    available_quantity = 5000,
    reserved_quantity = 0,
    unit = 'piece',
    avg_cost = 0.5
  returning 1
),
batch as (
  insert into public.batches(id, item_id, warehouse_id, quantity_received, quantity_consumed, quantity_transferred, unit_cost, qc_status, status, batch_code)
  select
    '11111111-1111-1111-1111-111111111111'::uuid,
    'item_uom_test_choco',
    warehouse_id,
    5000,
    0,
    0,
    0.5,
    'released',
    'active',
    'BATCH-UOM-TEST'
  from wh2
  on conflict (id) do update set
    item_id = excluded.item_id,
    warehouse_id = excluded.warehouse_id,
    quantity_received = excluded.quantity_received,
    quantity_consumed = 0,
    quantity_transferred = 0,
    unit_cost = excluded.unit_cost,
    qc_status = excluded.qc_status,
    status = excluded.status,
    batch_code = excluded.batch_code
  returning id
),
order_row as (
  insert into public.orders(status, currency, warehouse_id, data)
  select
    'pending',
    'SAR',
    warehouse_id,
    jsonb_build_object(
      'orderSource','in_store',
      'currency','SAR',
      'items', jsonb_build_array(
        jsonb_build_object(
          'itemId','item_uom_test_choco',
          'quantity', 1,
          'uomCode','pack',
          'uomQtyInBase', 12
        )
      ),
      'total', 12,
      'subtotal', 12,
      'taxAmount', 0,
      'discount', 0
    )
  from wh2, admin_seed, seed_stock, batch, uom, item
  returning id, warehouse_id, data
)
insert into tmp_uom_audit(order_id, warehouse_id, order_data)
select id, warehouse_id, data from order_row;

select public.confirm_order_delivery(
  (select order_id from tmp_uom_audit limit 1),
  jsonb_build_array(jsonb_build_object('itemId','item_uom_test_choco','quantity', 12)),
  (select order_data || jsonb_build_object('deliveredAt', now()) from tmp_uom_audit limit 1),
  (select warehouse_id from tmp_uom_audit limit 1)
) as delivery_result;

with moved as (
  select sum(im.quantity) as moved_qty
  from public.inventory_movements im
  where im.reference_table = 'orders'
    and im.reference_id = (select order_id::text from tmp_uom_audit limit 1)
    and im.movement_type = 'sale_out'
),
expected as (
  select sum((li->>'quantity')::numeric * coalesce(nullif((li->>'uomQtyInBase')::numeric, 0), 1)) as expected_base_qty
  from tmp_uom_audit t
  cross join lateral jsonb_array_elements(t.order_data->'items') li
)
select
  (select order_id from tmp_uom_audit limit 1) as order_id,
  (select expected_base_qty from expected) as expected_base_qty,
  coalesce((select moved_qty from moved), 0) as moved_qty,
  coalesce((select moved_qty from moved), 0) - coalesce((select expected_base_qty from expected), 0) as diff;

select
  sm.item_id,
  sm.warehouse_id,
  sm.available_quantity,
  sm.reserved_quantity,
  sm.unit,
  sm.avg_cost
from public.stock_management sm
where sm.item_id = 'item_uom_test_choco';
