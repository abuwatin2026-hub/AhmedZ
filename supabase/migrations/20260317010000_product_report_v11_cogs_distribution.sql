-- =============================================================================
-- Product Report V11 (v1.1): Fix per-item COGS using sales-proportional allocation
-- + Exact COGS rounding (last-remainder adjustment)
--
-- Formula: item_cost_v11 = (item_sales / total_sales) × total_summary_cogs
-- Ensures SUM(total_cost) = summary.cogs EXACTLY (via last-item remainder adjust)
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
-- Step 1: Raw V10 data (sales already aligned to summary)
v10 as (
  select *
  from public.get_product_sales_report_v10(p_start_date, p_end_date, p_zone_id, p_invoice_only)
),
-- Step 2: Authoritative COGS from summary
summary_result as (
  select coalesce((s ->> 'cogs')::numeric, 0) as target_cogs
  from (select public.get_sales_report_summary(p_start_date, p_end_date, p_zone_id, p_invoice_only) as s) x
),
-- Step 3: Total V10 sales for proportion calculation
v10_total as (
  select coalesce(sum(total_sales), 0) as base_sales
  from v10
),
-- Step 4: Allocate COGS proportionally by revenue share
-- Use cumulative sum so we can apply last-item remainder trick
allocated as (
  select
    v10.*,
    sr.target_cogs,
    vt.base_sales,
    -- Proportional share for items WITH sales
    case
      when vt.base_sales > 0 and v10.total_sales > 0
        then round((v10.total_sales / vt.base_sales) * sr.target_cogs, 2)
      else 0
    end as item_allocated_cost,
    -- Window: cumulative allocated cost for last-item adjustment
    sum(
      case
        when vt.base_sales > 0 and v10.total_sales > 0
          then round((v10.total_sales / vt.base_sales) * sr.target_cogs, 2)
        else 0
      end
    ) over (order by v10.total_sales desc rows between unbounded preceding and current row) as cumulative_cost,
    -- Mark last item that has sales (for remainder adjustment)
    row_number() over (order by v10.total_sales desc) as rn,
    count(*) over () as total_rows,
    count(case when v10.total_sales > 0 then 1 end) over () as sales_item_count,
    row_number() over (partition by case when v10.total_sales > 0 then 1 else 0 end order by v10.total_sales asc) as sales_item_rn
  from v10
  cross join summary_result sr
  cross join v10_total vt
),
-- Step 5: Final cost = allocated, except last sales-item gets remainder to ensure SUM = target_cogs
final as (
  select
    a.item_id,
    a.item_name,
    a.unit_type,
    a.quantity_sold,
    a.total_sales,
    case
      -- Last item with sales: adjust to make sum exact
      when a.sales_item_rn = 1 and a.total_sales > 0 and a.base_sales > 0
        then greatest(
          a.target_cogs - (a.cumulative_cost - a.item_allocated_cost),
          0
        )
      when a.total_sales > 0 and a.base_sales > 0
        then a.item_allocated_cost
      -- Items with zero sales: keep original V10 cost (typically 0 or small return cost)
      else a.total_cost
    end as final_cost,
    a.current_stock,
    a.reserved_stock,
    a.current_cost_price,
    a.avg_inventory
  from allocated a
)
select
  f.item_id,
  f.item_name,
  f.unit_type,
  f.quantity_sold,
  f.total_sales,
  f.final_cost                     as total_cost,
  (f.total_sales - f.final_cost)   as total_profit,
  f.current_stock,
  f.reserved_stock,
  f.current_cost_price,
  f.avg_inventory
from final f
order by f.total_sales desc;
$$;

revoke all      on function public.get_product_sales_report_v11(timestamptz, timestamptz, uuid, boolean) from public;
revoke execute  on function public.get_product_sales_report_v11(timestamptz, timestamptz, uuid, boolean) from anon;
grant execute   on function public.get_product_sales_report_v11(timestamptz, timestamptz, uuid, boolean) to authenticated;

notify pgrst, 'reload schema';
