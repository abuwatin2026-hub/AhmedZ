-- Force seed accounting accounts and settings via Migration
-- This ensures data is inserted even if seed.sql was skipped

do $$
declare
  v_sales uuid;
  v_sales_returns uuid;
  v_inventory uuid;
  v_cogs uuid;
  v_ar uuid;
  v_ap uuid;
  v_vat_payable uuid;
  v_vat_recoverable uuid;
  v_cash uuid;
  v_bank uuid;
  v_deposits uuid;
  v_expenses uuid;
  v_shrinkage uuid;
  v_gain uuid;
  v_delivery_income uuid;
  v_sales_discounts uuid;
  v_over_short uuid;
  v_settings jsonb;
begin
  -- 1. Insert Accounts
  insert into public.chart_of_accounts(code, name, account_type, normal_balance, is_active)
  values
    ('1010', 'Cash', 'asset', 'debit', true),
    ('1020', 'Bank', 'asset', 'debit', true),
    ('1200', 'Accounts Receivable', 'asset', 'debit', true),
    ('1410', 'Inventory', 'asset', 'debit', true),
    ('1420', 'VAT Recoverable', 'asset', 'debit', true),
    ('2010', 'Accounts Payable', 'liability', 'credit', true),
    ('2020', 'VAT Payable', 'liability', 'credit', true),
    ('2050', 'Customer Deposits', 'liability', 'credit', true),
    ('3000', 'Retained Earnings', 'equity', 'credit', true),
    ('4010', 'Sales Revenue', 'income', 'credit', true),
    ('4020', 'Delivery Income', 'income', 'credit', true),
    ('4021', 'Inventory Gain', 'income', 'credit', true),
    ('4025', 'Sales Discounts', 'income', 'debit', true),
    ('4026', 'Sales Returns', 'income', 'debit', true),
    ('5010', 'Cost of Goods Sold', 'expense', 'debit', true),
    ('5020', 'Inventory Shrinkage', 'expense', 'debit', true),
    ('6100', 'Operating Expenses', 'expense', 'debit', true),
    ('6110', 'Cash Over/Short', 'expense', 'debit', true)
  on conflict (code) do update
  set name = excluded.name,
      account_type = excluded.account_type,
      normal_balance = excluded.normal_balance,
      is_active = true;

  -- 2. Get Account IDs (using direct select to be safe inside do block)
  select id into v_sales from public.chart_of_accounts where code = '4010';
  select id into v_sales_returns from public.chart_of_accounts where code = '4026';
  select id into v_inventory from public.chart_of_accounts where code = '1410';
  select id into v_cogs from public.chart_of_accounts where code = '5010';
  select id into v_ar from public.chart_of_accounts where code = '1200';
  select id into v_ap from public.chart_of_accounts where code = '2010';
  select id into v_vat_payable from public.chart_of_accounts where code = '2020';
  select id into v_vat_recoverable from public.chart_of_accounts where code = '1420';
  select id into v_cash from public.chart_of_accounts where code = '1010';
  select id into v_bank from public.chart_of_accounts where code = '1020';
  select id into v_deposits from public.chart_of_accounts where code = '2050';
  select id into v_expenses from public.chart_of_accounts where code = '6100';
  select id into v_shrinkage from public.chart_of_accounts where code = '5020';
  select id into v_gain from public.chart_of_accounts where code = '4021';
  select id into v_delivery_income from public.chart_of_accounts where code = '4020';
  select id into v_sales_discounts from public.chart_of_accounts where code = '4025';
  select id into v_over_short from public.chart_of_accounts where code = '6110';

  -- 3. Update App Settings
  v_settings := jsonb_build_object(
    'accounting_accounts', jsonb_build_object(
      'sales', v_sales,
      'sales_returns', v_sales_returns,
      'inventory', v_inventory,
      'cogs', v_cogs,
      'ar', v_ar,
      'ap', v_ap,
      'vat_payable', v_vat_payable,
      'vat_recoverable', v_vat_recoverable,
      'cash', v_cash,
      'bank', v_bank,
      'deposits', v_deposits,
      'expenses', v_expenses,
      'shrinkage', v_shrinkage,
      'gain', v_gain,
      'delivery_income', v_delivery_income,
      'sales_discounts', v_sales_discounts,
      'over_short', v_over_short
    )
  );

  insert into public.app_settings(id, data, created_at, updated_at)
  values ('app', jsonb_build_object('id','app','settings', v_settings, 'updatedAt', now()), now(), now())
  on conflict (id) do update
  set data = jsonb_build_object('id','app','settings', v_settings, 'updatedAt', now()),
      updated_at = now();
end $$;
