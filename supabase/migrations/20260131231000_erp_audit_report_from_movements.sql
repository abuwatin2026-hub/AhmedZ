-- ERP Audit: Single source of truth for product report - quantity_sold from inventory_movements (sale_out)
-- RPC returns item_id and quantity_sold from movements only; frontend can merge with v9 or use as primary.

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

comment on function public.get_product_sales_quantity_from_movements(timestamptz, timestamptz, uuid) is 'ERP Audit: quantity_sold from inventory_movements (single source of truth) for product report merge';
