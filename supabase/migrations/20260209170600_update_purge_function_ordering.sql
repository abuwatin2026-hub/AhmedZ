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

  -- Purge ledger first to allow movement deletes
  execute 'truncate table public.journal_lines, public.journal_entries restart identity cascade';
  execute 'truncate table public.ledger_entry_hash_chain restart identity cascade';
  execute 'truncate table public.ledger_snapshot_lines, public.ledger_snapshot_headers restart identity cascade';
  execute 'truncate table public.party_ledger_entries restart identity cascade';
  execute 'truncate table public.financial_report_snapshots restart identity cascade';
  execute 'truncate table public.open_item_snapshots restart identity cascade';
  execute 'truncate table public.party_balance_snapshots restart identity cascade';

  -- Then purge movements and stock
  execute 'truncate table public.inventory_movements restart identity cascade';
  execute 'truncate table public.stock_management restart identity cascade';

  -- Operational docs
  execute 'truncate table public.payments restart identity cascade';
  execute 'truncate table public.orders restart identity cascade';
  execute 'truncate table public.sales_returns restart identity cascade';

  -- Now remove receipts if keeping POs
  if p_keep_purchase_orders then
    execute 'truncate table public.purchase_receipts restart identity cascade';
  end if;

  -- Banking/Workflow/Approvals
  execute 'truncate table public.cash_shifts restart identity cascade';
  if to_regclass('public.bank_statement_batches') is not null then
    execute 'truncate table public.bank_statement_batches restart identity cascade';
  end if;
  if to_regclass('public.bank_statement_lines') is not null then
    execute 'truncate table public.bank_statement_lines restart identity cascade';
  end if;
  if to_regclass('public.bank_reconciliation_batches') is not null then
    execute 'truncate table public.bank_reconciliation_batches restart identity cascade';
  end if;

  execute 'truncate table public.workflow_instances restart identity cascade';
  execute 'truncate table public.workflow_approvals restart identity cascade';
  execute 'truncate table public.workflow_event_logs restart identity cascade';
  execute 'truncate table public.approval_requests restart identity cascade';

  -- Expenses / import
  execute 'truncate table public.expenses restart identity cascade';
  execute 'truncate table public.import_shipments restart identity cascade';
  execute 'truncate table public.import_shipments_items restart identity cascade';
  execute 'truncate table public.import_expenses restart identity cascade';

  if to_regclass('public.audit_logs') is not null then
    execute 'truncate table public.audit_logs restart identity cascade';
  end if;

  if not p_keep_items then
    execute 'truncate table public.menu_items restart identity cascade';
    execute 'truncate table public.item_batches restart identity cascade';
    execute 'truncate table public.menu_item_prices restart identity cascade';
  end if;

  if not p_keep_suppliers then
    execute 'truncate table public.suppliers restart identity cascade';
  end if;

  if not p_keep_settings then
    execute 'truncate table public.app_settings restart identity cascade';
  end if;

  if not p_keep_users then
    execute 'truncate table public.customers restart identity cascade';
    execute 'truncate table public.admin_users restart identity cascade';
  end if;
end;
$$;

revoke all on function public.purge_non_core_data(boolean, boolean, boolean, boolean, boolean, boolean) from public;
grant execute on function public.purge_non_core_data(boolean, boolean, boolean, boolean, boolean, boolean) to authenticated;

notify pgrst, 'reload schema';
