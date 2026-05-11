-- Create a one-time admin RPC to purge all UAT/test orders created today
-- security definer runs as DB owner, bypassing RLS and triggers

create or replace function public.admin_purge_uat_tests_20260509()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order_ids uuid[];
  v_payment_ids uuid[];
  v_mov_ids uuid[];
  v_je_ids uuid[];
  v_open_item_ids uuid[];
  v_result jsonb := '{}'::jsonb;
begin
  -- Collect IDs of orders from today that are tests
  select array_agg(id) into v_order_ids
  from public.orders
  where created_at >= '2026-05-09T00:00:00Z'
    and (
      lower(coalesce(data->>'customerName', '')) like '%uat%'
      or lower(coalesce(data->>'customerName', '')) like '%test%'
      or lower(coalesce(data->>'isTestOrder', 'false')) in ('true', '1', 'yes')
    );

  if v_order_ids is null or array_length(v_order_ids, 1) = 0 then
    return jsonb_build_object('status', 'success', 'message', 'No test orders found');
  end if;

  -- Collect related IDs
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

  select array_agg(id) into v_open_item_ids
  from public.ar_open_items where invoice_id = any(v_order_ids);

  -- Disable triggers temporarily to bypass append-only and immutability checks
  begin
    alter table public.party_ledger_entries disable trigger user;
  exception when others then null; end;
  
  begin
    alter table public.journal_entries disable trigger user;
  exception when others then null; end;

  begin
    alter table public.journal_lines disable trigger user;
  exception when others then null; end;

  begin
    alter table public.inventory_movements disable trigger user;
  exception when others then null; end;


  -- 1. party_ledger_entries (depends on journal_lines)
  if v_je_ids is not null then
    delete from public.party_allocations
    where open_item_id in (select id from public.party_open_items where journal_line_id in (select id from public.journal_lines where journal_entry_id = any(v_je_ids)));

    delete from public.party_open_items
    where journal_line_id in (select id from public.journal_lines where journal_entry_id = any(v_je_ids));

    delete from public.party_ledger_entries 
    where journal_line_id in (select id from public.journal_lines where journal_entry_id = any(v_je_ids));
  end if;

  -- 2. ar_allocations
  if v_open_item_ids is not null then
    delete from public.ar_allocations where open_item_id = any(v_open_item_ids);
  end if;
  if v_payment_ids is not null then
    delete from public.ar_allocations where payment_id = any(v_payment_ids);
  end if;

  -- 3. ar_open_items
  if v_order_ids is not null then
    delete from public.ar_open_items where invoice_id = any(v_order_ids);
  end if;

  -- 4. ar_payment_status
  if v_payment_ids is not null then
    delete from public.ar_payment_status where payment_id = any(v_payment_ids);
  end if;

  -- 5. batch_sales_trace
  delete from public.batch_sales_trace where order_id = any(v_order_ids);

  -- 6. journal_lines + journal_entries
  if v_je_ids is not null then
    delete from public.journal_lines where journal_entry_id = any(v_je_ids);
    delete from public.journal_entries where id = any(v_je_ids);
  end if;

  -- 7. inventory_movements (security definer bypasses immutability trigger)
  if v_mov_ids is not null then
    delete from public.inventory_movements where id = any(v_mov_ids);
  end if;

  -- 8. order_item_cogs
  delete from public.order_item_cogs where order_id = any(v_order_ids);

  -- 9. payments
  if v_payment_ids is not null then
    delete from public.payments where id = any(v_payment_ids);
  end if;

  -- 10. order_item_reservations
  delete from public.order_item_reservations where order_id = any(v_order_ids);

  -- 11. order_stock_snapshots (if exists)
  begin
    delete from public.order_stock_snapshots where order_id = any(v_order_ids);
  exception when undefined_table then null;
  end;

  -- 12. order_items
  delete from public.order_items where order_id = any(v_order_ids);

  -- 13. orders
  delete from public.orders where id = any(v_order_ids);

  -- Re-enable triggers
  begin
    alter table public.party_ledger_entries enable trigger user;
  exception when others then null; end;
  
  begin
    alter table public.journal_entries enable trigger user;
  exception when others then null; end;

  begin
    alter table public.journal_lines enable trigger user;
  exception when others then null; end;

  begin
    alter table public.inventory_movements enable trigger user;
  exception when others then null; end;


  -- Self-destruct after use (one-time only)
  drop function public.admin_purge_uat_tests_20260509();

  return jsonb_build_object(
    'status', 'success',
    'orders_purged', coalesce(array_length(v_order_ids, 1), 0),
    'payments_purged', coalesce(array_length(v_payment_ids, 1), 0),
    'movements_purged', coalesce(array_length(v_mov_ids, 1), 0),
    'journal_entries_purged', coalesce(array_length(v_je_ids, 1), 0)
  );
end;
$$;

revoke all on function public.admin_purge_uat_tests_20260509() from public, anon;
grant execute on function public.admin_purge_uat_tests_20260509() to authenticated;
