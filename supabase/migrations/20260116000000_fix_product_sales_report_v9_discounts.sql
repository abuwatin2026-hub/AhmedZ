create or replace function public.get_product_sales_report_v9(
  p_start_date timestamptz,
  p_end_date timestamptz,
  p_zone_id uuid default null,
  p_invoice_only boolean default false
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
  if not public.is_staff() then
    raise exception 'not allowed';
  end if;

  return query
  with effective_orders as (
    select
      o.id,
      o.status,
      o.created_at,
      nullif(o.data->>'paidAt','')::timestamptz as paid_at,
      case
        when p_invoice_only
          then nullif(o.data->'invoiceSnapshot'->>'issuedAt', '')::timestamptz
        else coalesce(
          nullif(o.data->'invoiceSnapshot'->>'issuedAt', '')::timestamptz,
          nullif(o.data->>'paidAt', '')::timestamptz,
          nullif(o.data->>'deliveredAt', '')::timestamptz,
          o.created_at
        )
      end as date_by,
      coalesce(
        o.delivery_zone_id,
        case
          when nullif(o.data->>'deliveryZoneId','') is not null
               and (o.data->>'deliveryZoneId') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
            then (o.data->>'deliveryZoneId')::uuid
          else null
        end
      ) as zone_effective,
      o.data
    from public.orders o
    where (p_zone_id is null or coalesce(
      o.delivery_zone_id,
      case
        when nullif(o.data->>'deliveryZoneId','') is not null
             and (o.data->>'deliveryZoneId') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
          then (o.data->>'deliveryZoneId')::uuid
        else null
      end
    ) = p_zone_id)
  ),
  sales_orders as (
    select
      eo.*,
      coalesce(
        nullif(eo.data->>'discountAmount','')::numeric,
        nullif(eo.data->>'discountTotal','')::numeric,
        nullif(eo.data->>'discount','')::numeric,
        0
      ) as discount_amount,
      coalesce(nullif(eo.data->>'subtotal','')::numeric, 0) as subtotal_amount
    from effective_orders eo
    where (eo.status = 'delivered' or eo.paid_at is not null)
      and eo.date_by >= p_start_date
      and eo.date_by <= p_end_date
  ),
  expanded_items as (
    select
      so.id as order_id,
      item as item,
      mi_res.resolved_id as resolved_item_id,
      mi_res.resolved_unit_type as resolved_unit_type,
      mi_res.resolved_name as resolved_name
    from sales_orders so
    cross join lateral jsonb_array_elements(
      case
        when p_invoice_only then
          case
            when jsonb_typeof(so.data->'invoiceSnapshot'->'items') = 'array'
                 and jsonb_array_length(so.data->'invoiceSnapshot'->'items') > 0 then so.data->'invoiceSnapshot'->'items'
            else '[]'::jsonb
          end
        else
          case
            when jsonb_typeof(so.data->'invoiceSnapshot'->'items') = 'array'
                 and jsonb_array_length(so.data->'invoiceSnapshot'->'items') > 0 then so.data->'invoiceSnapshot'->'items'
            when jsonb_typeof(so.data->'items') = 'array' then so.data->'items'
            else '[]'::jsonb
          end
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
      coalesce(nullif(ei.item->>'quantity', '')::numeric, 0) as quantity,
      coalesce(nullif(ei.item->>'weight', '')::numeric, 0) as weight,
      coalesce(nullif(ei.item->>'price', '')::numeric, 0) as price,
      coalesce(nullif(ei.item->>'pricePerUnit', '')::numeric, 0) as price_per_unit,
      ei.item->'selectedAddons' as addons,
      case
        when jsonb_typeof(ei.item->'selectedAddons') = 'object' then coalesce((
          select sum(
            coalesce((addon_value->'addon'->>'price')::numeric, 0) *
            coalesce((addon_value->>'quantity')::numeric, 0)
          )
          from jsonb_each(ei.item->'selectedAddons') as a(key, addon_value)
        ), 0)
        when jsonb_typeof(ei.item->'selectedAddons') = 'array' then coalesce((
          select sum(
            coalesce((addon_value->'addon'->>'price')::numeric, 0) *
            coalesce((addon_value->>'quantity')::numeric, 0)
          )
          from jsonb_array_elements(ei.item->'selectedAddons') as addon_value
        ), 0)
        else 0
      end as addons_total
    from expanded_items ei
  ),
  order_item_gross as (
    select
      ni.order_id,
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
            + ni.addons_total
          )
          *
          case
            when ni.unit_type in ('kg', 'gram') and ni.weight > 0
              then greatest(ni.quantity, 1)
            else greatest(ni.quantity, 0)
          end
        )
      ) as line_gross
    from normalized_items ni
    where nullif(ni.item_id_text, '') is not null
    group by ni.order_id, ni.item_id_text
  ),
  order_totals as (
    select
      so.id as order_id,
      coalesce(sum(oig.line_gross), 0) as items_gross_sum,
      max(so.discount_amount) as discount_amount,
      max(so.subtotal_amount) as subtotal_amount
    from sales_orders so
    left join order_item_gross oig on oig.order_id = so.id
    group by so.id
  ),
  order_scaling as (
    select
      ot.order_id,
      greatest(coalesce(ot.items_gross_sum, 0), 0) as items_gross_sum,
      greatest(coalesce(ot.subtotal_amount, 0), 0) as subtotal_amount,
      greatest(coalesce(ot.discount_amount, 0), 0) as discount_amount,
      greatest(
        case
          when coalesce(ot.subtotal_amount, 0) > 0 then ot.subtotal_amount
          else coalesce(ot.items_gross_sum, 0)
        end,
        0
      ) as base_amount,
      case
        when coalesce(ot.subtotal_amount, 0) > 0 and coalesce(ot.items_gross_sum, 0) > 0
          then (ot.subtotal_amount / ot.items_gross_sum)
        else 1
      end as scale_to_subtotal
    from order_totals ot
  ),
  order_item_net as (
    select
      oig.item_id_text,
      max(oig.any_name) as any_name,
      max(oig.any_unit) as any_unit,
      sum(oig.qty_sold) as qty_sold,
      sum(
        greatest(
          (oig.line_gross * os.scale_to_subtotal)
          - (least(os.discount_amount, os.base_amount) * ((oig.line_gross * os.scale_to_subtotal) / nullif(os.base_amount, 0))),
          0
        )
      ) as net_sales
    from order_item_gross oig
    join order_scaling os on os.order_id = oig.order_id
    group by oig.item_id_text
  ),
  sales_lines as (
    select
      oin.item_id_text,
      oin.any_name,
      oin.any_unit,
      oin.qty_sold,
      oin.net_sales
    from order_item_net oin
  ),
  returns_base as (
    select
      sr.id as return_id,
      sr.order_id,
      sr.total_refund_amount as return_amount,
      sr.items as items,
      coalesce(
        nullif(o.data->>'discountAmount','')::numeric,
        nullif(o.data->>'discountTotal','')::numeric,
        nullif(o.data->>'discount','')::numeric,
        0
      ) as discount_amount,
      coalesce(nullif(o.data->>'subtotal','')::numeric, 0) as subtotal_amount,
      o.data as order_data
    from public.sales_returns sr
    join public.orders o on o.id = sr.order_id
    where sr.status = 'completed'
      and sr.return_date >= p_start_date
      and sr.return_date <= p_end_date
      and (p_zone_id is null or coalesce(
        o.delivery_zone_id,
        case
          when nullif(o.data->>'deliveryZoneId','') is not null
               and (o.data->>'deliveryZoneId') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
            then (o.data->>'deliveryZoneId')::uuid
          else null
        end
      ) = p_zone_id)
  ),
  returns_items as (
    select
      rb.return_id,
      rb.order_id,
      rb.return_amount,
      coalesce(nullif(ri->>'itemId',''), nullif(ri->>'id','')) as item_id_text,
      coalesce(nullif(ri->>'quantity','')::numeric, 0) as qty_returned
    from returns_base rb
    cross join lateral jsonb_array_elements(coalesce(rb.items, '[]'::jsonb)) as ri
    where coalesce(nullif(ri->>'quantity','')::numeric, 0) > 0
  ),
  return_expanded_items as (
    select
      rb.order_id,
      item as item,
      mi_res.resolved_id as resolved_item_id,
      mi_res.resolved_unit_type as resolved_unit_type
    from returns_base rb
    cross join lateral jsonb_array_elements(
      case
        when jsonb_typeof(rb.order_data->'invoiceSnapshot'->'items') = 'array'
             and jsonb_array_length(rb.order_data->'invoiceSnapshot'->'items') > 0 then rb.order_data->'invoiceSnapshot'->'items'
        when jsonb_typeof(rb.order_data->'items') = 'array' then rb.order_data->'items'
        else '[]'::jsonb
      end
    ) as item
    left join lateral (
      select
        mi.id::text as resolved_id,
        mi.unit_type as resolved_unit_type
      from public.menu_items mi
      where (
        (item->'name'->>'ar' is not null and mi.data->'name'->>'ar' = item->'name'->>'ar')
        or (item->'name'->>'en' is not null and mi.data->'name'->>'en' = item->'name'->>'en')
      )
      order by mi.updated_at desc
      limit 1
    ) as mi_res on true
  ),
  normalized_return_items as (
    select
      rei.order_id,
      coalesce(
        nullif(rei.item->>'itemId', ''),
        nullif(rei.item->>'id', ''),
        nullif(rei.item->>'menuItemId', ''),
        nullif(rei.resolved_item_id, '')
      ) as item_id_text,
      coalesce(nullif(rei.item->>'unitType', ''), nullif(rei.item->>'unit', ''), nullif(rei.resolved_unit_type, ''), 'piece') as unit_type,
      coalesce(nullif(rei.item->>'quantity', '')::numeric, 0) as quantity,
      coalesce(nullif(rei.item->>'weight', '')::numeric, 0) as weight,
      coalesce(nullif(rei.item->>'price', '')::numeric, 0) as price,
      coalesce(nullif(rei.item->>'pricePerUnit', '')::numeric, 0) as price_per_unit,
      case
        when jsonb_typeof(rei.item->'selectedAddons') = 'object' then coalesce((
          select sum(
            coalesce((addon_value->'addon'->>'price')::numeric, 0) *
            coalesce((addon_value->>'quantity')::numeric, 0)
          )
          from jsonb_each(rei.item->'selectedAddons') as a(key, addon_value)
        ), 0)
        when jsonb_typeof(rei.item->'selectedAddons') = 'array' then coalesce((
          select sum(
            coalesce((addon_value->'addon'->>'price')::numeric, 0) *
            coalesce((addon_value->>'quantity')::numeric, 0)
          )
          from jsonb_array_elements(rei.item->'selectedAddons') as addon_value
        ), 0)
        else 0
      end as addons_total
    from return_expanded_items rei
  ),
  return_order_item_gross as (
    select
      nri.order_id,
      nri.item_id_text,
      sum(
        case
          when nri.unit_type in ('kg', 'gram') and nri.weight > 0
            then (nri.weight * greatest(nri.quantity, 1))
          else greatest(nri.quantity, 0)
        end
      ) as qty_stock,
      sum(
        (
          (
            case
              when nri.unit_type = 'gram'
                   and nri.price_per_unit > 0
                   and nri.weight > 0 then (nri.price_per_unit / 1000.0) * nri.weight
              when nri.unit_type in ('kg', 'gram')
                   and nri.weight > 0 then nri.price * nri.weight
              else nri.price
            end
            + nri.addons_total
          )
          *
          case
            when nri.unit_type in ('kg', 'gram') and nri.weight > 0
              then greatest(nri.quantity, 1)
            else greatest(nri.quantity, 0)
          end
        )
      ) as line_gross
    from normalized_return_items nri
    where nullif(nri.item_id_text,'') is not null
    group by nri.order_id, nri.item_id_text
  ),
  return_order_totals as (
    select
      rb.order_id,
      coalesce(sum(roig.line_gross), 0) as items_gross_sum,
      max(rb.discount_amount) as discount_amount,
      max(rb.subtotal_amount) as subtotal_amount
    from returns_base rb
    left join return_order_item_gross roig on roig.order_id = rb.order_id
    group by rb.order_id
  ),
  return_order_scaling as (
    select
      rot.order_id,
      greatest(coalesce(rot.items_gross_sum, 0), 0) as items_gross_sum,
      greatest(coalesce(rot.subtotal_amount, 0), 0) as subtotal_amount,
      greatest(coalesce(rot.discount_amount, 0), 0) as discount_amount,
      greatest(
        case
          when coalesce(rot.subtotal_amount, 0) > 0 then rot.subtotal_amount
          else coalesce(rot.items_gross_sum, 0)
        end,
        0
      ) as base_amount,
      case
        when coalesce(rot.subtotal_amount, 0) > 0 and coalesce(rot.items_gross_sum, 0) > 0
          then (rot.subtotal_amount / rot.items_gross_sum)
        else 1
      end as scale_to_subtotal
    from return_order_totals rot
  ),
  return_order_item_net as (
    select
      roig.order_id,
      roig.item_id_text,
      roig.qty_stock,
      greatest(
        (roig.line_gross * ros.scale_to_subtotal)
        - (least(ros.discount_amount, ros.base_amount) * ((roig.line_gross * ros.scale_to_subtotal) / nullif(ros.base_amount, 0))),
        0
      ) as net_sales_amount
    from return_order_item_gross roig
    join return_order_scaling ros on ros.order_id = roig.order_id
  ),
  return_item_gross_value as (
    select
      ri.return_id,
      ri.order_id,
      ri.item_id_text,
      ri.qty_returned,
      ri.return_amount,
      case
        when roin.qty_stock > 0
          then (ri.qty_returned * (roin.net_sales_amount / roin.qty_stock))
        else 0
      end as gross_value
    from returns_items ri
    left join return_order_item_net roin
      on roin.order_id = ri.order_id
     and roin.item_id_text = ri.item_id_text
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
        p_zone_id is null or exists (
          select 1 from public.orders o
          where o.id = (im.data->>'orderId')::uuid
            and coalesce(
              o.delivery_zone_id,
              case
                when nullif(o.data->>'deliveryZoneId','') is not null
                     and (o.data->>'deliveryZoneId') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
                  then (o.data->>'deliveryZoneId')::uuid
                else null
              end
            ) = p_zone_id
        )
      )
    group by im.item_id::text
  ),
  cogs_gross as (
    select
      oic.item_id::text as item_id_text,
      sum(oic.total_cost) as gross_cost
    from public.order_item_cogs oic
    join sales_orders so on so.id = oic.order_id
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
    coalesce(nullif(mi.unit_type, ''), nullif(sl.any_unit, ''), 'piece') as unit_type,
    greatest(coalesce(sl.qty_sold, 0) - coalesce(rs.qty_returned, 0), 0) as quantity_sold,
    greatest(coalesce(sl.net_sales, 0) - coalesce(rs.returned_sales, 0), 0) as total_sales,
    greatest(coalesce(cg.gross_cost, 0) - coalesce(rc.returned_cost, 0), 0) as total_cost,
    (
      greatest(coalesce(sl.net_sales, 0) - coalesce(rs.returned_sales, 0), 0)
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
  where (coalesce(sl.qty_sold, 0) + coalesce(rs.qty_returned, 0) + coalesce(rc.qty_returned_cost, 0)) > 0
  order by total_sales desc;
end;
$$;

revoke all on function public.get_product_sales_report_v9(timestamptz, timestamptz, uuid, boolean) from public;
revoke execute on function public.get_product_sales_report_v9(timestamptz, timestamptz, uuid, boolean) from anon;
grant execute on function public.get_product_sales_report_v9(timestamptz, timestamptz, uuid, boolean) to authenticated;
select pg_sleep(1);
notify pgrst, 'reload schema';
