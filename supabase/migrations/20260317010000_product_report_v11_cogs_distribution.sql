-- =============================================================================
-- Product Report V11 (v2.0): Fix zero-sales items caused by invoiceSnapshot mismatch
--
-- Root Cause: V9 uses invoiceSnapshot.items when available. Some orders store
-- different items in invoiceSnapshot vs data.items (invoice may cover only
-- part of the order). Items that appear in data.items but NOT in invoiceSnapshot
-- get zero sales in V9/V10.
--
-- Fix Strategy:
--   A) Compute "recovered_sales" directly from order_item_cogs + data.items
--      for items that V10 shows as zero-sales but non-zero COGS.
--   B) For normal items, keep V10 proportional sales (already aligned to summary).
--   C) Distribute total COGS proportionally by final sales to keep margins sane.
--
-- Applied: 2026-03-17
-- =============================================================================

create or replace function public.get_product_sales_report_v11(
  p_start_date   timestamptz,
  p_end_date     timestamptz,
  p_zone_id      uuid    default null,
  p_invoice_only boolean default false
)
returns table (
  item_id            text,
  item_name          jsonb,
  unit_type          text,
  quantity_sold      numeric,
  total_sales        numeric,
  total_cost         numeric,
  total_profit       numeric,
  current_stock      numeric,
  reserved_stock     numeric,
  current_cost_price numeric,
  avg_inventory      numeric
)
language sql
security definer
set search_path = public
as $$
with
-- Step 1: V10 base (sales aligned to summary, per-item)
v10 as (
  select *
  from public.get_product_sales_report_v10(p_start_date, p_end_date, p_zone_id, p_invoice_only)
),
-- Step 2: Identify items with COGS but zero sales in V10 (the "missed items")
missed_items as (
  select item_id from v10
  where total_sales = 0 and total_cost > 0
),
-- Step 3: For missed items, recover sales from order JSON data.items
-- Use order_item_cogs as the bridge to find the orders, then
-- compute revenue from data.items using the item id (not invoiceSnapshot)
recovered_sales as (
  select
    oic.item_id::text as item_id,
    sum(
      coalesce(
        (item_json->>'quantity')::numeric, 0
      ) *
      coalesce(
        (item_json->>'price')::numeric, 0
      ) *
      coalesce(o.fx_rate, 1)
    ) as recovered_revenue,
    sum(coalesce((item_json->>'quantity')::numeric, 0)) as recovered_qty
  from public.order_item_cogs oic
  join public.orders o on o.id = oic.order_id
  -- Expand data.items (the raw items, not invoiceSnapshot)
  cross join lateral jsonb_array_elements(
    case
      when jsonb_typeof(o.data->'items') = 'array' then o.data->'items'
      else '[]'::jsonb
    end
  ) as item_json
  where
    oic.item_id::text in (select item_id from missed_items)
    -- Item JSON must match by id or itemId
    and coalesce(
      nullif(item_json->>'itemId', ''),
      nullif(item_json->>'id', '')
    ) = oic.item_id::text
    -- Filter by reporting period using deliveredAt or created_at
    and coalesce(
      nullif(o.data->>'deliveredAt', '')::timestamptz,
      o.created_at
    ) >= p_start_date
    and coalesce(
      nullif(o.data->>'deliveredAt', '')::timestamptz,
      o.created_at
    ) <= p_end_date
    -- Exclude voided orders
    and nullif(trim(coalesce(o.data->>'voidedAt', '')), '') is null
    and o.status <> 'cancelled'
  group by oic.item_id::text
),
-- Step 4: Merge V10 data with recovered sales for missed items
merged as (
  select
    v10.item_id,
    v10.item_name,
    v10.unit_type,
    case
      when rs.item_id is not null
        then coalesce(rs.recovered_qty, v10.quantity_sold)
      else v10.quantity_sold
    end as quantity_sold,
    case
      when rs.item_id is not null
        then coalesce(rs.recovered_revenue, 0)
      else v10.total_sales
    end as merged_sales,
    v10.total_cost,
    v10.current_stock,
    v10.reserved_stock,
    v10.current_cost_price,
    v10.avg_inventory
  from v10
  left join recovered_sales rs on rs.item_id = v10.item_id
),
-- Step 5: Re-align total sales to summary after injection of recovered sales
merged_total as (
  select coalesce(sum(merged_sales), 0) as base_sales from merged
),
summary_result as (
  select
    coalesce((s ->> 'cogs')::numeric, 0) as target_cogs,
    coalesce((s ->> 'total_sales_accrual')::numeric, 0) - coalesce((s ->> 'returns_total')::numeric, 0) as target_sales
  from (select public.get_sales_report_summary(p_start_date, p_end_date, p_zone_id, p_invoice_only) as s) x
),
-- Step 6: Proportionally scale sales to summary total, apply COGS by sales share
final as (
  select
    m.item_id,
    m.item_name,
    m.unit_type,
    m.quantity_sold,
    -- Re-scale sales proportionally to match summary target
    case
      when mt.base_sales > 0
        then round((m.merged_sales / mt.base_sales) * sr.target_sales, 4)
      else 0
    end as final_sales,
    -- Allocate COGS by revenue share (sales-proportional)
    case
      when mt.base_sales > 0 and m.merged_sales > 0
        then round((m.merged_sales / mt.base_sales) * sr.target_cogs, 2)
      else round(m.total_cost, 2)
    end as final_cost,
    m.current_stock,
    m.reserved_stock,
    m.current_cost_price,
    m.avg_inventory
  from merged m
  cross join merged_total mt
  cross join summary_result sr
)
select
  f.item_id,
  f.item_name,
  f.unit_type,
  f.quantity_sold,
  f.final_sales                       as total_sales,
  f.final_cost                        as total_cost,
  (f.final_sales - f.final_cost)      as total_profit,
  f.current_stock,
  f.reserved_stock,
  f.current_cost_price,
  f.avg_inventory
from final f
order by f.final_sales desc;
$$;

revoke all      on function public.get_product_sales_report_v11(timestamptz, timestamptz, uuid, boolean) from public;
revoke execute  on function public.get_product_sales_report_v11(timestamptz, timestamptz, uuid, boolean) from anon;
grant execute   on function public.get_product_sales_report_v11(timestamptz, timestamptz, uuid, boolean) to authenticated;

notify pgrst, 'reload schema';
