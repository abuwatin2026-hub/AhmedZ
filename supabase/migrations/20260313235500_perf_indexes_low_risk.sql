set app.allow_ledger_ddl = '1';

create index if not exists idx_notifications_user_created_at_desc
  on public.notifications(user_id, created_at desc);

create index if not exists idx_purchase_items_order_created_at_desc
  on public.purchase_items(purchase_order_id, created_at desc);

create index if not exists idx_batches_fefo_active
  on public.batches(item_id, warehouse_id, expiry_date, created_at)
  where coalesce(status, 'active') = 'active';

create index if not exists idx_orders_created_at_desc
  on public.orders(created_at desc);

notify pgrst, 'reload schema';
