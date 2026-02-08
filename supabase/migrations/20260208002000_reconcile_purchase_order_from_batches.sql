create or replace function public.reconcile_purchase_order_receipt_status(p_order_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text;
  v_has_receipts boolean;
  v_all_received boolean;
  v_has_batches boolean;
begin
  if p_order_id is null then
    raise exception 'p_order_id is required';
  end if;

  if not public.can_manage_stock() then
    raise exception 'not allowed';
  end if;

  select po.status
  into v_status
  from public.purchase_orders po
  where po.id = p_order_id
  for update;

  if not found then
    raise exception 'purchase order not found';
  end if;

  if v_status = 'cancelled' then
    return 'cancelled';
  end if;

  select exists(select 1 from public.purchase_receipts pr where pr.purchase_order_id = p_order_id)
  into v_has_receipts;

  if not coalesce(v_has_receipts, false) then
    return coalesce(v_status, 'draft');
  end if;

  select exists(
    select 1
    from public.purchase_receipts pr
    join public.batches b on b.receipt_id = pr.id
    where pr.purchase_order_id = p_order_id
  )
  into v_has_batches;

  if coalesce(v_has_batches, false) then
    with totals as (
      select b.item_id::text as item_id, sum(coalesce(b.quantity_received, 0)) as received
      from public.purchase_receipts pr
      join public.batches b on b.receipt_id = pr.id
      where pr.purchase_order_id = p_order_id
      group by b.item_id::text
    )
    update public.purchase_items pi
    set received_quantity = least(coalesce(t.received, 0), coalesce(pi.quantity, 0))
    from totals t
    where pi.purchase_order_id = p_order_id
      and pi.item_id::text = t.item_id
      and coalesce(pi.received_quantity, 0) is distinct from least(coalesce(t.received, 0), coalesce(pi.quantity, 0));
  else
    with totals as (
      select pri.item_id::text as item_id, sum(coalesce(pri.quantity, 0)) as received
      from public.purchase_receipts pr
      join public.purchase_receipt_items pri on pri.receipt_id = pr.id
      where pr.purchase_order_id = p_order_id
      group by pri.item_id::text
    )
    update public.purchase_items pi
    set received_quantity = least(coalesce(t.received, 0), coalesce(pi.quantity, 0))
    from totals t
    where pi.purchase_order_id = p_order_id
      and pi.item_id::text = t.item_id
      and coalesce(pi.received_quantity, 0) is distinct from least(coalesce(t.received, 0), coalesce(pi.quantity, 0));
  end if;

  select not exists (
    select 1
    from public.purchase_items pi
    where pi.purchase_order_id = p_order_id
      and (coalesce(pi.received_quantity, 0) + 0.000000001) < coalesce(pi.quantity, 0)
  )
  into v_all_received;

  if coalesce(v_all_received, false) then
    if v_status is distinct from 'completed' then
      update public.purchase_orders
      set status = 'completed',
          updated_at = now()
      where id = p_order_id;
    end if;
    return 'completed';
  end if;

  if v_status = 'draft' then
    update public.purchase_orders
    set status = 'partial',
        updated_at = now()
    where id = p_order_id;
    return 'partial';
  end if;

  return coalesce(v_status, 'partial');
end;
$$;

do $$
declare
  v_id uuid;
begin
  for v_id in
    select distinct pr.purchase_order_id
    from public.purchase_receipts pr
    join public.purchase_orders po on po.id = pr.purchase_order_id
    where po.status in ('draft','partial')
  loop
    begin
      perform public.reconcile_purchase_order_receipt_status(v_id);
    exception when others then
      null;
    end;
  end loop;
end;
$$;

select pg_sleep(0.5);
notify pgrst, 'reload schema';
