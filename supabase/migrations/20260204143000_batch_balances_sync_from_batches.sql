do $$
begin
  if to_regclass('public.batch_balances') is null or to_regclass('public.batches') is null then
    return;
  end if;
end $$;

create or replace function public.trg_sync_batch_balances_from_batches()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_wh uuid;
  v_qty numeric;
begin
  if tg_op = 'DELETE' then
    delete from public.batch_balances bb
    where bb.item_id::text = old.item_id::text
      and bb.batch_id = old.id
      and bb.warehouse_id = old.warehouse_id;
    return old;
  end if;

  v_wh := coalesce(new.warehouse_id, public._resolve_default_admin_warehouse_id());
  if v_wh is null then
    raise exception 'warehouse_id is required';
  end if;

  if tg_op = 'UPDATE' then
    if old.warehouse_id is distinct from v_wh or old.item_id::text is distinct from new.item_id::text then
      delete from public.batch_balances bb
      where bb.item_id::text = old.item_id::text
        and bb.batch_id = old.id
        and bb.warehouse_id = old.warehouse_id;
    end if;
  end if;

  v_qty := greatest(
    coalesce(new.quantity_received, 0)
    - coalesce(new.quantity_consumed, 0)
    - coalesce(new.quantity_transferred, 0),
    0
  );

  insert into public.batch_balances(item_id, batch_id, warehouse_id, quantity, expiry_date, created_at, updated_at)
  values (new.item_id::text, new.id, v_wh, v_qty, new.expiry_date, now(), now())
  on conflict (item_id, batch_id, warehouse_id)
  do update set
    quantity = excluded.quantity,
    expiry_date = case
      when public.batch_balances.expiry_date is null then excluded.expiry_date
      else public.batch_balances.expiry_date
    end,
    updated_at = now();

  return new;
end;
$$;

drop trigger if exists trg_sync_batch_balances_from_batches on public.batches;
create trigger trg_sync_batch_balances_from_batches
after insert or update of item_id, warehouse_id, quantity_received, quantity_consumed, quantity_transferred, expiry_date, status, qc_status
on public.batches
for each row
execute function public.trg_sync_batch_balances_from_batches();

do $$
declare
  v_wh uuid;
begin
  if to_regclass('public.batch_balances') is null or to_regclass('public.batches') is null then
    return;
  end if;
  select public._resolve_default_admin_warehouse_id() into v_wh;
  update public.batches
  set warehouse_id = coalesce(warehouse_id, v_wh)
  where warehouse_id is null;

  insert into public.batch_balances(item_id, batch_id, warehouse_id, quantity, expiry_date, created_at, updated_at)
  select
    b.item_id::text,
    b.id as batch_id,
    coalesce(b.warehouse_id, v_wh) as warehouse_id,
    greatest(coalesce(b.quantity_received,0) - coalesce(b.quantity_consumed,0) - coalesce(b.quantity_transferred,0), 0) as quantity,
    b.expiry_date,
    now(),
    now()
  from public.batches b
  where coalesce(b.warehouse_id, v_wh) is not null
  on conflict (item_id, batch_id, warehouse_id)
  do update set
    quantity = excluded.quantity,
    expiry_date = case
      when public.batch_balances.expiry_date is null then excluded.expiry_date
      else public.batch_balances.expiry_date
    end,
    updated_at = now();
end $$;

select pg_sleep(0.5);
notify pgrst, 'reload schema';
