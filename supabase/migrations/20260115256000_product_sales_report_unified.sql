create or replace function public.get_product_sales_report_unified(
  p_start_date text,
  p_end_date text,
  p_zone_id_text text default null,
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
  select *
  from public.get_product_sales_report_v9(
    p_start_date::timestamptz,
    p_end_date::timestamptz,
    case
      when nullif(trim(coalesce(p_zone_id_text,'')),'') is not null
           and trim(p_zone_id_text) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        then p_zone_id_text::uuid
      else null
    end,
    coalesce(p_invoice_only, false)
  );
$$;

revoke all on function public.get_product_sales_report_unified(text, text, text, boolean) from public;
grant execute on function public.get_product_sales_report_unified(text, text, text, boolean) to anon, authenticated;
select pg_sleep(1);
notify pgrst, 'reload schema';

