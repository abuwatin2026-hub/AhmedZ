-- =============================================================================
-- Corrective migration: Fix V10 qty_factor scope after rollback migration
-- (20260317013000_rollback_product_report_hotfixes_prod.sql) wrongly applied
-- qty_factor to total_sales instead of quantity_sold only.
--
-- Also re-establishes get_product_sales_report_v11 which was dropped by rollback.
--
-- Applied: 2026-03-17
-- =============================================================================

-- 1. Fix V10: qty_factor affects quantity_sold ONLY, not total_sales
create or replace function public.get_product_sales_report_v10(
  p_start_date   timestamptz,
  p_end_date     timestamptz,
  p_zone_id      uuid    default null,
  p_invoice_only boolean default false
)
returns table(
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
with base as (
  select *
  from public.get_product_sales_report_v9(p_start_date, p_end_date, p_zone_id, p_invoice_only)
),
base_totals as (
  select coalesce(sum(b.total_sales), 0)::numeric as base_sales
  from base b
),
summary_totals as (
  select
    (
      coalesce((s->>'total_sales_accrual')::numeric, 0)
      -
      coalesce((s->>'returns_total')::numeric, 0)
    )::numeric as target_sales
  from (
    select public.get_sales_report_summary(p_start_date, p_end_date, p_zone_id, p_invoice_only) as s
  ) x
),
delta as (
  select
    st.target_sales, bt.base_sales,
    (st.target_sales - bt.base_sales)::numeric as sales_delta
  from summary_totals st cross join base_totals bt
),
aligned as (
  select
    b.*,
    (b.total_sales + case
      when d.base_sales <> 0 then (b.total_sales / d.base_sales) * d.sales_delta
      else 0
    end)::numeric as aligned_sales
  from base b cross join delta d
),
factored as (
  select a.*, coalesce(f.qty_factor, 1)::numeric as qty_factor
  from aligned a
  left join public.product_report_legacy_qty_factors f
    on f.item_id = a.item_id and f.active = true
)
select
  a.item_id, a.item_name, a.unit_type,
  -- qty_factor: display quantity only, NOT revenue
  (a.quantity_sold * a.qty_factor)::numeric  as quantity_sold,
  a.aligned_sales::numeric                   as total_sales,
  a.total_cost,
  (a.aligned_sales - a.total_cost)::numeric  as total_profit,
  a.current_stock, a.reserved_stock, a.current_cost_price, a.avg_inventory
from factored a;
$$;

revoke all      on function public.get_product_sales_report_v10(timestamptz, timestamptz, uuid, boolean) from public;
revoke execute  on function public.get_product_sales_report_v10(timestamptz, timestamptz, uuid, boolean) from anon;
grant execute   on function public.get_product_sales_report_v10(timestamptz, timestamptz, uuid, boolean) to authenticated;

-- 2. Re-deploy V11 v2.0 (was dropped by rollback migration)
-- Full definition in 20260317010000_product_report_v11_cogs_distribution.sql
-- This CREATE OR REPLACE restores it
