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
      coalesce(nullif((o.data->>'total')::numeric, null), 0) as total,
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
  where (eo.status = 'delivered' or eo.paid_at is not null)
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
      coalesce(nullif((o.data->>'total')::numeric, null), 0) as total,
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
  )
  select
    eo.date_by::date as day_date,
    sum(eo.total) as total_sales,
    count(*) as order_count
  from effective_orders eo
  where (eo.status = 'delivered' or eo.paid_at is not null)
    and eo.date_by >= p_start_date
    and eo.date_by <= p_end_date
  group by 1
  order by 1;
end;
$$;

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
      coalesce(nullif((o.data->>'total')::numeric, null), 0) as total,
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
  )
  select
    extract(hour from eo.date_by)::int as hour_of_day,
    sum(eo.total) as total_sales,
    count(*) as order_count
  from effective_orders eo
  where (eo.status = 'delivered' or eo.paid_at is not null)
    and eo.date_by >= p_start_date
    and eo.date_by <= p_end_date
  group by 1
  order by 1;
end;
$$;

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
      o.id,
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
      coalesce(nullif((o.data->>'total')::numeric, null), 0) as total,
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
  )
  select
    method,
    sum(total) as total_sales,
    count(*) as order_count
  from effective_orders eo
  where (eo.status = 'delivered' or eo.paid_at is not null)
    and eo.date_by >= p_start_date
    and eo.date_by <= p_end_date
  group by 1
  order by 2 desc;
end;
$$;
