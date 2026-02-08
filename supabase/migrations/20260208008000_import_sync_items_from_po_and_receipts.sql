do $$
begin
  if to_regclass('public.import_shipments_items') is null then
    return;
  end if;
  create unique index if not exists uq_import_shipments_items_shipment_item
    on public.import_shipments_items(shipment_id, item_id);
end $$;

create or replace function public.sync_import_shipment_items_from_receipts(
  p_shipment_id uuid,
  p_replace boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_ship record;
  v_currency text;
  v_linked_count int := 0;
  v_upserted int := 0;
  v_deleted int := 0;
begin
  if not public.has_admin_permission('procurement.manage') then
    raise exception 'not allowed';
  end if;

  if p_shipment_id is null then
    raise exception 'p_shipment_id is required';
  end if;

  select *
  into v_ship
  from public.import_shipments s
  where s.id = p_shipment_id
  for update;

  if not found then
    raise exception 'shipment not found';
  end if;

  if v_ship.status = 'closed' then
    raise exception 'shipment is closed';
  end if;

  select count(*)
  into v_linked_count
  from public.purchase_receipts pr
  where pr.import_shipment_id = p_shipment_id;

  if v_linked_count = 0 then
    return jsonb_build_object('status','skipped','reason','no_linked_receipts','upserted',0,'deleted',0);
  end if;

  select
    case
      when count(distinct nullif(coalesce(po.currency, ''), '')) = 1 then max(nullif(coalesce(po.currency, ''), ''))
      else null
    end
  into v_currency
  from public.purchase_receipts pr
  join public.purchase_orders po on po.id = pr.purchase_order_id
  where pr.import_shipment_id = p_shipment_id;

  if v_currency is null or btrim(v_currency) = '' then
    v_currency := coalesce(public.get_base_currency(), 'USD');
  end if;

  with agg as (
    select
      pri.item_id::text as item_id,
      sum(coalesce(pri.quantity, 0))::numeric as quantity,
      case
        when sum(coalesce(pri.quantity, 0)) > 0 then
          (sum(coalesce(pri.quantity, 0) * greatest(coalesce(pri.unit_cost, 0) - coalesce(pri.transport_cost, 0) - coalesce(pri.supply_tax_cost, 0), 0)))
          / sum(coalesce(pri.quantity, 0))
        else 0
      end::numeric as unit_price_fob
    from public.purchase_receipts pr
    join public.purchase_receipt_items pri on pri.receipt_id = pr.id
    where pr.import_shipment_id = p_shipment_id
    group by pri.item_id
    having sum(coalesce(pri.quantity, 0)) > 0
  ),
  up as (
    insert into public.import_shipments_items(
      shipment_id,
      item_id,
      quantity,
      unit_price_fob,
      currency,
      expiry_date,
      notes,
      updated_at
    )
    select
      p_shipment_id,
      a.item_id,
      a.quantity,
      greatest(coalesce(a.unit_price_fob, 0), 0),
      v_currency,
      null,
      'synced_from_receipts',
      now()
    from agg a
    on conflict (shipment_id, item_id) do update
    set
      quantity = excluded.quantity,
      unit_price_fob = case when coalesce(import_shipments_items.unit_price_fob, 0) > 0 then import_shipments_items.unit_price_fob else excluded.unit_price_fob end,
      currency = coalesce(nullif(import_shipments_items.currency, ''), excluded.currency),
      updated_at = now()
    returning 1
  )
  select count(*) into v_upserted from up;

  if p_replace then
    with keep as (
      select pri.item_id::text as item_id
      from public.purchase_receipts pr
      join public.purchase_receipt_items pri on pri.receipt_id = pr.id
      where pr.import_shipment_id = p_shipment_id
      group by pri.item_id
      having sum(coalesce(pri.quantity, 0)) > 0
    ),
    del as (
      delete from public.import_shipments_items isi
      where isi.shipment_id = p_shipment_id
        and not exists (select 1 from keep k where k.item_id = isi.item_id::text)
      returning 1
    )
    select count(*) into v_deleted from del;
  end if;

  return jsonb_build_object(
    'status','ok',
    'linkedReceipts', v_linked_count,
    'upserted', v_upserted,
    'deleted', v_deleted,
    'currency', v_currency
  );
end;
$$;

revoke all on function public.sync_import_shipment_items_from_receipts(uuid, boolean) from public;
grant execute on function public.sync_import_shipment_items_from_receipts(uuid, boolean) to authenticated;

select pg_sleep(0.5);
notify pgrst, 'reload schema';
