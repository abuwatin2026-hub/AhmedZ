revoke all on function public.get_product_sales_report_v7(timestamptz, timestamptz, text) from public;
grant execute on function public.get_product_sales_report_v7(timestamptz, timestamptz, text) to anon, authenticated;
notify pgrst, 'reload schema';

