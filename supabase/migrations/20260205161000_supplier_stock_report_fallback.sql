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
  mapped_items as (
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
  purchased_items as (
    select distinct pi.item_id::text as item_id
    from public.purchase_items pi
    join public.purchase_orders po on po.id = pi.purchase_order_id
    where po.supplier_id = p_supplier_id
      and coalesce(po.status, 'draft') <> 'cancelled'
  ),
  supplier_item_set as (
    select mi.item_id,
           mi.reorder_point,
           mi.target_cover_days,
           mi.lead_time_days,
           mi.pack_size
    from mapped_items mi
    union all
    select
      p.item_id,
      0::numeric as reorder_point,
      14::integer as target_cover_days,
      3::integer as lead_time_days,
      1::numeric as pack_size
    from purchased_items p
    where not exists (select 1 from mapped_items m where m.item_id::text = p.item_id::text)
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
    where im.movement_type = 'sale_out'
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
    coalesce(sis.reorder_point, 0) as reorder_point,
    coalesce(sis.target_cover_days, 14) as target_cover_days,
    coalesce(sis.lead_time_days, 3) as lead_time_days,
    coalesce(nullif(sis.pack_size, 0), 1) as pack_size,
    case
      when (coalesce(sla.qty_sold, 0) / (select days_window from params)) <= 0 then 0
      else (
        ceiling(
          greatest(
            0,
            (
              ((coalesce(sis.target_cover_days, 14) + coalesce(sis.lead_time_days, 3))::numeric)
              * (coalesce(sla.qty_sold, 0) / (select days_window from params))
            ) - (coalesce(sa.current_stock, 0) - coalesce(sa.reserved_stock, 0))
          ) / coalesce(nullif(sis.pack_size, 0), 1)
        ) * coalesce(nullif(sis.pack_size, 0), 1)
      )
    end as suggested_qty
  from supplier_item_set sis
  join public.menu_items mi on mi.id = sis.item_id
  left join stock_agg sa on sa.item_id = mi.id
  left join sales_agg sla on sla.item_id = mi.id
  where coalesce(mi.status, 'active') = 'active'
  order by suggested_qty desc, available_stock asc, mi.id asc;
end;
$$;

revoke all on function public.get_supplier_stock_report(uuid, uuid, integer) from public;
grant execute on function public.get_supplier_stock_report(uuid, uuid, integer) to authenticated;
