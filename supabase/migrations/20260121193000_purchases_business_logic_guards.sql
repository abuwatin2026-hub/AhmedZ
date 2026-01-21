create or replace function public.recalc_purchase_order_totals(p_order_id uuid)
returns void
language plpgsql
set search_path = public
as $$
declare
  v_items_total numeric;
  v_returns_total numeric;
  v_net_total numeric;
begin
  if p_order_id is null then
    return;
  end if;

  select coalesce(sum(coalesce(pi.total_cost, coalesce(pi.quantity, 0) * coalesce(pi.unit_cost, 0))), 0)
  into v_items_total
  from public.purchase_items pi
  where pi.purchase_order_id = p_order_id;

  select coalesce(sum(coalesce(pri.total_cost, coalesce(pri.quantity, 0) * coalesce(pri.unit_cost, 0))), 0)
  into v_returns_total
  from public.purchase_returns pr
  join public.purchase_return_items pri on pri.return_id = pr.id
  where pr.purchase_order_id = p_order_id;

  v_net_total := greatest(0, coalesce(v_items_total, 0) - coalesce(v_returns_total, 0));

  update public.purchase_orders po
  set
    total_amount = v_net_total,
    items_count = coalesce((
      select count(*)
      from public.purchase_items pi
      where pi.purchase_order_id = p_order_id
    ), 0),
    paid_amount = least(coalesce(po.paid_amount, 0), v_net_total),
    updated_at = now()
  where po.id = p_order_id;
end;
$$;

create or replace function public.purchase_return_items_after_change()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_old_order_id uuid;
  v_new_order_id uuid;
begin
  if tg_op = 'DELETE' then
    select pr.purchase_order_id into v_old_order_id
    from public.purchase_returns pr
    where pr.id = old.return_id;
    perform public.recalc_purchase_order_totals(v_old_order_id);
    return old;
  end if;

  if tg_op = 'UPDATE' then
    select pr.purchase_order_id into v_old_order_id
    from public.purchase_returns pr
    where pr.id = old.return_id;
    select pr.purchase_order_id into v_new_order_id
    from public.purchase_returns pr
    where pr.id = new.return_id;
    if v_old_order_id is distinct from v_new_order_id then
      perform public.recalc_purchase_order_totals(v_old_order_id);
    end if;
    perform public.recalc_purchase_order_totals(v_new_order_id);
    return new;
  end if;

  select pr.purchase_order_id into v_new_order_id
  from public.purchase_returns pr
  where pr.id = new.return_id;
  perform public.recalc_purchase_order_totals(v_new_order_id);
  return new;
end;
$$;

drop trigger if exists trg_purchase_return_items_recalc on public.purchase_return_items;
create trigger trg_purchase_return_items_recalc
after insert or update or delete
on public.purchase_return_items
for each row
execute function public.purchase_return_items_after_change();

do $$
begin
  alter table public.purchase_orders
    drop constraint if exists purchase_orders_amounts_check;
exception when undefined_object then
  null;
end $$;

alter table public.purchase_orders
add constraint purchase_orders_amounts_check
check (
  coalesce(total_amount, 0) >= 0
  and coalesce(paid_amount, 0) >= 0
  and coalesce(paid_amount, 0) <= coalesce(total_amount, 0) + 0.000000001
);

create or replace function public.enforce_purchase_orders_status_transition()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_has_receipts boolean;
  v_has_payments boolean;
  v_has_movements boolean;
begin
  if new.status is not distinct from old.status then
    return new;
  end if;

  if old.status = 'cancelled' then
    raise exception 'cannot change status from cancelled';
  end if;

  if new.status = 'draft' then
    raise exception 'cannot revert to draft';
  end if;

  if old.status = 'completed' and new.status is distinct from 'completed' then
    raise exception 'cannot change status from completed';
  end if;

  if not (
    (old.status = 'draft' and new.status in ('partial', 'completed', 'cancelled'))
    or (old.status = 'partial' and new.status = 'completed')
  ) then
    raise exception 'invalid status transition';
  end if;

  if new.status = 'cancelled' then
    select exists(select 1 from public.purchase_receipts pr where pr.purchase_order_id = new.id) into v_has_receipts;
    select exists(
      select 1
      from public.payments p
      where p.reference_table = 'purchase_orders'
        and p.reference_id::text = new.id::text
    ) into v_has_payments;
    select exists(
      select 1
      from public.inventory_movements im
      where (im.reference_table = 'purchase_orders' and im.reference_id::text = new.id::text)
         or (im.data ? 'purchaseOrderId' and im.data->>'purchaseOrderId' = new.id::text)
    ) into v_has_movements;

    if coalesce(v_has_receipts, false)
      or coalesce(v_has_payments, false)
      or coalesce(v_has_movements, false)
      or coalesce(old.paid_amount, 0) > 0
    then
      raise exception 'cannot cancel posted purchase order';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_purchase_orders_status_guard on public.purchase_orders;
