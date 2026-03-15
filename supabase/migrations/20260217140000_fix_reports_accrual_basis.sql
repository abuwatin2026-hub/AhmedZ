-- ============================================================================
-- Migration: Fix reports to use Accrual Basis (include ALL delivered orders)
-- Date: 2026-02-17
-- Problem: Eight RPCs use a restrictive filter that excludes delivered+cash
--          orders when paidAt is NULL. This causes old COD orders to be
--          missing from Sales, Product, Category, and Chart reports.
--
-- Old filter:  paid_at IS NOT NULL OR (status='delivered' AND payment_method<>'cash')
-- New filter:  paid_at IS NOT NULL OR status = 'delivered'
--
-- Affected functions:
--   1. get_sales_report_orders
--   2. get_product_sales_report_v9
--   3. get_product_sales_quantity_from_movements
--   4. get_daily_sales_stats
--   5. get_hourly_sales_stats
--   6. get_payment_method_stats
--   7. get_order_source_revenue
--   8. get_sales_by_category
-- ============================================================================


-- ============================================================================
-- 1. FIX get_sales_report_orders
-- ============================================================================
create or replace function public.get_sales_report_orders(
  p_start_date timestamptz,
  p_end_date timestamptz,
  p_zone_id uuid default null,
  p_invoice_only boolean default false,
  p_search text default null,
  p_limit integer default 500,
  p_offset integer default 0
)
returns table (
  id uuid,
  status text,
  date_by timestamptz,
  total numeric,
  payment_method text,
  order_source text,
  customer_name text,
  invoice_number text,
  invoice_issued_at timestamptz,
  delivery_zone_id uuid,
  delivery_zone_name text
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
      o.status::text as status,
      nullif(o.data->>'paidAt', '')::timestamptz as paid_at,
      nullif(o.data->>'deliveredAt', '')::timestamptz as delivered_at,
      nullif(o.data->'invoiceSnapshot'->>'issuedAt', '')::timestamptz as invoice_issued_at,
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
        o.base_total,
        coalesce(nullif((o.data->>'total')::numeric, null), 0) * public.order_fx_rate(
          coalesce(nullif(btrim(coalesce(o.currency, '')), ''), nullif(btrim(coalesce(o.data->>'currency', '')), ''), public.get_base_currency()),
          case
            when p_invoice_only
              then nullif(o.data->'invoiceSnapshot'->>'issuedAt', '')::timestamptz
            else coalesce(
              nullif(o.data->'invoiceSnapshot'->>'issuedAt', '')::timestamptz,
              nullif(o.data->>'paidAt', '')::timestamptz,
              nullif(o.data->>'deliveredAt', '')::timestamptz,
              o.created_at
            )
          end,
          o.fx_rate
        )
      ) as total,
      coalesce(nullif(o.data->>'paymentMethod',''), 'unknown') as payment_method,
      coalesce(nullif(o.data->>'orderSource',''), '') as order_source,
      coalesce(nullif(o.data->>'customerName',''), '') as customer_name,
      coalesce(
        nullif(o.data->'invoiceSnapshot'->>'invoiceNumber',''),
        nullif(o.invoice_number,''),
        nullif(o.data->>'invoiceNumber','')
      ) as invoice_number,
      coalesce(
        o.delivery_zone_id,
        case
          when nullif(o.data->>'deliveryZoneId','') is not null
               and (o.data->>'deliveryZoneId') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
            then (o.data->>'deliveryZoneId')::uuid
          else null
        end
      ) as zone_effective
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
      and nullif(trim(coalesce(o.data->>'voidedAt','')), '') is null
  )
  select
    eo.id,
    eo.status,
    eo.date_by,
    eo.total,
    eo.payment_method,
    eo.order_source,
    eo.customer_name,
    eo.invoice_number,
    eo.invoice_issued_at,
    eo.zone_effective as delivery_zone_id,
    coalesce(dz.name, '') as delivery_zone_name
  from effective_orders eo
  left join public.delivery_zones dz on dz.id = eo.zone_effective
  where (
      eo.status <> 'cancelled'
      and (
      eo.paid_at is not null
      or eo.status = 'delivered'            -- ← ACCRUAL: include ALL delivered orders
      )
  )
    and eo.date_by >= p_start_date
    and eo.date_by <= p_end_date
    and (
      p_search is null
      or nullif(trim(p_search),'') is null
      or right(eo.id::text, 6) ilike '%' || trim(p_search) || '%'
      or coalesce(eo.invoice_number,'') ilike '%' || trim(p_search) || '%'
      or coalesce(eo.customer_name,'') ilike '%' || trim(p_search) || '%'
      or coalesce(eo.payment_method,'') ilike '%' || trim(p_search) || '%'
      or coalesce(dz.name,'') ilike '%' || trim(p_search) || '%'
    )
  order by eo.date_by desc
  limit greatest(1, least(p_limit, 20000))
  offset greatest(0, p_offset);
