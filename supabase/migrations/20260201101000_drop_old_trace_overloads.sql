drop function if exists public.get_food_sales_movements_report(timestamptz, timestamptz, uuid);
drop function if exists public.get_batch_recall_orders(uuid);

select pg_sleep(0.5);
notify pgrst, 'reload schema';
