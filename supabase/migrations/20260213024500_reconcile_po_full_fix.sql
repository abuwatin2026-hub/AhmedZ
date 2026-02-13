set app.allow_ledger_ddl = '1';

create or replace function public.backfill_receipt_items_qty_base()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_n int := 0;
begin
  if to_regclass('public.purchase_receipt_items') is null then
    return 0;
  end if;
  update public.purchase_receipt_items pri
  set qty_base = coalesce(
    nullif(pri.qty_base, 0),
    public.item_qty_to_base_safe(pri.item_id, pri.quantity, pri.uom_id)
  )
  where coalesce(pri.qty_base, 0) = 0
    and coalesce(pri.quantity, 0) > 0;
  get diagnostics v_n = row_count;
  notify pgrst, 'reload schema';
  return coalesce(v_n, 0);
end;
$$;

revoke all on function public.backfill_receipt_items_qty_base() from public;
grant execute on function public.backfill_receipt_items_qty_base() to authenticated;

create or replace function public.backfill_purchase_items_qty_base()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_n int := 0;
begin
  if to_regclass('public.purchase_items') is null then
    return 0;
  end if;
  if to_regclass('public.item_uom') is null then
    return 0;
  end if;
  update public.purchase_items pi
  set uom_id = coalesce(pi.uom_id, iu.base_uom_id),
      qty_base = coalesce(
        nullif(pi.qty_base, 0),
        public.item_qty_to_base_safe(pi.item_id::text, pi.quantity, coalesce(pi.uom_id, iu.base_uom_id))
      )
  from public.item_uom iu
  where iu.item_id::text = pi.item_id::text
    and coalesce(pi.quantity, 0) > 0
    and coalesce(pi.qty_base, 0) = 0;
  get diagnostics v_n = row_count;
  notify pgrst, 'reload schema';
  return coalesce(v_n, 0);
end;
$$;

revoke all on function public.backfill_purchase_items_qty_base() from public;
grant execute on function public.backfill_purchase_items_qty_base() to authenticated;

create or replace function public.force_complete_purchase_orders_from_receipts(p_limit int default 100000)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_n int := 0;
  v_has_batches boolean := false;
