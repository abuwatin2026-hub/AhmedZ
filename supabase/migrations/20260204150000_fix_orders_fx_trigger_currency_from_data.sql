do $$
begin
  if to_regclass('public.orders') is null then
    return;
  end if;

  create or replace function public.trg_set_order_fx()
  returns trigger
  language plpgsql
  security definer
  set search_path = public
  as $fn$
  declare
    v_base text;
    v_currency text;
    v_rate numeric;
    v_total numeric;
    v_data_fx numeric;
  begin
    v_base := public.get_base_currency();

    if tg_op = 'UPDATE' and coalesce(old.fx_locked, true) then
      new.currency := old.currency;
      new.fx_rate := old.fx_rate;
    else
      v_currency := upper(nullif(btrim(coalesce(new.currency, new.data->>'currency', '')), ''));
      if v_currency is null then
        v_currency := v_base;
      end if;
      new.currency := v_currency;

      if new.fx_rate is null then
        v_data_fx := null;
        begin
          v_data_fx := nullif((new.data->>'fxRate')::numeric, null);
        exception when others then
          v_data_fx := null;
        end;
        if v_data_fx is not null and v_data_fx > 0 then
          new.fx_rate := v_data_fx;
        else
          v_rate := public.get_fx_rate(new.currency, current_date, 'operational');
          if v_rate is null then
            raise exception 'fx rate missing for currency %', new.currency;
          end if;
          new.fx_rate := v_rate;
        end if;
      end if;
    end if;

    v_total := 0;
    begin
      v_total := nullif((new.data->>'total')::numeric, null);
    exception when others then
      v_total := 0;
    end;
    new.base_total := coalesce(v_total, 0) * coalesce(new.fx_rate, 1);

    return new;
  end;
  $fn$;

  drop trigger if exists trg_set_order_fx on public.orders;
  create trigger trg_set_order_fx
  before insert or update on public.orders
  for each row execute function public.trg_set_order_fx();
end $$;

