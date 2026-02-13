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
    pri.qty_base,
    public.item_qty_to_base(pri.item_id, pri.quantity, pri.uom_id)
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
        public.item_qty_to_base(pi.item_id::text, pi.quantity, coalesce(pi.uom_id, iu.base_uom_id))
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
  notify pgrst, 'reload schema';
  return jsonb_build_object(
    'receiptItemsUpdated', coalesce(v_r, 0),
    'purchaseItemsUpdated', coalesce(v_p, 0),
    'ordersReconciled', coalesce(v_n, 0)
  );
end;
$$;

revoke all on function public.reconcile_po_full_fix(int) from public;
grant execute on function public.reconcile_po_full_fix(int) to authenticated;

notify pgrst, 'reload schema';