begin
  begin
    if to_regclass('public.batches') is not null then
      v_has_batches := true;
    end if;
  exception when others then
    v_has_batches := false;
  end;

  for v_id in
    select po.id
    from public.purchase_orders po
    where po.status <> 'cancelled'
      and exists (select 1 from public.purchase_receipts pr where pr.purchase_order_id = po.id)
    order by po.updated_at desc nulls last
    limit greatest(coalesce(p_limit, 0), 0)
  loop
    begin
      if v_has_batches then
        with totals as (
          select b.item_id::text as item_id, sum(coalesce(b.quantity_received, 0)) as received_base
          from public.purchase_receipts pr
          join public.batches b on b.receipt_id = pr.id
          where pr.purchase_order_id = v_id
          group by b.item_id::text
        ),
        ordered as (
          select
            pi.id,
            pi.item_id::text as item_id,
            coalesce(
              nullif(pi.qty_base, 0),
              case
                when pi.uom_id is not null then public.item_qty_to_base_safe(pi.item_id, pi.quantity, pi.uom_id)
                else pi.quantity
              end,
              0
            ) as ordered_base
          from public.purchase_items pi
          where pi.purchase_order_id = v_id
        )
        update public.purchase_items pi
        set received_quantity = least(coalesce(t.received_base, 0), coalesce(o.ordered_base, 0))
        from totals t
        join ordered o on o.id = pi.id
        where pi.purchase_order_id = v_id
          and pi.item_id::text = t.item_id
          and coalesce(pi.received_quantity, 0) is distinct from least(coalesce(t.received_base, 0), coalesce(o.ordered_base, 0));
      else
        with totals as (
          select
            pri.item_id::text as item_id,
            sum(
              coalesce(
                nullif(pri.qty_base, 0),
                case
                  when pri.uom_id is not null then public.item_qty_to_base_safe(pri.item_id, pri.quantity, pri.uom_id)
                  else pri.quantity
                end,
                0
              )
            ) as received_base
          from public.purchase_receipts pr
          join public.purchase_receipt_items pri on pri.receipt_id = pr.id
          where pr.purchase_order_id = v_id
          group by pri.item_id::text
        ),
        ordered as (
          select
            pi.id,
            pi.item_id::text as item_id,
            coalesce(
              nullif(pi.qty_base, 0),
              case
                when pi.uom_id is not null then public.item_qty_to_base_safe(pi.item_id, pi.quantity, pi.uom_id)
                else pi.quantity
              end,
              0
            ) as ordered_base
          from public.purchase_items pi
          where pi.purchase_order_id = v_id
        )
        update public.purchase_items pi
        set received_quantity = least(coalesce(t.received_base, 0), coalesce(o.ordered_base, 0))
        from totals t
        join ordered o on o.id = pi.id
        where pi.purchase_order_id = v_id
          and pi.item_id::text = t.item_id
          and coalesce(pi.received_quantity, 0) is distinct from least(coalesce(t.received_base, 0), coalesce(o.ordered_base, 0));
      end if;

      with ordered_sum as (
        select sum(
          coalesce(
            nullif(pi.qty_base, 0),
            case
              when pi.uom_id is not null then public.item_qty_to_base_safe(pi.item_id, pi.quantity, pi.uom_id)
              else pi.quantity
            end,
            0
          )
        ) as ordered_base
        from public.purchase_items pi
        where pi.purchase_order_id = v_id
      ),
      received_sum as (
        select sum(
          coalesce(
            nullif(pri.qty_base, 0),
            case
              when pri.uom_id is not null then public.item_qty_to_base_safe(pri.item_id, pri.quantity, pri.uom_id)
              else pri.quantity
            end,
            0
          )
        ) as received_base
        from public.purchase_receipts pr
        join public.purchase_receipt_items pri on pri.receipt_id = pr.id
        where pr.purchase_order_id = v_id
      )
      update public.purchase_orders po
      set status = 'completed',
          approval_status = 'approved',
          approval_request_id = null,
          updated_at = now()
      from ordered_sum o, received_sum r
      where po.id = v_id
        and po.status <> 'cancelled'
        and (
          (coalesce(o.ordered_base, 0) > 0 and coalesce(r.received_base, 0) + 0.000000001 >= coalesce(o.ordered_base, 0))
          or (coalesce(o.ordered_base, 0) = 0 and coalesce(r.received_base, 0) > 0)
        )
        and po.status is distinct from 'completed';

      if found then
        v_n := v_n + 1;
      end if;
    exception when others then
      null;
    end;
  end loop;

  begin
    update public.purchase_orders po
    set approval_status = 'approved',
        approval_request_id = null,
        updated_at = now()
    where po.status = 'completed'
      and exists (select 1 from public.purchase_receipts pr where pr.purchase_order_id = po.id);
  exception when others then
    null;
  end;

  return v_n;
end;
$$;

revoke all on function public.force_complete_purchase_orders_from_receipts(int) from public;
grant execute on function public.force_complete_purchase_orders_from_receipts(int) to authenticated;

create or replace function public.report_partial_purchase_orders(p_limit int default 2000)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rows jsonb;
  v_n int := 0;
