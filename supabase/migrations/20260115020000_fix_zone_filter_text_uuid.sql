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
  current_cost_price numeric
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
        or coalesce(o.delivery_zone_id::text, o.data->>'deliveryZoneId') = p_zone_id::text
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
create or replace function public.get_sales_report_summary(
  p_start_date timestamptz,
  p_end_date timestamptz,
  p_zone_id uuid default null,
  p_invoice_only boolean default false
)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_total_collected numeric := 0;
  v_total_tax numeric := 0;
  v_total_delivery numeric := 0;
  v_total_discounts numeric := 0;
  v_gross_subtotal numeric := 0;
  v_total_orders integer := 0;
  v_cancelled_orders integer := 0;
  v_delivered_orders integer := 0;
  v_total_returns numeric := 0;
  v_total_cogs numeric := 0;
  v_total_returns_cogs numeric := 0;
  v_total_wastage numeric := 0;
  v_total_expenses numeric := 0;
  v_total_delivery_cost numeric := 0;
  v_out_for_delivery integer := 0;
  v_in_store integer := 0;
  v_online integer := 0;
  v_result json;
begin
  with effective_orders as (
    select
      o.id,
      o.status,
      o.created_at,
      coalesce(nullif((o.data->>'total')::numeric, null), 0) as total,
      coalesce(nullif((o.data->>'taxAmount')::numeric, null), 0) as tax_amount,
      coalesce(nullif((o.data->>'deliveryFee')::numeric, null), 0) as delivery_fee,
      coalesce(nullif((o.data->>'discountAmount')::numeric, null), 0) as discount_amount,
      coalesce(nullif((o.data->>'subtotal')::numeric, null), 0) as subtotal,
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
      coalesce(nullif(o.data->>'orderSource', ''), '') as order_source
    from public.orders o
    where (
      p_zone_id is null
      or coalesce(o.delivery_zone_id::text, o.data->>'deliveryZoneId') = p_zone_id::text
    )
  )
  select
    coalesce(sum(eo.total), 0),
    coalesce(sum(eo.tax_amount), 0),
    coalesce(sum(eo.delivery_fee), 0),
    coalesce(sum(eo.discount_amount), 0),
    coalesce(sum(eo.subtotal), 0),
    count(*),
    count(*) filter (where eo.status = 'delivered')
  into
    v_total_collected,
    v_total_tax,
    v_total_delivery,
    v_total_discounts,
    v_gross_subtotal,
    v_total_orders,
    v_delivered_orders
  from effective_orders eo
  where eo.status = 'delivered'
    and eo.paid_at is not null
    and eo.date_by >= p_start_date
    and eo.date_by <= p_end_date;

  with effective_orders as (
    select
      o.id,
      o.status,
      o.created_at,
      case
        when p_invoice_only
          then nullif(o.data->'invoiceSnapshot'->>'issuedAt', '')::timestamptz
        else coalesce(
          nullif(o.data->'invoiceSnapshot'->>'issuedAt', '')::timestamptz,
          nullif(o.data->>'paidAt', '')::timestamptz,
          nullif(o.data->>'deliveredAt', '')::timestamptz,
          o.created_at
        )
      end as date_by
    from public.orders o
    where (
      p_zone_id is null
      or coalesce(o.delivery_zone_id::text, o.data->>'deliveryZoneId') = p_zone_id::text
    )
  )
  select count(*)
  into v_cancelled_orders
  from effective_orders eo
  where eo.status = 'cancelled'
    and eo.date_by >= p_start_date
    and eo.date_by <= p_end_date;

  select coalesce(sum(sr.total_refund_amount), 0)
  into v_total_returns
  from public.sales_returns sr
  join public.orders o on o.id::text = sr.order_id::text
  where sr.status = 'completed'
    and sr.return_date >= p_start_date
    and sr.return_date <= p_end_date
    and (
      p_zone_id is null
      or coalesce(o.delivery_zone_id::text, o.data->>'deliveryZoneId') = p_zone_id::text
    );

  with effective_orders as (
    select
      o.id,
      o.status,
      o.created_at,
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
      end as date_by
    from public.orders o
    where (
      p_zone_id is null
      or coalesce(o.delivery_zone_id::text, o.data->>'deliveryZoneId') = p_zone_id::text
    )
  )
  select coalesce(sum(oic.total_cost), 0)
  into v_total_cogs
  from public.order_item_cogs oic
  join effective_orders eo on oic.order_id = eo.id
  where eo.status = 'delivered'
    and eo.paid_at is not null
    and eo.date_by >= p_start_date
    and eo.date_by <= p_end_date;

  select coalesce(sum(im.total_cost), 0)
  into v_total_returns_cogs
  from public.inventory_movements im
  where im.reference_table = 'sales_returns'
    and im.movement_type = 'return_in'
    and im.occurred_at >= p_start_date
    and im.occurred_at <= p_end_date
    and (
      p_zone_id is null or exists (
        select 1 from public.orders o
        where o.id = (im.data->>'orderId')::uuid
          and coalesce(o.delivery_zone_id::text, o.data->>'deliveryZoneId') = p_zone_id::text
      )
    );

  v_total_cogs := greatest(v_total_cogs - v_total_returns_cogs, 0);

  if p_zone_id is null then
    select coalesce(sum(quantity * cost_at_time), 0)
    into v_total_wastage
    from public.stock_wastage
    where created_at >= p_start_date and created_at <= p_end_date;

    select coalesce(sum(amount), 0)
    into v_total_expenses
    from public.expenses
    where date >= p_start_date::date and date <= p_end_date::date;
  else
    v_total_wastage := 0;
    v_total_expenses := 0;
  end if;

  select coalesce(sum(dc.cost_amount), 0)
  into v_total_delivery_cost
  from public.delivery_costs dc
  where dc.occurred_at >= p_start_date
    and dc.occurred_at <= p_end_date
    and (
      p_zone_id is null or exists (
        select 1 from public.orders o
        where o.id = dc.order_id
          and coalesce(o.delivery_zone_id::text, o.data->>'deliveryZoneId') = p_zone_id::text
      )
    );

  with effective_orders as (
    select
      o.id,
      o.status,
      o.created_at,
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
      coalesce(nullif(o.data->>'orderSource', ''), '') as order_source
    from public.orders o
    where (
      p_zone_id is null
      or coalesce(o.delivery_zone_id::text, o.data->>'deliveryZoneId') = p_zone_id::text
    )
  )
  select
    coalesce(count(*) filter (where status = 'out_for_delivery'), 0),
    coalesce(count(*) filter (where status = 'delivered' and order_source = 'in_store'), 0),
    coalesce(count(*) filter (where status = 'delivered' and order_source <> 'in_store'), 0)
  into v_out_for_delivery, v_in_store, v_online
  from effective_orders eo
  where eo.date_by >= p_start_date
    and eo.date_by <= p_end_date;

  v_result := json_build_object(
    'total_collected', v_total_collected,
    'gross_subtotal', v_gross_subtotal,
    'returns', v_total_returns,
    'discounts', v_total_discounts,
    'tax', v_total_tax,
    'delivery_fees', v_total_delivery,
    'delivery_cost', v_total_delivery_cost,
    'cogs', v_total_cogs,
    'wastage', v_total_wastage,
    'expenses', v_total_expenses,
    'total_orders', v_total_orders,
    'delivered_orders', v_delivered_orders,
    'cancelled_orders', v_cancelled_orders,
    'out_for_delivery_count', v_out_for_delivery,
    'in_store_count', v_in_store,
    'online_count', v_online
  );

  return v_result;
end;
$$;
