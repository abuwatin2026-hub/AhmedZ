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
  v_tax_refunds numeric := 0;
  v_result json;
begin
  with effective_orders as (
    select
      o.id,
      o.status,
      o.created_at,
      o.delivery_zone_id,
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
    where (p_zone_id is null or coalesce(
      o.delivery_zone_id,
      case
        when nullif(o.data->>'deliveryZoneId','') is not null
             and (o.data->>'deliveryZoneId') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
          then (o.data->>'deliveryZoneId')::uuid
        else null
      end
    ) = p_zone_id)
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
  where (eo.status = 'delivered' or eo.paid_at is not null)
    and eo.date_by >= p_start_date
    and eo.date_by <= p_end_date;

  with effective_orders as (
    select
      o.id,
      o.status,
      o.created_at,
      o.delivery_zone_id,
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
    where (p_zone_id is null or coalesce(
      o.delivery_zone_id,
      case
        when nullif(o.data->>'deliveryZoneId','') is not null
             and (o.data->>'deliveryZoneId') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
          then (o.data->>'deliveryZoneId')::uuid
        else null
      end
    ) = p_zone_id)
  )
  select count(*)
  into v_cancelled_orders
  from effective_orders eo
  where eo.status = 'cancelled'
    and eo.date_by >= p_start_date
    and eo.date_by <= p_end_date;

  with returns_base as (
    select
      sr.id,
      sr.total_refund_amount as return_subtotal,
      coalesce(nullif((o.data->>'subtotal')::numeric, null), 0) as order_subtotal,
      coalesce(nullif((o.data->>'discountAmount')::numeric, null), 0) as order_discount,
      greatest(
        0,
        coalesce(nullif((o.data->>'subtotal')::numeric, null), 0)
        - coalesce(nullif((o.data->>'discountAmount')::numeric, null), 0)
      ) as order_net_subtotal,
      coalesce(nullif((o.data->>'taxAmount')::numeric, null), 0) as order_tax
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
  )
  select
    coalesce(sum(return_subtotal), 0),
    coalesce(sum(
      case
        when order_net_subtotal > 0 and order_tax > 0
          then least(order_tax, (return_subtotal / order_net_subtotal) * order_tax)
        else 0
      end
    ), 0)
  into v_total_returns, v_tax_refunds
  from returns_base;

  v_total_tax := greatest(v_total_tax - v_tax_refunds, 0);

  with effective_orders as (
    select
      o.id,
      o.status,
      o.created_at,
      o.delivery_zone_id,
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
    where (p_zone_id is null or coalesce(
      o.delivery_zone_id,
      case
        when nullif(o.data->>'deliveryZoneId','') is not null
             and (o.data->>'deliveryZoneId') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
          then (o.data->>'deliveryZoneId')::uuid
        else null
      end
    ) = p_zone_id)
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
        where o.id = (im.data->>'orderId')::uuid and coalesce(
          o.delivery_zone_id,
          case
            when nullif(o.data->>'deliveryZoneId','') is not null
                 and (o.data->>'deliveryZoneId') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
              then (o.data->>'deliveryZoneId')::uuid
            else null
          end
        ) = p_zone_id
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
        where o.id = dc.order_id and coalesce(
          o.delivery_zone_id,
          case
            when nullif(o.data->>'deliveryZoneId','') is not null
                 and (o.data->>'deliveryZoneId') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
              then (o.data->>'deliveryZoneId')::uuid
            else null
          end
        ) = p_zone_id
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
      coalesce(nullif(o.data->>'orderSource', ''), '') as order_source,
      o.delivery_zone_id
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
      nullif(o.data->>'paidAt','')::timestamptz as paid_at,
      case
        when (o.data->'invoiceSnapshot'->>'issuedAt') is not null
          then nullif(o.data->'invoiceSnapshot'->>'issuedAt','')::timestamptz
        else coalesce(
          nullif(o.data->>'paidAt','')::timestamptz,
          nullif(o.data->>'deliveredAt','')::timestamptz,
          o.created_at
        )
      end as date_by,
      coalesce(nullif(o.delivery_zone_id::text, ''), nullif(o.data->>'deliveryZoneId','')) as zone_effective_text,
      o.data
    from public.orders o
    where (o.status = 'delivered' or nullif(o.data->>'paidAt','') is not null)
      and (
        case when (o.data->'invoiceSnapshot'->>'issuedAt') is not null
             then (o.data->'invoiceSnapshot'->>'issuedAt')::timestamptz
             else coalesce((o.data->>'paidAt')::timestamptz, (o.data->>'deliveredAt')::timestamptz, o.created_at)
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
      coalesce(item->>'itemId', item->>'id') as item_id_text,
      coalesce((item->>'quantity')::numeric, 0) as quantity,
      coalesce((item->>'weight')::numeric, 0) as weight,
      coalesce(item->>'unitType', item->>'unit', 'piece') as unit_type,
      coalesce((item->>'price')::numeric, 0) as price,
      coalesce((item->>'pricePerUnit')::numeric, 0) as price_per_unit,
      item->'selectedAddons' as addons
    from effective_orders eo,
    jsonb_array_elements(
      case when eo.data->'invoiceSnapshot' is not null and jsonb_typeof(eo.data->'invoiceSnapshot'->'items') = 'array'
           then eo.data->'invoiceSnapshot'->'items'
           else eo.data->'items'
      end
    ) as item
  ),
  item_unit_guess as (
    select
      ei.item_id_text,
      max(nullif(ei.unit_type, '')) as unit_type
    from expanded_items ei
    where nullif(ei.item_id_text, '') is not null
    group by ei.item_id_text
  ),
  item_sales as (
    select
      ei.item_id_text,
      sum(
        case
          when coalesce(nullif(ei.unit_type, ''), nullif(mi.unit_type, ''), 'piece') in ('kg', 'gram') and ei.weight > 0
            then (ei.weight * greatest(ei.quantity, 1))
          else greatest(ei.quantity, 0)
        end
      ) as qty_sold,
      sum(
        (
          (
            case
              when coalesce(nullif(ei.unit_type, ''), nullif(mi.unit_type, ''), 'piece') = 'gram'
                   and ei.price_per_unit > 0
                   and ei.weight > 0 then (ei.price_per_unit / 1000.0) * ei.weight
              when coalesce(nullif(ei.unit_type, ''), nullif(mi.unit_type, ''), 'piece') in ('kg', 'gram')
                   and ei.weight > 0 then ei.price * ei.weight
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
          )
          *
          case
            when coalesce(nullif(ei.unit_type, ''), nullif(mi.unit_type, ''), 'piece') in ('kg', 'gram') and ei.weight > 0
              then greatest(ei.quantity, 1)
            else greatest(ei.quantity, 0)
          end
        )
      ) as sales_amount
    from expanded_items ei
    left join public.menu_items mi on mi.id::text = ei.item_id_text
    where nullif(ei.item_id_text, '') is not null
    group by ei.item_id_text
  ),
  returns_movements as (
    select
      im.item_id::text as item_id_text,
      sum(im.quantity) as qty_returned,
      sum(im.total_cost) as cogs_returned
    from public.inventory_movements im
    where im.movement_type = 'return_in'
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
  cogs_data as (
    select
      oic.item_id::text as item_id_text,
      sum(oic.total_cost) as cost_amount
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
    select item_id_text from item_sales
    union
    select item_id_text from returns_movements
  )
  select
    k.item_id_text as item_id,
    coalesce(mi.data->'name', jsonb_build_object('ar', k.item_id_text)) as item_name,
    coalesce(nullif(iug.unit_type, ''), nullif(mi.unit_type, ''), 'piece') as unit_type,
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
  from item_keys k
  left join public.menu_items mi on mi.id::text = k.item_id_text
  left join item_unit_guess iug on iug.item_id_text = k.item_id_text
  left join item_sales its on its.item_id_text = k.item_id_text
  left join returns_movements rm on rm.item_id_text = k.item_id_text
  left join cogs_data cd on cd.item_id_text = k.item_id_text
  left join public.stock_management sm on sm.item_id::text = k.item_id_text
  left join period_movements pm on pm.item_id_text = k.item_id_text
  where (coalesce(its.qty_sold, 0) + coalesce(rm.qty_returned, 0)) > 0
  order by total_sales desc;
end;
$$;

