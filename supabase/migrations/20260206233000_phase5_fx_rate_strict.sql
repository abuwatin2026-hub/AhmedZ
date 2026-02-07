create or replace function public.get_fx_rate(p_currency text, p_date date, p_rate_type text)
returns numeric
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_currency text;
  v_type text;
  v_date date;
  v_base text;
  v_rate numeric;
  v_base_high boolean := false;
begin
  v_currency := upper(nullif(btrim(coalesce(p_currency, '')), ''));
  v_type := lower(nullif(btrim(coalesce(p_rate_type, '')), ''));
  v_date := coalesce(p_date, current_date);
  v_base := public.get_base_currency();

  if v_type is null then
    v_type := 'operational';
  end if;
  if v_currency is null then
    v_currency := v_base;
  end if;

  if v_currency = v_base then
    if v_type = 'accounting' then
      select coalesce(c.is_high_inflation, false)
      into v_base_high
      from public.currencies c
      where upper(c.code) = upper(v_base)
      limit 1;
      if v_base_high then
        select fr.rate
        into v_rate
        from public.fx_rates fr
        where upper(fr.currency_code) = v_base
          and fr.rate_type = v_type
          and fr.rate_date <= v_date
        order by fr.rate_date desc
        limit 1;
        return v_rate;
      end if;
    end if;
    return 1;
  end if;

  select fr.rate
  into v_rate
  from public.fx_rates fr
  where upper(fr.currency_code) = v_currency
    and fr.rate_type = v_type
    and fr.rate_date <= v_date
  order by fr.rate_date desc
  limit 1;

  return v_rate;
end;
$$;

create or replace function public.trg_fx_rates_validate_and_normalize()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_base text;
  v_base_high boolean := false;
  v_cur_high boolean := false;
  v_old_rate numeric;
begin
  v_base := public.get_base_currency();
  new.currency_code := upper(nullif(btrim(coalesce(new.currency_code, '')), ''));
  if new.currency_code is null then
    raise exception 'currency_code required';
  end if;
  if new.rate is null or new.rate <= 0 then
    raise exception 'rate must be > 0';
  end if;
  new.rate_type := lower(nullif(btrim(coalesce(new.rate_type, '')), ''));
  if new.rate_type is null then
    new.rate_type := 'operational';
  end if;
  if new.rate_type not in ('operational','accounting') then
    raise exception 'invalid rate_type';
  end if;

  select coalesce(c.is_high_inflation, false)
  into v_base_high
  from public.currencies c
  where upper(c.code) = upper(v_base)
  limit 1;

  select coalesce(c.is_high_inflation, false)
  into v_cur_high
  from public.currencies c
  where upper(c.code) = upper(new.currency_code)
  limit 1;

  if upper(new.currency_code) = upper(v_base) then
    if new.rate_type = 'operational' then
      new.rate := 1;
    elsif not v_base_high then
      new.rate := 1;
    end if;
    return new;
  end if;

  v_old_rate := new.rate;

  if (not v_base_high) and v_cur_high then
    if new.rate > 1 then
      new.rate := 1 / new.rate;
    end if;
  elsif v_base_high and (not v_cur_high) then
    if new.rate < 1 then
      new.rate := 1 / new.rate;
    end if;
  end if;

  if v_old_rate is distinct from new.rate then
    begin
      insert into public.system_audit_logs(action, module, details, performed_by, performed_at, metadata)
      values (
        'fx_rate_normalized',
        'fx_rates',
        concat('Normalized FX rate for ', new.currency_code, ' ', new.rate_type, ' ', coalesce(new.rate_date::text, ''), ' from ', v_old_rate::text, ' to ', new.rate::text),
        auth.uid(),
        now(),
        jsonb_build_object('currency', new.currency_code, 'rate_type', new.rate_type, 'rate_date', new.rate_date, 'old', v_old_rate, 'new', new.rate)
      );
    exception when others then
      null;
    end;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_fx_rates_validate_and_normalize on public.fx_rates;
create trigger trg_fx_rates_validate_and_normalize
before insert or update on public.fx_rates
for each row execute function public.trg_fx_rates_validate_and_normalize();

revoke all on function public.get_fx_rate(text, date, text) from public;
grant execute on function public.get_fx_rate(text, date, text) to anon, authenticated;

notify pgrst, 'reload schema';

