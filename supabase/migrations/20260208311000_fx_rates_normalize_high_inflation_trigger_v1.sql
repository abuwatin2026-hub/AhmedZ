set request.jwt.claims = '';
set app.allow_ledger_ddl = '1';

create or replace function public.trg_fx_rates_normalize_high_inflation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_base text;
  v_hi boolean := false;
  v_base_hi boolean := false;
begin
  v_base := public.get_base_currency();
  if new.currency_code is null then
    return new;
  end if;
  if upper(new.currency_code) = upper(v_base) then
    new.rate := 1;
    return new;
  end if;

  begin
    select coalesce(c.is_high_inflation, false)
    into v_hi
    from public.currencies c
    where upper(c.code) = upper(new.currency_code)
    limit 1;
  exception when others then
    v_hi := false;
  end;

  begin
    select coalesce(c.is_high_inflation, false)
    into v_base_hi
    from public.currencies c
    where upper(c.code) = upper(v_base)
    limit 1;
  exception when others then
    v_base_hi := false;
  end;

  if coalesce(new.rate, 0) > 0 and v_hi and not v_base_hi and new.rate > 10 then
    new.rate := 1 / new.rate;
  end if;

  return new;
end;
$$;

do $$
begin
  if to_regclass('public.fx_rates') is not null then
    drop trigger if exists trg_fx_rates_normalize_high_inflation on public.fx_rates;
    create trigger trg_fx_rates_normalize_high_inflation
    before insert or update on public.fx_rates
    for each row execute function public.trg_fx_rates_normalize_high_inflation();
  end if;
end $$;

notify pgrst, 'reload schema';
