set app.allow_ledger_ddl = '1';

do $$
begin
  if to_regclass('public.purchase_items') is null then
    return;
  end if;

  begin
    alter table public.purchase_items
      drop constraint if exists purchase_items_received_quantity_check;
  exception when undefined_object then
    null;
  end;

  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'purchase_items'
      and column_name = 'qty_base'
  ) then
    begin
      update public.purchase_items pi
      set qty_base = public.item_qty_to_base(pi.item_id, pi.quantity, pi.uom_id)
      where (pi.qty_base is null or pi.qty_base = 0)
        and coalesce(pi.quantity, 0) > 0;
    exception when others then
      null;
    end;

    begin
      alter table public.purchase_items
      add constraint purchase_items_received_quantity_check
      check (
        coalesce(received_quantity, 0) >= 0
        and coalesce(received_quantity, 0) <= coalesce(qty_base, quantity, 0) + 0.000000001
      );
    exception when duplicate_object then
      null;
    end;
  else
    begin
      alter table public.purchase_items
      add constraint purchase_items_received_quantity_check
      check (
        coalesce(received_quantity, 0) >= 0
        and coalesce(received_quantity, 0) <= coalesce(quantity, 0) + 0.000000001
      );
    exception when duplicate_object then
      null;
    end;
  end if;
end $$;

notify pgrst, 'reload schema';

