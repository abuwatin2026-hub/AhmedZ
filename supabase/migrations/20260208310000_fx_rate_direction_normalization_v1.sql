set request.jwt.claims = '';
set app.allow_ledger_ddl = '1';

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
  v_hi boolean := false;
  v_base_hi boolean := false;
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

  begin
    select coalesce(c.is_high_inflation, false)
    into v_hi
    from public.currencies c
    where upper(c.code) = v_currency
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

  if v_rate is not null and v_rate > 0 and v_hi and not v_base_hi and v_rate > 10 then
    v_rate := 1 / v_rate;
  end if;

  return v_rate;
end;
$$;

do $$
declare
  v_po_ids uuid[];
  v_po_base_bad uuid[];
  v_disabled boolean := false;
begin
  if to_regclass('public.fx_rates') is not null and to_regclass('public.currencies') is not null then
    update public.fx_rates fr
    set rate = 1 / fr.rate
    from public.currencies c
    where upper(c.code) = upper(fr.currency_code)
      and coalesce(c.is_high_inflation, false) = true
      and coalesce(fr.rate, 0) > 10;
  end if;

  if to_regclass('public.purchase_orders') is not null and to_regclass('public.currencies') is not null then
    select array_agg(po.id)
    into v_po_ids
    from public.purchase_orders po
    join public.currencies c on upper(c.code) = upper(po.currency)
    where upper(coalesce(po.currency,'')) <> upper(public.get_base_currency())
      and coalesce(c.is_high_inflation, false) = true
      and coalesce(po.fx_rate, 0) > 10;

    select array_agg(po.id)
    into v_po_base_bad
    from public.purchase_orders po
    where upper(coalesce(po.currency,'')) = upper(public.get_base_currency())
      and abs(coalesce(po.fx_rate, 1) - 1) > 1e-12;

    if v_po_ids is not null or v_po_base_bad is not null then
      begin
        execute 'alter table public.purchase_orders disable trigger trg_purchase_orders_fx_lock';
        v_disabled := true;
      exception when others then
        v_disabled := false;
      end;
    end if;

    if v_po_ids is not null then
      update public.purchase_orders po
      set
        fx_rate = 1 / nullif(po.fx_rate, 0),
        base_total = coalesce(po.total_amount, 0) * (1 / nullif(po.fx_rate, 0))
      where po.id = any(v_po_ids);
    end if;

    if v_po_base_bad is not null then
      update public.purchase_orders po
      set
        fx_rate = 1,
        base_total = coalesce(po.total_amount, 0)
      where po.id = any(v_po_base_bad);
    end if;

    if v_disabled then
      begin
        execute 'alter table public.purchase_orders enable trigger trg_purchase_orders_fx_lock';
      exception when others then
        null;
      end;
    end if;

    if to_regclass('public.purchase_items') is not null and v_po_ids is not null then
      update public.purchase_items pi
      set unit_cost_base = coalesce(pi.unit_cost_foreign, pi.unit_cost, 0) * coalesce(po.fx_rate, 0)
      from public.purchase_orders po
      where pi.purchase_order_id = po.id
        and po.id = any(v_po_ids);
    end if;
  end if;
end $$;

notify pgrst, 'reload schema';
