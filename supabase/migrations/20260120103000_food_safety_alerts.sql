do $$
begin
  if to_regclass('public.inventory_movements') is not null
     and to_regclass('public.warehouses') is not null
     and not exists (
        select 1
        from information_schema.columns
        where table_schema = 'public'
          and table_name = 'inventory_movements'
          and column_name = 'warehouse_id'
     ) then
    alter table public.inventory_movements
      add column warehouse_id uuid references public.warehouses(id) on delete set null;
    create index if not exists idx_inventory_movements_warehouse_item_date
      on public.inventory_movements(warehouse_id, item_id, occurred_at desc);
    create index if not exists idx_inventory_movements_warehouse_batch
      on public.inventory_movements(warehouse_id, batch_id);
  end if;
end $$;

create or replace view public.v_food_batch_balances as
with default_wh as (
  select w.id as warehouse_id
  from public.warehouses w
  where upper(coalesce(w.code, '')) = 'MAIN'
  order by w.code asc
  limit 1
),
movements as (
  select
    im.item_id,
    im.batch_id,
    coalesce(
      im.warehouse_id,
      case
        when (im.data ? 'warehouseId')
             and (im.data->>'warehouseId') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
          then (im.data->>'warehouseId')::uuid
        else null
      end,
      (select warehouse_id from default_wh)
    ) as warehouse_id,
    case
      when im.movement_type in ('purchase_in','adjust_in','return_in') then im.quantity
      else 0
    end as in_qty,
    case
      when im.movement_type in ('sale_out','wastage_out','adjust_out','return_out') then im.quantity
      else 0
    end as out_qty,
    case
      when (im.data->>'expiryDate') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then (im.data->>'expiryDate')::date
      else null
    end as expiry_date
  from public.inventory_movements im
  where im.batch_id is not null
),
batch_expiry as (
  select
    m.item_id,
    m.batch_id,
    max(m.expiry_date) as expiry_date
  from movements m
  group by 1, 2
),
balances as (
  select
    m.item_id,
    m.batch_id,
    m.warehouse_id,
    sum(m.in_qty) as received_qty,
    sum(m.out_qty) as consumed_qty
  from movements m
  group by 1, 2, 3
)
select
  b.item_id,
  b.batch_id,
  b.warehouse_id,
  e.expiry_date,
  coalesce(b.received_qty, 0) as received_qty,
  coalesce(b.consumed_qty, 0) as consumed_qty,
  greatest(coalesce(b.received_qty, 0) - coalesce(b.consumed_qty, 0), 0) as remaining_qty
from balances b
join batch_expiry e
  on e.item_id = b.item_id
 and e.batch_id = b.batch_id;

create or replace function public.get_food_near_expiry_alert(p_threshold_days int default 7)
returns table (
  item_id text,
  item_name text,
  batch_id uuid,
  warehouse_id uuid,
  warehouse_code text,
  warehouse_name text,
  expiry_date date,
  days_remaining int,
  qty_remaining numeric
)
language sql
stable
set search_path = public
as $$
  select
    mi.id as item_id,
    coalesce(mi.data->'name'->>'ar', mi.data->'name'->>'en', mi.data->>'name', mi.id) as item_name,
    b.batch_id,
    w.id as warehouse_id,
    w.code as warehouse_code,
    w.name as warehouse_name,
    b.expiry_date,
    (b.expiry_date - current_date)::int as days_remaining,
    b.remaining_qty as qty_remaining
  from public.v_food_batch_balances b
  join public.menu_items mi on mi.id = b.item_id
  left join public.warehouses w on w.id = b.warehouse_id
  where mi.category = 'food'
    and b.expiry_date is not null
    and b.remaining_qty > 0
    and b.expiry_date >= current_date
    and b.expiry_date <= current_date + greatest(coalesce(p_threshold_days, 0), 0);
$$;

create or replace function public.get_food_expired_in_stock_alert()
returns table (
  item_id text,
  item_name text,
  batch_id uuid,
  warehouse_id uuid,
  warehouse_code text,
  warehouse_name text,
  expiry_date date,
  days_expired int,
  qty_remaining numeric
)
language sql
stable
set search_path = public
as $$
  select
    mi.id as item_id,
    coalesce(mi.data->'name'->>'ar', mi.data->'name'->>'en', mi.data->>'name', mi.id) as item_name,
    b.batch_id,
    w.id as warehouse_id,
    w.code as warehouse_code,
    w.name as warehouse_name,
    b.expiry_date,
    (current_date - b.expiry_date)::int as days_expired,
    b.remaining_qty as qty_remaining
  from public.v_food_batch_balances b
  join public.menu_items mi on mi.id = b.item_id
  left join public.warehouses w on w.id = b.warehouse_id
  where mi.category = 'food'
    and b.expiry_date is not null
    and b.remaining_qty > 0
    and b.expiry_date < current_date;
$$;

create or replace function public.get_food_reservation_block_reason(p_item_id text default null)
returns table (
  item_id text,
  item_name text,
  batch_id uuid,
  expiry_date date,
  days_from_today int,
  qty_remaining numeric,
  reason text
)
language sql
stable
set search_path = public
as $$
  select
    mi.id as item_id,
    coalesce(mi.data->'name'->>'ar', mi.data->'name'->>'en', mi.data->>'name', mi.id) as item_name,
    b.batch_id,
    b.expiry_date,
    case
      when b.expiry_date is null then null
      else (b.expiry_date - current_date)::int
    end as days_from_today,
    b.remaining_qty as qty_remaining,
    case
      when b.expiry_date is null then 'missing_expiry'
      when b.expiry_date < current_date then 'expired'
      else 'ok'
    end as reason
  from public.v_food_batch_balances b
  join public.menu_items mi on mi.id = b.item_id
  where mi.category = 'food'
    and b.remaining_qty > 0
    and (
      b.expiry_date is null
      or b.expiry_date < current_date
    )
    and (p_item_id is null or b.item_id = p_item_id);
$$;

revoke all on function public.get_food_near_expiry_alert(int) from public;
revoke all on function public.get_food_expired_in_stock_alert() from public;
revoke all on function public.get_food_reservation_block_reason(text) from public;
grant execute on function public.get_food_near_expiry_alert(int) to authenticated;
grant execute on function public.get_food_expired_in_stock_alert() to authenticated;
grant execute on function public.get_food_reservation_block_reason(text) to authenticated;
