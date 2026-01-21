-- Remove legacy text-parameter overload to avoid RPC ambiguity
drop function if exists public.get_sales_report_summary(timestamptz, timestamptz, text, boolean);

-- Ensure uuid-parameter version remains callable by clients
revoke all on function public.get_sales_report_summary(timestamptz, timestamptz, uuid, boolean) from public;
grant execute on function public.get_sales_report_summary(timestamptz, timestamptz, uuid, boolean) to anon, authenticated;
