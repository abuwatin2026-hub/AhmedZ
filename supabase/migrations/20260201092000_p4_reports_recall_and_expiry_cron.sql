create or replace function public.get_food_sales_movements_report(
  p_start_date timestamptz,
  p_end_date timestamptz,
  p_warehouse_id uuid default null
)
returns table (
  order_id uuid,
  sold_at timestamptz,
  warehouse_id uuid,
  item_id text,
  item_name jsonb,
  batch_id uuid,
  expiry_date date,
  supplier_id uuid,
  supplier_name text,
  quantity numeric,
  unit_cost numeric,
  total_cost numeric
)
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public._require_staff('get_food_sales_movements_report');

  return query
  select
    (im.reference_id)::uuid as order_id,
    im.occurred_at as sold_at,
    im.warehouse_id,
    im.item_id::text as item_id,
    coalesce(mi.data->'name', '{}'::jsonb) as item_name,
    im.batch_id,
    b.expiry_date,
    po.supplier_id,
    s.name as supplier_name,
    im.quantity,
    im.unit_cost,
    im.total_cost
  from public.inventory_movements im
  join public.menu_items mi on mi.id::text = im.item_id::text
  join public.batches b on b.id = im.batch_id
  left join public.purchase_receipts pr on pr.id = b.receipt_id
  left join public.purchase_orders po on po.id = pr.purchase_order_id
  left join public.suppliers s on s.id = po.supplier_id
  where im.movement_type = 'sale_out'
    and im.reference_table = 'orders'
    and im.occurred_at >= p_start_date
    and im.occurred_at <= p_end_date
    and coalesce(mi.category,'') = 'food'
    and (p_warehouse_id is null or im.warehouse_id = p_warehouse_id)
  order by im.occurred_at desc;
end;
$$;

revoke all on function public.get_food_sales_movements_report(timestamptz, timestamptz, uuid) from public;
grant execute on function public.get_food_sales_movements_report(timestamptz, timestamptz, uuid) to authenticated;

create or replace function public.get_batch_recall_orders(p_batch_id uuid)
returns table (
  order_id uuid,
  sold_at timestamptz,
  warehouse_id uuid,
  item_id text,
  item_name jsonb,
  batch_id uuid,
  expiry_date date,
  supplier_id uuid,
  supplier_name text,
  quantity numeric
)
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public._require_staff('get_batch_recall_orders');
  if p_batch_id is null then
    raise exception 'p_batch_id is required';
  end if;

  return query
  select
    (im.reference_id)::uuid as order_id,
    im.occurred_at as sold_at,
    im.warehouse_id,
    im.item_id::text as item_id,
    coalesce(mi.data->'name', '{}'::jsonb) as item_name,
    im.batch_id,
    b.expiry_date,
    po.supplier_id,
    s.name as supplier_name,
    im.quantity
  from public.inventory_movements im
  join public.menu_items mi on mi.id::text = im.item_id::text
  join public.batches b on b.id = im.batch_id
  left join public.purchase_receipts pr on pr.id = b.receipt_id
  left join public.purchase_orders po on po.id = pr.purchase_order_id
  left join public.suppliers s on s.id = po.supplier_id
  where im.movement_type = 'sale_out'
    and im.reference_table = 'orders'
    and im.batch_id = p_batch_id
  order by im.occurred_at desc;
end;
$$;

revoke all on function public.get_batch_recall_orders(uuid) from public;
grant execute on function public.get_batch_recall_orders(uuid) to authenticated;

create extension if not exists pg_cron;

do $$
begin
  if to_regclass('cron.job') is null then
    raise exception 'pg_cron is not available';
  end if;
  if not exists (select 1 from cron.job where jobname = 'process_expired_batches_daily') then
    perform cron.schedule(
      'process_expired_batches_daily',
      '0 2 * * *',
      $cmd$select public.run_expiry_job();$cmd$
    );
  end if;
end $$;

select pg_sleep(0.5);
notify pgrst, 'reload schema';
