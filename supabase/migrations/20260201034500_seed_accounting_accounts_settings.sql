-- Seed default accounting control accounts mapping into app_settings.data
do $$
declare
  v_sales uuid := public.get_account_id_by_code('4010');
  v_sales_returns uuid := public.get_account_id_by_code('4026');
  v_inventory uuid := public.get_account_id_by_code('1410');
  v_cogs uuid := public.get_account_id_by_code('5010');
  v_ar uuid := public.get_account_id_by_code('1200');
  v_ap uuid := public.get_account_id_by_code('2010');
  v_vat_payable uuid := public.get_account_id_by_code('2020');
  v_vat_recoverable uuid := public.get_account_id_by_code('1420');
  v_cash uuid := public.get_account_id_by_code('1010');
  v_bank uuid := public.get_account_id_by_code('1020');
  v_deposits uuid := public.get_account_id_by_code('2050');
  v_expenses uuid := public.get_account_id_by_code('6100');
  v_shrinkage uuid := public.get_account_id_by_code('5020');
  v_gain uuid := public.get_account_id_by_code('4021');
  v_delivery_income uuid := public.get_account_id_by_code('4020');
  v_sales_discounts uuid := public.get_account_id_by_code('4025');
  v_over_short uuid := public.get_account_id_by_code('6110');
  v_settings jsonb;
begin
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

select pg_sleep(0.5);
notify pgrst, 'reload schema';
