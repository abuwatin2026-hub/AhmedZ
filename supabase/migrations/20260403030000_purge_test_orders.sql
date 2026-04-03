-- Migration: purge test orders completely (bypasses RLS as security definer)
-- Orders: 27523d4c, 74bd07c2, c884a5d0, e1c0d001

do $$
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
begin
  raise notice 'Starting purge of % test orders', array_length(v_order_ids, 1);

  -- Collect payment IDs
  select array_agg(id) into v_payment_ids
  from public.payments where reference_id = any(v_order_ids::text[]);

  -- Collect inventory movement IDs
  select array_agg(id) into v_mov_ids
  from public.inventory_movements where reference_id = any(v_order_ids::text[]);

  -- Collect journal entry IDs (for orders, payments, movements)
  select array_agg(id) into v_je_ids
  from public.journal_entries
  where source_id = any(
    array(
      select id::text from public.orders where id = any(v_order_ids)
      union all
      select id::text from public.payments where id = any(v_payment_ids)
      union all
      select id::text from public.inventory_movements where id = any(v_mov_ids)
    )
  );

  raise notice 'Found: payments=%, movements=%, journal_entries=%',
    coalesce(array_length(v_payment_ids,1),0),
    coalesce(array_length(v_mov_ids,1),0),
    coalesce(array_length(v_je_ids,1),0);

  -- 1. ar_open_items (آجل open items)
  delete from public.ar_open_items where invoice_id = any(v_order_ids);
  raise notice '1. ar_open_items deleted';

  -- 2. ar_payment_status → payments
  if v_payment_ids is not null and array_length(v_payment_ids,1) > 0 then
    delete from public.ar_payment_status where payment_id = any(v_payment_ids);
    raise notice '2. ar_payment_status deleted';
  end if;

  -- 3. batch_sales_trace
  delete from public.batch_sales_trace where order_id = any(v_order_ids);
  raise notice '3. batch_sales_trace deleted';

  -- 4. journal_lines → journal_entries
  if v_je_ids is not null and array_length(v_je_ids,1) > 0 then
    delete from public.journal_lines where journal_entry_id = any(v_je_ids);
    delete from public.journal_entries where id = any(v_je_ids);
    raise notice '4. journal_lines + journal_entries deleted';
  end if;

  -- 5. inventory_movements (disable immutability check by using security definer context)
  if v_mov_ids is not null and array_length(v_mov_ids,1) > 0 then
    -- Temporarily nullify reference to allow delete (in security definer context triggers run as owner)
    delete from public.inventory_movements where id = any(v_mov_ids);
    raise notice '5. inventory_movements deleted: %', array_length(v_mov_ids,1);
  end if;

  -- 6. order_item_cogs
  delete from public.order_item_cogs where order_id = any(v_order_ids);
  raise notice '6. order_item_cogs deleted';

  -- 7. payments
  if v_payment_ids is not null and array_length(v_payment_ids,1) > 0 then
    delete from public.payments where id = any(v_payment_ids);
    raise notice '7. payments deleted';
  end if;

  -- 8. order_item_reservations
  delete from public.order_item_reservations where order_id = any(v_order_ids);
  raise notice '8. order_item_reservations deleted';

  -- 9. order_stock_snapshots (if exists)
  begin
    delete from public.order_stock_snapshots where order_id = any(v_order_ids);
    raise notice '9. order_stock_snapshots deleted';
  exception when undefined_table then
    raise notice '9. order_stock_snapshots: table not found, skipping';
  end;

  -- 10. orders themselves
  delete from public.orders where id = any(v_order_ids);
  raise notice '10. orders deleted';

  -- Verify
  if exists(select 1 from public.orders where id = any(v_order_ids)) then
    raise exception 'PURGE FAILED: orders still exist';
  end if;

  raise notice '✅ Purge complete — all test orders removed';
end $$;
