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
      o.data,
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
  ),
  filtered_orders as (
    select *
    from effective_orders eo
    where (eo.status = 'delivered' or eo.paid_at is not null)
      and eo.date_by >= p_start_date
      and eo.date_by <= p_end_date
  ),
  expanded_items as (
    select
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
      coalesce(
        nullif(item->>'category',''),
        nullif(item->>'categoryId',''),
        'Uncategorized'
      ) as category_key,
      nullif(item->>'categoryName','') as category_name_raw,
      coalesce((item->>'quantity')::numeric, 0) as quantity,
      coalesce((item->>'weight')::numeric, 0) as weight,
      coalesce(item->>'unitType', item->>'unit', 'piece') as unit_type,
      coalesce((item->>'price')::numeric, 0) as price,
      coalesce((item->>'pricePerUnit')::numeric, 0) as price_per_unit,
      item->'selectedAddons' as addons
    from expanded_items
  ),
  computed_lines as (
    select
      l.category_key,
      l.category_name_raw,
      (
        case
          when l.unit_type in ('kg', 'gram') and l.weight > 0
            then (l.weight * greatest(l.quantity, 1))
          else greatest(l.quantity, 0)
        end
      ) as qty_sold,
      (
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
            +
            coalesce((
              select sum(
                coalesce((addon_value->'addon'->>'price')::numeric, 0) *
                coalesce((addon_value->>'quantity')::numeric, 0)
              )
              from jsonb_each(l.addons) as a(key, addon_value)
            ), 0)
          )
          *
          case
            when l.unit_type in ('kg', 'gram') and l.weight > 0
              then greatest(l.quantity, 1)
            else greatest(l.quantity, 0)
          end
        )
      ) as sales_amount
    from lines l
  ),
  labeled as (
    select
      coalesce(
        nullif(cl.category_name_raw, ''),
        nullif(ic.data->'name'->>'ar', ''),
        nullif(ic.data->'name'->>'en', ''),
        case when cl.category_key = 'Uncategorized' then 'غير مصنف' else cl.category_key end
      ) as category_name,
      cl.qty_sold,
      cl.sales_amount
    from computed_lines cl
    left join public.item_categories ic on ic.key = cl.category_key
  )
  select
    l.category_name,
    coalesce(sum(l.sales_amount), 0) as total_sales,
    coalesce(sum(l.qty_sold), 0) as quantity_sold
  from labeled l
  group by l.category_name
  order by 2 desc;
end;
$$;

revoke all on function public.get_sales_by_category(timestamptz, timestamptz, uuid, boolean) from public;
revoke execute on function public.get_sales_by_category(timestamptz, timestamptz, uuid, boolean) from anon;
grant execute on function public.get_sales_by_category(timestamptz, timestamptz, uuid, boolean) to authenticated;
