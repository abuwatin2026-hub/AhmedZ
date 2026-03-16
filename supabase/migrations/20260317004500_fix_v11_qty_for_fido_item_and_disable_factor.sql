update public.product_report_legacy_qty_factors
set active = false,
    note = coalesce(note, '') || ' | disabled on 2026-03-17 due wrong qty inflation'
where item_id = '81e85ebf-1415-49a3-b9fa-0fcae3af6b8a';

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
select
  v.item_id,
  v.item_name,
  v.unit_type,
  case
    when v.item_id = '81e85ebf-1415-49a3-b9fa-0fcae3af6b8a' then v.quantity_sold
    else v.quantity_sold
  end as quantity_sold,
  v.total_sales,
  v.total_cost,
  v.total_profit,
  v.current_stock,
  v.reserved_stock,
  v.current_cost_price,
  v.avg_inventory
from public.get_product_sales_report_v10(p_start_date, p_end_date, p_zone_id, p_invoice_only) v;
$$;

revoke all on function public.get_product_sales_report_v11(timestamptz, timestamptz, uuid, boolean) from public;
revoke execute on function public.get_product_sales_report_v11(timestamptz, timestamptz, uuid, boolean) from anon;
grant execute on function public.get_product_sales_report_v11(timestamptz, timestamptz, uuid, boolean) to authenticated;

notify pgrst, 'reload schema';
