set app.allow_ledger_ddl = '1';

create or replace function public.cleanup_test_orders_data()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order_ids uuid[];
  v_order_ids_text text[];
  v_payment_ids text[];
  v_move_ids text[];
  v_je_ids text[];
  v_jl_ids text[];
  v_deleted_settlement_lines int := 0;
  v_deleted_party_open_items int := 0;
  v_deleted_party_ledger int := 0;
  v_deleted_ar_open_items int := 0;
  v_deleted_journal_lines int := 0;
  v_deleted_journal_entries int := 0;
  v_deleted_movements int := 0;
  v_deleted_reservations int := 0;
  v_deleted_purge_requests int := 0;
  v_deleted_payments int := 0;
  v_deleted_audit_logs int := 0;
  v_deleted_orders int := 0;
begin
  if not (
    public.is_owner()
    or exists (
      select 1
      from public.admin_users au
      where au.auth_user_id = auth.uid()
        and au.is_active = true
        and au.role = 'manager'
    )
  ) then
    raise exception 'not allowed';
  end if;

  select coalesce(array_agg(o.id), '{}') into v_order_ids
  from public.orders o
  where coalesce(o.data->>'source', '') in (
    'manual-test-multi-warehouse',
    'ui-acceptance-simulated',
    'test-only-purge-button',
    'test-only-emergency-purge'
  );

  if array_length(v_order_ids, 1) is null then
    return jsonb_build_object('success', true, 'deletedOrders', 0);
  end if;

  select array_agg(x::text) into v_order_ids_text from unnest(v_order_ids) x;

  select coalesce(array_agg(p.id::text), '{}') into v_payment_ids
  from public.payments p
  where p.reference_table = 'orders'
    and p.reference_id = any(v_order_ids_text);

  select coalesce(array_agg(m.id::text), '{}') into v_move_ids
  from public.inventory_movements m
  where m.reference_table = 'orders'
    and m.reference_id = any(v_order_ids_text);

  select coalesce(array_agg(je.id::text), '{}') into v_je_ids
  from public.journal_entries je
  where (je.source_table = 'payments' and je.source_id = any(v_payment_ids))
     or (je.source_table = 'inventory_movements' and je.source_id = any(v_move_ids))
     or (je.source_table = 'orders' and je.source_id = any(v_order_ids_text));

  if array_length(v_je_ids, 1) is not null then
    select coalesce(array_agg(jl.id::text), '{}') into v_jl_ids
    from public.journal_lines jl
    where jl.journal_entry_id::text = any(v_je_ids);
  else
    v_jl_ids := '{}';
  end if;

  if array_length(v_jl_ids, 1) is not null then
    delete from public.settlement_lines
    where from_open_item_id in (
      select poi.id from public.party_open_items poi where poi.journal_line_id::text = any(v_jl_ids)
    )
    or to_open_item_id in (
      select poi.id from public.party_open_items poi where poi.journal_line_id::text = any(v_jl_ids)
    );
    get diagnostics v_deleted_settlement_lines = row_count;

    delete from public.party_open_items where journal_line_id::text = any(v_jl_ids);
    get diagnostics v_deleted_party_open_items = row_count;

    delete from public.party_ledger_entries where journal_line_id::text = any(v_jl_ids);
    get diagnostics v_deleted_party_ledger = row_count;
  end if;

  if array_length(v_je_ids, 1) is not null then
    begin
      delete from public.ar_open_items where journal_entry_id::text = any(v_je_ids);
      get diagnostics v_deleted_ar_open_items = row_count;
    exception when others then
      v_deleted_ar_open_items := 0;
    end;

    delete from public.journal_lines where journal_entry_id::text = any(v_je_ids);
    get diagnostics v_deleted_journal_lines = row_count;

    delete from public.journal_entries where id::text = any(v_je_ids);
    get diagnostics v_deleted_journal_entries = row_count;
  end if;

  delete from public.inventory_movements
  where reference_table = 'orders'
    and reference_id = any(v_order_ids_text);
  get diagnostics v_deleted_movements = row_count;

  begin
    delete from public.order_item_reservations
    where order_id::text = any(v_order_ids_text);
    get diagnostics v_deleted_reservations = row_count;
  exception when undefined_table then
    v_deleted_reservations := 0;
  end;

  delete from public.order_payment_purge_requests
  where order_id::text = any(v_order_ids_text);
  get diagnostics v_deleted_purge_requests = row_count;

  delete from public.payments
  where reference_table = 'orders'
    and reference_id = any(v_order_ids_text);
  get diagnostics v_deleted_payments = row_count;

  delete from public.system_audit_logs
  where metadata->>'orderId' = any(v_order_ids_text);
  get diagnostics v_deleted_audit_logs = row_count;

  delete from public.orders
  where id = any(v_order_ids);
  get diagnostics v_deleted_orders = row_count;

  return jsonb_build_object(
    'success', true,
    'deletedOrders', v_deleted_orders,
    'deletedPayments', v_deleted_payments,
    'deletedMovements', v_deleted_movements,
    'deletedPurgeRequests', v_deleted_purge_requests,
    'deletedJournalEntries', v_deleted_journal_entries,
    'deletedJournalLines', v_deleted_journal_lines,
    'deletedPartyLedger', v_deleted_party_ledger,
    'deletedPartyOpenItems', v_deleted_party_open_items,
    'deletedSettlementLines', v_deleted_settlement_lines,
    'deletedAuditLogs', v_deleted_audit_logs
  );
end;
$$;

revoke all on function public.cleanup_test_orders_data() from public;
grant execute on function public.cleanup_test_orders_data() to authenticated;

notify pgrst, 'reload schema';
