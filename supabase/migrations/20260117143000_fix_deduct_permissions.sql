revoke all on function public.deduct_stock_on_delivery_v2(uuid, jsonb) from public;
revoke execute on function public.deduct_stock_on_delivery_v2(uuid, jsonb) from anon;
grant execute on function public.deduct_stock_on_delivery_v2(uuid, jsonb) to authenticated;
