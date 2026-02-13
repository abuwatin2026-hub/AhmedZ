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

  if not (
    current_user in ('postgres','supabase_admin')
    or auth.role() = 'service_role'
    or public.can_manage_stock()
  ) then
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
    update public.purchase_orders
    set status = 'completed',
        updated_at = now()
    where id = p_order_id
      and status is distinct from 'completed';
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

create or replace function public.reconcile_all_purchase_orders(p_limit int default 10000)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_n int := 0;
begin
  if not (
    current_user in ('postgres','supabase_admin')
    or auth.role() = 'service_role'
    or public.can_manage_stock()
  ) then
    raise exception 'not allowed';
  end if;

  for v_id in
    select po.id
    from public.purchase_orders po
    where po.status <> 'cancelled'
      and exists (select 1 from public.purchase_receipts pr where pr.purchase_order_id = po.id)
    order by po.updated_at desc nulls last
    limit greatest(coalesce(p_limit, 0), 0)
  loop
    begin
      perform public.reconcile_purchase_order_receipt_status(v_id);
      v_n := v_n + 1;
    exception when others then
      null;
    end;
  end loop;

  return v_n;
end;
$$;

revoke all on function public.reconcile_all_purchase_orders(int) from public;
grant execute on function public.reconcile_all_purchase_orders(int) to authenticated;

do $$
begin
  begin
    perform public.reconcile_all_purchase_orders(100000);
  exception when others then
    null;
  end;
end $$;

notify pgrst, 'reload schema';
