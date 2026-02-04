do $$
declare
  v_wh uuid;
begin
  if to_regclass('public.warehouses') is null then
    return;
  end if;

  select public._resolve_default_admin_warehouse_id() into v_wh;
  if v_wh is null then
    return;
  end if;

  if to_regclass('public.stock_management') is not null then
    update public.stock_management set warehouse_id = coalesce(warehouse_id, v_wh) where warehouse_id is null;
  end if;
  if to_regclass('public.inventory_movements') is not null then
    update public.inventory_movements set warehouse_id = coalesce(warehouse_id, v_wh) where warehouse_id is null;
  end if;
  if to_regclass('public.batches') is not null then
    update public.batches set warehouse_id = coalesce(warehouse_id, v_wh) where warehouse_id is null;
  end if;
  if to_regclass('public.batch_balances') is not null then
    update public.batch_balances set warehouse_id = coalesce(warehouse_id, v_wh) where warehouse_id is null;
  end if;
  if to_regclass('public.purchase_orders') is not null then
    update public.purchase_orders set warehouse_id = coalesce(warehouse_id, v_wh) where warehouse_id is null;
  end if;
  if to_regclass('public.purchase_receipts') is not null then
    update public.purchase_receipts set warehouse_id = coalesce(warehouse_id, v_wh) where warehouse_id is null;
  end if;
  if to_regclass('public.orders') is not null then
    update public.orders set warehouse_id = coalesce(warehouse_id, v_wh) where warehouse_id is null;
  end if;

  begin
    if to_regclass('public.stock_management') is not null then
      alter table public.stock_management alter column warehouse_id set not null;
    end if;
  exception when others then null;
  end;

  begin
    if to_regclass('public.inventory_movements') is not null then
      alter table public.inventory_movements alter column warehouse_id set not null;
    end if;
  exception when others then null;
  end;

  begin
    if to_regclass('public.batches') is not null then
      alter table public.batches alter column warehouse_id set not null;
    end if;
  exception when others then null;
  end;

  begin
    if to_regclass('public.batch_balances') is not null then
      alter table public.batch_balances alter column warehouse_id set not null;
    end if;
  exception when others then null;
  end;

  begin
    if to_regclass('public.purchase_orders') is not null then
      alter table public.purchase_orders alter column warehouse_id set not null;
    end if;
  exception when others then null;
  end;

  begin
    if to_regclass('public.purchase_receipts') is not null then
      alter table public.purchase_receipts alter column warehouse_id set not null;
    end if;
  exception when others then null;
  end;

  begin
    if to_regclass('public.orders') is not null then
      alter table public.orders alter column warehouse_id set not null;
    end if;
  exception when others then null;
  end;
end $$;

select pg_sleep(0.5);
notify pgrst, 'reload schema';