end;
$$;

revoke all on function public.get_sales_report_orders(timestamptz, timestamptz, uuid, boolean, text, integer, integer) from public;
grant execute on function public.get_sales_report_orders(timestamptz, timestamptz, uuid, boolean, text, integer, integer) to authenticated;


-- ============================================================================
-- 2. FIX get_product_sales_report_v9
-- ============================================================================
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
      o.data,
      o.status,
      o.payment_method,
      nullif(o.data->>'paidAt', '')::timestamptz as paid_at,
      case
        when p_invoice_only
          then nullif(o.data->'invoiceSnapshot'->>'issuedAt', '')::timestamptz
        else coalesce(
          nullif(o.data->'invoiceSnapshot'->>'issuedAt', '')::timestamptz,
          nullif(o.data->>'deliveredAt', '')::timestamptz,
          nullif(o.data->>'paidAt', '')::timestamptz,
          o.created_at
        )
      end as date_by,
      public.order_fx_rate(
        coalesce(nullif(btrim(coalesce(o.currency, '')), ''), nullif(btrim(coalesce(o.data->>'currency', '')), ''), public.get_base_currency()),
        case
          when p_invoice_only
            then nullif(o.data->'invoiceSnapshot'->>'issuedAt', '')::timestamptz
          else coalesce(
            nullif(o.data->'invoiceSnapshot'->>'issuedAt', '')::timestamptz,
            nullif(o.data->>'deliveredAt', '')::timestamptz,
            nullif(o.data->>'paidAt', '')::timestamptz,
            o.created_at
          )
        end,
        o.fx_rate
      ) as fx_rate,
      coalesce(
        o.delivery_zone_id,
        case
          when nullif(o.data->>'deliveryZoneId','') is not null
               and (o.data->>'deliveryZoneId') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
            then (o.data->>'deliveryZoneId')::uuid
          else null
        end
      ) as zone_effective,
      coalesce(
        nullif(o.data->>'discountAmount','')::numeric,
        nullif(o.data->>'discountTotal','')::numeric,
        nullif(o.data->>'discount','')::numeric,
        0
      ) as discount_amount,
      coalesce(nullif(o.data->>'subtotal','')::numeric, 0) as subtotal_amount
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
      and nullif(trim(coalesce(o.data->>'voidedAt','')), '') is null
  ),
  sales_orders as (
    select *
    from effective_orders eo
    where (
        eo.paid_at is not null
        or eo.status = 'delivered'          -- ← ACCRUAL: include ALL delivered orders
    )
      and eo.date_by >= p_start_date
      and eo.date_by <= p_end_date
  ),
  expanded_items as (
    select
      so.id as order_id,
      so.data,
      so.fx_rate,
      so.discount_amount,
      so.subtotal_amount,
      jsonb_array_elements(
        case
          when p_invoice_only then
            case
              when jsonb_typeof(so.data->'invoiceSnapshot'->'items') = 'array' then so.data->'invoiceSnapshot'->'items'
              else '[]'::jsonb
            end
          else
            case
              when jsonb_typeof(so.data->'invoiceSnapshot'->'items') = 'array' then so.data->'invoiceSnapshot'->'items'
              when jsonb_typeof(so.data->'items') = 'array' then so.data->'items'
              else '[]'::jsonb
            end
        end
      ) as item
    from sales_orders so
  ),
  item_resolved as (
    select
      ei.order_id,
      ei.fx_rate,
      ei.discount_amount,
      ei.subtotal_amount,
      ei.item,
      mi_res.resolved_id as resolved_item_id,
      mi_res.resolved_unit_type as resolved_unit_type
    from expanded_items ei
    left join lateral (
      select
        mi.id::text as resolved_id,
        mi.unit_type as resolved_unit_type
      from public.menu_items mi
      where (
        (ei.item->'name'->>'ar' is not null and mi.data->'name'->>'ar' = ei.item->'name'->>'ar')
        or (ei.item->'name'->>'en' is not null and mi.data->'name'->>'en' = ei.item->'name'->>'en')
      )
      order by mi.updated_at desc
      limit 1
    ) as mi_res on true
  ),
  normalized_items as (
    select
      ir.order_id,
      coalesce(
        nullif(ir.item->>'itemId', ''),
        nullif(ir.item->>'id', ''),
        nullif(ir.item->>'menuItemId', ''),
        nullif(ir.resolved_item_id, '')
      ) as item_id_text,
      coalesce(nullif(ir.item->>'unitType', ''), nullif(ir.item->>'unit', ''), nullif(ir.resolved_unit_type, ''), 'piece') as unit_type,
      coalesce(nullif(ir.item->>'quantity', '')::numeric, 0) as quantity,
      coalesce(nullif(ir.item->>'weight', '')::numeric, 0) as weight,
      coalesce(nullif(ir.item->>'price', '')::numeric, 0) as price,
      coalesce(nullif(ir.item->>'pricePerUnit', '')::numeric, 0) as price_per_unit,
      coalesce(ir.item->'name', '{}'::jsonb) as name_json,
      case
        when jsonb_typeof(ir.item->'selectedAddons') = 'object' then coalesce((
          select sum(
            coalesce((addon_value->'addon'->>'price')::numeric, 0) *
            coalesce((addon_value->>'quantity')::numeric, 0)
          )
          from jsonb_each(ir.item->'selectedAddons') as a(key, addon_value)
        ), 0)
        when jsonb_typeof(ir.item->'selectedAddons') = 'array' then coalesce((
          select sum(
            coalesce((addon_value->'addon'->>'price')::numeric, 0) *
            coalesce((addon_value->>'quantity')::numeric, 0)
          )
          from jsonb_array_elements(ir.item->'selectedAddons') as addon_value
        ), 0)
        else 0
      end as addons_total,
      ir.fx_rate,
      ir.discount_amount,
      ir.subtotal_amount
    from item_resolved ir
  ),
  order_item_gross as (
    select
      ni.order_id,
      ni.item_id_text,
      max(ni.name_json) as any_name,
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
      ) as line_gross,
      max(ni.fx_rate) as fx_rate,
      max(ni.discount_amount) as discount_amount,
      max(ni.subtotal_amount) as subtotal_amount
    from normalized_items ni
    where nullif(ni.item_id_text, '') is not null
    group by ni.order_id, ni.item_id_text
  ),
  order_totals as (
    select
      oig.order_id,
      max(oig.fx_rate) as fx_rate,
      coalesce(sum(oig.line_gross), 0) as items_gross_sum,
      max(oig.discount_amount) as discount_amount,
      max(oig.subtotal_amount) as subtotal_amount
    from order_item_gross oig
    group by oig.order_id
  ),
  order_scaling as (
    select
      ot.order_id,
      coalesce(ot.fx_rate, 1) as fx_rate,
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
  order_item_net_by_order as (
    select
      oig.order_id,
      oig.item_id_text,
      max(oig.any_name) as any_name,
      max(oig.any_unit) as any_unit,
      sum(oig.qty_sold) as qty_sold,
      sum(
        greatest(
          (oig.line_gross * os.scale_to_subtotal)
          - (least(os.discount_amount, os.base_amount) * ((oig.line_gross * os.scale_to_subtotal) / nullif(os.base_amount, 0))),
          0
        ) * coalesce(os.fx_rate, 1)
      ) as net_sales
    from order_item_gross oig
    join order_scaling os on os.order_id = oig.order_id
    group by oig.order_id, oig.item_id_text
  ),
  sales_lines as (
    select
      oin.item_id_text,
      max(oin.any_name) as any_name,
      max(oin.any_unit) as any_unit,
      sum(oin.qty_sold) as qty_sold,
      sum(oin.net_sales) as net_sales
    from order_item_net_by_order oin
    group by oin.item_id_text
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
      public.order_fx_rate(
        coalesce(nullif(btrim(coalesce(o.currency, '')), ''), nullif(btrim(coalesce(o.data->>'currency', '')), ''), public.get_base_currency()),
        sr.return_date,
        o.fx_rate
      ) as fx_rate,
      o.data as order_data
    from public.sales_returns sr
    join public.orders o on o.id = sr.order_id
    where sr.status = 'completed'
      and sr.return_date >= p_start_date
      and sr.return_date <= p_end_date
      and nullif(trim(coalesce(o.data->>'voidedAt','')), '') is null
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
        (
          case
            when rs.gross_value_sum > 0
              then rigv.gross_value * (rs.return_amount / rs.gross_value_sum)
            else 0
          end
        ) * coalesce(rb.fx_rate, 1)
      ) as returned_sales
    from return_item_gross_value rigv
    join return_scaling rs on rs.return_id = rigv.return_id
    join returns_base rb on rb.return_id = rigv.return_id
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
            and nullif(trim(coalesce(o.data->>'voidedAt','')), '') is null
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
  stock_agg as (
    select
      sm.item_id::text as item_id_text,
      coalesce(sum(sm.available_quantity), 0) as available_quantity,
      coalesce(sum(sm.reserved_quantity), 0) as reserved_quantity,
      case
        when coalesce(sum(sm.available_quantity), 0) > 0
          then coalesce(sum(sm.avg_cost * sm.available_quantity) / nullif(sum(sm.available_quantity), 0), 0)
        else coalesce(avg(sm.avg_cost), 0)
      end as avg_cost
    from public.stock_management sm
    group by sm.item_id::text
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
    coalesce(sa.available_quantity, 0) as current_stock,
    coalesce(sa.reserved_quantity, 0) as reserved_stock,
    coalesce(sa.avg_cost, mi.cost_price, 0) as current_cost_price,
    (
      (
        greatest(
          coalesce(sa.available_quantity, 0) - coalesce(pm.net_qty_period, 0),
          0
        )
        + coalesce(sa.available_quantity, 0)
      ) / 2.0
    ) as avg_inventory
  from item_keys k
  left join public.menu_items mi on mi.id::text = k.item_id_text
  left join sales_lines sl on sl.item_id_text = k.item_id_text
  left join returns_sales rs on rs.item_id_text = k.item_id_text
  left join returns_cost rc on rc.item_id_text = k.item_id_text
  left join stock_agg sa on sa.item_id_text = k.item_id_text
  left join period_movements pm on pm.item_id_text = k.item_id_text
  left join cogs_gross cg on cg.item_id_text = k.item_id_text
  where (coalesce(sl.qty_sold, 0) + coalesce(rs.qty_returned, 0)) > 0
  order by total_sales desc;
end;
$$;

revoke all on function public.get_product_sales_report_v9(timestamptz, timestamptz, uuid, boolean) from public;
grant execute on function public.get_product_sales_report_v9(timestamptz, timestamptz, uuid, boolean) to authenticated;


-- ============================================================================
-- 3. FIX get_product_sales_quantity_from_movements
-- ============================================================================
create or replace function public.get_product_sales_quantity_from_movements(
  p_start_date timestamptz,
  p_end_date timestamptz,
  p_zone_id uuid default null
)
returns table (
  item_id text,
  quantity_sold numeric
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
  select
    im.item_id::text as item_id,
    coalesce(sum(im.quantity), 0) as quantity_sold
  from public.inventory_movements im
  join public.orders o on o.id = (im.reference_id)::uuid
    and (
        o.data->>'paidAt' is not null
        or o.status = 'delivered'           -- ← ACCRUAL: include ALL delivered orders
    )
    and nullif(trim(coalesce(o.data->>'voidedAt','')), '') is null
  where im.movement_type = 'sale_out'
    and im.reference_table = 'orders'
    and im.occurred_at >= p_start_date
    and im.occurred_at <= p_end_date
    and (p_zone_id is null or coalesce(
      o.delivery_zone_id,
      case
        when nullif(o.data->>'deliveryZoneId','') is not null
             and (o.data->>'deliveryZoneId') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
          then (o.data->>'deliveryZoneId')::uuid
        else null
      end
    ) = p_zone_id)
  group by im.item_id::text;
end;
$$;

revoke all on function public.get_product_sales_quantity_from_movements(timestamptz, timestamptz, uuid) from public;
grant execute on function public.get_product_sales_quantity_from_movements(timestamptz, timestamptz, uuid) to authenticated;


-- ============================================================================
-- 4. FIX get_daily_sales_stats
-- ============================================================================
create or replace function public.get_daily_sales_stats(
  p_start_date timestamptz,
  p_end_date timestamptz,
  p_zone_id uuid default null,
  p_invoice_only boolean default false
)
returns table (
  day_date date,
  total_sales numeric,
  order_count bigint
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
      coalesce(nullif(o.data->>'paymentMethod', ''), '') as payment_method,
      nullif(o.data->>'paidAt', '')::timestamptz as paid_at,
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
        o.base_total,
        coalesce(nullif((o.data->>'total')::numeric, null), 0) * public.order_fx_rate(
          coalesce(nullif(btrim(coalesce(o.currency, '')), ''), nullif(btrim(coalesce(o.data->>'currency', '')), ''), public.get_base_currency()),
          case
            when p_invoice_only
              then nullif(o.data->'invoiceSnapshot'->>'issuedAt', '')::timestamptz
            else coalesce(
              nullif(o.data->'invoiceSnapshot'->>'issuedAt', '')::timestamptz,
              nullif(o.data->>'paidAt', '')::timestamptz,
              nullif(o.data->>'deliveredAt', '')::timestamptz,
              o.created_at
            )
          end,
          o.fx_rate
        )
      ) as total,
      coalesce(
        o.delivery_zone_id,
        case
          when nullif(o.data->>'deliveryZoneId','') is not null
               and (o.data->>'deliveryZoneId') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
            then (o.data->>'deliveryZoneId')::uuid
          else null
        end
      ) as zone_effective
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
      and nullif(trim(coalesce(o.data->>'voidedAt','')), '') is null
  )
  select
    eo.date_by::date as day_date,
    coalesce(sum(eo.total), 0) as total_sales,
    count(*) as order_count
  from effective_orders eo
  where (
      eo.paid_at is not null
      or eo.status = 'delivered'            -- ← ACCRUAL
  )
    and eo.date_by >= p_start_date
    and eo.date_by <= p_end_date
  group by 1
  order by 1;
end;
$$;

revoke all on function public.get_daily_sales_stats(timestamptz, timestamptz, uuid, boolean) from public;
revoke execute on function public.get_daily_sales_stats(timestamptz, timestamptz, uuid, boolean) from anon;
grant execute on function public.get_daily_sales_stats(timestamptz, timestamptz, uuid, boolean) to authenticated;


-- ============================================================================
-- 5. FIX get_hourly_sales_stats
-- ============================================================================
create or replace function public.get_hourly_sales_stats(
  p_start_date timestamptz,
  p_end_date timestamptz,
  p_zone_id uuid default null,
  p_invoice_only boolean default false
)
returns table (
  hour_of_day int,
  total_sales numeric,
  order_count bigint
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
      coalesce(nullif(o.data->>'paymentMethod', ''), '') as payment_method,
      nullif(o.data->>'paidAt', '')::timestamptz as paid_at,
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
        o.base_total,
        coalesce(nullif((o.data->>'total')::numeric, null), 0) * public.order_fx_rate(
          coalesce(nullif(btrim(coalesce(o.currency, '')), ''), nullif(btrim(coalesce(o.data->>'currency', '')), ''), public.get_base_currency()),
          case
            when p_invoice_only
              then nullif(o.data->'invoiceSnapshot'->>'issuedAt', '')::timestamptz
            else coalesce(
              nullif(o.data->'invoiceSnapshot'->>'issuedAt', '')::timestamptz,
              nullif(o.data->>'paidAt', '')::timestamptz,
              nullif(o.data->>'deliveredAt', '')::timestamptz,
              o.created_at
            )
          end,
          o.fx_rate
        )
      ) as total,
      coalesce(
        o.delivery_zone_id,
        case
          when nullif(o.data->>'deliveryZoneId','') is not null
               and (o.data->>'deliveryZoneId') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
            then (o.data->>'deliveryZoneId')::uuid
          else null
        end
      ) as zone_effective
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
      and nullif(trim(coalesce(o.data->>'voidedAt','')), '') is null
  )
  select
    extract(hour from eo.date_by)::int as hour_of_day,
    coalesce(sum(eo.total), 0) as total_sales,
    count(*) as order_count
  from effective_orders eo
  where (
      eo.paid_at is not null
      or eo.status = 'delivered'            -- ← ACCRUAL
  )
    and eo.date_by >= p_start_date
    and eo.date_by <= p_end_date
  group by 1
  order by 1;
end;
$$;

revoke all on function public.get_hourly_sales_stats(timestamptz, timestamptz, uuid, boolean) from public;
revoke execute on function public.get_hourly_sales_stats(timestamptz, timestamptz, uuid, boolean) from anon;
grant execute on function public.get_hourly_sales_stats(timestamptz, timestamptz, uuid, boolean) to authenticated;


-- ============================================================================
-- 6. FIX get_payment_method_stats
-- ============================================================================
create or replace function public.get_payment_method_stats(
  p_start_date timestamptz,
  p_end_date timestamptz,
  p_zone_id uuid default null,
  p_invoice_only boolean default false
)
returns table (
  method text,
  total_sales numeric,
  order_count bigint
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
      o.status,
      coalesce(o.data->>'paymentMethod', 'unknown') as method,
      nullif(o.data->>'paidAt', '')::timestamptz as paid_at,
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
        o.base_total,
        coalesce(nullif((o.data->>'total')::numeric, null), 0) * public.order_fx_rate(
          coalesce(nullif(btrim(coalesce(o.currency, '')), ''), nullif(btrim(coalesce(o.data->>'currency', '')), ''), public.get_base_currency()),
          case
            when p_invoice_only
              then nullif(o.data->'invoiceSnapshot'->>'issuedAt', '')::timestamptz
            else coalesce(
              nullif(o.data->'invoiceSnapshot'->>'issuedAt', '')::timestamptz,
              nullif(o.data->>'paidAt', '')::timestamptz,
              nullif(o.data->>'deliveredAt', '')::timestamptz,
              o.created_at
            )
          end,
          o.fx_rate
        )
      ) as total,
      coalesce(
        o.delivery_zone_id,
        case
          when nullif(o.data->>'deliveryZoneId','') is not null
               and (o.data->>'deliveryZoneId') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
            then (o.data->>'deliveryZoneId')::uuid
          else null
        end
      ) as zone_effective
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
      and nullif(trim(coalesce(o.data->>'voidedAt','')), '') is null
  )
  select
    eo.method,
    coalesce(sum(eo.total), 0) as total_sales,
    count(*) as order_count
  from effective_orders eo
  where (
      eo.paid_at is not null
      or eo.status = 'delivered'            -- ← ACCRUAL
  )
    and eo.date_by >= p_start_date
    and eo.date_by <= p_end_date
  group by 1
  order by 2 desc;
