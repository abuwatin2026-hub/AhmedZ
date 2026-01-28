create or replace function public.calculate_shipment_landed_cost(p_shipment_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_total_fob_value numeric;
  v_total_qty numeric;
  v_total_expenses numeric;
begin
  if p_shipment_id is null then
    raise exception 'p_shipment_id is required';
  end if;

  select
    coalesce(sum(isi.quantity * isi.unit_price_fob), 0),
    coalesce(sum(isi.quantity), 0)
  into v_total_fob_value, v_total_qty
  from public.import_shipments_items isi
  where isi.shipment_id = p_shipment_id;

  if coalesce(v_total_qty, 0) <= 0 then
    return;
  end if;

  select coalesce(sum(ie.amount * ie.exchange_rate), 0)
  into v_total_expenses
  from public.import_expenses ie
  where ie.shipment_id = p_shipment_id;

  if coalesce(v_total_fob_value, 0) > 0 then
    update public.import_shipments_items
    set landing_cost_per_unit = unit_price_fob * (1 + (coalesce(v_total_expenses, 0) / v_total_fob_value)),
        updated_at = now()
    where shipment_id = p_shipment_id;
  else
    update public.import_shipments_items
    set landing_cost_per_unit = unit_price_fob + (coalesce(v_total_expenses, 0) / v_total_qty),
        updated_at = now()
    where shipment_id = p_shipment_id;
  end if;
end;
$$;

revoke all on function public.calculate_shipment_landed_cost(uuid) from public;
revoke execute on function public.calculate_shipment_landed_cost(uuid) from anon;
grant execute on function public.calculate_shipment_landed_cost(uuid) to authenticated;

notify pgrst, 'reload schema';
