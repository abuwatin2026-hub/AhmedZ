-- Create a one-time admin RPC to purge test orders
-- security definer runs as DB owner, bypassing RLS and triggers

create or replace function public.admin_purge_test_orders_once()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order_ids uuid[] := array[
    '27523d4c-f339-4421-a4dc-612afe2e0523'::uuid,
    '74bd07c2-862b-4e6e-92fb-be4e94a0aa7c'::uuid,
    'c884a5d0-2d3e-45a9-82ca-88f39be50538'::uuid,
    'e1c0d001-03b2-4de7-9cc2-227dfd048584'::uuid
  ];
  v_payment_ids uuid[];
  v_mov_ids uuid[];
  v_je_ids uuid[];
  v_result jsonb := '{}'::jsonb;
begin
  -- Must be owner/admin
  perform public._require_staff('accounting.post');

  -- Collect IDs
  select array_agg(id) into v_payment_ids
  from public.payments where reference_id = any(v_order_ids::text[]);

  select array_agg(id) into v_mov_ids
  from public.inventory_movements where reference_id = any(v_order_ids::text[]);

  select array_agg(je.id) into v_je_ids
  from public.journal_entries je
  where je.source_id = any(
    array(
      select unnest(v_order_ids)::text
      union all
      select unnest(coalesce(v_payment_ids, array[]::uuid[]))::text
      union all
      select unnest(coalesce(v_mov_ids, array[]::uuid[]))::text
    )
  );

  -- 1. ar_open_items
  delete from public.ar_open_items where invoice_id = any(v_order_ids);

  -- 2. ar_payment_status
  if v_payment_ids is not null then
    delete from public.ar_payment_status where payment_id = any(v_payment_ids);
  end if;

  -- 3. batch_sales_trace
  delete from public.batch_sales_trace where order_id = any(v_order_ids);

  -- 4. journal_lines + journal_entries
  if v_je_ids is not null then
    delete from public.journal_lines where journal_entry_id = any(v_je_ids);
    delete from public.journal_entries where id = any(v_je_ids);
  end if;

  -- 5. inventory_movements (security definer bypasses immutability trigger)
  if v_mov_ids is not null then
    delete from public.inventory_movements where id = any(v_mov_ids);
  end if;

  -- 6. order_item_cogs
  delete from public.order_item_cogs where order_id = any(v_order_ids);

  -- 7. payments
  if v_payment_ids is not null then
    delete from public.payments where id = any(v_payment_ids);
  end if;

  -- 8. order_item_reservations
  delete from public.order_item_reservations where order_id = any(v_order_ids);

  -- 9. order_stock_snapshots (if exists)
  begin
    delete from public.order_stock_snapshots where order_id = any(v_order_ids);
  exception when undefined_table then null;
  end;

  -- 10. orders
  delete from public.orders where id = any(v_order_ids);

  -- Self-destruct after use (one-time only)
  drop function public.admin_purge_test_orders_once();

  -- Verify
  if exists(select 1 from public.orders where id = any(v_order_ids)) then
    raise exception 'PURGE_INCOMPLETE: some orders remain';
  end if;

  return jsonb_build_object(
    'status', 'success',
    'orders_purged', array_length(v_order_ids, 1),
    'payments_purged', coalesce(array_length(v_payment_ids,1), 0),
    'movements_purged', coalesce(array_length(v_mov_ids,1), 0),
    'journal_entries_purged', coalesce(array_length(v_je_ids,1), 0)
  );
end;
$$;

revoke all on function public.admin_purge_test_orders_once() from public, anon;
grant execute on function public.admin_purge_test_orders_once() to authenticated;
