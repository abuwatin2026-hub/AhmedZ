-- Restrict sensitive RPC functions to authenticated users only
revoke all on function public.manage_menu_item_stock(uuid, numeric, text, text, uuid, numeric, boolean, uuid) from public;
revoke execute on function public.manage_menu_item_stock(uuid, numeric, text, text, uuid, numeric, boolean, uuid) from anon;
grant execute on function public.manage_menu_item_stock(uuid, numeric, text, text, uuid, numeric, boolean, uuid) to authenticated;

revoke all on function public.receive_purchase_order(uuid) from public;
revoke execute on function public.receive_purchase_order(uuid) from anon;
grant execute on function public.receive_purchase_order(uuid) to authenticated;

revoke all on function public.receive_purchase_order_partial(uuid, jsonb, timestamptz) from public;
revoke execute on function public.receive_purchase_order_partial(uuid, jsonb, timestamptz) from anon;
grant execute on function public.receive_purchase_order_partial(uuid, jsonb, timestamptz) to authenticated;

revoke all on function public.process_sales_return(uuid) from public;
revoke execute on function public.process_sales_return(uuid) from anon;
grant execute on function public.process_sales_return(uuid) to authenticated;