begin
  with po_base as (
    select
      po.id,
      po.po_number,
      po.reference_number,
      s.name as supplier_name
    from public.purchase_orders po
    left join public.suppliers s on s.id = po.supplier_id
    where po.status <> 'cancelled'
      and exists (select 1 from public.purchase_receipts pr where pr.purchase_order_id = po.id)
    order by po.updated_at desc nulls last
    limit greatest(coalesce(p_limit, 0), 0)
  ),
  ordered as (
    select
      pi.purchase_order_id,
      pi.item_id::text as item_id,
      sum(
        coalesce(
          nullif(pi.qty_base, 0),
          case
            when pi.uom_id is not null then public.item_qty_to_base_safe(pi.item_id, pi.quantity, pi.uom_id)
            else pi.quantity
          end,
          0
        )
      ) as ordered_base
    from public.purchase_items pi
    join po_base pb on pb.id = pi.purchase_order_id
    group by pi.purchase_order_id, pi.item_id::text
  ),
  received as (
    select
      pr.purchase_order_id,
      pri.item_id::text as item_id,
      sum(
        coalesce(
          nullif(pri.qty_base, 0),
          case
            when pri.uom_id is not null then public.item_qty_to_base_safe(pri.item_id, pri.quantity, pri.uom_id)
            else pri.quantity
          end,
          0
        )
      ) as received_base
    from public.purchase_receipts pr
    join public.purchase_receipt_items pri on pri.receipt_id = pr.id
    where pr.purchase_order_id in (select id from po_base)
    group by pr.purchase_order_id, pri.item_id::text
  ),
  rows as (
    select
      pb.id as order_id,
      coalesce(pb.po_number::text, pb.reference_number, pb.id::text) as reference,
      coalesce(pb.supplier_name, '') as supplier_name,
      jsonb_agg(
        jsonb_build_object(
          'itemId', o.item_id,
          'ordered', o.ordered_base,
          'received', coalesce(r.received_base, 0),
          'remaining', greatest(o.ordered_base - coalesce(r.received_base, 0), 0)
        )
        order by o.item_id
      ) filter (where greatest(o.ordered_base - coalesce(r.received_base, 0), 0) > 0.000000001) as items
    from po_base pb
    join ordered o on o.purchase_order_id = pb.id
    left join received r on r.purchase_order_id = pb.id and r.item_id = o.item_id
    group by pb.id, pb.po_number, pb.reference_number, pb.supplier_name
  )
  select jsonb_agg(
    jsonb_build_object(
      'orderId', order_id,
      'reference', reference,
      'supplierName', supplier_name,
      'items', items
    )
  ) filter (where items is not null)
  into v_rows
  from rows;

  v_n := coalesce(jsonb_array_length(v_rows), 0);
  return jsonb_build_object(
    'count', v_n,
    'rows', coalesce(v_rows, '[]'::jsonb)
  );
end;
$$;

revoke all on function public.report_partial_purchase_orders(int) from public;
grant execute on function public.report_partial_purchase_orders(int) to authenticated;

create or replace function public.reconcile_po_full_fix(p_limit int default 100000)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_r int := 0;
  v_p int := 0;
  v_n int := 0;
  v_f int := 0;
begin
  begin
    v_r := coalesce(public.backfill_receipt_items_qty_base(), 0);
  exception when others then
    v_r := 0;
  end;
  begin
    v_p := coalesce(public.backfill_purchase_items_qty_base(), 0);
  exception when others then
    v_p := 0;
  end;
  begin
    if to_regprocedure('public.reconcile_all_purchase_orders(integer)') is not null then
      v_n := coalesce(public.reconcile_all_purchase_orders(greatest(coalesce(p_limit, 0), 0)), 0);
    else
      v_n := 0;
    end if;
  exception when others then
    v_n := 0;
  end;
  begin
    if to_regprocedure('public.force_complete_purchase_orders_from_receipts(integer)') is not null then
      v_f := coalesce(public.force_complete_purchase_orders_from_receipts(greatest(coalesce(p_limit, 0), 0)), 0);
    else
      v_f := 0;
    end if;
  exception when others then
    v_f := 0;
  end;
  notify pgrst, 'reload schema';
  return jsonb_build_object(
    'receiptItemsUpdated', coalesce(v_r, 0),
    'purchaseItemsUpdated', coalesce(v_p, 0),
    'ordersReconciled', coalesce(v_n, 0),
    'ordersForced', coalesce(v_f, 0)
  );
end;
$$;

revoke all on function public.reconcile_po_full_fix(int) from public;
grant execute on function public.reconcile_po_full_fix(int) to authenticated;

notify pgrst, 'reload schema';
