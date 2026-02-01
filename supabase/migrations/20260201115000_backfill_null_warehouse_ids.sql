do $$
declare
  v_wh uuid;
begin
  select public._resolve_default_admin_warehouse_id() into v_wh;

  update public.purchase_orders
  set warehouse_id = coalesce(warehouse_id, v_wh)
  where warehouse_id is null;

  update public.stock_management
  set warehouse_id = coalesce(warehouse_id, v_wh)
  where warehouse_id is null;

  update public.batches
  set warehouse_id = coalesce(warehouse_id, v_wh)
  where warehouse_id is null;

  update public.batch_balances
  set warehouse_id = coalesce(warehouse_id, v_wh)
  where warehouse_id is null;

  update public.inventory_movements
  set warehouse_id = coalesce(warehouse_id, v_wh)
  where warehouse_id is null;
end $$;

select pg_sleep(0.5);
notify pgrst, 'reload schema';
