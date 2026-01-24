do $$
begin
  if not exists (
    select 1
    from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
    where n.nspname = 'public'
      and t.relname = 'inventory_movements'
      and c.conname = 'purchase_in_requires_batch'
  ) then
    alter table public.inventory_movements
      add constraint purchase_in_requires_batch
      check (movement_type != 'purchase_in' or batch_id is not null)
      not valid;
  end if;
end;
$$;

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

revoke all on function public.trg_inventory_movements_purchase_in_defaults() from public;
grant execute on function public.trg_inventory_movements_purchase_in_defaults() to authenticated;

create or replace function public.trg_inventory_movements_purchase_in_sync_batch_balances()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_wh uuid;
  v_expiry date;
begin
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

  if tg_op = 'UPDATE' then
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
    insert into public.batch_balances(item_id, batch_id, warehouse_id, quantity, expiry_date)
    values (new.item_id::text, new.batch_id, v_wh, new.quantity, v_expiry)
    on conflict (item_id, batch_id, warehouse_id)
    do update set
      quantity = public.batch_balances.quantity + excluded.quantity,
      expiry_date = coalesce(excluded.expiry_date, public.batch_balances.expiry_date),
      updated_at = now();
  end if;

  return new;
end;
$$;

revoke all on function public.trg_inventory_movements_purchase_in_sync_batch_balances() from public;
grant execute on function public.trg_inventory_movements_purchase_in_sync_batch_balances() to authenticated;

drop trigger if exists trg_inventory_movements_purchase_in_defaults on public.inventory_movements;
create trigger trg_inventory_movements_purchase_in_defaults
before insert or update of movement_type, batch_id, item_id, warehouse_id, quantity
on public.inventory_movements
for each row
execute function public.trg_inventory_movements_purchase_in_defaults();

drop trigger if exists trg_inventory_movements_purchase_in_sync_batch_balances on public.inventory_movements;
drop trigger if exists trg_inventory_movements_purchase_in_sync_batch_balances_ins on public.inventory_movements;
create trigger trg_inventory_movements_purchase_in_sync_batch_balances_ins
after insert
on public.inventory_movements
for each row
when (new.movement_type = 'purchase_in')
execute function public.trg_inventory_movements_purchase_in_sync_batch_balances();

create trigger trg_inventory_movements_purchase_in_sync_batch_balances
after update of movement_type, batch_id, item_id, warehouse_id, quantity, data
on public.inventory_movements
for each row
when (new.movement_type = 'purchase_in' or old.movement_type = 'purchase_in')
execute function public.trg_inventory_movements_purchase_in_sync_batch_balances();

drop trigger if exists trg_inventory_movements_purchase_in_sync_batch_balances_del on public.inventory_movements;
create trigger trg_inventory_movements_purchase_in_sync_batch_balances_del
after delete
on public.inventory_movements
for each row
when (old.movement_type = 'purchase_in')
execute function public.trg_inventory_movements_purchase_in_sync_batch_balances();

create or replace function public.reserve_stock_for_order(
  p_items jsonb,
  p_order_id uuid default null,
  p_warehouse_id uuid default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid;
  v_order record;
  v_item jsonb;
  v_item_id text;
  v_qty numeric;
  v_wh uuid;
  v_wh_text text;
  v_needed numeric;
  v_batch record;
  v_reserved_other numeric;
  v_available numeric;
  v_alloc numeric;
  v_expired_left numeric;
begin
  v_actor := auth.uid();
  if v_actor is null then
    raise exception 'not authenticated';
  end if;
  if p_order_id is null then
    raise exception 'p_order_id is required';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    raise exception 'p_items must be a json array';
  end if;

  select * into v_order
  from public.orders o
  where o.id = p_order_id
  for update;

  if not found then
    raise exception 'order not found';
  end if;

  if not public.is_staff() and v_order.customer_auth_user_id <> v_actor then
    raise exception 'not allowed';
  end if;

  v_wh := p_warehouse_id;
  if v_wh is null then
    v_wh_text := nullif(trim(coalesce(v_order.data->>'warehouseId','')), '');
    if v_wh_text is not null then
      begin
        v_wh := v_wh_text::uuid;
      exception when others then
        v_wh := null;
      end;
    end if;
  end if;
  v_wh := coalesce(v_wh, public._resolve_default_warehouse_id());
  if v_wh is null then
    raise exception 'warehouse_id is required';
  end if;

  for v_item in select value from jsonb_array_elements(p_items)
  loop
    v_item_id := nullif(trim(coalesce(v_item->>'itemId', v_item->>'id')), '');
    v_qty := coalesce(nullif(v_item->>'quantity','')::numeric, 0);
    if v_item_id is null or v_qty <= 0 then
      raise exception 'invalid item reservation';
    end if;

    delete from public.batch_reservations
    where order_id = p_order_id
      and item_id = v_item_id
      and warehouse_id = v_wh;

    v_needed := v_qty;

    for v_batch in
      select
        bb.batch_id,
        bb.quantity,
        bb.expiry_date
      from public.batch_balances bb
      where bb.item_id = v_item_id
        and bb.warehouse_id = v_wh
        and bb.quantity > 0
        and (bb.expiry_date is null or bb.expiry_date >= current_date)
      order by bb.expiry_date asc nulls last, bb.batch_id asc
      for update
    loop
      select coalesce(sum(br.quantity), 0)
      into v_reserved_other
      from public.batch_reservations br
      where br.item_id = v_item_id
        and br.warehouse_id = v_wh
        and br.batch_id = v_batch.batch_id;

      v_available := greatest(coalesce(v_batch.quantity, 0) - coalesce(v_reserved_other, 0), 0);
      if v_available <= 0 then
        continue;
      end if;

      v_alloc := least(v_needed, v_available);
      if v_alloc <= 0 then
        continue;
      end if;

      insert into public.batch_reservations(order_id, item_id, batch_id, warehouse_id, quantity)
      values (p_order_id, v_item_id, v_batch.batch_id, v_wh, v_alloc)
      on conflict (order_id, item_id, batch_id, warehouse_id)
      do update set quantity = public.batch_reservations.quantity + excluded.quantity;

      v_needed := v_needed - v_alloc;
      exit when v_needed <= 0;
    end loop;

    if v_needed > 0 then
      select coalesce(sum(bb.quantity),0)
      into v_expired_left
      from public.batch_balances bb
      where bb.item_id = v_item_id
        and bb.warehouse_id = v_wh
        and bb.quantity > 0
        and bb.expiry_date is not null
        and bb.expiry_date < current_date;

      if v_expired_left > 0 then
        raise exception 'cannot reserve expired stock for item %', v_item_id;
      end if;
      raise exception 'insufficient stock to reserve for item %', v_item_id;
    end if;

    update public.stock_management sm
    set reserved_quantity = coalesce((
          select sum(br.quantity)
          from public.batch_reservations br
          where br.item_id = v_item_id
            and br.warehouse_id = v_wh
        ), 0),
        available_quantity = coalesce((
          select sum(bb.quantity)
          from public.batch_balances bb
          where bb.item_id = v_item_id
            and bb.warehouse_id = v_wh
        ), 0),
        updated_at = now(),
        last_updated = now()
    where sm.item_id::text = v_item_id
      and sm.warehouse_id = v_wh;
  end loop;
end;
$$;

revoke all on function public.reserve_stock_for_order(jsonb, uuid, uuid) from public;
grant execute on function public.reserve_stock_for_order(jsonb, uuid, uuid) to authenticated;
