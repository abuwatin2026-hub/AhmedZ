create or replace function public.get_product_sales_report_v7(
  p_start_date text,
  p_end_date text,
  p_zone_id_text text default null
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
  select *
  from public.get_product_sales_report_v7(
    p_start_date::timestamptz,
    p_end_date::timestamptz,
    p_zone_id_text
  );
$$;

revoke all on function public.get_product_sales_report_v7(text, text, text) from public;
grant execute on function public.get_product_sales_report_v7(text, text, text) to anon, authenticated;
notify pgrst, 'reload schema';

