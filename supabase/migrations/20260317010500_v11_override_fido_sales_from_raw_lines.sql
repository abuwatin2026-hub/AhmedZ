create or replace function public.get_product_sales_report_v11(
  p_start_date timestamptz,
  p_end_date timestamptz,
  p_zone_id uuid default null,
  p_invoice_only boolean default false
)
returns table(
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
language sql
security definer
set search_path = public
as $$
with base as (
  select *
  from public.get_product_sales_report_v10(p_start_date, p_end_date, p_zone_id, p_invoice_only)
),
sales_orders as (
  select
    o.id,
    o.created_at,
    o.data,
    public.order_fx_rate(
      coalesce(nullif(btrim(coalesce(o.data->>'currency', '')), ''), public.get_base_currency()),
      coalesce(
        case
          when o.data->'invoiceSnapshot' is not null and jsonb_typeof(o.data->'invoiceSnapshot') = 'object'
            then nullif(o.data->'invoiceSnapshot'->>'issuedAt', '')::timestamptz
          else null
        end,
        nullif(o.data->>'createdAt', '')::timestamptz,
        o.created_at
      ),
      nullif(o.data->>'fxRate', '')::numeric
    ) as fx_rate_effective
  from public.orders o
  where o.status = 'delivered'
    and nullif(trim(coalesce(o.data->>'voidedAt', '')), '') is null
    and o.created_at >= p_start_date
    and o.created_at <= p_end_date
),
sales_lines as (
  select
    so.id as order_id,
    so.fx_rate_effective,
    it
  from sales_orders so,
  jsonb_array_elements(
    case
      when so.data->'invoiceSnapshot' is not null and jsonb_typeof(so.data->'invoiceSnapshot'->'items') = 'array'
        then so.data->'invoiceSnapshot'->'items'
      else coalesce(so.data->'items', '[]'::jsonb)
    end
  ) it
),
sales_fido as (
  select
    coalesce(sum(
      (
        case
          when coalesce(nullif(it->>'unitType', ''), nullif(it->>'unit', '')) in ('kg', 'gram')
            then (
              case
                when coalesce((it->>'pricePerUnit')::numeric, 0) > 0 and coalesce((it->>'weight')::numeric, 0) > 0
                  then (coalesce((it->>'pricePerUnit')::numeric, 0) / 1000.0) * coalesce((it->>'weight')::numeric, 0)
                else coalesce((it->>'price')::numeric, 0) * coalesce((it->>'weight')::numeric, 0)
              end
            ) * greatest(coalesce((it->>'quantity')::numeric, 0), 1)
          else
            case
              when coalesce((it->>'pricePerUnit')::numeric, 0) > 0
                then coalesce((it->>'pricePerUnit')::numeric, 0) * greatest(coalesce((it->>'quantity')::numeric, 0), 0)
              when coalesce((it->>'total')::numeric, 0) > 0
                then coalesce((it->>'total')::numeric, 0)
              when coalesce((it->>'quantity')::numeric, 0) > 1
                then coalesce((it->>'price')::numeric, 0)
              else coalesce((it->>'price')::numeric, 0)
            end
        end
      ) * coalesce(fx_rate_effective, 1)
    ), 0) as total_sales_raw
  from sales_lines
  where coalesce(it->>'itemId', it->>'id') = '81e85ebf-1415-49a3-b9fa-0fcae3af6b8a'
),
returns_base as (
  select
    sr.id,
    sr.return_date,
    sr.items,
    o.data as order_data,
    public.order_fx_rate(
      coalesce(nullif(btrim(coalesce(o.data->>'currency', '')), ''), public.get_base_currency()),
      sr.return_date,
      nullif(o.data->>'fxRate', '')::numeric
    ) as fx_rate_effective
  from public.sales_returns sr
  join public.orders o on o.id = sr.order_id
  where sr.status = 'completed'
    and sr.return_date >= p_start_date
    and sr.return_date <= p_end_date
    and nullif(trim(coalesce(o.data->>'voidedAt', '')), '') is null
),
return_lines as (
  select
    rb.fx_rate_effective,
    it
  from returns_base rb,
  jsonb_array_elements(
    case
      when jsonb_typeof(rb.items) = 'array' then rb.items
      when rb.order_data->'invoiceSnapshot' is not null and jsonb_typeof(rb.order_data->'invoiceSnapshot'->'items') = 'array'
        then rb.order_data->'invoiceSnapshot'->'items'
      else coalesce(rb.order_data->'items', '[]'::jsonb)
    end
  ) it
),
returns_fido as (
  select
    coalesce(sum(
      (
        case
          when coalesce(nullif(it->>'unitType', ''), nullif(it->>'unit', '')) in ('kg', 'gram')
            then (
              case
                when coalesce((it->>'pricePerUnit')::numeric, 0) > 0 and coalesce((it->>'weight')::numeric, 0) > 0
                  then (coalesce((it->>'pricePerUnit')::numeric, 0) / 1000.0) * coalesce((it->>'weight')::numeric, 0)
                else coalesce((it->>'price')::numeric, 0) * coalesce((it->>'weight')::numeric, 0)
              end
            ) * greatest(coalesce((it->>'quantity')::numeric, 0), 1)
          else
            case
              when coalesce((it->>'pricePerUnit')::numeric, 0) > 0
                then coalesce((it->>'pricePerUnit')::numeric, 0) * greatest(coalesce((it->>'quantity')::numeric, 0), 0)
              when coalesce((it->>'total')::numeric, 0) > 0
                then coalesce((it->>'total')::numeric, 0)
              when coalesce((it->>'quantity')::numeric, 0) > 1
                then coalesce((it->>'price')::numeric, 0)
              else coalesce((it->>'price')::numeric, 0)
            end
        end
      ) * coalesce(fx_rate_effective, 1)
    ), 0) as total_returns_raw
  from return_lines
  where coalesce(it->>'itemId', it->>'id') = '81e85ebf-1415-49a3-b9fa-0fcae3af6b8a'
),
fido_net as (
  select greatest(sf.total_sales_raw - rf.total_returns_raw, 0)::numeric as net_sales
  from sales_fido sf
  cross join returns_fido rf
)
select
  b.item_id,
  b.item_name,
  b.unit_type,
  b.quantity_sold,
  case
    when b.item_id = '81e85ebf-1415-49a3-b9fa-0fcae3af6b8a' then fn.net_sales
    else b.total_sales
  end as total_sales,
  b.total_cost,
  case
    when b.item_id = '81e85ebf-1415-49a3-b9fa-0fcae3af6b8a' then fn.net_sales - b.total_cost
    else b.total_profit
  end as total_profit,
  b.current_stock,
  b.reserved_stock,
  b.current_cost_price,
  b.avg_inventory
from base b
cross join fido_net fn;
$$;

revoke all on function public.get_product_sales_report_v11(timestamptz, timestamptz, uuid, boolean) from public;
revoke execute on function public.get_product_sales_report_v11(timestamptz, timestamptz, uuid, boolean) from anon;
grant execute on function public.get_product_sales_report_v11(timestamptz, timestamptz, uuid, boolean) to authenticated;

notify pgrst, 'reload schema';
