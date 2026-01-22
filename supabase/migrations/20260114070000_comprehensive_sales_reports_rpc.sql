-- 1. Daily Sales Stats (for Line Chart)
create or replace function public.get_daily_sales_stats(
  p_start_date timestamptz,
  p_end_date timestamptz,
  p_zone_id uuid default null
)
returns table (
  day_date date,
  total_sales numeric,
  order_count bigint
)
language plpgsql
security definer
as $$
begin
  return query
  select
    (case when (data->'invoiceSnapshot'->>'issuedAt') is not null
          then (data->'invoiceSnapshot'->>'issuedAt')::timestamptz
          else coalesce((data->>'paidAt')::timestamptz, (data->>'deliveredAt')::timestamptz, created_at)
     end)::date as d,
    sum(coalesce((data->>'total')::numeric, 0)) as sales,
    count(id) as cnt
  from public.orders
  where status = 'delivered'
    and (data->>'paidAt') is not null
    and (p_zone_id is null or delivery_zone_id = p_zone_id)
    and (
      case when (data->'invoiceSnapshot'->>'issuedAt') is not null
           then (data->'invoiceSnapshot'->>'issuedAt')::timestamptz
           else coalesce((data->>'paidAt')::timestamptz, (data->>'deliveredAt')::timestamptz, created_at)
      end
    ) between p_start_date and p_end_date
  group by 1
  order by 1;
end;
$$;
-- 2. Sales by Category (New Feature)
create or replace function public.get_sales_by_category(
  p_start_date timestamptz,
  p_end_date timestamptz,
  p_zone_id uuid default null
)
returns table (
  category_name text,
  total_sales numeric,
  quantity_sold numeric
)
language plpgsql
security definer
as $$
begin
  return query
  with items as (
    select
      coalesce(item->>'categoryId', 'Uncategorized') as cat_id,
      coalesce((item->>'price')::numeric, 0) * coalesce((item->>'quantity')::numeric, 0) as line_total,
      coalesce((item->>'quantity')::numeric, 0) as qty
    from public.orders o,
    jsonb_array_elements(
      case when o.data->'invoiceSnapshot' is not null and jsonb_typeof(o.data->'invoiceSnapshot'->'items') = 'array'
           then o.data->'invoiceSnapshot'->'items'
           else o.data->'items'
      end
    ) as item
    where o.status = 'delivered'
      and (o.data->>'paidAt') is not null
      and (p_zone_id is null or o.delivery_zone_id = p_zone_id)
      and (
        case when (o.data->'invoiceSnapshot'->>'issuedAt') is not null
             then (o.data->'invoiceSnapshot'->>'issuedAt')::timestamptz
             else coalesce((o.data->>'paidAt')::timestamptz, (o.data->>'deliveredAt')::timestamptz, o.created_at)
        end
      ) between p_start_date and p_end_date
  )
  select
    coalesce(c.name->>'ar', c.name->>'en', i.cat_id) as c_name,
    sum(i.line_total) as t_sales,
    sum(i.qty) as t_qty
  from items i
  left join public.categories c on c.id = i.cat_id
  group by 1
  order by 2 desc;
end;
$$;
-- 3. Hourly Sales Stats (Heatmap/Peak Analysis)
create or replace function public.get_hourly_sales_stats(
  p_start_date timestamptz,
  p_end_date timestamptz,
  p_zone_id uuid default null
)
returns table (
  hour_of_day int,
  total_sales numeric,
  order_count bigint
)
language plpgsql
security definer
as $$
begin
  return query
  select
    extract(hour from (
      case when (data->'invoiceSnapshot'->>'issuedAt') is not null
           then (data->'invoiceSnapshot'->>'issuedAt')::timestamptz
           else coalesce((data->>'paidAt')::timestamptz, (data->>'deliveredAt')::timestamptz, created_at)
      end
    ))::int as h,
    sum(coalesce((data->>'total')::numeric, 0)) as sales,
    count(id) as cnt
  from public.orders
  where status = 'delivered'
    and (data->>'paidAt') is not null
    and (p_zone_id is null or delivery_zone_id = p_zone_id)
    and (
      case when (data->'invoiceSnapshot'->>'issuedAt') is not null
           then (data->'invoiceSnapshot'->>'issuedAt')::timestamptz
           else coalesce((data->>'paidAt')::timestamptz, (data->>'deliveredAt')::timestamptz, created_at)
      end
    ) between p_start_date and p_end_date
  group by 1
  order by 1;
end;
$$;
-- 4. Payment Method Stats
create or replace function public.get_payment_method_stats(
  p_start_date timestamptz,
  p_end_date timestamptz,
  p_zone_id uuid default null
)
returns table (
  method text,
  total_sales numeric,
  order_count bigint
)
language plpgsql
security definer
as $$
begin
  return query
  select
    coalesce(data->>'paymentMethod', 'unknown') as m,
    sum(coalesce((data->>'total')::numeric, 0)) as sales,
    count(id) as cnt
  from public.orders
  where status = 'delivered'
    and (data->>'paidAt') is not null
    and (p_zone_id is null or delivery_zone_id = p_zone_id)
    and (
      case when (data->'invoiceSnapshot'->>'issuedAt') is not null
           then (data->'invoiceSnapshot'->>'issuedAt')::timestamptz
           else coalesce((data->>'paidAt')::timestamptz, (data->>'deliveredAt')::timestamptz, created_at)
      end
    ) between p_start_date and p_end_date
  group by 1
  order by 2 desc;
end;
$$;
-- 5. Driver Performance Report
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
