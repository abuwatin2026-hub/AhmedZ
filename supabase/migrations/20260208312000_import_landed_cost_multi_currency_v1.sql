set request.jwt.claims = '';
set app.allow_ledger_ddl = '1';

do $$
declare
  v_base text;
  v_base_hi boolean := false;
begin
  v_base := public.get_base_currency();
  begin
    select coalesce(c.is_high_inflation, false)
    into v_base_hi
    from public.currencies c
    where upper(c.code) = upper(v_base)
    limit 1;
  exception when others then
    v_base_hi := false;
  end;

  if to_regclass('public.import_expenses') is not null and to_regclass('public.currencies') is not null then
    update public.import_expenses ie
    set exchange_rate = 1 / ie.exchange_rate
    from public.currencies c
    where upper(c.code) = upper(ie.currency)
      and coalesce(c.is_high_inflation, false) = true
      and not v_base_hi
      and coalesce(ie.exchange_rate, 0) > 10;
  end if;
end $$;

create or replace function public.calculate_shipment_landed_cost(p_shipment_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_base text;
  v_ship record;
  v_date date;
  v_total_fob_base numeric := 0;
  v_total_qty numeric := 0;
  v_total_expenses_base numeric := 0;
  v_fx numeric;
  v_item record;
  v_item_fob_base_total numeric;
  v_alloc_item_base numeric;
  v_unit_fob_base numeric;
  v_per_unit_alloc numeric;
begin
  if p_shipment_id is null then
    raise exception 'p_shipment_id is required';
  end if;

  v_base := public.get_base_currency();

  select s.*
  into v_ship
  from public.import_shipments s
  where s.id = p_shipment_id;
  if not found then
    return;
  end if;

  v_date := coalesce(v_ship.actual_arrival_date, v_ship.expected_arrival_date, v_ship.departure_date, current_date);

  select coalesce(sum(coalesce(isi.quantity,0)), 0)
  into v_total_qty
  from public.import_shipments_items isi
  where isi.shipment_id = p_shipment_id;

  if coalesce(v_total_qty, 0) <= 0 then
    return;
  end if;

  v_total_fob_base := 0;
  for v_item in
    select isi.item_id, isi.quantity, isi.unit_price_fob, upper(coalesce(nullif(btrim(isi.currency),''), v_base)) as currency
    from public.import_shipments_items isi
    where isi.shipment_id = p_shipment_id
  loop
    v_fx := public.get_fx_rate(v_item.currency, v_date, 'accounting');
    if v_fx is null or v_fx <= 0 then
      v_fx := public.get_fx_rate(v_item.currency, v_date, 'operational');
    end if;
    if v_fx is null or v_fx <= 0 then
      v_fx := case when v_item.currency = v_base then 1 else null end;
    end if;
    if v_fx is null or v_fx <= 0 then
      continue;
    end if;
    v_total_fob_base := v_total_fob_base + (coalesce(v_item.quantity,0) * coalesce(v_item.unit_price_fob,0) * v_fx);
  end loop;

  select coalesce(sum(coalesce(ie.amount,0) * coalesce(ie.exchange_rate,1)), 0)
  into v_total_expenses_base
  from public.import_expenses ie
  where ie.shipment_id = p_shipment_id;

  if coalesce(v_total_fob_base, 0) > 0 then
    for v_item in
      select isi.id, isi.quantity, isi.unit_price_fob, upper(coalesce(nullif(btrim(isi.currency),''), v_base)) as currency
      from public.import_shipments_items isi
      where isi.shipment_id = p_shipment_id
    loop
      v_fx := public.get_fx_rate(v_item.currency, v_date, 'accounting');
      if v_fx is null or v_fx <= 0 then
        v_fx := public.get_fx_rate(v_item.currency, v_date, 'operational');
      end if;
      if v_fx is null or v_fx <= 0 then
        v_fx := case when v_item.currency = v_base then 1 else null end;
      end if;
      if v_fx is null or v_fx <= 0 or coalesce(v_item.quantity,0) <= 0 then
        continue;
      end if;

      v_item_fob_base_total := coalesce(v_item.quantity,0) * coalesce(v_item.unit_price_fob,0) * v_fx;
      v_alloc_item_base := (v_item_fob_base_total / v_total_fob_base) * coalesce(v_total_expenses_base,0);
      v_unit_fob_base := coalesce(v_item.unit_price_fob,0) * v_fx;
      v_per_unit_alloc := v_alloc_item_base / v_item.quantity;

      update public.import_shipments_items
      set landing_cost_per_unit = (v_unit_fob_base + v_per_unit_alloc),
          updated_at = now()
      where id = v_item.id;
    end loop;
  else
    for v_item in
      select isi.id, isi.quantity, isi.unit_price_fob, upper(coalesce(nullif(btrim(isi.currency),''), v_base)) as currency
      from public.import_shipments_items isi
      where isi.shipment_id = p_shipment_id
    loop
      v_fx := public.get_fx_rate(v_item.currency, v_date, 'accounting');
      if v_fx is null or v_fx <= 0 then
        v_fx := public.get_fx_rate(v_item.currency, v_date, 'operational');
      end if;
      if v_fx is null or v_fx <= 0 then
        v_fx := case when v_item.currency = v_base then 1 else null end;
      end if;
      if v_fx is null or v_fx <= 0 or coalesce(v_item.quantity,0) <= 0 then
        continue;
      end if;
      v_unit_fob_base := coalesce(v_item.unit_price_fob,0) * v_fx;
      v_per_unit_alloc := coalesce(v_total_expenses_base,0) / v_total_qty;
      update public.import_shipments_items
      set landing_cost_per_unit = (v_unit_fob_base + v_per_unit_alloc),
          updated_at = now()
      where id = v_item.id;
    end loop;
  end if;
end;
$$;

notify pgrst, 'reload schema';
