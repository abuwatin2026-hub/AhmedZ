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
  v_cur_high boolean := false;
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

  begin
    select coalesce(c.is_high_inflation, false)
    into v_base_high
    from public.currencies c
    where upper(c.code) = upper(v_base)
    limit 1;
  exception when undefined_table then
    v_base_high := false;
  end;

  if v_currency = v_base then
    if v_type = 'accounting' then
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

  begin
    select coalesce(c.is_high_inflation, false)
    into v_cur_high
    from public.currencies c
    where upper(c.code) = upper(v_currency)
    limit 1;
  exception when undefined_table then
    v_cur_high := false;
  end;

  select fr.rate
  into v_rate
  from public.fx_rates fr
  where upper(fr.currency_code) = v_currency
    and fr.rate_type = v_type
    and fr.rate_date <= v_date
  order by fr.rate_date desc
  limit 1;

  if v_rate is null then
    return null;
  end if;

  if (not v_base_high) and v_cur_high then
    if v_rate > 1 then
      v_rate := 1 / v_rate;
    end if;
  elsif v_base_high and (not v_cur_high) then
    if v_rate > 0 and v_rate < 1 then
      v_rate := 1 / v_rate;
    end if;
  end if;

  return v_rate;
end;
$$;

notify pgrst, 'reload schema';