end;
$$;

revoke all on function public.get_payment_method_stats(timestamptz, timestamptz, uuid, boolean) from public;
revoke execute on function public.get_payment_method_stats(timestamptz, timestamptz, uuid, boolean) from anon;
grant execute on function public.get_payment_method_stats(timestamptz, timestamptz, uuid, boolean) to authenticated;


-- ============================================================================
-- 7. FIX get_order_source_revenue
-- ============================================================================
create or replace function public.get_order_source_revenue(
  p_start_date timestamptz,
  p_end_date timestamptz,
  p_zone_id uuid default null,
  p_invoice_only boolean default false
)
returns table (
  source text,
  total_sales numeric,
  order_count bigint
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
      o.status,
      coalesce(nullif(o.data->>'paymentMethod', ''), '') as payment_method,
      nullif(o.data->>'paidAt', '')::timestamptz as paid_at,
      coalesce(nullif(o.data->>'orderSource',''), '') as order_source,
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
        o.base_total,
        coalesce(nullif((o.data->>'total')::numeric, null), 0) * public.order_fx_rate(
          coalesce(nullif(btrim(coalesce(o.currency, '')), ''), nullif(btrim(coalesce(o.data->>'currency', '')), ''), public.get_base_currency()),
          case
            when p_invoice_only
              then nullif(o.data->'invoiceSnapshot'->>'issuedAt', '')::timestamptz
            else coalesce(
              nullif(o.data->'invoiceSnapshot'->>'issuedAt', '')::timestamptz,
              nullif(o.data->>'paidAt', '')::timestamptz,
              nullif(o.data->>'deliveredAt', '')::timestamptz,
              o.created_at
            )
          end,
          o.fx_rate
        )
      ) as total,
      coalesce(
        o.delivery_zone_id,
        case
          when nullif(o.data->>'deliveryZoneId','') is not null
               and (o.data->>'deliveryZoneId') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
            then (o.data->>'deliveryZoneId')::uuid
          else null
        end
      ) as zone_effective
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
      and nullif(trim(coalesce(o.data->>'voidedAt','')), '') is null
  )
  select
    case when eo.order_source = 'in_store' then 'in_store' else 'online' end as source,
    coalesce(sum(eo.total), 0) as total_sales,
    count(*) as order_count
  from effective_orders eo
  where (
      eo.paid_at is not null
      or eo.status = 'delivered'            -- ← ACCRUAL
  )
    and eo.date_by >= p_start_date
    and eo.date_by <= p_end_date
  group by 1
  order by 2 desc;
