do $$
begin
  if to_regclass('public.chart_of_accounts') is null then
    return;
  end if;
  insert into public.chart_of_accounts(code, name, account_type, normal_balance, is_active)
  values
    ('4000', 'FX Gain (Realized)', 'income', 'credit', true),
    ('5000', 'FX Loss (Realized)', 'expense', 'debit', true)
  on conflict (code) do update
  set name = excluded.name,
      account_type = excluded.account_type,
      normal_balance = excluded.normal_balance,
      is_active = true;
exception when others then
  null;
end $$;

notify pgrst, 'reload schema';

