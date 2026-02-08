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
        coalesce(nullif((o.data->>'total')::numeric, null), 0) * coalesce(o.fx_rate, 1)
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
      eo.paid_at is not null
      or (eo.status = 'delivered' and eo.payment_method <> 'cash')
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
  if not public.is_staff() then
    raise exception 'not allowed';
  end if;

  with effective_orders as (
    select
      o.id,
      o.status,
      o.created_at,
      coalesce(nullif(o.data->>'paymentMethod', ''), '') as payment_method,
      nullif(o.data->>'paidAt', '')::timestamptz as paid_at,
      coalesce(o.fx_rate, 1) as fx_rate,
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
        coalesce(nullif((o.data->>'total')::numeric, null), 0) * coalesce(o.fx_rate, 1)
      ) as total,
      (coalesce(nullif((o.data->>'taxAmount')::numeric, null), 0) * coalesce(o.fx_rate, 1)) as tax_amount,
      (coalesce(nullif((o.data->>'deliveryFee')::numeric, null), 0) * coalesce(o.fx_rate, 1)) as delivery_fee,
      (coalesce(nullif((o.data->>'discountAmount')::numeric, null), 0) * coalesce(o.fx_rate, 1)) as discount_amount,
      (coalesce(nullif((o.data->>'subtotal')::numeric, null), 0) * coalesce(o.fx_rate, 1)) as subtotal,
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
  where (
      eo.paid_at is not null
      or (eo.status = 'delivered' and eo.payment_method <> 'cash')
  )
    and eo.date_by >= p_start_date
    and eo.date_by <= p_end_date;

  with effective_orders as (
    select
      o.id,
      o.status,
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
  select count(*)
  into v_cancelled_orders
  from effective_orders eo
  where eo.status = 'cancelled'
    and eo.date_by >= p_start_date
    and eo.date_by <= p_end_date;

  with returns_base as (
    select
      coalesce(o.fx_rate, 1) as fx_rate,
      (coalesce(nullif((o.data->>'subtotal')::numeric, null), 0) * coalesce(o.fx_rate, 1)) as order_subtotal,
      (coalesce(nullif((o.data->>'discountAmount')::numeric, null), 0) * coalesce(o.fx_rate, 1)) as order_discount,
      greatest(
        (coalesce(nullif((o.data->>'subtotal')::numeric, null), 0) * coalesce(o.fx_rate, 1))
        - (coalesce(nullif((o.data->>'discountAmount')::numeric, null), 0) * coalesce(o.fx_rate, 1)),
        0
      ) as order_net_subtotal,
      (coalesce(nullif((o.data->>'taxAmount')::numeric, null), 0) * coalesce(o.fx_rate, 1)) as order_tax,
      (coalesce(sum(coalesce(nullif((i->>'quantity')::numeric, null), 0) * coalesce(nullif((i->>'unitPrice')::numeric, null), 0)), 0) * coalesce(o.fx_rate, 1)) as return_subtotal,
      (coalesce(sum(sr.total_refund_amount), 0) * coalesce(o.fx_rate, 1)) as total_refund_amount
    from public.sales_returns sr
    join public.orders o on o.id::text = sr.order_id::text
    cross join lateral jsonb_array_elements(coalesce(sr.items, '[]'::jsonb)) i
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
    group by o.id, o.data, o.fx_rate
  )
  select
    coalesce(sum(total_refund_amount), 0),
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
      and nullif(trim(coalesce(o.data->>'voidedAt','')), '') is null
  )
  select coalesce(sum(oic.total_cost), 0)
  into v_total_cogs
  from public.order_item_cogs oic
  join effective_orders eo on oic.order_id = eo.id
  where (
      eo.paid_at is not null
      or (eo.status = 'delivered' and eo.payment_method <> 'cash')
  )
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
        where o.id::text = (im.data->>'orderId')
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

  if to_regclass('public.delivery_costs') is not null then
    select coalesce(sum(dc.cost_amount), 0)
    into v_total_delivery_cost
    from public.delivery_costs dc
    where dc.occurred_at >= p_start_date
      and dc.occurred_at <= p_end_date
      and (
        p_zone_id is null or exists (
          select 1 from public.orders o
          where o.id = dc.order_id
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
      );
  else
    v_total_delivery_cost := 0;
  end if;

  with effective_orders as (
    select
      o.id,
      o.status,
      coalesce(nullif(o.data->>'orderSource', ''), '') as order_source,
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
    coalesce(count(*) filter (where eo.status = 'out_for_delivery'), 0),
    coalesce(count(*) filter (where eo.status = 'delivered' and eo.order_source = 'in_store'), 0),
    coalesce(count(*) filter (where eo.status = 'delivered' and eo.order_source <> 'in_store'), 0)
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

revoke all on function public.get_sales_report_summary(timestamptz, timestamptz, uuid, boolean) from public;
grant execute on function public.get_sales_report_summary(timestamptz, timestamptz, uuid, boolean) to authenticated;

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
        coalesce(nullif((o.data->>'total')::numeric, null), 0) * coalesce(o.fx_rate, 1)
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
      or (eo.status = 'delivered' and eo.payment_method <> 'cash')
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
        coalesce(nullif((o.data->>'total')::numeric, null), 0) * coalesce(o.fx_rate, 1)
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
      or (eo.status = 'delivered' and eo.payment_method <> 'cash')
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
        coalesce(nullif((o.data->>'total')::numeric, null), 0) * coalesce(o.fx_rate, 1)
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
      or (eo.status = 'delivered' and eo.method <> 'cash')
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
        coalesce(nullif((o.data->>'total')::numeric, null), 0) * coalesce(o.fx_rate, 1)
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
      or (eo.status = 'delivered' and eo.payment_method <> 'cash')
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
      coalesce(nullif(o.fx_rate, 0), 1) as fx_rate,
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
        or (eo.status = 'delivered' and eo.payment_method <> 'cash')
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

create or replace function public.get_driver_performance_stats(
  p_start_date timestamptz,
  p_end_date timestamptz
)
returns table (
  driver_id uuid,
  driver_name text,
  delivered_count bigint,
  avg_delivery_minutes numeric
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
  with driver_stats as (
    select
      assigned_delivery_user_id as did,
      count(*) as d_count,
      avg(
        extract(epoch from (
          (data->>'deliveredAt')::timestamptz - (data->>'outForDeliveryAt')::timestamptz
        )) / 60
      ) as avg_mins
    from public.orders
    where status = 'delivered'
      and nullif(trim(coalesce(data->>'voidedAt','')), '') is null
      and assigned_delivery_user_id is not null
      and (data->>'outForDeliveryAt') is not null
      and (data->>'deliveredAt') is not null
      and (
        case when (data->'invoiceSnapshot'->>'issuedAt') is not null
             then (data->'invoiceSnapshot'->>'issuedAt')::timestamptz
             else coalesce((data->>'paidAt')::timestamptz, (data->>'deliveredAt')::timestamptz, created_at)
        end
      ) between p_start_date and p_end_date
    group by 1
  )
  select
    ds.did,
    coalesce(au.raw_user_meta_data->>'full_name', au.email, 'Unknown') as d_name,
    ds.d_count,
    ds.avg_mins::numeric
  from driver_stats ds
  left join auth.users au on au.id = ds.did
  order by 3 desc;
end;
$$;

revoke all on function public.get_driver_performance_stats(timestamptz, timestamptz) from public;
revoke execute on function public.get_driver_performance_stats(timestamptz, timestamptz) from anon;
grant execute on function public.get_driver_performance_stats(timestamptz, timestamptz) to authenticated;

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
    and o.status = 'delivered'
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

create or replace function public.get_supplier_stock_report(
  p_supplier_id uuid,
  p_warehouse_id uuid default null,
  p_days integer default 7
)
returns table (
  item_id text,
  item_name jsonb,
  category text,
  item_group text,
  unit text,
  current_stock numeric,
  reserved_stock numeric,
  available_stock numeric,
  avg_daily_sales numeric,
  days_cover numeric,
  reorder_point numeric,
  target_cover_days integer,
  lead_time_days integer,
  pack_size numeric,
  suggested_qty numeric
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.can_view_reports() then
    raise exception 'ليس لديك صلاحية عرض التقارير';
  end if;

  return query
  with params as (
    select greatest(1, coalesce(p_days, 7))::numeric as days_window
  ),
  supplier_items_active as (
    select
      si.item_id,
      si.reorder_point,
      si.target_cover_days,
      si.lead_time_days,
      si.pack_size
    from public.supplier_items si
    where si.supplier_id = p_supplier_id
      and si.is_active = true
  ),
  stock_agg as (
    select
      sm.item_id,
      coalesce(sum(sm.available_quantity), 0) as current_stock,
      coalesce(sum(sm.reserved_quantity), 0) as reserved_stock,
      max(coalesce(sm.unit, 'piece')) as unit
    from public.stock_management sm
    where (p_warehouse_id is null or sm.warehouse_id = p_warehouse_id)
    group by sm.item_id
  ),
  sales_agg as (
    select
      im.item_id,
      coalesce(sum(im.quantity), 0) as qty_sold
    from public.inventory_movements im
    join public.orders o
      on im.reference_table = 'orders'
     and o.id::text = im.reference_id::text
     and o.status = 'delivered'
     and nullif(trim(coalesce(o.data->>'voidedAt','')), '') is null
    where im.movement_type = 'sale_out'
      and im.reference_table = 'orders'
      and im.occurred_at >= (now() - (greatest(1, coalesce(p_days, 7))::text || ' days')::interval)
      and (p_warehouse_id is null or im.warehouse_id = p_warehouse_id)
    group by im.item_id
  )
  select
    mi.id as item_id,
    mi.name as item_name,
    mi.category as category,
    nullif(coalesce(mi.data->>'group', ''), '') as item_group,
    coalesce(sa.unit, coalesce(mi.base_unit, coalesce(mi.unit_type, 'piece'))) as unit,
    coalesce(sa.current_stock, 0) as current_stock,
    coalesce(sa.reserved_stock, 0) as reserved_stock,
    coalesce(sa.current_stock, 0) - coalesce(sa.reserved_stock, 0) as available_stock,
    (coalesce(sla.qty_sold, 0) / (select days_window from params)) as avg_daily_sales,
    case
      when (coalesce(sla.qty_sold, 0) / (select days_window from params)) > 0
        then (coalesce(sa.current_stock, 0) - coalesce(sa.reserved_stock, 0)) / (coalesce(sla.qty_sold, 0) / (select days_window from params))
      else null
    end as days_cover,
    coalesce(sia.reorder_point, 0) as reorder_point,
    coalesce(sia.target_cover_days, 14) as target_cover_days,
    coalesce(sia.lead_time_days, 3) as lead_time_days,
    coalesce(nullif(sia.pack_size, 0), 1) as pack_size,
    case
      when (coalesce(sla.qty_sold, 0) / (select days_window from params)) <= 0 then 0
      else (
        ceiling(
          greatest(
            0,
            (
              ((coalesce(sia.target_cover_days, 14) + coalesce(sia.lead_time_days, 3))::numeric)
              * (coalesce(sla.qty_sold, 0) / (select days_window from params))
            ) - (coalesce(sa.current_stock, 0) - coalesce(sa.reserved_stock, 0))
          ) / coalesce(nullif(sia.pack_size, 0), 1)
        ) * coalesce(nullif(sia.pack_size, 0), 1)
      )
    end as suggested_qty
  from supplier_items_active sia
  join public.menu_items mi on mi.id = sia.item_id
  left join stock_agg sa on sa.item_id = mi.id
  left join sales_agg sla on sla.item_id = mi.id
  order by suggested_qty desc, (coalesce(sa.current_stock, 0) - coalesce(sa.reserved_stock, 0)) asc, mi.id asc;
end;
$$;

revoke all on function public.get_supplier_stock_report(uuid, uuid, integer) from public;
grant execute on function public.get_supplier_stock_report(uuid, uuid, integer) to authenticated;

select pg_sleep(0.5);
notify pgrst, 'reload schema';

