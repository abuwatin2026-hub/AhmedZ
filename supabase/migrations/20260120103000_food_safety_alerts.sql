create or replace view public.v_food_batch_balances as
with purchases as (
  select
    im.item_id,
    im.batch_id,
    sum(im.quantity) as received_qty,
    max(
      case
        when (im.data->>'expiryDate') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then (im.data->>'expiryDate')::date
        else null
      end
    ) as expiry_date
  from public.inventory_movements im
  where im.movement_type = 'purchase_in'
    and im.batch_id is not null
  group by im.item_id, im.batch_id
),
consumed as (
  select
    im.item_id,
    im.batch_id,
    sum(im.quantity) as consumed_qty
  from public.inventory_movements im
  where im.movement_type in ('sale_out','wastage_out','adjust_out','return_out')
    and im.batch_id is not null
  group by im.item_id, im.batch_id
)
select
  p.item_id,
  p.batch_id,
  p.expiry_date,
  coalesce(p.received_qty, 0) as received_qty,
  coalesce(c.consumed_qty, 0) as consumed_qty,
  greatest(coalesce(p.received_qty, 0) - coalesce(c.consumed_qty, 0), 0) as remaining_qty
from purchases p
left join consumed c
  on c.item_id = p.item_id
 and c.batch_id = p.batch_id;

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
  with wh as (
    select w.id, w.code, w.name
    from public.warehouses w
    where w.code = 'MAIN'
    limit 1
  )
  select
    mi.id as item_id,
    coalesce(mi.data->'name'->>'ar', mi.data->'name'->>'en', mi.data->>'name', mi.id) as item_name,
    b.batch_id,
    wh.id as warehouse_id,
    wh.code as warehouse_code,
    wh.name as warehouse_name,
    b.expiry_date,
    (b.expiry_date - current_date)::int as days_remaining,
    b.remaining_qty as qty_remaining
  from public.v_food_batch_balances b
  join public.menu_items mi on mi.id = b.item_id
  cross join wh
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
  with wh as (
    select w.id, w.code, w.name
    from public.warehouses w
    where w.code = 'MAIN'
    limit 1
  )
  select
    mi.id as item_id,
    coalesce(mi.data->'name'->>'ar', mi.data->'name'->>'en', mi.data->>'name', mi.id) as item_name,
    b.batch_id,
    wh.id as warehouse_id,
    wh.code as warehouse_code,
    wh.name as warehouse_name,
    b.expiry_date,
    (current_date - b.expiry_date)::int as days_expired,
    b.remaining_qty as qty_remaining
  from public.v_food_batch_balances b
  join public.menu_items mi on mi.id = b.item_id
  cross join wh
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
