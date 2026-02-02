do $$
begin
  if to_regclass('public.app_settings') is null then
    return;
  end if;
  update public.app_settings s
  set data = jsonb_set(
    coalesce(s.data, '{}'::jsonb),
    '{settings,accounting_accounts}',
    (
      select jsonb_build_object(
        'sales', coalesce(public.get_account_id_by_code('4010')::text, ''),
        'sales_returns', coalesce(public.get_account_id_by_code('4026')::text, ''),
        'inventory', coalesce(public.get_account_id_by_code('1410')::text, ''),
        'cogs', coalesce(public.get_account_id_by_code('5010')::text, ''),
        'ar', coalesce(public.get_account_id_by_code('1200')::text, ''),
        'ap', coalesce(public.get_account_id_by_code('2010')::text, ''),
        'vat_payable', coalesce(public.get_account_id_by_code('2020')::text, ''),
        'vat_recoverable', coalesce(public.get_account_id_by_code('1420')::text, ''),
        'cash', coalesce(public.get_account_id_by_code('1010')::text, ''),
        'bank', coalesce(public.get_account_id_by_code('1020')::text, ''),
        'deposits', coalesce(public.get_account_id_by_code('2050')::text, ''),
        'expenses', coalesce(public.get_account_id_by_code('6100')::text, ''),
        'shrinkage', coalesce(public.get_account_id_by_code('5020')::text, ''),
        'gain', coalesce(public.get_account_id_by_code('4021')::text, ''),
        'delivery_income', coalesce(public.get_account_id_by_code('4020')::text, ''),
        'sales_discounts', coalesce(public.get_account_id_by_code('4025')::text, ''),
        'over_short', coalesce(public.get_account_id_by_code('6110')::text, '')
      )
    ),
    true
  )
  where s.id = 'app';
end $$;
