create or replace function public.reconcile_purchase_order_receipt_status(p_order_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text;
  v_has_receipts boolean;
  v_all_received boolean;
begin
  if p_order_id is null then
    raise exception 'p_order_id is required';
  end if;

  if not public.can_manage_stock() then
    raise exception 'not allowed';
  end if;

  select po.status
  into v_status
  from public.purchase_orders po
  where po.id = p_order_id
  for update;

  if not found then
    raise exception 'purchase order not found';
  end if;

  if v_status = 'cancelled' then
    return 'cancelled';
  end if;

  select exists(select 1 from public.purchase_receipts pr where pr.purchase_order_id = p_order_id)
  into v_has_receipts;

  if not coalesce(v_has_receipts, false) then
    return coalesce(v_status, 'draft');
  end if;

  select not exists (
    select 1
    from public.purchase_items pi
    where pi.purchase_order_id = p_order_id
      and (coalesce(pi.received_quantity, 0) + 0.000000001) < coalesce(pi.quantity, 0)
  )
  into v_all_received;

  if coalesce(v_all_received, false) then
    if v_status is distinct from 'completed' then
      update public.purchase_orders
      set status = 'completed',
          updated_at = now()
      where id = p_order_id;
    end if;
    return 'completed';
  end if;

  if v_status = 'draft' then
    update public.purchase_orders
    set status = 'partial',
        updated_at = now()
    where id = p_order_id;
    return 'partial';
  end if;

  return coalesce(v_status, 'partial');
end;
$$;

revoke all on function public.reconcile_purchase_order_receipt_status(uuid) from public;
grant execute on function public.reconcile_purchase_order_receipt_status(uuid) to authenticated;

create or replace function public.trg_reconcile_purchase_order_receipt_status()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  begin
    perform public.reconcile_purchase_order_receipt_status(new.purchase_order_id);
  exception when others then
    null;
  end;
  return new;
end;
$$;

drop trigger if exists trg_purchase_items_reconcile_receipt_status on public.purchase_items;
create trigger trg_purchase_items_reconcile_receipt_status
after update of received_quantity
on public.purchase_items
for each row
execute function public.trg_reconcile_purchase_order_receipt_status();

do $$
declare
  v_id uuid;
begin
  for v_id in
    select po.id
    from public.purchase_orders po
    where po.status = 'partial'
      and po.status is distinct from 'cancelled'
      and exists(select 1 from public.purchase_receipts pr where pr.purchase_order_id = po.id)
      and not exists (
        select 1
        from public.purchase_items pi
        where pi.purchase_order_id = po.id
          and (coalesce(pi.received_quantity, 0) + 0.000000001) < coalesce(pi.quantity, 0)
      )
  loop
    begin
      perform public.reconcile_purchase_order_receipt_status(v_id);
    exception when others then
      null;
    end;
  end loop;
end;
$$;

select pg_sleep(0.5);
notify pgrst, 'reload schema';
