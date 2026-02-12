set app.allow_ledger_ddl = '1';

create or replace function public.trg_lock_closed_import_shipments()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'UPDATE' then
    if coalesce(old.status, '') = 'closed' then
      raise exception 'Shipment is closed and cannot be modified';
    end if;
    if coalesce(old.status, '') = 'delivered' and coalesce(new.status, '') <> 'closed' then
      raise exception 'Delivered shipment can only transition to closed';
    end if;
  end if;
  return new;
end;
$$;

do $$
begin
  if to_regclass('public.import_shipments') is null then
    return;
  end if;
  drop trigger if exists trg_lock_closed_import_shipments on public.import_shipments;
  create trigger trg_lock_closed_import_shipments
  before update on public.import_shipments
  for each row
  execute function public.trg_lock_closed_import_shipments();
end $$;

create or replace function public.trg_block_closed_import_shipment_children()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ship_id uuid;
  v_status text;
begin
  v_ship_id := null;
  if tg_table_name = 'import_shipments_items' then
    v_ship_id := coalesce(new.shipment_id, old.shipment_id);
  elsif tg_table_name = 'import_expenses' then
    v_ship_id := coalesce(new.shipment_id, old.shipment_id);
  end if;

  if v_ship_id is null then
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  select s.status into v_status
  from public.import_shipments s
  where s.id = v_ship_id;

  if coalesce(v_status, '') = 'closed' then
    raise exception 'Shipment is closed and its items/expenses cannot be modified';
  end if;

  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

do $$
begin
  if to_regclass('public.import_shipments_items') is not null then
    drop trigger if exists trg_block_closed_import_shipment_items on public.import_shipments_items;
    create trigger trg_block_closed_import_shipment_items
    before insert or update or delete on public.import_shipments_items
    for each row
    execute function public.trg_block_closed_import_shipment_children();
  end if;

  if to_regclass('public.import_expenses') is not null then
    drop trigger if exists trg_block_closed_import_expenses on public.import_expenses;
    create trigger trg_block_closed_import_expenses
    before insert or update or delete on public.import_expenses
    for each row
    execute function public.trg_block_closed_import_shipment_children();
  end if;
end $$;

create or replace function public.trg_guard_purchase_receipt_import_shipment_po()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ship_id uuid;
  v_po_id uuid;
  v_has_allowlist boolean;
  v_ship_status text;
begin
  if tg_op = 'DELETE' then
    return old;
  end if;

  v_ship_id := new.import_shipment_id;
  if v_ship_id is null then
    return new;
  end if;

  select s.status into v_ship_status
  from public.import_shipments s
  where s.id = v_ship_id;
  if coalesce(v_ship_status, '') = 'closed' then
    raise exception 'Shipment is closed and cannot be linked to receipts';
  end if;

  v_po_id := new.purchase_order_id;
  if v_po_id is null then
    return new;
  end if;

  if to_regclass('public.import_shipment_purchase_orders') is not null then
    select exists(
      select 1
      from public.import_shipment_purchase_orders l
      where l.shipment_id = v_ship_id
    )
    into v_has_allowlist;

    if v_has_allowlist then
      if not exists(
        select 1
        from public.import_shipment_purchase_orders l
        where l.shipment_id = v_ship_id
          and l.purchase_order_id = v_po_id
      ) then
        raise exception 'Purchase order % is not allowed for shipment %', v_po_id, v_ship_id;
      end if;
    end if;
  end if;

  if exists(
    select 1
    from public.purchase_receipts pr
    where pr.import_shipment_id = v_ship_id
      and pr.purchase_order_id = v_po_id
      and pr.id <> new.id
  ) then
    raise exception 'Purchase order % is already linked to shipment %', v_po_id, v_ship_id;
  end if;

  return new;
end;
$$;

notify pgrst, 'reload schema';

