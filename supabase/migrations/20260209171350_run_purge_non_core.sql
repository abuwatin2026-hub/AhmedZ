do $$
begin
  perform public.purge_non_core_data(
    p_keep_users => true,
    p_keep_settings => true,
    p_keep_items => true,
    p_keep_suppliers => true,
    p_keep_purchase_orders => true,
    p_force => true
  );
end $$;

notify pgrst, 'reload schema';

