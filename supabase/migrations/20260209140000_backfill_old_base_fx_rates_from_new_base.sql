set request.jwt.claims = '';
set app.allow_ledger_ddl = '1';

do $$
declare
  v_old_base text;
  v_new_base text;
  v_lock_date date;
begin
  select old_base_currency, new_base_currency, locked_at::date
  into v_old_base, v_new_base, v_lock_date
  from public.base_currency_restatement_state
  where id = 'sar_base_lock'
  limit 1;

  if v_old_base is null or v_new_base is null or v_lock_date is null then
    return;
  end if;

  insert into public.fx_rates(currency_code, rate, rate_date, rate_type)
  select
    upper(v_old_base),
    (1 / fr.rate),
    fr.rate_date,
    fr.rate_type
  from public.fx_rates fr
  where upper(fr.currency_code) = upper(v_new_base)
    and fr.rate is not null
    and fr.rate > 0
    and fr.rate_date <= v_lock_date
    and not exists (
      select 1
      from public.fx_rates x
      where upper(x.currency_code) = upper(v_old_base)
        and x.rate_date = fr.rate_date
        and x.rate_type = fr.rate_type
    );
end $$;

notify pgrst, 'reload schema';

