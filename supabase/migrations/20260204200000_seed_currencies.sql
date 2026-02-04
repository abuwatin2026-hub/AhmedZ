-- Seed standard currencies and initial rates
do $$
begin
  -- 1. Insert Currencies
  if to_regclass('public.currencies') is not null then
    insert into public.currencies(code, name, is_base)
    values 
      ('SAR', 'Saudi Riyal', false),
      ('USD', 'US Dollar', false)
    on conflict (code) do nothing;
  end if;

  -- 2. Insert Initial Rates (Operational)
  -- These are indicative rates; users should update them via the FxRates UI
  if to_regclass('public.fx_rates') is not null then
    -- SAR
    insert into public.fx_rates(currency_code, rate, rate_date, rate_type)
    values ('SAR', 140, current_date, 'operational')
    on conflict (currency_code, rate_date, rate_type) do nothing;

    -- USD
    insert into public.fx_rates(currency_code, rate, rate_date, rate_type)
    values ('USD', 530, current_date, 'operational')
    on conflict (currency_code, rate_date, rate_type) do nothing;
  end if;
end $$;

notify pgrst, 'reload schema';
