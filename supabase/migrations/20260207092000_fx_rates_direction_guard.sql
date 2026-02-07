do $$
begin
  if to_regclass('public.fx_rates') is null then
    return;
  end if;

  create or replace function public.trg_fx_rates_direction_guard()
  returns trigger
  language plpgsql
  security definer
  set search_path = public
  as $fn$
  declare
    v_base text;
    v_base_high boolean := false;
    v_cur_high boolean := false;
  begin
    v_base := public.get_base_currency();

    begin
      select coalesce(c.is_high_inflation, false)
      into v_base_high
      from public.currencies c
      where upper(c.code) = upper(v_base)
      limit 1;
    exception when undefined_table then
      v_base_high := false;
    end;

    begin
      select coalesce(c.is_high_inflation, false)
      into v_cur_high
      from public.currencies c
      where upper(c.code) = upper(new.currency_code)
      limit 1;
    exception when undefined_table then
      v_cur_high := false;
    end;

    if upper(coalesce(new.currency_code, '')) = upper(v_base) then
      return new;
    end if;

    if (not v_base_high) and v_cur_high then
      if coalesce(new.rate, 0) >= 1 then
        raise exception 'fx rate direction invalid: expected base per 1 foreign';
      end if;
    elsif v_base_high and (not v_cur_high) then
      if coalesce(new.rate, 0) <= 1 then
        raise exception 'fx rate direction invalid: expected base per 1 foreign';
      end if;
    end if;

    return new;
  end;
  $fn$;

  drop trigger if exists trg_fx_rates_zz_direction_guard on public.fx_rates;
  create trigger trg_fx_rates_zz_direction_guard
  before insert or update on public.fx_rates
  for each row execute function public.trg_fx_rates_direction_guard();
end $$;

notify pgrst, 'reload schema';
