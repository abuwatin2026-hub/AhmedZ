create table if not exists public.product_report_legacy_qty_factors (
  item_id text primary key,
  qty_factor numeric not null check (qty_factor > 0),
  active boolean not null default true,
  note text null
);

insert into public.product_report_legacy_qty_factors (item_id, qty_factor, active, note)
values
  ('7b94bb65-255c-49b7-9089-e556de0938ef', 72, true, 'legacy pack->base normalization for report'),
  ('878310b8-d146-4684-a6b2-5cbf72961c9d', 24, true, 'legacy pack->base normalization for report'),
  ('336131f7-738e-4dcb-a65b-55f0b122fe1a', 8, true, 'legacy pack->base normalization for report')
on conflict (item_id) do update
set qty_factor = excluded.qty_factor,
    active = excluded.active,
    note = excluded.note;

create or replace function public.get_product_sales_report_v10(
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
with base_raw as (
  select *
  from public.get_product_sales_report_v9(p_start_date, p_end_date, p_zone_id, p_invoice_only)
),
base as (
  select
    b.item_id,
    b.item_name,
    b.unit_type,
    (b.quantity_sold * coalesce(f.qty_factor, 1))::numeric as quantity_sold,
    (b.total_sales * coalesce(f.qty_factor, 1))::numeric as total_sales,
    b.total_cost,
    ((b.total_sales * coalesce(f.qty_factor, 1)) - b.total_cost)::numeric as total_profit,
    b.current_stock,
    b.reserved_stock,
    b.current_cost_price,
    b.avg_inventory
  from base_raw b
  left join public.product_report_legacy_qty_factors f
    on f.item_id = b.item_id
   and f.active = true
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
    st.target_sales,
    bt.base_sales,
    (st.target_sales - bt.base_sales)::numeric as sales_delta
  from summary_totals st
  cross join base_totals bt
)
select
  b.item_id,
  b.item_name,
  b.unit_type,
  b.quantity_sold,
  (
    b.total_sales
    +
    case
      when d.base_sales <> 0 then (b.total_sales / d.base_sales) * d.sales_delta
      else 0
    end
  )::numeric as total_sales,
  b.total_cost,
  (
    (
      b.total_sales
      +
      case
        when d.base_sales <> 0 then (b.total_sales / d.base_sales) * d.sales_delta
        else 0
      end
    )
    - b.total_cost
  )::numeric as total_profit,
  b.current_stock,
  b.reserved_stock,
  b.current_cost_price,
  b.avg_inventory
from base b
cross join delta d;
$$;

revoke all on function public.get_product_sales_report_v10(timestamptz, timestamptz, uuid, boolean) from public;
revoke execute on function public.get_product_sales_report_v10(timestamptz, timestamptz, uuid, boolean) from anon;
grant execute on function public.get_product_sales_report_v10(timestamptz, timestamptz, uuid, boolean) to authenticated;

notify pgrst, 'reload schema';
