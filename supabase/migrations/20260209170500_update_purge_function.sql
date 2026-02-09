set app.allow_ledger_ddl = '1';

create or replace function public.purge_non_core_data(
  p_keep_users boolean default true,
  p_keep_settings boolean default true,
  p_keep_items boolean default true,
  p_keep_suppliers boolean default true,
  p_keep_purchase_orders boolean default true,
  p_force boolean default false
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not p_force and not public.has_admin_permission('settings.manage') then
    raise exception 'not allowed';
  end if;

  perform set_config('app.allow_ledger_ddl', '1', true);

  if p_keep_purchase_orders then
    delete from public.purchase_receipts;
  end if;

  delete from public.inventory_movements;
  delete from public.stock_management;

  delete from public.payments;
  delete from public.orders;
  delete from public.sales_returns;

  delete from public.party_ledger_entries;
  delete from public.financial_report_snapshots;
  delete from public.open_item_snapshots;
  delete from public.party_balance_snapshots;

  delete from public.journal_lines;
  delete from public.journal_entries;
  delete from public.ledger_entry_hash_chain;
  delete from public.ledger_snapshot_lines;
  delete from public.ledger_snapshot_headers;

  delete from public.cash_shifts;
  delete from public.bank_statement_batches;
  delete from public.bank_statement_lines;
  delete from public.bank_reconciliation_batches;

  delete from public.workflow_instances;
  delete from public.workflow_approvals;
  delete from public.workflow_event_logs;
  delete from public.approval_requests;

  delete from public.expenses;
  delete from public.import_shipments;
  delete from public.import_shipments_items;
  delete from public.import_expenses;

  delete from public.audit_logs;

  if not p_keep_items then
    delete from public.menu_items;
    delete from public.item_batches;
    delete from public.menu_item_prices;
  end if;

  if not p_keep_suppliers then
    delete from public.suppliers;
  end if;

  if not p_keep_settings then
    delete from public.app_settings;
  end if;

  if not p_keep_users then
    delete from public.customers;
    delete from public.admin_users;
  end if;
end;
$$;

revoke all on function public.purge_non_core_data(boolean, boolean, boolean, boolean, boolean, boolean) from public;
grant execute on function public.purge_non_core_data(boolean, boolean, boolean, boolean, boolean, boolean) to authenticated;

notify pgrst, 'reload schema';

