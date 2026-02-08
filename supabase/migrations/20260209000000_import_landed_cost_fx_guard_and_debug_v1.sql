set request.jwt.claims = '';
set app.allow_ledger_ddl = '1';

create or replace function public._pick_fx_for_landed_cost(p_currency text, p_date date)
returns numeric
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_base text;
  v_base_hi boolean := false;
  v_cur text;
  v_cur_hi boolean := false;
  v_acc numeric;
  v_op numeric;
  v_fx numeric;
begin
  v_base := public.get_base_currency();
  v_cur := upper(nullif(btrim(coalesce(p_currency, '')), ''));
  if v_cur is null or v_cur = '' then
    v_cur := v_base;
  end if;
  if v_cur = v_base then
    return 1;
  end if;

  begin
    select coalesce(c.is_high_inflation, false)
    into v_base_hi
    from public.currencies c
    where upper(c.code) = upper(v_base)
    limit 1;
  exception when others then
    v_base_hi := false;
  end;

  begin
    select coalesce(c.is_high_inflation, false)
    into v_cur_hi
    from public.currencies c
    where upper(c.code) = upper(v_cur)
    limit 1;
  exception when others then
    v_cur_hi := false;
  end;

  v_acc := public.get_fx_rate(v_cur, p_date, 'accounting');
  v_op := public.get_fx_rate(v_cur, p_date, 'operational');

  if v_acc is not null and v_acc > 0 then
    v_fx := v_acc;
  elsif v_op is not null and v_op > 0 then
    v_fx := v_op;
  else
    return null;
  end if;

  if v_acc is not null and v_acc > 0 and v_op is not null and v_op > 0 then
    if (not v_base_hi) and v_cur_hi then
      v_fx := least(v_acc, v_op);
    elsif v_base_hi and (not v_cur_hi) then
      v_fx := greatest(v_acc, v_op);
    else
      if v_acc > (v_op * 100) then
        v_fx := v_op;
      elsif v_op > (v_acc * 100) then
        v_fx := v_acc;
      end if;
    end if;
  end if;

  return v_fx;
end;
$$;

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
    v_fx := public._pick_fx_for_landed_cost(v_item.currency, v_date);
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
      v_fx := public._pick_fx_for_landed_cost(v_item.currency, v_date);
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
      v_fx := public._pick_fx_for_landed_cost(v_item.currency, v_date);
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

create or replace function public.debug_shipment_landed_cost(p_shipment_id uuid)
returns table(
  item_id text,
  currency text,
  quantity numeric,
  unit_price_fob numeric,
  fx_accounting numeric,
  fx_operational numeric,
  fx_used numeric,
  unit_fob_base numeric,
  fob_base_total numeric,
  expenses_base_total numeric,
  alloc_item_base numeric,
  per_unit_alloc numeric,
  landed_cost_per_unit numeric
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_base text;
  v_ship record;
  v_date date;
  v_total_fob_base numeric := 0;
  v_total_expenses_base numeric := 0;
  v_item record;
  v_fx_acc numeric;
  v_fx_op numeric;
  v_fx numeric;
  v_item_fob_base_total numeric;
  v_alloc_item_base numeric;
  v_unit_fob_base numeric;
  v_per_unit_alloc numeric;
begin
  v_base := public.get_base_currency();
  select s.* into v_ship from public.import_shipments s where s.id = p_shipment_id;
  if not found then
    return;
  end if;
  v_date := coalesce(v_ship.actual_arrival_date, v_ship.expected_arrival_date, v_ship.departure_date, current_date);

  select coalesce(sum(coalesce(ie.amount,0) * coalesce(ie.exchange_rate,1)), 0)
  into v_total_expenses_base
  from public.import_expenses ie
  where ie.shipment_id = p_shipment_id;

  v_total_fob_base := 0;
  for v_item in
    select isi.item_id, isi.quantity, isi.unit_price_fob, upper(coalesce(nullif(btrim(isi.currency),''), v_base)) as currency
    from public.import_shipments_items isi
    where isi.shipment_id = p_shipment_id
  loop
    v_fx := public._pick_fx_for_landed_cost(v_item.currency, v_date);
    if v_fx is not null and v_fx > 0 then
      v_total_fob_base := v_total_fob_base + (coalesce(v_item.quantity,0) * coalesce(v_item.unit_price_fob,0) * v_fx);
    end if;
  end loop;

  for v_item in
    select isi.item_id, isi.quantity, isi.unit_price_fob, upper(coalesce(nullif(btrim(isi.currency),''), v_base)) as currency, isi.landing_cost_per_unit
    from public.import_shipments_items isi
    where isi.shipment_id = p_shipment_id
  loop
    v_fx_acc := public.get_fx_rate(v_item.currency, v_date, 'accounting');
    v_fx_op := public.get_fx_rate(v_item.currency, v_date, 'operational');
    v_fx := public._pick_fx_for_landed_cost(v_item.currency, v_date);
    v_unit_fob_base := case when v_fx is not null and v_fx > 0 then coalesce(v_item.unit_price_fob,0) * v_fx else null end;
    v_item_fob_base_total := case when v_fx is not null and v_fx > 0 then coalesce(v_item.quantity,0) * coalesce(v_item.unit_price_fob,0) * v_fx else null end;
    if v_total_fob_base > 0 and v_item_fob_base_total is not null then
      v_alloc_item_base := (v_item_fob_base_total / v_total_fob_base) * coalesce(v_total_expenses_base,0);
      v_per_unit_alloc := case when coalesce(v_item.quantity,0) > 0 then v_alloc_item_base / v_item.quantity else null end;
    else
      v_alloc_item_base := null;
      v_per_unit_alloc := null;
    end if;

    item_id := v_item.item_id::text;
    currency := v_item.currency;
    quantity := v_item.quantity;
    unit_price_fob := v_item.unit_price_fob;
    fx_accounting := v_fx_acc;
    fx_operational := v_fx_op;
    fx_used := v_fx;
    unit_fob_base := v_unit_fob_base;
    fob_base_total := v_item_fob_base_total;
    expenses_base_total := v_total_expenses_base;
    alloc_item_base := v_alloc_item_base;
    per_unit_alloc := v_per_unit_alloc;
    landed_cost_per_unit := v_item.landing_cost_per_unit;
    return next;
  end loop;
end;
$$;

revoke all on function public.debug_shipment_landed_cost(uuid) from public;
revoke execute on function public.debug_shipment_landed_cost(uuid) from anon;
grant execute on function public.debug_shipment_landed_cost(uuid) to authenticated, service_role;

notify pgrst, 'reload schema';
