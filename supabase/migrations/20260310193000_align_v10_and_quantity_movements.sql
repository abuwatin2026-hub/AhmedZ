create or replace function public.get_product_sales_report_v10(
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
language sql
security definer
set search_path = public
as $$
  with base as (
    select *
    from public.get_product_sales_report_v9(
      p_start_date,
      p_end_date,
      p_zone_id,
      p_invoice_only
    )
  )
  select
    b.item_id,
    b.item_name,
    b.unit_type,
    b.quantity_sold,
    b.total_sales,
    case
      when coalesce(b.total_cost, 0) <= 0
           and coalesce(b.total_sales, 0) > 0
           and coalesce(b.total_profit, 0) >= 0
           and coalesce(b.total_profit, 0) < coalesce(b.total_sales, 0)
      then greatest(coalesce(b.total_sales, 0) - coalesce(b.total_profit, 0), 0)
      else b.total_cost
    end as total_cost,
    case
      when coalesce(b.total_cost, 0) <= 0
           and coalesce(b.total_sales, 0) > 0
           and coalesce(b.total_profit, 0) >= 0
           and coalesce(b.total_profit, 0) < coalesce(b.total_sales, 0)
      then coalesce(b.total_profit, 0)
      else b.total_profit
    end as total_profit,
    b.current_stock,
    b.reserved_stock,
    b.current_cost_price,
    b.avg_inventory
  from base b;
$$;

revoke all on function public.get_product_sales_report_v10(timestamptz, timestamptz, uuid, boolean) from public;
revoke execute on function public.get_product_sales_report_v10(timestamptz, timestamptz, uuid, boolean) from anon;
grant execute on function public.get_product_sales_report_v10(timestamptz, timestamptz, uuid, boolean) to authenticated;

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
  with effective_orders as (
    select
      o.id
    from public.orders o
    where o.status <> 'cancelled'
      and (
      nullif(o.data->>'paidAt','') is not null
      or o.status = 'delivered'
      )
      and coalesce(
        nullif(o.data->'invoiceSnapshot'->>'issuedAt', '')::timestamptz,
        nullif(o.data->>'paidAt', '')::timestamptz,
        nullif(o.data->>'deliveredAt', '')::timestamptz,
        nullif(o.data->>'closedAt', '')::timestamptz,
        o.created_at
      ) between p_start_date and p_end_date
      and nullif(trim(coalesce(o.data->>'voidedAt','')), '') is null
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
  sold as (
    select
      im.item_id::text as item_id_text,
      sum(im.quantity) as qty_sold
    from public.inventory_movements im
    join effective_orders eo on eo.id::text = im.reference_id
    where im.reference_table = 'orders'
      and im.movement_type = 'sale_out'
    group by im.item_id::text
  ),
  returned as (
    select
      im.item_id::text as item_id_text,
      sum(im.quantity) as qty_returned
    from public.inventory_movements im
    join public.sales_returns sr on sr.id::text = im.reference_id and sr.status = 'completed'
    join effective_orders eo on eo.id = sr.order_id
    where im.reference_table = 'sales_returns'
      and im.movement_type = 'return_in'
      and im.occurred_at between p_start_date and p_end_date
    group by im.item_id::text
  )
  select
    s.item_id_text as item_id,
    greatest(coalesce(s.qty_sold, 0) - coalesce(r.qty_returned, 0), 0) as quantity_sold
  from sold s
  left join returned r on r.item_id_text = s.item_id_text;
end;
$$;

revoke all on function public.get_product_sales_quantity_from_movements(timestamptz, timestamptz, uuid) from public;
grant execute on function public.get_product_sales_quantity_from_movements(timestamptz, timestamptz, uuid) to authenticated;

notify pgrst, 'reload schema';
