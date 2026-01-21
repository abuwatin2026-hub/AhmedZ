-- Restrict more sensitive RPCs to authenticated users only
revoke all on function public.reserve_stock_for_order(jsonb, uuid) from public;
revoke execute on function public.reserve_stock_for_order(jsonb, uuid) from anon;
grant execute on function public.reserve_stock_for_order(jsonb, uuid) to authenticated;

revoke all on function public.release_reserved_stock_for_order(jsonb, uuid) from public;
revoke execute on function public.release_reserved_stock_for_order(jsonb, uuid) from anon;
grant execute on function public.release_reserved_stock_for_order(jsonb, uuid) to authenticated;

revoke all on function public.confirm_order_delivery(uuid, jsonb, jsonb) from public;
revoke execute on function public.confirm_order_delivery(uuid, jsonb, jsonb) from anon;
grant execute on function public.confirm_order_delivery(uuid, jsonb, jsonb) to authenticated;

revoke all on function public.record_order_payment(uuid, numeric, text, timestamptz, text) from public;
revoke execute on function public.record_order_payment(uuid, numeric, text, timestamptz, text) from anon;
grant execute on function public.record_order_payment(uuid, numeric, text, timestamptz, text) to authenticated;