create trigger trg_purchase_orders_status_guard
before update of status
on public.purchase_orders
for each row
execute function public.enforce_purchase_orders_status_transition();

create or replace function public.enforce_purchase_items_editability()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_order_id uuid;
  v_status text;
  v_has_receipts boolean;
begin
  v_order_id := coalesce(new.purchase_order_id, old.purchase_order_id);

  select po.status
  into v_status
  from public.purchase_orders po
  where po.id = v_order_id;

  if not found then
    raise exception 'purchase order not found';
  end if;

  select exists(select 1 from public.purchase_receipts pr where pr.purchase_order_id = v_order_id)
  into v_has_receipts;

  if tg_op = 'INSERT' then
    if v_status <> 'draft' or coalesce(v_has_receipts, false) then
      raise exception 'cannot add purchase items after receiving';
    end if;
    return new;
  end if;

  if tg_op = 'DELETE' then
    if v_status <> 'draft' or coalesce(v_has_receipts, false) or coalesce(old.received_quantity, 0) > 0 then
      raise exception 'cannot delete purchase items after receiving';
    end if;
    return old;
  end if;

  if (new.quantity is distinct from old.quantity)
    or (new.unit_cost is distinct from old.unit_cost)
    or (new.item_id is distinct from old.item_id)
    or (new.purchase_order_id is distinct from old.purchase_order_id)
  then
    if v_status <> 'draft' or coalesce(v_has_receipts, false) or coalesce(old.received_quantity, 0) > 0 then
      raise exception 'cannot modify purchase items after receiving';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_purchase_items_editability on public.purchase_items;
create trigger trg_purchase_items_editability
before insert or update or delete
on public.purchase_items
for each row
execute function public.enforce_purchase_items_editability();

create or replace function public.record_purchase_order_payment(
  p_purchase_order_id uuid,
  p_amount numeric,
  p_method text,
  p_occurred_at timestamptz,
  p_data jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_amount numeric;
  v_paid numeric;
  v_total numeric;
  v_status text;
  v_method text;
  v_occurred_at timestamptz;
  v_payment_id uuid;
  v_data jsonb;
  v_idempotency_key text;
begin
  if not public.is_admin() then
    raise exception 'not allowed';
  end if;

  if p_purchase_order_id is null then
    raise exception 'p_purchase_order_id is required';
  end if;

  select coalesce(po.paid_amount, 0), coalesce(po.total_amount, 0), po.status
  into v_paid, v_total, v_status
  from public.purchase_orders po
  where po.id = p_purchase_order_id
  for update;

  if not found then
    raise exception 'purchase order not found';
  end if;

  if v_status = 'cancelled' then
    raise exception 'cannot pay cancelled purchase order';
  end if;

  v_amount := coalesce(p_amount, 0);
  if v_amount <= 0 then
    raise exception 'invalid amount';
  end if;

  if v_total > 0 and (v_paid + v_amount) > (v_total + 1e-9) then
    raise exception 'paid amount exceeds total';
  end if;

  v_method := nullif(trim(coalesce(p_method, '')), '');
  if v_method is null then
    v_method := 'cash';
  end if;

  v_occurred_at := coalesce(p_occurred_at, now());
  v_data := jsonb_strip_nulls(jsonb_build_object('purchaseOrderId', p_purchase_order_id::text) || coalesce(p_data, '{}'::jsonb));
  v_idempotency_key := nullif(trim(coalesce(v_data->>'idempotencyKey', '')), '');

  if v_idempotency_key is null then
    insert into public.payments(direction, method, amount, currency, reference_table, reference_id, occurred_at, created_by, data)
    values (
      'out',
      v_method,
      v_amount,
      'YER',
      'purchase_orders',
      p_purchase_order_id::text,
      v_occurred_at,
      auth.uid(),
      v_data
    )
    returning id into v_payment_id;
  else
    insert into public.payments(direction, method, amount, currency, reference_table, reference_id, occurred_at, created_by, data, idempotency_key)
    values (
      'out',
      v_method,
      v_amount,
      'YER',
      'purchase_orders',
      p_purchase_order_id::text,
      v_occurred_at,
      auth.uid(),
      v_data,
      v_idempotency_key
    )
    on conflict (reference_table, reference_id, direction, idempotency_key)
    do nothing
    returning id into v_payment_id;

    if v_payment_id is null then
      return;
    end if;
  end if;

  perform public.post_payment(v_payment_id);

  update public.purchase_orders
  set paid_amount = paid_amount + v_amount,
      updated_at = now()
  where id = p_purchase_order_id;
end;
$$;

revoke all on function public.record_purchase_order_payment(uuid, numeric, text, timestamptz, jsonb) from public;
grant execute on function public.record_purchase_order_payment(uuid, numeric, text, timestamptz, jsonb) to anon, authenticated;

