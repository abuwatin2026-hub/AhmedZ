do $$
declare
  v_confirm text := current_setting('app.handover_confirm', true);
  v_tables text[] := array[
    'public.notifications',
    'public.system_audit_logs',

    'public.promotion_usage',
    'public.promotion_items',
    'public.promotions',
    'public.coupons',
    'public.ads',
    'public.reviews',
    'public.user_challenge_progress',
    'public.challenges',

    'public.customer_special_prices',
    'public.customers',

    'public.approval_steps',
    'public.approval_requests',

    'public.supplier_credit_note_allocations',
    'public.supplier_credit_notes',
    'public.supplier_items',
    'public.supplier_evaluations',
    'public.supplier_contracts',
    'public.purchase_return_items',
    'public.purchase_returns',
    'public.purchase_receipt_items',
    'public.purchase_receipts',
    'public.purchase_items',
    'public.purchase_orders',
    'public.suppliers',

    'public.import_expenses',
    'public.import_shipments_items',
    'public.import_shipments',

    'public.warehouse_transfer_items',
    'public.warehouse_transfers',
    'public.inventory_transfer_items',
    'public.inventory_transfers',

    'public.batch_sales_trace',
    'public.batch_recalls',
    'public.batch_reservations',
    'public.batch_balances',
    'public.batches',

    'public.stock_wastage',
    'public.order_item_reservations',
    'public.order_item_cogs',
    'public.inventory_movements',
    'public.stock_management',

    'public.bank_reconciliation_matches',
    'public.bank_statement_lines',
    'public.bank_statement_batches',
    'public.bank_accounts',

    'public.payroll_run_lines',
    'public.payroll_runs',
    'public.payroll_employees',
    'public.payroll_loans',
    'public.payroll_attendance',

    'public.expenses',
    'public.payments',
    'public.sales_returns',
    'public.orders',

    'public.cod_settlement_orders',
    'public.cod_settlements',
    'public.driver_ledger',
    'public.ledger_lines',
    'public.ledger_entries',

    'public.ar_open_items',
    'public.accounting_documents',
    'public.journal_lines',
    'public.journal_entries',

    'public.price_tiers',
    'public.menu_items'
  ];
  v_exists text := '';
  v_t text;
begin
  if v_confirm <> 'YES_DELETE_DEMO_DATA' then
    raise exception 'Set: SET app.handover_confirm = ''YES_DELETE_DEMO_DATA''; then rerun.';
  end if;

  perform set_config('app.accounting_bypass', '1', true);

  foreach v_t in array v_tables loop
    if to_regclass(v_t) is not null then
      v_exists := v_exists || case when v_exists = '' then '' else ', ' end || v_t;
    end if;
  end loop;

  if v_exists <> '' then
    execute 'truncate table ' || v_exists || ' restart identity cascade';
  end if;
end $$;
