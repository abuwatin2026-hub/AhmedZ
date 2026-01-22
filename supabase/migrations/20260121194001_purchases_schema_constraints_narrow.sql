create or replace function public.purchase_return_items_set_total_cost()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.total_cost := coalesce(new.quantity, 0) * coalesce(new.unit_cost, 0);
  return new;
end;
$$;

do $$
begin
  if to_regclass('public.purchase_return_items') is not null then
    drop trigger if exists trg_purchase_return_items_total_cost on public.purchase_return_items;
    create trigger trg_purchase_return_items_total_cost
    before insert or update of quantity, unit_cost
    on public.purchase_return_items
    for each row
    execute function public.purchase_return_items_set_total_cost();
  end if;
end $$;

create or replace function public.purchase_receipt_items_set_total_cost()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.total_cost := coalesce(new.quantity, 0) * coalesce(new.unit_cost, 0);
  return new;
end;
$$;

do $$
begin
  if to_regclass('public.purchase_receipt_items') is not null then
    drop trigger if exists trg_purchase_receipt_items_total_cost on public.purchase_receipt_items;
    create trigger trg_purchase_receipt_items_total_cost
    before insert or update of quantity, unit_cost
    on public.purchase_receipt_items
    for each row
    execute function public.purchase_receipt_items_set_total_cost();
  end if;
end $$;

do $$
begin
  if to_regclass('public.purchase_items') is not null then
    begin
      alter table public.purchase_items
        drop constraint if exists purchase_items_received_quantity_check;
    exception when undefined_object then
      null;
    end;

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

create or replace function public.sync_purchase_order_paid_amount_from_payments(p_order_id uuid)
returns void
language plpgsql
set search_path = public
as $$
declare
  v_total numeric;
  v_sum numeric;
begin
  if p_order_id is null then
    return;
  end if;

  select coalesce(po.total_amount, 0)
  into v_total
  from public.purchase_orders po
  where po.id = p_order_id
  for update;

  if not found then
    return;
  end if;

  select coalesce(sum(p.amount), 0)
  into v_sum
  from public.payments p
  where p.reference_table = 'purchase_orders'
    and p.direction = 'out'
    and p.reference_id = p_order_id::text;

  update public.purchase_orders po
  set paid_amount = least(coalesce(v_sum, 0), coalesce(v_total, 0)),
      updated_at = now()
  where po.id = p_order_id;
end;
$$;

create or replace function public.trg_sync_purchase_order_paid_amount()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_old_id uuid;
  v_new_id uuid;
  v_status text;
begin
  if tg_op = 'DELETE' then
    begin
      v_old_id := nullif(trim(coalesce(old.reference_id, '')), '')::uuid;
    exception when others then
      return old;
    end;
    if old.reference_table = 'purchase_orders' and old.direction = 'out' then
      perform public.sync_purchase_order_paid_amount_from_payments(v_old_id);
    end if;
    return old;
  end if;

  if new.reference_table is distinct from 'purchase_orders' or new.direction is distinct from 'out' then
    return new;
  end if;

  begin
    v_new_id := nullif(trim(coalesce(new.reference_id, '')), '')::uuid;
  exception when others then
    raise exception 'invalid purchase order reference_id';
  end;

  select po.status
  into v_status
  from public.purchase_orders po
  where po.id = v_new_id;

  if not found then
    raise exception 'purchase order not found';
  end if;

  if v_status = 'cancelled' then
    raise exception 'cannot record payment for cancelled purchase order';
  end if;

  if tg_op = 'UPDATE' and (new.reference_id is distinct from old.reference_id) then
    begin
      v_old_id := nullif(trim(coalesce(old.reference_id, '')), '')::uuid;
    exception when others then
      v_old_id := null;
    end;
    if v_old_id is not null then
      perform public.sync_purchase_order_paid_amount_from_payments(v_old_id);
    end if;
  end if;

  perform public.sync_purchase_order_paid_amount_from_payments(v_new_id);
  return new;
end;
$$;

