-- Fix product reports RPC to use JSON name from menu_items.data
drop function if exists public.get_product_sales_report(timestamptz, timestamptz, uuid);
create or replace function public.get_product_sales_report(
  p_start_date timestamptz,
  p_end_date timestamptz,
  p_zone_id uuid default null
)
returns table (
  item_id text,
  item_name jsonb,
  unit_type text,
  quantity_sold numeric,
  total_sales numeric,
  total_cost numeric,
  total_profit numeric,
  current_stock numeric,
  reserved_stock numeric,
  current_cost_price numeric,
  avg_inventory numeric
)
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  with orders_in_range as (
    select
      o.id,
      o.data
    from public.orders o
    where o.status = 'delivered'
      and (o.data->>'paidAt') is not null
      and (
        p_zone_id is null
        or (o.delivery_zone_id::text = p_zone_id::text)
      )
      and (
        case when (o.data->'invoiceSnapshot'->>'issuedAt') is not null
             then (o.data->'invoiceSnapshot'->>'issuedAt')::timestamptz
             else coalesce((o.data->>'paidAt')::timestamptz, (o.data->>'deliveredAt')::timestamptz, o.created_at)
        end
      ) >= p_start_date
      and (
        case when (o.data->'invoiceSnapshot'->>'issuedAt') is not null
             then (o.data->'invoiceSnapshot'->>'issuedAt')::timestamptz
             else coalesce((o.data->>'paidAt')::timestamptz, (o.data->>'deliveredAt')::timestamptz, o.created_at)
        end
      ) <= p_end_date
  ),
  expanded_items as (
    select
      oir.id as order_id,
      coalesce(item->>'itemId', item->>'id') as item_id,
      coalesce((item->>'quantity')::numeric, 0) as quantity,
      coalesce((item->>'weight')::numeric, 0) as weight,
      coalesce(item->>'unitType', item->>'unit', 'piece') as unit_type,
      coalesce((item->>'price')::numeric, 0) as price,
      coalesce((item->>'pricePerUnit')::numeric, 0) as price_per_unit,
      item->'selectedAddons' as addons
    from orders_in_range oir,
    jsonb_array_elements(
      case when oir.data->'invoiceSnapshot' is not null and jsonb_typeof(oir.data->'invoiceSnapshot'->'items') = 'array'
           then oir.data->'invoiceSnapshot'->'items'
           else oir.data->'items'
      end
    ) as item
  ),
  item_sales as (
    select
      ei.item_id,
      sum(
        case
          when ei.unit_type in ('kg', 'gram') and ei.weight > 0 then ei.weight
          else ei.quantity
        end
      ) as qty_sold,
      sum(
        (
          case
            when ei.unit_type = 'gram' and ei.price_per_unit > 0 then ei.price_per_unit / 1000.0
            else ei.price
          end
          +
          coalesce((
            select sum(
              coalesce((addon_value->'addon'->>'price')::numeric, 0) *
              coalesce((addon_value->>'quantity')::numeric, 0)
            )
            from jsonb_each(ei.addons) as a(key, addon_value)
          ), 0)
        ) *
        (
          case
            when ei.unit_type in ('kg', 'gram') and ei.weight > 0 then ei.weight
            else ei.quantity
          end
        )
      ) as sales_amount
    from expanded_items ei
    group by ei.item_id
  ),
  returns_movements as (
    select
      im.item_id,
      sum(im.quantity) as qty_returned,
      sum(im.total_cost) as cogs_returned
    from public.inventory_movements im
    where im.movement_type = 'return_in'
      and im.occurred_at >= p_start_date
      and im.occurred_at <= p_end_date
      and (
        p_zone_id is null
        or exists (
          select 1 from public.orders o
          where o.id = (im.data->>'orderId')::uuid
            and o.delivery_zone_id = p_zone_id
        )
      )
    group by im.item_id
  ),
  cogs_data as (
    select
      oic.item_id,
      sum(oic.total_cost) as cost_amount
    from public.order_item_cogs oic
    where oic.order_id in (select id from orders_in_range)
    group by oic.item_id
  ),
  period_movements as (
    select
      im.item_id,
      sum(case when im.movement_type in ('purchase_in','adjust_in','return_in') then im.quantity else 0 end)
      -
      sum(case when im.movement_type in ('sale_out','wastage_out','adjust_out','return_out') then im.quantity else 0 end)
      as net_qty_period
    from public.inventory_movements im
    where im.occurred_at >= p_start_date
      and im.occurred_at <= p_end_date
    group by im.item_id
  )
  select
    mi.id as item_id,
    coalesce(mi.data->'name', jsonb_build_object('ar', mi.id::text)) as item_name,
    coalesce(mi.unit_type, 'piece') as unit_type,
    greatest(coalesce(its.qty_sold, 0) - coalesce(rm.qty_returned, 0), 0) as quantity_sold,
    greatest(
      coalesce(its.sales_amount, 0)
      - (coalesce(rm.qty_returned, 0) * coalesce(its.sales_amount / nullif(its.qty_sold, 0), 0)),
      0
    ) as total_sales,
    greatest(
      coalesce(
        cd.cost_amount,
        coalesce(its.qty_sold, 0) * coalesce(sm.avg_cost, mi.cost_price, 0)
      ) - coalesce(rm.cogs_returned, 0),
      0
    ) as total_cost,
    (
      greatest(
        coalesce(its.sales_amount, 0)
        - (coalesce(rm.qty_returned, 0) * coalesce(its.sales_amount / nullif(its.qty_sold, 0), 0)),
        0
      )
      -
      greatest(
        coalesce(
          cd.cost_amount,
          coalesce(its.qty_sold, 0) * coalesce(sm.avg_cost, mi.cost_price, 0)
        ) - coalesce(rm.cogs_returned, 0),
        0
      )
    ) as total_profit,
    coalesce(sm.available_quantity, 0) as current_stock,
    coalesce(sm.reserved_quantity, 0) as reserved_stock,
    coalesce(sm.avg_cost, mi.cost_price, 0) as current_cost_price,
    (
      (
        greatest(
          coalesce(sm.available_quantity, 0) - coalesce(pm.net_qty_period, 0),
          0
        )
        + coalesce(sm.available_quantity, 0)
      ) / 2.0
    ) as avg_inventory
  from public.menu_items mi
  left join item_sales its on mi.id = its.item_id
  left join returns_movements rm on mi.id = rm.item_id
  left join cogs_data cd on mi.id = cd.item_id
  left join public.stock_management sm on mi.id = sm.item_id
  left join period_movements pm on mi.id = pm.item_id
  where (coalesce(its.qty_sold, 0) + coalesce(rm.qty_returned, 0)) > 0
  order by total_sales desc;
end;
$$;
