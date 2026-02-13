set app.allow_ledger_ddl = '1';

do $$
begin
  if to_regclass('public.purchase_items') is null then
    return;
  end if;
  if to_regclass('public.item_uom') is null then
    return;
  end if;
  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'purchase_items'
      and column_name = 'qty_base'
  ) then
    return;
  end if;

  begin
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
  exception when others then
    null;
  end;

  begin
    if to_regprocedure('public.reconcile_all_purchase_orders(integer)') is not null then
      perform public.reconcile_all_purchase_orders(100000);
    end if;
  exception when others then
    null;
  end;
end $$;

notify pgrst, 'reload schema';

