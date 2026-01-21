create or replace function public.get_product_sales_report_v7(
  p_start_date timestamptz,
  p_end_date timestamptz,
  p_zone_id_text text default null
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
declare
  v_zone_text text;
begin
  v_zone_text := nullif(trim(coalesce(p_zone_id_text, '')), '');

  return query
  with effective_orders as (
    select
      o.id,
      o.status,
      o.created_at,
      nullif(o.data->>'paidAt','')::timestamptz as paid_at,
      coalesce(nullif(o.delivery_zone_id::text, ''), nullif(o.data->>'deliveryZoneId','')) as zone_effective_text,
      case
        when nullif(o.data->'invoiceSnapshot'->>'issuedAt','') is not null
          then nullif(o.data->'invoiceSnapshot'->>'issuedAt','')::timestamptz
        else coalesce(
          nullif(o.data->>'paidAt','')::timestamptz,
          nullif(o.data->>'deliveredAt','')::timestamptz,
          o.created_at
        )
      end as date_by,
      o.data
    from public.orders o
    where (o.status = 'delivered' or nullif(o.data->>'paidAt','') is not null)
      and (
        case
          when nullif(o.data->'invoiceSnapshot'->>'issuedAt','') is not null
            then nullif(o.data->'invoiceSnapshot'->>'issuedAt','')::timestamptz
          else coalesce(
            nullif(o.data->>'paidAt','')::timestamptz,
            nullif(o.data->>'deliveredAt','')::timestamptz,
            o.created_at
          )
        end
      ) between p_start_date and p_end_date
      and (
        v_zone_text is null
        or coalesce(nullif(o.delivery_zone_id::text, ''), nullif(o.data->>'deliveryZoneId','')) = v_zone_text
      )
  ),
  expanded_items as (
    select
      eo.id as order_id,
      item as item,
      mi_res.resolved_id as resolved_item_id,
      mi_res.resolved_unit_type as resolved_unit_type,
      mi_res.resolved_name as resolved_name
    from effective_orders eo
    cross join lateral jsonb_array_elements(
      case
        when jsonb_typeof(eo.data->'invoiceSnapshot'->'items') = 'array'
             and jsonb_array_length(eo.data->'invoiceSnapshot'->'items') > 0 then eo.data->'invoiceSnapshot'->'items'
        when jsonb_typeof(eo.data->'items') = 'array' then eo.data->'items'
        else '[]'::jsonb
      end
    ) as item
    left join lateral (
      select
        mi.id::text as resolved_id,
        mi.unit_type as resolved_unit_type,
        mi.data->'name' as resolved_name
      from public.menu_items mi
      where (
        (item->'name'->>'ar' is not null and mi.data->'name'->>'ar' = item->'name'->>'ar')
        or (item->'name'->>'en' is not null and mi.data->'name'->>'en' = item->'name'->>'en')
      )
      order by mi.updated_at desc
      limit 1
    ) as mi_res on true
  ),
  normalized_items as (
    select
      ei.order_id,
      coalesce(
        nullif(ei.item->>'itemId', ''),
        nullif(ei.item->>'id', ''),
        nullif(ei.item->>'menuItemId', ''),
        nullif(ei.resolved_item_id, '')
      ) as item_id_text,
      coalesce(ei.item->'name', ei.resolved_name) as item_name,
      coalesce(
        nullif(ei.item->>'unitType', ''),
        nullif(ei.item->>'unit', ''),
        nullif(ei.resolved_unit_type, ''),
        'piece'
      ) as unit_type,
      coalesce((ei.item->>'quantity')::numeric, 0) as quantity,
      coalesce((ei.item->>'weight')::numeric, 0) as weight,
      coalesce((ei.item->>'price')::numeric, 0) as price,
      coalesce((ei.item->>'pricePerUnit')::numeric, 0) as price_per_unit,
      ei.item->'selectedAddons' as addons
    from expanded_items ei
  ),
  sales_lines as (
    select
      ni.item_id_text,
      max(ni.item_name) as any_name,
      max(ni.unit_type) as any_unit,
      sum(
        case
          when ni.unit_type in ('kg', 'gram') and ni.weight > 0
            then (ni.weight * greatest(ni.quantity, 1))
          else greatest(ni.quantity, 0)
        end
      ) as qty_sold,
      sum(
        (
          (
            case
              when ni.unit_type = 'gram'
                   and ni.price_per_unit > 0
                   and ni.weight > 0 then (ni.price_per_unit / 1000.0) * ni.weight
              when ni.unit_type in ('kg', 'gram')
                   and ni.weight > 0 then ni.price * ni.weight
              else ni.price
            end
            +
            coalesce((
              select sum(
                coalesce((addon_value->'addon'->>'price')::numeric, 0) *
                coalesce((addon_value->>'quantity')::numeric, 0)
              )
              from jsonb_each(ni.addons) as a(key, addon_value)
            ), 0)
          )
          *
          case
            when ni.unit_type in ('kg', 'gram') and ni.weight > 0
              then greatest(ni.quantity, 1)
            else greatest(ni.quantity, 0)
          end
        )
      ) as gross_sales
    from normalized_items ni
    where nullif(ni.item_id_text, '') is not null
    group by ni.item_id_text
  ),
  returns_base as (
    select
      sr.id as return_id,
      sr.order_id,
      sr.total_refund_amount as return_amount,
      sr.items as items
    from public.sales_returns sr
    join public.orders o on o.id = sr.order_id
    where sr.status = 'completed'
      and sr.return_date >= p_start_date
      and sr.return_date <= p_end_date
      and (
        v_zone_text is null
        or coalesce(nullif(o.delivery_zone_id::text, ''), nullif(o.data->>'deliveryZoneId','')) = v_zone_text
      )
  ),
  returns_items as (
    select
      rb.return_id,
      rb.order_id,
      rb.return_amount,
      coalesce(nullif(ri->>'itemId',''), nullif(ri->>'id','')) as item_id_text,
      coalesce((ri->>'quantity')::numeric, 0) as qty_returned
    from returns_base rb
    cross join lateral jsonb_array_elements(coalesce(rb.items, '[]'::jsonb)) as ri
    where coalesce((ri->>'quantity')::numeric, 0) > 0
  ),
  order_items_for_returns as (
    select
      o.id as order_id,
      item as item,
      mi_res.resolved_id as resolved_item_id
    from returns_base rb
    join public.orders o on o.id = rb.order_id
    cross join lateral jsonb_array_elements(
      case
        when jsonb_typeof(o.data->'invoiceSnapshot'->'items') = 'array'
             and jsonb_array_length(o.data->'invoiceSnapshot'->'items') > 0 then o.data->'invoiceSnapshot'->'items'
        when jsonb_typeof(o.data->'items') = 'array' then o.data->'items'
        else '[]'::jsonb
      end
    ) as item
    left join lateral (
      select mi.id::text as resolved_id
      from public.menu_items mi
      where (
        (item->'name'->>'ar' is not null and mi.data->'name'->>'ar' = item->'name'->>'ar')
        or (item->'name'->>'en' is not null and mi.data->'name'->>'en' = item->'name'->>'en')
      )
      order by mi.updated_at desc
      limit 1
    ) as mi_res on true
  ),
  normalized_order_items_for_returns as (
    select
      oir.order_id,
      coalesce(
        nullif(oir.item->>'itemId', ''),
        nullif(oir.item->>'id', ''),
        nullif(oir.item->>'menuItemId', ''),
        nullif(oir.resolved_item_id, '')
      ) as item_id_text,
      coalesce(nullif(oir.item->>'unitType',''), nullif(oir.item->>'unit',''), 'piece') as unit_type,
      coalesce((oir.item->>'quantity')::numeric, 0) as quantity,
      coalesce((oir.item->>'weight')::numeric, 0) as weight,
      coalesce((oir.item->>'price')::numeric, 0) as price,
      coalesce((oir.item->>'pricePerUnit')::numeric, 0) as price_per_unit,
      oir.item->'selectedAddons' as addons
    from order_items_for_returns oir
  ),
  order_item_price as (
    select
      noi.order_id,
      noi.item_id_text,
      sum(
        case
          when noi.unit_type in ('kg', 'gram') and noi.weight > 0
            then (noi.weight * greatest(noi.quantity, 1))
          else greatest(noi.quantity, 0)
        end
      ) as order_qty_stock,
      sum(
        (
          (
            case
              when noi.unit_type = 'gram'
                   and noi.price_per_unit > 0
                   and noi.weight > 0 then (noi.price_per_unit / 1000.0) * noi.weight
              when noi.unit_type in ('kg', 'gram')
                   and noi.weight > 0 then noi.price * noi.weight
              else noi.price
            end
            +
            coalesce((
              select sum(
                coalesce((addon_value->'addon'->>'price')::numeric, 0) *
                coalesce((addon_value->>'quantity')::numeric, 0)
              )
              from jsonb_each(noi.addons) as a(key, addon_value)
            ), 0)
          )
          *
          case
            when noi.unit_type in ('kg', 'gram') and noi.weight > 0
              then greatest(noi.quantity, 1)
            else greatest(noi.quantity, 0)
          end
        )
      ) as order_sales_amount
    from normalized_order_items_for_returns noi
    where nullif(noi.item_id_text,'') is not null
    group by noi.order_id, noi.item_id_text
  ),
  return_item_gross_value as (
    select
      ri.return_id,
      ri.order_id,
      ri.item_id_text,
      ri.qty_returned,
      ri.return_amount,
      case
        when oip.order_qty_stock > 0
          then (ri.qty_returned * (oip.order_sales_amount / oip.order_qty_stock))
        else 0
      end as gross_value
    from returns_items ri
    left join order_item_price oip
      on oip.order_id = ri.order_id
     and oip.item_id_text = ri.item_id_text
  ),
  return_scaling as (
    select
      rigv.return_id,
      max(rigv.return_amount) as return_amount,
      sum(rigv.gross_value) as gross_value_sum
    from return_item_gross_value rigv
    group by rigv.return_id
  ),
  returns_sales as (
    select
      rigv.item_id_text,
      sum(rigv.qty_returned) as qty_returned,
      sum(
        case
          when rs.gross_value_sum > 0
            then rigv.gross_value * (rs.return_amount / rs.gross_value_sum)
          else 0
        end
      ) as returned_sales
    from return_item_gross_value rigv
    join return_scaling rs on rs.return_id = rigv.return_id
    group by rigv.item_id_text
  ),
  returns_cost as (
    select
      im.item_id::text as item_id_text,
      sum(im.quantity) as qty_returned_cost,
      sum(im.total_cost) as returned_cost
    from public.inventory_movements im
    where im.reference_table = 'sales_returns'
      and im.movement_type = 'return_in'
      and im.occurred_at >= p_start_date
      and im.occurred_at <= p_end_date
      and (
        v_zone_text is null or exists (
          select 1 from public.orders o
          where o.id::text = (im.data->>'orderId')
            and coalesce(nullif(o.delivery_zone_id::text, ''), nullif(o.data->>'deliveryZoneId','')) = v_zone_text
        )
      )
    group by im.item_id::text
  ),
  cogs_gross as (
    select
      oic.item_id::text as item_id_text,
      sum(oic.total_cost) as gross_cost
    from public.order_item_cogs oic
    join effective_orders eo on eo.id = oic.order_id
    where eo.status = 'delivered'
      and eo.paid_at is not null
    group by oic.item_id::text
  ),
  period_movements as (
    select
      im.item_id::text as item_id_text,
      sum(case when im.movement_type in ('purchase_in','adjust_in','return_in') then im.quantity else 0 end)
      -
      sum(case when im.movement_type in ('sale_out','wastage_out','adjust_out','return_out') then im.quantity else 0 end)
      as net_qty_period
    from public.inventory_movements im
    where im.occurred_at >= p_start_date
      and im.occurred_at <= p_end_date
    group by im.item_id::text
  ),
  item_keys as (
    select item_id_text from sales_lines
    union
    select item_id_text from returns_sales
    union
    select item_id_text from returns_cost
    union
    select item_id_text from cogs_gross
  )
  select
    k.item_id_text as item_id,
    coalesce(mi.data->'name', sl.any_name, jsonb_build_object('ar', k.item_id_text)) as item_name,
    coalesce(nullif(iug.unit_type, ''), nullif(mi.unit_type, ''), nullif(sl.any_unit, ''), 'piece') as unit_type,
    greatest(coalesce(sl.qty_sold, 0) - coalesce(rs.qty_returned, 0), 0) as quantity_sold,
    greatest(coalesce(sl.gross_sales, 0) - coalesce(rs.returned_sales, 0), 0) as total_sales,
    greatest(coalesce(cg.gross_cost, 0) - coalesce(rc.returned_cost, 0), 0) as total_cost,
    (
      greatest(coalesce(sl.gross_sales, 0) - coalesce(rs.returned_sales, 0), 0)
      - greatest(coalesce(cg.gross_cost, 0) - coalesce(rc.returned_cost, 0), 0)
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
  from item_keys k
  left join public.menu_items mi on mi.id::text = k.item_id_text
  left join sales_lines sl on sl.item_id_text = k.item_id_text
  left join returns_sales rs on rs.item_id_text = k.item_id_text
  left join returns_cost rc on rc.item_id_text = k.item_id_text
  left join cogs_gross cg on cg.item_id_text = k.item_id_text
  left join public.stock_management sm on sm.item_id::text = k.item_id_text
  left join period_movements pm on pm.item_id_text = k.item_id_text
  left join (
    select
      ei.item_id_text,
      max(nullif(ei.unit_type, '')) as unit_type
    from normalized_items ei
    where nullif(ei.item_id_text, '') is not null
    group by ei.item_id_text
  ) as iug on iug.item_id_text = k.item_id_text
  where (coalesce(sl.qty_sold, 0) + coalesce(rs.qty_returned, 0) + coalesce(rc.qty_returned_cost, 0)) > 0
  order by total_sales desc;
end;
$$;

