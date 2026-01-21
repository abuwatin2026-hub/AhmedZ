-- Avoid RPC overload ambiguity by dropping legacy 3-arg report functions
drop function if exists public.get_daily_sales_stats(timestamptz, timestamptz, uuid);
drop function if exists public.get_hourly_sales_stats(timestamptz, timestamptz, uuid);
drop function if exists public.get_payment_method_stats(timestamptz, timestamptz, uuid);
drop function if exists public.get_sales_by_category(timestamptz, timestamptz, uuid);
