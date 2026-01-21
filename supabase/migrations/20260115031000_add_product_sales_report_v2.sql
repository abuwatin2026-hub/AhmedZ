create or replace function public.get_product_sales_report_v2(
  p_start_date timestamptz,
  p_end_date timestamptz,
  p_zone_id text default null
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
  current_cost_price numeric
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_zone_uuid uuid := null;
begin
  if p_zone_id is not null and nullif(trim(p_zone_id), '') is not null then
    if trim(p_zone_id) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
      v_zone_uuid := trim(p_zone_id)::uuid;
    end if;
  end if;

  return query
  with orders_in_range as (
    select
      o.id,
      o.data
    from public.orders o
    where o.status = 'delivered'
      and (o.data->>'paidAt') is not null
      and (
        v_zone_uuid is null
        or coalesce(
          (case
             when o.delivery_zone_id is not null
              and o.delivery_zone_id::text ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
               then o.delivery_zone_id::text::uuid
             else null
           end),
          (case
             when nullif(o.data->>'deliveryZoneId','') is not null
              and (o.data->>'deliveryZoneId') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
               then (o.data->>'deliveryZoneId')::uuid
             else null
           end)
        ) = v_zone_uuid
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
  cogs_data as (
    select
      oic.item_id,
      sum(oic.total_cost) as cost_amount
    from public.order_item_cogs oic
    where oic.order_id in (select id from orders_in_range)
    group by oic.item_id
  )
  select
    mi.id as item_id,
    mi.name as item_name,
    coalesce(mi.unit_type, 'piece') as unit_type,
    coalesce(its.qty_sold, 0) as quantity_sold,
    coalesce(its.sales_amount, 0) as total_sales,
    coalesce(
      cd.cost_amount,
      coalesce(its.qty_sold, 0) * coalesce(sm.avg_cost, mi.cost_price, 0)
    ) as total_cost,
    (
      coalesce(its.sales_amount, 0) -
      coalesce(
        cd.cost_amount,
        coalesce(its.qty_sold, 0) * coalesce(sm.avg_cost, mi.cost_price, 0)
      )
    ) as total_profit,
    coalesce(sm.available_quantity, 0) as current_stock,
    coalesce(sm.reserved_quantity, 0) as reserved_stock,
    coalesce(sm.avg_cost, mi.cost_price, 0) as current_cost_price
  from public.menu_items mi
  left join item_sales its on mi.id = its.item_id
  left join cogs_data cd on mi.id = cd.item_id
  left join public.stock_management sm on mi.id = sm.item_id
  where coalesce(its.sales_amount, 0) > 0 or coalesce(cd.cost_amount, 0) > 0
  order by total_sales desc;
end;
$$;
