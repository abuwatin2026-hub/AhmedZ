set app.allow_ledger_ddl = '1';

create or replace function public.calculate_shipment_landed_cost(p_shipment_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_total_expenses numeric := 0;
  v_total_base_fob numeric := 0;
  r record;
  v_purchase_uom uuid;
  v_base_price numeric;
  v_factor numeric;
  v_ratio numeric := 0;
begin
  if p_shipment_id is null then
    raise exception 'p_shipment_id is required';
  end if;

  select coalesce(sum(ie.amount * ie.exchange_rate), 0)
  into v_total_expenses
  from public.import_expenses ie
  where ie.shipment_id = p_shipment_id;

  -- First pass: compute total FOB in base units to weight expenses
  for r in
    select isi.id, isi.item_id::text as item_id, isi.quantity, isi.unit_price_fob
    from public.import_shipments_items isi
    where isi.shipment_id = p_shipment_id
  loop
    select purchase_uom_id into v_purchase_uom
    from public.item_uom
    where item_id = r.item_id
    limit 1;

    begin
      v_base_price := public.item_unit_cost_to_base(r.item_id, r.unit_price_fob, v_purchase_uom);
    exception when others then
      v_base_price := coalesce(r.unit_price_fob, 0);
    end;

    select qty_in_base into v_factor
    from public.item_uom_units
    where item_id = r.item_id
      and uom_id = v_purchase_uom
      and is_active = true
    limit 1;

    v_factor := coalesce(v_factor, 1);
    v_total_base_fob := coalesce(v_total_base_fob, 0) + (coalesce(v_base_price, 0) * (coalesce(r.quantity, 0) * v_factor));
  end loop;

  if coalesce(v_total_base_fob, 0) > 0 then
    v_ratio := v_total_expenses / v_total_base_fob;
  else
    v_ratio := 0;
  end if;

  -- Second pass: update landing cost per base unit
  for r in
    select isi.id, isi.item_id::text as item_id, isi.quantity, isi.unit_price_fob
    from public.import_shipments_items isi
    where isi.shipment_id = p_shipment_id
  loop
    select purchase_uom_id into v_purchase_uom
    from public.item_uom
    where item_id = r.item_id
    limit 1;

    begin
      v_base_price := public.item_unit_cost_to_base(r.item_id, r.unit_price_fob, v_purchase_uom);
    exception when others then
      v_base_price := coalesce(r.unit_price_fob, 0);
    end;

    update public.import_shipments_items
    set landing_cost_per_unit = coalesce(v_base_price, 0) * (1 + coalesce(v_ratio, 0)),
        updated_at = now()
    where id = r.id;
  end loop;
end;
$$;

revoke all on function public.calculate_shipment_landed_cost(uuid) from public;
revoke execute on function public.calculate_shipment_landed_cost(uuid) from anon;
grant execute on function public.calculate_shipment_landed_cost(uuid) to authenticated;

notify pgrst, 'reload schema';