end;
$$;

revoke all on function public.get_order_source_revenue(timestamptz, timestamptz, uuid, boolean) from public;
revoke execute on function public.get_order_source_revenue(timestamptz, timestamptz, uuid, boolean) from anon;
grant execute on function public.get_order_source_revenue(timestamptz, timestamptz, uuid, boolean) to authenticated;


-- ============================================================================
-- 8. FIX get_sales_by_category
-- ============================================================================
create or replace function public.get_sales_by_category(
  p_start_date timestamptz,
  p_end_date timestamptz,
  p_zone_id uuid default null,
  p_invoice_only boolean default false
)
returns table (
  category_name text,
  total_sales numeric,
  quantity_sold numeric
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
      o.data,
      o.status,
      nullif(o.data->>'paidAt', '')::timestamptz as paid_at,
      coalesce(nullif(o.data->>'paymentMethod', ''), '') as payment_method,
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
      public.order_fx_rate(
        coalesce(nullif(btrim(coalesce(o.currency, '')), ''), nullif(btrim(coalesce(o.data->>'currency', '')), ''), public.get_base_currency()),
        case
          when p_invoice_only
            then nullif(o.data->'invoiceSnapshot'->>'issuedAt', '')::timestamptz
          else coalesce(
            nullif(o.data->'invoiceSnapshot'->>'issuedAt', '')::timestamptz,
            nullif(o.data->>'paidAt', '')::timestamptz,
            nullif(o.data->>'deliveredAt', '')::timestamptz,
            o.created_at
          )
        end,
        o.fx_rate
      ) as fx_rate,
      coalesce(
        o.delivery_zone_id,
        case
          when nullif(o.data->>'deliveryZoneId','') is not null
               and (o.data->>'deliveryZoneId') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
            then (o.data->>'deliveryZoneId')::uuid
          else null
        end
      ) as zone_effective,
      coalesce(
        nullif(o.data->>'discountAmount','')::numeric,
        nullif(o.data->>'discountTotal','')::numeric,
        nullif(o.data->>'discount','')::numeric,
        0
      ) as discount_amount,
      coalesce(nullif(o.data->>'subtotal','')::numeric, 0) as subtotal_amount
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
      and nullif(trim(coalesce(o.data->>'voidedAt','')), '') is null
  ),
  filtered_orders as (
    select *
    from effective_orders eo
    where (
        eo.paid_at is not null
        or eo.status = 'delivered'          -- ← ACCRUAL
    )
      and eo.date_by >= p_start_date
      and eo.date_by <= p_end_date
  ),
  expanded_items as (
    select
      fo.id as order_id,
      fo.fx_rate,
      fo.discount_amount,
      fo.subtotal_amount,
      jsonb_array_elements(
        case
          when p_invoice_only then
            case
              when jsonb_typeof(fo.data->'invoiceSnapshot'->'items') = 'array' then fo.data->'invoiceSnapshot'->'items'
              else '[]'::jsonb
            end
          else
            case
              when jsonb_typeof(fo.data->'invoiceSnapshot'->'items') = 'array' then fo.data->'invoiceSnapshot'->'items'
              when jsonb_typeof(fo.data->'items') = 'array' then fo.data->'items'
              else '[]'::jsonb
            end
        end
      ) as item
    from filtered_orders fo
  ),
  lines as (
    select
      ei.order_id,
      ei.fx_rate,
      ei.discount_amount,
      ei.subtotal_amount,
      coalesce(
        nullif(ei.item->>'category',''),
        nullif(ei.item->>'categoryId',''),
        'Uncategorized'
      ) as category_key,
      nullif(ei.item->>'categoryName','') as category_name_raw,
      coalesce((ei.item->>'quantity')::numeric, 0) as quantity,
      coalesce((ei.item->>'weight')::numeric, 0) as weight,
      coalesce(ei.item->>'unitType', ei.item->>'unit', 'piece') as unit_type,
      coalesce((ei.item->>'price')::numeric, 0) as price,
      coalesce((ei.item->>'pricePerUnit')::numeric, 0) as price_per_unit,
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
  order_category_gross as (
    select
      l.order_id,
      l.category_key,
      max(l.category_name_raw) as category_name_raw,
      sum(
        case
          when l.unit_type in ('kg', 'gram') and l.weight > 0
            then (l.weight * greatest(l.quantity, 1))
          else greatest(l.quantity, 0)
        end
      ) as qty_sold,
      sum(
        (
          (
            case
              when l.unit_type = 'gram'
                   and l.price_per_unit > 0
                   and l.weight > 0 then (l.price_per_unit / 1000.0) * l.weight
              when l.unit_type in ('kg', 'gram')
                   and l.weight > 0 then l.price * l.weight
              else l.price
            end
            + l.addons_total
          )
          *
          case
            when l.unit_type in ('kg', 'gram') and l.weight > 0
              then greatest(l.quantity, 1)
            else greatest(l.quantity, 0)
          end
        )
      ) as line_gross,
      max(l.fx_rate) as fx_rate,
      max(l.discount_amount) as discount_amount,
      max(l.subtotal_amount) as subtotal_amount
    from lines l
    group by l.order_id, l.category_key
  ),
  order_totals as (
    select
      ocg.order_id,
      max(ocg.fx_rate) as fx_rate,
      coalesce(sum(ocg.line_gross), 0) as items_gross_sum,
      max(ocg.discount_amount) as discount_amount,
      max(ocg.subtotal_amount) as subtotal_amount
    from order_category_gross ocg
    group by ocg.order_id
  ),
  scaled as (
    select
      ocg.category_key,
      ocg.category_name_raw,
      ocg.qty_sold,
      (
        (
          (ocg.line_gross * (
            case
              when ot.items_gross_sum > 0 and ot.subtotal_amount > 0 then (ot.subtotal_amount / ot.items_gross_sum)
              else 1
            end
          ))
          -
          (
            case
              when greatest(ot.discount_amount, 0) > 0 and greatest(ot.subtotal_amount, 0) > 0
                then greatest(ot.discount_amount, 0) * (
                  (ocg.line_gross * (
                    case
                      when ot.items_gross_sum > 0 and ot.subtotal_amount > 0 then (ot.subtotal_amount / ot.items_gross_sum)
                      else 1
                    end
                  )) / greatest(ot.subtotal_amount, 0)
                )
              else 0
            end
          )
        )
        * ot.fx_rate
      ) as net_sales_base
    from order_category_gross ocg
    join order_totals ot on ot.order_id = ocg.order_id
  ),
  labeled as (
    select
      coalesce(
        nullif(s.category_name_raw, ''),
        nullif(ic.data->'name'->>'ar', ''),
        nullif(ic.data->'name'->>'en', ''),
        case when s.category_key = 'Uncategorized' then 'غير مصنف' else s.category_key end
      ) as category_name,
      s.qty_sold,
      s.net_sales_base
    from scaled s
    left join public.item_categories ic on ic.key = s.category_key
  )
  select
    l.category_name,
    coalesce(sum(l.net_sales_base), 0) as total_sales,
    coalesce(sum(l.qty_sold), 0) as quantity_sold
  from labeled l
  group by l.category_name
  order by 2 desc;
end;
$$;

revoke all on function public.get_sales_by_category(timestamptz, timestamptz, uuid, boolean) from public;
revoke execute on function public.get_sales_by_category(timestamptz, timestamptz, uuid, boolean) from anon;
grant execute on function public.get_sales_by_category(timestamptz, timestamptz, uuid, boolean) to authenticated;
