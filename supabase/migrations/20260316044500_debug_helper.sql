-- Create a temporary debug function to expose pg_get_functiondef
create or replace function public.debug_get_func_def()
returns text
language sql
security definer
stable
as $$
  select pg_get_functiondef(
    'public.get_product_sales_report_v9(timestamp with time zone,timestamp with time zone,uuid,boolean)'::regprocedure
  )
$$;

grant execute on function public.debug_get_func_def() to authenticated;
notify pgrst, 'reload schema';
