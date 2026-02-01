create or replace function public.confirm_order_delivery_with_credit(
  p_order_id uuid,
  p_items jsonb,
  p_updated_data jsonb,
  p_warehouse_id uuid
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.role() <> 'service_role' then
    if not public.is_staff() then
      raise exception 'not allowed';
    end if;
  end if;

  perform public.confirm_order_delivery(p_order_id, p_items, p_updated_data, p_warehouse_id);
end;
$$;

revoke all on function public.confirm_order_delivery_with_credit(uuid, jsonb, jsonb, uuid) from public;
revoke execute on function public.confirm_order_delivery_with_credit(uuid, jsonb, jsonb, uuid) from anon;
grant execute on function public.confirm_order_delivery_with_credit(uuid, jsonb, jsonb, uuid) to authenticated;

create or replace function public.sync_ar_on_invoice(p_order_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order record;
  v_is_cod boolean := false;
  v_entry_id uuid;
  v_ar_id uuid;
  v_ar_amount numeric := 0;
begin
  if p_order_id is null then
    raise exception 'p_order_id is required';
  end if;
  select *
  into v_order
  from public.orders o
  where o.id = p_order_id;
  if not found then
    raise exception 'order not found';
  end if;
  v_is_cod := public._is_cod_delivery_order(coalesce(v_order.data,'{}'::jsonb), v_order.delivery_zone_id);
  if v_is_cod then
    return;
  end if;

  select je.id
  into v_entry_id
  from public.journal_entries je
  where je.source_table = 'orders'
    and je.source_id = p_order_id::text
    and je.source_event in ('invoiced','delivered')
  order by
    case when je.source_event = 'invoiced' then 0 else 1 end asc,
    je.entry_date desc
  limit 1;
  if not found then
    return;
  end if;

  select public.get_account_id_by_code('1200') into v_ar_id;
  if v_ar_id is null then
    raise exception 'AR account not found';
  end if;
  select coalesce(sum(jl.debit), 0) - coalesce(sum(jl.credit), 0)
  into v_ar_amount
  from public.journal_lines jl
  where jl.journal_entry_id = v_entry_id
    and jl.account_id = v_ar_id;
  if v_ar_amount is null or v_ar_amount <= 0 then
    return;
  end if;

  if exists (
    select 1 from public.ar_open_items a
    where a.invoice_id = p_order_id
      and a.status = 'open'
  ) then
    update public.ar_open_items
    set original_amount = v_ar_amount,
        open_balance = greatest(open_balance, v_ar_amount)
    where invoice_id = p_order_id
      and status = 'open';
  else
    insert into public.ar_open_items(invoice_id, order_id, journal_entry_id, original_amount, open_balance, status)
    values (p_order_id, p_order_id, v_entry_id, v_ar_amount, v_ar_amount, 'open');
  end if;
end;
$$;

revoke all on function public.sync_ar_on_invoice(uuid) from public;
revoke execute on function public.sync_ar_on_invoice(uuid) from anon;
grant execute on function public.sync_ar_on_invoice(uuid) to authenticated;

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
  end if;
  return new;
end;
$$;

drop trigger if exists trg_journal_entries_sync_ar_open_item on public.journal_entries;
create trigger trg_journal_entries_sync_ar_open_item
after insert on public.journal_entries
for each row execute function public.trg_journal_entries_sync_ar_open_item();

select pg_sleep(0.5);
notify pgrst, 'reload schema';
