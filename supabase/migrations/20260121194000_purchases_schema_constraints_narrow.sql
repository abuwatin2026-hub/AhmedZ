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

drop trigger if exists trg_purchase_return_items_total_cost on public.purchase_return_items;
create trigger trg_purchase_return_items_total_cost
before insert or update of quantity, unit_cost
on public.purchase_return_items
for each row
execute function public.purchase_return_items_set_total_cost();

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

drop trigger if exists trg_purchase_receipt_items_total_cost on public.purchase_receipt_items;
create trigger trg_purchase_receipt_items_total_cost
before insert or update of quantity, unit_cost
on public.purchase_receipt_items
for each row
execute function public.purchase_receipt_items_set_total_cost();

do $$
begin
  alter table public.purchase_items
    drop constraint if exists purchase_items_received_quantity_check;
exception when undefined_object then
  null;
end $$;

alter table public.purchase_items
add constraint purchase_items_received_quantity_check
check (
  coalesce(received_quantity, 0) >= 0
  and coalesce(received_quantity, 0) <= coalesce(quantity, 0) + 0.000000001
);

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

drop trigger if exists trg_payments_sync_purchase_orders on public.payments;
create trigger trg_payments_sync_purchase_orders
after insert or update or delete
on public.payments
for each row
execute function public.trg_sync_purchase_order_paid_amount();

