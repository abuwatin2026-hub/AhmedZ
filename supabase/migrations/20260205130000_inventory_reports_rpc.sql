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

create or replace function public.get_inventory_stock_report(
  p_warehouse_id uuid,
  p_category text default null,
  p_group text default null,
  p_supplier_id uuid default null,
  p_stock_filter text default 'all',
  p_search text default null,
  p_limit integer default 200,
  p_offset integer default 0
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
  low_stock_threshold numeric,
  supplier_ids uuid[],
  total_count integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_limit integer := greatest(1, coalesce(p_limit, 200));
  v_offset integer := greatest(0, coalesce(p_offset, 0));
begin
  if not public.can_view_reports() then
    raise exception 'ليس لديك صلاحية عرض التقارير';
  end if;

  return query
  with base as (
    select
      mi.id as item_id,
      mi.name as item_name,
      mi.category as category,
      nullif(coalesce(mi.data->>'group', ''), '') as item_group,
      coalesce(sm.unit, coalesce(mi.base_unit, coalesce(mi.unit_type, 'piece'))) as unit,
      coalesce(sm.available_quantity, 0) as current_stock,
      coalesce(sm.reserved_quantity, 0) as reserved_stock,
      coalesce(sm.available_quantity, 0) - coalesce(sm.reserved_quantity, 0) as available_stock,
      coalesce(sm.low_stock_threshold, 5) as low_stock_threshold,
      coalesce(array_agg(distinct si.supplier_id) filter (where si.is_active), '{}'::uuid[]) as supplier_ids
    from public.menu_items mi
    left join public.stock_management sm
      on sm.item_id::text = mi.id::text
      and sm.warehouse_id = p_warehouse_id
    left join public.supplier_items si
      on si.item_id::text = mi.id::text
    where coalesce(mi.status, 'active') = 'active'
    group by mi.id, mi.name, mi.category, mi.data, mi.base_unit, mi.unit_type, sm.unit, sm.available_quantity, sm.reserved_quantity, sm.low_stock_threshold
  ),
  filtered as (
    select b.*
    from base b
    where (p_category is null or p_category = '' or b.category = p_category)
      and (p_group is null or p_group = '' or b.item_group = p_group)
      and (p_supplier_id is null or p_supplier_id = any(b.supplier_ids))
      and (
        p_search is null or btrim(p_search) = ''
        or b.item_id ilike '%' || btrim(p_search) || '%'
        or coalesce(b.item_name->>'ar', '') ilike '%' || btrim(p_search) || '%'
        or coalesce(b.item_name->>'en', '') ilike '%' || btrim(p_search) || '%'
      )
      and (
        coalesce(p_stock_filter, 'all') = 'all'
        or (p_stock_filter = 'in' and b.available_stock > b.low_stock_threshold)
        or (p_stock_filter = 'low' and b.available_stock > 0 and b.available_stock <= b.low_stock_threshold)
        or (p_stock_filter = 'out' and b.available_stock <= 0)
      )
  ),
  counted as (
    select f.*, count(*) over ()::integer as total_count
    from filtered f
  )
  select *
  from counted
  order by available_stock asc, item_id asc
  limit v_limit
  offset v_offset;
end;
$$;

revoke all on function public.get_supplier_stock_report(uuid, uuid, integer) from public;
grant execute on function public.get_supplier_stock_report(uuid, uuid, integer) to authenticated;

revoke all on function public.get_inventory_stock_report(uuid, text, text, uuid, text, text, integer, integer) from public;
grant execute on function public.get_inventory_stock_report(uuid, text, text, uuid, text, text, integer, integer) to authenticated;
