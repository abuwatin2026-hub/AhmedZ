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
  return query
  with effective_orders as (
    select
      o.data,
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
    where (o.status = 'delivered' or (o.data->>'paidAt') is not null)
      and (
        p_zone_id is null
        or coalesce(
          o.delivery_zone_id,
          case
            when nullif(o.data->>'deliveryZoneId','') is not null
                 and (o.data->>'deliveryZoneId') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
              then (o.data->>'deliveryZoneId')::uuid
            else null
          end
        ) = p_zone_id
      )
  ),
  items as (
    select
      coalesce(
        nullif(item->>'categoryName',''),
        nullif(item->>'category',''),
        nullif(item->>'categoryId',''),
        'Uncategorized'
      ) as cat_name,
      coalesce((item->>'price')::numeric, 0) * coalesce((item->>'quantity')::numeric, 0) as line_total,
      coalesce((item->>'quantity')::numeric, 0) as qty
    from effective_orders eo,
    jsonb_array_elements(
      case
        when p_invoice_only then
          case
            when jsonb_typeof(eo.data->'invoiceSnapshot'->'items') = 'array' then eo.data->'invoiceSnapshot'->'items'
            else '[]'::jsonb
          end
        else
          case
            when jsonb_typeof(eo.data->'invoiceSnapshot'->'items') = 'array' then eo.data->'invoiceSnapshot'->'items'
            when jsonb_typeof(eo.data->'items') = 'array' then eo.data->'items'
            else '[]'::jsonb
          end
      end
    ) as item
    where eo.paid_at is not null
      and eo.date_by between p_start_date and p_end_date
  )
  select
    cat_name as category_name,
    sum(line_total) as total_sales,
    sum(qty) as quantity_sold
  from items
  group by cat_name
  order by 2 desc;
end;
$$;
