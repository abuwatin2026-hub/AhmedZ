set app.allow_ledger_ddl = '1';

do $$
begin
  if to_regclass('public.purchase_receipt_items') is null then
    return;
  end if;

  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'purchase_receipt_items'
      and column_name = 'qty_base'
  ) then
    begin
      update public.purchase_receipt_items pri
      set qty_base = coalesce(
        pri.qty_base,
        public.item_qty_to_base(pri.item_id, pri.quantity, pri.uom_id)
      )
      where coalesce(pri.qty_base, 0) = 0
        and coalesce(pri.quantity, 0) > 0;
    exception when others then
      null;
    end;
  end if;
end $$;

notify pgrst, 'reload schema';
