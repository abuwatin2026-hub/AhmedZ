create or replace function public.trg_inventory_movements_purchase_in_immutable()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if old.movement_type = 'purchase_in' or new.movement_type = 'purchase_in' then
    if old.movement_type is distinct from new.movement_type then
      raise exception 'purchase_in is immutable';
    end if;
    if old.quantity is distinct from new.quantity then
      raise exception 'purchase_in is immutable';
    end if;
    if old.batch_id is distinct from new.batch_id then
      raise exception 'purchase_in is immutable';
    end if;
    if old.warehouse_id is distinct from new.warehouse_id then
      raise exception 'purchase_in is immutable';
    end if;
    if (old.data->>'expiryDate') is distinct from (new.data->>'expiryDate') then
      raise exception 'purchase_in is immutable';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_inventory_movements_purchase_in_immutable on public.inventory_movements;
create trigger trg_inventory_movements_purchase_in_immutable
before update
on public.inventory_movements
for each row
when (old.movement_type = 'purchase_in' or new.movement_type = 'purchase_in')
execute function public.trg_inventory_movements_purchase_in_immutable();

create or replace function public.trg_inventory_movements_purchase_in_defaults()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_wh uuid;
begin
  if new.movement_type = 'purchase_in' then
    if auth.uid() is null then
      raise exception 'not authenticated';
    end if;
    if not public.has_admin_permission('stock.manage') then
      raise exception 'not allowed';
    end if;
    if new.batch_id is null then
      raise exception 'purchase_in requires batch_id';
    end if;
    if new.warehouse_id is null then
      v_wh := public._resolve_default_warehouse_id();
      if v_wh is null then
        raise exception 'warehouse_id is required';
      end if;
      new.warehouse_id := v_wh;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_inventory_movements_purchase_in_defaults on public.inventory_movements;
create trigger trg_inventory_movements_purchase_in_defaults
before insert
on public.inventory_movements
for each row
when (new.movement_type = 'purchase_in')
execute function public.trg_inventory_movements_purchase_in_defaults();

create or replace function public.trg_inventory_movements_purchase_in_sync_batch_balances()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_wh uuid;
  v_expiry date;
  v_existing_expiry date;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;
  if not public.has_admin_permission('stock.manage') then
    raise exception 'not allowed';
  end if;

  if tg_op = 'UPDATE' then
    if old.movement_type = 'purchase_in' or new.movement_type = 'purchase_in' then
      raise exception 'purchase_in is append-only';
    end if;
    return new;
  end if;

  if tg_op = 'DELETE' then
    if old.movement_type = 'purchase_in' then
      v_wh := coalesce(old.warehouse_id, public._resolve_default_warehouse_id());
      if v_wh is null then
        raise exception 'warehouse_id is required';
      end if;
      update public.batch_balances
      set quantity = quantity - old.quantity,
          updated_at = now()
      where item_id = old.item_id::text
        and batch_id = old.batch_id
        and warehouse_id = v_wh;
    end if;
    return old;
  end if;

  if new.movement_type = 'purchase_in' then
    if new.batch_id is null then
      raise exception 'purchase_in requires batch_id';
    end if;
    v_wh := coalesce(new.warehouse_id, public._resolve_default_warehouse_id());
    if v_wh is null then
      raise exception 'warehouse_id is required';
    end if;
    v_expiry := case
      when (new.data->>'expiryDate') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then (new.data->>'expiryDate')::date
      else null
    end;

    select bb.expiry_date
    into v_existing_expiry
    from public.batch_balances bb
    where bb.item_id = new.item_id::text
      and bb.batch_id = new.batch_id
      and bb.warehouse_id = v_wh
    for update;

    if found then
      if v_existing_expiry is distinct from v_expiry then
        if exists (
          select 1
          from public.batch_reservations br
          where br.item_id = new.item_id::text
            and br.batch_id = new.batch_id
            and br.warehouse_id = v_wh
            and br.quantity > 0
        ) then
          raise exception 'expiry_date is immutable once reserved';
        end if;
        if exists (
          select 1
          from public.inventory_movements im
          where im.movement_type = 'sale_out'
            and im.item_id::text = new.item_id::text
            and im.batch_id = new.batch_id
            and im.warehouse_id = v_wh
        ) then
          raise exception 'expiry_date is immutable once sold';
        end if;
      end if;

      update public.batch_balances
      set quantity = quantity + new.quantity,
          expiry_date = case
            when expiry_date is null then v_expiry
            else expiry_date
          end,
          updated_at = now()
      where item_id = new.item_id::text
        and batch_id = new.batch_id
        and warehouse_id = v_wh;
    else
      insert into public.batch_balances(item_id, batch_id, warehouse_id, quantity, expiry_date)
      values (new.item_id::text, new.batch_id, v_wh, new.quantity, v_expiry);
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_inventory_movements_purchase_in_sync_batch_balances on public.inventory_movements;
create trigger trg_inventory_movements_purchase_in_sync_batch_balances
after insert or update or delete
on public.inventory_movements
for each row
when (
  (tg_op = 'INSERT' and new.movement_type = 'purchase_in')
  or (tg_op = 'UPDATE' and (old.movement_type = 'purchase_in' or new.movement_type = 'purchase_in'))
  or (tg_op = 'DELETE' and old.movement_type = 'purchase_in')
)
execute function public.trg_inventory_movements_purchase_in_sync_batch_balances();

create or replace function public.trg_batch_balances_expiry_immutable()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;
  if not public.has_admin_permission('stock.manage') then
    raise exception 'not allowed';
  end if;

  if old.expiry_date is distinct from new.expiry_date then
    if exists (
      select 1
      from public.batch_reservations br
      where br.item_id = old.item_id
        and br.batch_id = old.batch_id
        and br.warehouse_id = old.warehouse_id
        and br.quantity > 0
    ) then
      raise exception 'expiry_date is immutable once reserved';
    end if;

    if exists (
      select 1
      from public.inventory_movements im
      where im.movement_type = 'sale_out'
        and im.item_id::text = old.item_id::text
        and im.batch_id = old.batch_id
        and im.warehouse_id = old.warehouse_id
    ) then
      raise exception 'expiry_date is immutable once sold';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_batch_balances_expiry_immutable on public.batch_balances;
create trigger trg_batch_balances_expiry_immutable
before update of expiry_date
on public.batch_balances
for each row
execute function public.trg_batch_balances_expiry_immutable();