do $$
begin
  if to_regclass('public.payments') is not null then
    drop trigger if exists trg_payments_sync_purchase_orders on public.payments;
    create trigger trg_payments_sync_purchase_orders
    after insert or update or delete
    on public.payments
    for each row
    execute function public.trg_sync_purchase_order_paid_amount();
  end if;
end $$;

do $$
begin
  if to_regclass('public.suppliers') is not null then
    alter table public.suppliers enable row level security;
    begin drop policy if exists "Enable read access for authenticated users" on public.suppliers; exception when undefined_object then null; end;
    begin drop policy if exists suppliers_admin_select on public.suppliers; exception when undefined_object then null; end;
    begin drop policy if exists "Enable all access for admins and managers" on public.suppliers; exception when undefined_object then null; end;
    begin drop policy if exists suppliers_select on public.suppliers; exception when undefined_object then null; end;
    begin drop policy if exists suppliers_manage on public.suppliers; exception when undefined_object then null; end;

    create policy suppliers_select
    on public.suppliers
    for select
    using (public.can_manage_stock());

    create policy suppliers_manage
    on public.suppliers
    for all
    using (public.can_manage_stock())
    with check (public.can_manage_stock());
  end if;

  if to_regclass('public.purchase_orders') is not null then
    alter table public.purchase_orders enable row level security;
    begin drop policy if exists "Enable read access for authenticated users" on public.purchase_orders; exception when undefined_object then null; end;
    begin drop policy if exists purchase_orders_admin_select on public.purchase_orders; exception when undefined_object then null; end;
    begin drop policy if exists "Enable insert/update for admins and managers" on public.purchase_orders; exception when undefined_object then null; end;
    begin drop policy if exists purchase_orders_manage on public.purchase_orders; exception when undefined_object then null; end;
    begin drop policy if exists purchase_orders_select on public.purchase_orders; exception when undefined_object then null; end;
    begin drop policy if exists purchase_orders_insert on public.purchase_orders; exception when undefined_object then null; end;
    begin drop policy if exists purchase_orders_update on public.purchase_orders; exception when undefined_object then null; end;
    begin drop policy if exists purchase_orders_delete on public.purchase_orders; exception when undefined_object then null; end;

    create policy purchase_orders_select
    on public.purchase_orders
    for select
    using (public.can_manage_stock());

    create policy purchase_orders_insert
    on public.purchase_orders
    for insert
    with check (public.can_manage_stock());

    create policy purchase_orders_update
    on public.purchase_orders
    for update
    using (public.can_manage_stock())
    with check (public.can_manage_stock());

    create policy purchase_orders_delete
    on public.purchase_orders
    for delete
    using (public.can_manage_stock() and status = 'draft');
  end if;

  if to_regclass('public.purchase_items') is not null then
    alter table public.purchase_items enable row level security;
    begin drop policy if exists "Enable read access for authenticated users" on public.purchase_items; exception when undefined_object then null; end;
    begin drop policy if exists purchase_items_admin_select on public.purchase_items; exception when undefined_object then null; end;
    begin drop policy if exists "Enable all access for admins and managers" on public.purchase_items; exception when undefined_object then null; end;
    begin drop policy if exists purchase_items_manage on public.purchase_items; exception when undefined_object then null; end;
    begin drop policy if exists purchase_items_select on public.purchase_items; exception when undefined_object then null; end;
    begin drop policy if exists purchase_items_insert on public.purchase_items; exception when undefined_object then null; end;
    begin drop policy if exists purchase_items_update on public.purchase_items; exception when undefined_object then null; end;
    begin drop policy if exists purchase_items_delete on public.purchase_items; exception when undefined_object then null; end;

    create policy purchase_items_select
    on public.purchase_items
    for select
    using (public.can_manage_stock());

    create policy purchase_items_insert
    on public.purchase_items
    for insert
    with check (public.can_manage_stock());

    create policy purchase_items_update
    on public.purchase_items
    for update
    using (public.can_manage_stock())
    with check (public.can_manage_stock());

    create policy purchase_items_delete
    on public.purchase_items
    for delete
    using (
      public.can_manage_stock()
      and exists (
        select 1
        from public.purchase_orders po
        where po.id = purchase_items.purchase_order_id
          and po.status = 'draft'
      )
    );
  end if;

  if to_regclass('public.purchase_receipts') is not null then
    alter table public.purchase_receipts enable row level security;
    begin drop policy if exists purchase_receipts_admin_only on public.purchase_receipts; exception when undefined_object then null; end;
    begin drop policy if exists purchase_receipts_select on public.purchase_receipts; exception when undefined_object then null; end;
    begin drop policy if exists purchase_receipts_insert on public.purchase_receipts; exception when undefined_object then null; end;
    begin drop policy if exists purchase_receipts_update on public.purchase_receipts; exception when undefined_object then null; end;

    create policy purchase_receipts_select
    on public.purchase_receipts
    for select
    using (public.can_manage_stock());

    create policy purchase_receipts_insert
    on public.purchase_receipts
    for insert
    with check (public.can_manage_stock());

    create policy purchase_receipts_update
    on public.purchase_receipts
    for update
    using (public.can_manage_stock())
    with check (public.can_manage_stock());
  end if;

  if to_regclass('public.purchase_receipt_items') is not null then
    alter table public.purchase_receipt_items enable row level security;
    begin drop policy if exists purchase_receipt_items_admin_only on public.purchase_receipt_items; exception when undefined_object then null; end;
    begin drop policy if exists purchase_receipt_items_select on public.purchase_receipt_items; exception when undefined_object then null; end;
    begin drop policy if exists purchase_receipt_items_insert on public.purchase_receipt_items; exception when undefined_object then null; end;
    begin drop policy if exists purchase_receipt_items_update on public.purchase_receipt_items; exception when undefined_object then null; end;

    create policy purchase_receipt_items_select
    on public.purchase_receipt_items
    for select
    using (public.can_manage_stock());

    create policy purchase_receipt_items_insert
    on public.purchase_receipt_items
    for insert
    with check (public.can_manage_stock());

    create policy purchase_receipt_items_update
    on public.purchase_receipt_items
    for update
    using (public.can_manage_stock())
    with check (public.can_manage_stock());
  end if;

  if to_regclass('public.purchase_returns') is not null then
    alter table public.purchase_returns enable row level security;
    begin drop policy if exists purchase_returns_admin_only on public.purchase_returns; exception when undefined_object then null; end;
    begin drop policy if exists purchase_returns_select on public.purchase_returns; exception when undefined_object then null; end;
    begin drop policy if exists purchase_returns_insert on public.purchase_returns; exception when undefined_object then null; end;
    begin drop policy if exists purchase_returns_update on public.purchase_returns; exception when undefined_object then null; end;

    create policy purchase_returns_select
    on public.purchase_returns
    for select
    using (public.can_manage_stock());

    create policy purchase_returns_insert
    on public.purchase_returns
    for insert
    with check (public.can_manage_stock());

    create policy purchase_returns_update
    on public.purchase_returns
    for update
    using (public.can_manage_stock())
    with check (public.can_manage_stock());
  end if;

  if to_regclass('public.purchase_return_items') is not null then
    alter table public.purchase_return_items enable row level security;
    begin drop policy if exists purchase_return_items_admin_only on public.purchase_return_items; exception when undefined_object then null; end;
    begin drop policy if exists purchase_return_items_select on public.purchase_return_items; exception when undefined_object then null; end;
    begin drop policy if exists purchase_return_items_insert on public.purchase_return_items; exception when undefined_object then null; end;
    begin drop policy if exists purchase_return_items_update on public.purchase_return_items; exception when undefined_object then null; end;

    create policy purchase_return_items_select
    on public.purchase_return_items
    for select
    using (public.can_manage_stock());

    create policy purchase_return_items_insert
    on public.purchase_return_items
    for insert
    with check (public.can_manage_stock());

    create policy purchase_return_items_update
    on public.purchase_return_items
    for update
    using (public.can_manage_stock())
    with check (public.can_manage_stock());
  end if;
end $$;
