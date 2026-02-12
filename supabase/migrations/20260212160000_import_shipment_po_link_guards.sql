set app.allow_ledger_ddl = '1';

do $$
begin
  if to_regclass('public.import_shipments') is null or to_regclass('public.purchase_orders') is null then
    return;
  end if;

  if to_regclass('public.import_shipment_purchase_orders') is null then
    create table public.import_shipment_purchase_orders (
      shipment_id uuid not null references public.import_shipments(id) on delete cascade,
      purchase_order_id uuid not null references public.purchase_orders(id) on delete cascade,
      created_at timestamptz not null default now(),
      created_by uuid references auth.users(id) on delete set null,
      primary key (shipment_id, purchase_order_id)
    );
    create index if not exists idx_import_shipment_purchase_orders_po
      on public.import_shipment_purchase_orders(purchase_order_id, created_at desc);
  end if;

  alter table public.import_shipment_purchase_orders enable row level security;

  begin
    drop policy if exists import_shipment_purchase_orders_select on public.import_shipment_purchase_orders;
  exception when undefined_object then null;
  end;
  begin
    drop policy if exists import_shipment_purchase_orders_manage on public.import_shipment_purchase_orders;
  exception when undefined_object then null;
  end;

  create policy import_shipment_purchase_orders_select
  on public.import_shipment_purchase_orders
  for select
  using (
    public.has_admin_permission('procurement.manage')
    or public.has_admin_permission('shipments.view')
  );

  create policy import_shipment_purchase_orders_manage
  on public.import_shipment_purchase_orders
  for all
  using (public.has_admin_permission('procurement.manage'))
  with check (public.has_admin_permission('procurement.manage'));
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
begin
  if tg_op = 'DELETE' then
    return old;
  end if;

  v_ship_id := new.import_shipment_id;
  if v_ship_id is null then
    return new;
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

do $$
begin
  if to_regclass('public.purchase_receipts') is null then
    return;
  end if;
  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'purchase_receipts'
      and column_name = 'import_shipment_id'
  ) then
    return;
  end if;

  drop trigger if exists trg_guard_purchase_receipt_import_shipment_po on public.purchase_receipts;
  create trigger trg_guard_purchase_receipt_import_shipment_po
  before insert or update of import_shipment_id
  on public.purchase_receipts
  for each row
  execute function public.trg_guard_purchase_receipt_import_shipment_po();
end $$;

revoke all on function public.trg_guard_purchase_receipt_import_shipment_po() from public;
revoke execute on function public.trg_guard_purchase_receipt_import_shipment_po() from anon;
grant execute on function public.trg_guard_purchase_receipt_import_shipment_po() to authenticated, service_role;

notify pgrst, 'reload schema';

