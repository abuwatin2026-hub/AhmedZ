set app.allow_ledger_ddl = '1';

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
  v_has_batches boolean := false;
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

  begin
    if to_regclass('public.batches') is not null then
      select exists(
        select 1
        from public.purchase_receipts pr
        join public.batches b on b.receipt_id = pr.id
        where pr.purchase_order_id = p_order_id
      )
      into v_has_batches;
    end if;
  exception when others then
    v_has_batches := false;
  end;

  if coalesce(v_has_batches, false) then
    with totals as (
      select b.item_id::text as item_id, sum(coalesce(b.quantity_received, 0)) as received_base
      from public.purchase_receipts pr
      join public.batches b on b.receipt_id = pr.id
      where pr.purchase_order_id = p_order_id
      group by b.item_id::text
    ),
    ordered as (
      select
        pi.id,
        pi.item_id::text as item_id,
        coalesce(
          pi.qty_base,
          case
            when pi.uom_id is not null then public.item_qty_to_base(pi.item_id, pi.quantity, pi.uom_id)
            else pi.quantity
          end,
          0
        ) as ordered_base
      from public.purchase_items pi
      where pi.purchase_order_id = p_order_id
    )
    update public.purchase_items pi
    set received_quantity = least(coalesce(t.received_base, 0), coalesce(o.ordered_base, 0))
    from totals t
    join ordered o on o.id = pi.id
    where pi.purchase_order_id = p_order_id
      and pi.item_id::text = t.item_id
      and coalesce(pi.received_quantity, 0) is distinct from least(coalesce(t.received_base, 0), coalesce(o.ordered_base, 0));
  else
    with totals as (
      select
        pri.item_id::text as item_id,
        sum(
          coalesce(
            pri.qty_base,
            case
              when pri.uom_id is not null then public.item_qty_to_base(pri.item_id, pri.quantity, pri.uom_id)
              else pri.quantity
            end,
            0
          )
        ) as received_base
      from public.purchase_receipts pr
      join public.purchase_receipt_items pri on pri.receipt_id = pr.id
      where pr.purchase_order_id = p_order_id
      group by pri.item_id::text
    ),
    ordered as (
      select
        pi.id,
        pi.item_id::text as item_id,
        coalesce(
          pi.qty_base,
          case
            when pi.uom_id is not null then public.item_qty_to_base(pi.item_id, pi.quantity, pi.uom_id)
            else pi.quantity
          end,
          0
        ) as ordered_base
      from public.purchase_items pi
      where pi.purchase_order_id = p_order_id
    )
    update public.purchase_items pi
    set received_quantity = least(coalesce(t.received_base, 0), coalesce(o.ordered_base, 0))
    from totals t
    join ordered o on o.id = pi.id
    where pi.purchase_order_id = p_order_id
      and pi.item_id::text = t.item_id
      and coalesce(pi.received_quantity, 0) is distinct from least(coalesce(t.received_base, 0), coalesce(o.ordered_base, 0));
  end if;

  select not exists (
    select 1
    from public.purchase_items pi
    where pi.purchase_order_id = p_order_id
      and (coalesce(pi.received_quantity, 0) + 0.000000001) < coalesce(
        pi.qty_base,
        case
          when pi.uom_id is not null then public.item_qty_to_base(pi.item_id, pi.quantity, pi.uom_id)
          else pi.quantity
        end,
        0
      )
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

revoke all on function public.reconcile_purchase_order_receipt_status(uuid) from public;
grant execute on function public.reconcile_purchase_order_receipt_status(uuid) to authenticated;

notify pgrst, 'reload schema';
