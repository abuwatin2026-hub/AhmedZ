create or replace function public.auto_allocate_payments_for_order(p_order_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_open record;
  v_delivered_at timestamptz;
  v_pay record;
  v_amt numeric;
begin
  if not (auth.role() = 'service_role' or public.has_admin_permission('accounting.manage')) then
    raise exception 'not authorized';
  end if;
  if p_order_id is null then
    raise exception 'order_id required';
  end if;
  select public.order_delivered_at(p_order_id) into v_delivered_at;
  if v_delivered_at is null then
    return;
  end if;
  select *
  into v_open
  from public.ar_open_items
  where order_id = p_order_id
    and status = 'open'
  order by created_at desc
  limit 1;
  if not found then
    return;
  end if;
  for v_pay in
    select id, coalesce(base_amount, amount, 0) as base_amount
    from public.payments
    where reference_table = 'orders'
      and reference_id = p_order_id::text
      and direction = 'in'
      and coalesce(base_amount, amount, 0) > 0
      and occurred_at >= v_delivered_at
    order by occurred_at asc
  loop
    begin
      perform public.flag_payment_allocation_status(v_pay.id);
    exception when others then
      null;
    end;
    select least(greatest(coalesce(v_open.open_balance, 0), 0), v_pay.base_amount)
    into v_amt;
    if coalesce(v_amt, 0) > 0 then
      perform public.allocate_payment_to_open_item(v_open.id, v_pay.id, v_amt);
      select * into v_open from public.ar_open_items where id = v_open.id;
      if coalesce(v_open.open_balance, 0) <= 0 then
        exit;
      end if;
    end if;
  end loop;
end;
$$;

create or replace function public.trg_journal_entries_sync_ar_open_item()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.source_table = 'orders' and new.source_event in ('invoiced','delivered') then
    begin
      perform public.sync_ar_on_invoice((new.source_id)::uuid);
    exception when others then
      null;
    end;
    if new.source_event = 'delivered' then
      begin
        perform public.auto_allocate_payments_for_order((new.source_id)::uuid);
      exception when others then
        null;
      end;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_journal_entries_sync_ar_open_item on public.journal_entries;
create trigger trg_journal_entries_sync_ar_open_item
after insert on public.journal_entries
for each row execute function public.trg_journal_entries_sync_ar_open_item();
