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
  v_total_expenses_base numeric := 0;
  v_total_fob_base numeric := 0;
  v_fx numeric;
  v_item record;
  v_base_qty numeric;
  v_unit_cost_trx numeric;
  v_item_fob_base_total numeric;
  v_alloc_item_base numeric;
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

  select coalesce(sum(coalesce(ie.amount,0) * coalesce(ie.exchange_rate,1)), 0)
  into v_total_expenses_base
  from public.import_expenses ie
  where ie.shipment_id = p_shipment_id;

  v_total_fob_base := 0;
  for v_item in
    with linked_receipts as (
      select pr.id, pr.purchase_order_id
      from public.purchase_receipts pr
      where pr.import_shipment_id = p_shipment_id
    ),
    receipt_qty as (
      select pri.item_id::text as item_id, sum(coalesce(pri.quantity,0))::numeric as base_qty
      from linked_receipts lr
      join public.purchase_receipt_items pri on pri.receipt_id = lr.id
      group by pri.item_id
    ),
    linked_orders as (
      select distinct lr.purchase_order_id
      from linked_receipts lr
      where lr.purchase_order_id is not null
    ),
    po_cost as (
      select
        pi.item_id::text as item_id,
        case
          when sum(coalesce(pi.qty_base, pi.quantity, 0)) > 0 then
            sum(
              coalesce(pi.qty_base, pi.quantity, 0)
              * public.item_unit_cost_to_base(pi.item_id::text, coalesce(pi.unit_cost, 0), pi.uom_id)
            )
            / sum(coalesce(pi.qty_base, pi.quantity, 0))
          else 0
        end::numeric as unit_cost_base
      from public.purchase_items pi
      join linked_orders lo on lo.purchase_order_id = pi.purchase_order_id
      group by pi.item_id
    )
    select
      isi.id,
      isi.item_id::text as item_id,
      upper(coalesce(nullif(btrim(isi.currency),''), v_base)) as currency,
      coalesce(rq.base_qty, isi.quantity, 0) as base_qty,
      coalesce(pc.unit_cost_base, isi.unit_price_fob, 0) as unit_cost_trx
    from public.import_shipments_items isi
    left join receipt_qty rq on rq.item_id = isi.item_id::text
    left join po_cost pc on pc.item_id = isi.item_id::text
    where isi.shipment_id = p_shipment_id
  loop
    v_base_qty := coalesce(v_item.base_qty, 0);
    if v_base_qty <= 0 then
      continue;
    end if;
    v_unit_cost_trx := coalesce(v_item.unit_cost_trx, 0);
    v_fx := public._pick_fx_for_landed_cost(v_item.currency, v_date);
    if v_fx is null or v_fx <= 0 then
      continue;
    end if;
    v_total_fob_base := v_total_fob_base + (v_base_qty * v_unit_cost_trx * v_fx);
  end loop;

  if coalesce(v_total_fob_base, 0) <= 0 then
    return;
  end if;

  for v_item in
    with linked_receipts as (
      select pr.id, pr.purchase_order_id
      from public.purchase_receipts pr
      where pr.import_shipment_id = p_shipment_id
    ),
    receipt_qty as (
      select pri.item_id::text as item_id, sum(coalesce(pri.quantity,0))::numeric as base_qty
      from linked_receipts lr
      join public.purchase_receipt_items pri on pri.receipt_id = lr.id
      group by pri.item_id
    ),
    linked_orders as (
      select distinct lr.purchase_order_id
      from linked_receipts lr
      where lr.purchase_order_id is not null
    ),
    po_cost as (
      select
        pi.item_id::text as item_id,
        case
          when sum(coalesce(pi.qty_base, pi.quantity, 0)) > 0 then
            sum(
              coalesce(pi.qty_base, pi.quantity, 0)
              * public.item_unit_cost_to_base(pi.item_id::text, coalesce(pi.unit_cost, 0), pi.uom_id)
            )
            / sum(coalesce(pi.qty_base, pi.quantity, 0))
          else 0
        end::numeric as unit_cost_base
      from public.purchase_items pi
      join linked_orders lo on lo.purchase_order_id = pi.purchase_order_id
      group by pi.item_id
    )
    select
      isi.id,
      isi.item_id::text as item_id,
      upper(coalesce(nullif(btrim(isi.currency),''), v_base)) as currency,
      coalesce(rq.base_qty, isi.quantity, 0) as base_qty,
      coalesce(pc.unit_cost_base, isi.unit_price_fob, 0) as unit_cost_trx
    from public.import_shipments_items isi
    left join receipt_qty rq on rq.item_id = isi.item_id::text
    left join po_cost pc on pc.item_id = isi.item_id::text
    where isi.shipment_id = p_shipment_id
  loop
    v_base_qty := coalesce(v_item.base_qty, 0);
    if v_base_qty <= 0 then
      continue;
    end if;
    v_unit_cost_trx := coalesce(v_item.unit_cost_trx, 0);
    v_fx := public._pick_fx_for_landed_cost(v_item.currency, v_date);
    if v_fx is null or v_fx <= 0 then
      continue;
    end if;

    v_item_fob_base_total := v_base_qty * v_unit_cost_trx * v_fx;
    v_alloc_item_base := (v_item_fob_base_total / v_total_fob_base) * coalesce(v_total_expenses_base, 0);
    v_per_unit_alloc := v_alloc_item_base / v_base_qty;

    update public.import_shipments_items
    set landing_cost_per_unit = (v_unit_cost_trx * v_fx) + v_per_unit_alloc,
        updated_at = now()
    where id = v_item.id;
  end loop;
end;
$$;

revoke all on function public.calculate_shipment_landed_cost(uuid) from public;
revoke execute on function public.calculate_shipment_landed_cost(uuid) from anon;
grant execute on function public.calculate_shipment_landed_cost(uuid) to authenticated;

notify pgrst, 'reload schema';

