set app.allow_ledger_ddl = '1';

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
  v_total_expenses_base numeric := 0;
  v_fx numeric;
  v_uom_id uuid;
  v_factor numeric;
  v_item record;
  v_item_fob_base_total numeric;
  v_alloc_item_base numeric;
  v_unit_fob_base_per_base_uom numeric;
  v_per_base_uom_alloc numeric;
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
    if v_fx is null or v_fx <= 0 then
      continue;
    end if;
    v_total_fob_base := v_total_fob_base + (coalesce(v_item.quantity,0) * coalesce(v_item.unit_price_fob,0) * v_fx);
  end loop;

  if coalesce(v_total_fob_base, 0) <= 0 then
    return;
  end if;

  for v_item in
    select isi.id, isi.item_id, isi.quantity, isi.unit_price_fob, upper(coalesce(nullif(btrim(isi.currency),''), v_base)) as currency
    from public.import_shipments_items isi
    where isi.shipment_id = p_shipment_id
  loop
    v_fx := public._pick_fx_for_landed_cost(v_item.currency, v_date);
    if v_fx is null or v_fx <= 0 or coalesce(v_item.quantity,0) <= 0 then
      continue;
    end if;

    v_uom_id := null;
    begin
      select coalesce(iu.purchase_uom_id, null) into v_uom_id
      from public.item_uom iu
      where iu.item_id = v_item.item_id::text
      limit 1;
    exception when others then
      v_uom_id := null;
    end;

    if v_uom_id is null then
      begin
        select iuu.uom_id into v_uom_id
        from public.item_uom_units iuu
        where iuu.item_id = v_item.item_id::text
          and iuu.is_active = true
          and iuu.is_default_purchase = true
        limit 1;
      exception when others then
        v_uom_id := null;
      end;
    end if;

    if v_uom_id is null then
      begin
        select iuu.uom_id into v_uom_id
        from public.item_uom_units iuu
        where iuu.item_id = v_item.item_id::text
          and iuu.is_active = true
          and coalesce(iuu.qty_in_base, 1) > 1
        order by iuu.qty_in_base desc
        limit 1;
      exception when others then
        v_uom_id := null;
      end;
    end if;

    v_factor := 1;
    if v_uom_id is not null then
      begin
        v_factor := public.item_qty_to_base(v_item.item_id::text, 1, v_uom_id);
      exception when others then
        v_factor := 1;
      end;
    end if;
    if v_factor is null or v_factor <= 0 then
      v_factor := 1;
    end if;

    v_item_fob_base_total := coalesce(v_item.quantity,0) * coalesce(v_item.unit_price_fob,0) * v_fx;
    v_alloc_item_base := (v_item_fob_base_total / v_total_fob_base) * coalesce(v_total_expenses_base,0);

    v_unit_fob_base_per_base_uom := (coalesce(v_item.unit_price_fob,0) * v_fx) / v_factor;
    v_per_base_uom_alloc := v_alloc_item_base / (coalesce(v_item.quantity,0) * v_factor);

    update public.import_shipments_items
    set landing_cost_per_unit = (v_unit_fob_base_per_base_uom + v_per_base_uom_alloc),
        updated_at = now()
    where id = v_item.id;
  end loop;
end;
$$;

revoke all on function public.calculate_shipment_landed_cost(uuid) from public;
revoke execute on function public.calculate_shipment_landed_cost(uuid) from anon;
grant execute on function public.calculate_shipment_landed_cost(uuid) to authenticated;

notify pgrst, 'reload schema';

