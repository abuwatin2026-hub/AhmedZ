-- P0: Batch Enforcement & Sale-Out Guards
do $$
begin
  -- Add soft-delete fields to batches
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'batches' and column_name = 'status'
  ) then
    alter table public.batches add column status text not null default 'active';
  end if;
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'batches' and column_name = 'locked_at'
  ) then
    alter table public.batches add column locked_at timestamptz;
  end if;

  -- Ensure FK inventory_movements.batch_id → batches.id
  if not exists (
    select 1 from pg_constraint
    where conname = 'fk_inventory_movements_batch'
  ) then
    alter table public.inventory_movements
      add constraint fk_inventory_movements_batch
      foreign key (batch_id) references public.batches(id) on delete restrict;
  end if;
end $$;

-- Forbid physical DELETE on batches
create or replace function public.trg_forbid_delete_batch()
returns trigger
language plpgsql
as $$
begin
  raise exception 'BATCH_DELETE_FORBIDDEN';
end;
$$;
drop trigger if exists trg_forbid_delete_batch on public.batches;
create trigger trg_forbid_delete_batch
before delete on public.batches
for each row execute function public.trg_forbid_delete_batch();

-- Forbid deactivation if has remaining, reservations, or movements
create or replace function public.trg_forbid_disable_batch()
returns trigger
language plpgsql
as $$
declare
  v_remaining numeric;
  v_has_reservation boolean;
  v_has_movement boolean;
begin
  if tg_op <> 'UPDATE' then
    return new;
  end if;
  if old.id is distinct from new.id then
    return new;
  end if;
  if coalesce(new.status, 'active') = 'inactive' and coalesce(old.status, 'active') <> 'inactive' then
    select greatest(coalesce(b.quantity_received,0) - coalesce(b.quantity_consumed,0) - coalesce(b.quantity_transferred,0), 0)
    into v_remaining
    from public.batches b
    where b.id = new.id;

    select exists(select 1 from public.inventory_movements im where im.batch_id = new.id)
    into v_has_movement;

    -- If reservations table has batch_id column, check directly; otherwise fallback to stock_management JSON
    begin
      select exists(select 1 from public.order_item_reservations r where r.batch_id = new.id)
      into v_has_reservation;
    exception when undefined_column then
      select exists(
        select 1
        from public.stock_management sm
        where jsonb_typeof(sm.data->'reservedBatches') = 'object'
          and (sm.data->'reservedBatches') ? new.id::text
      )
      into v_has_reservation;
    end;

    if coalesce(v_remaining,0) > 0 or v_has_reservation or v_has_movement then
      raise exception 'BATCH_LOCKED_HAS_STOCK_OR_RESERVATIONS_OR_MOVEMENTS';
    end if;
    new.locked_at := now();
  end if;
  return new;
end;
$$;
drop trigger if exists trg_forbid_disable_batch on public.batches;
create trigger trg_forbid_disable_batch
before update on public.batches
for each row execute function public.trg_forbid_disable_batch();

-- Sale-out requires batch for food, and must not use expired batch
create or replace function public.trg_sale_out_require_batch()
returns trigger
language plpgsql
as $$
declare
  v_category text;
  v_expiry date;
begin
  if tg_op not in ('INSERT','UPDATE') then
    return new;
  end if;
  if new.movement_type <> 'sale_out' then
    return new;
  end if;
  select mi.category into v_category from public.menu_items mi where mi.id::text = new.item_id;
  if coalesce(v_category,'') = 'food' then
    if new.batch_id is null then
      raise exception 'FOOD_SALE_REQUIRES_BATCH';
    end if;
    select b.expiry_date into v_expiry from public.batches b where b.id = new.batch_id;
    if v_expiry is not null and v_expiry < new.occurred_at::date then
      raise exception 'BATCH_EXPIRED';
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists trg_sale_out_require_batch on public.inventory_movements;
create trigger trg_sale_out_require_batch
before insert or update on public.inventory_movements
for each row execute function public.trg_sale_out_require_batch();

-- Reservations must include batch_id (schema change)
do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'order_item_reservations' and column_name = 'batch_id'
  ) then
    alter table public.order_item_reservations add column batch_id uuid;
  end if;
  if not exists (
    select 1 from pg_constraint where conname = 'fk_order_item_reservations_batch'
  ) then
    alter table public.order_item_reservations
      add constraint fk_order_item_reservations_batch
      foreign key (batch_id) references public.batches(id) on delete restrict;
  end if;
end $$;

-- Enforce non-aggregated reservations per batch
create or replace function public.trg_consume_order_item_reservation_on_sale_out()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order_id uuid;
  v_source text;
begin
  if new.reference_table <> 'orders' or new.movement_type <> 'sale_out' then
    return new;
  end if;
  if new.warehouse_id is null then
    return new;
  end if;
  if new.batch_id is null then
    raise exception 'SALE_OUT_CONSUME_REQUIRES_BATCH';
  end if;

  begin
    v_order_id := nullif(new.reference_id, '')::uuid;
  exception when others then
    return new;
  end;

  select coalesce(nullif(o.data->>'orderSource',''), '') into v_source
  from public.orders o
  where o.id = v_order_id;

  if coalesce(v_source, '') = 'in_store' then
    return new;
  end if;

  update public.order_item_reservations
  set quantity = quantity - coalesce(new.quantity, 0),
      updated_at = now()
  where order_id = v_order_id
    and item_id = new.item_id::text
    and warehouse_id = new.warehouse_id
    and batch_id = new.batch_id;

  delete from public.order_item_reservations r
  where r.order_id = v_order_id
    and r.item_id = new.item_id::text
    and r.warehouse_id = new.warehouse_id
    and r.batch_id = new.batch_id
    and r.quantity <= 0;

  return new;
end;
$$;
drop trigger if exists trg_inventory_movements_consume_order_item_reservation on public.inventory_movements;
create trigger trg_inventory_movements_consume_order_item_reservation
after insert on public.inventory_movements
for each row execute function public.trg_consume_order_item_reservation_on_sale_out();

-- Replace aggregated unique index with per-batch uniqueness
do $$
begin
  if exists (select 1 from pg_indexes where indexname = 'uq_order_item_reservations_order_item_wh') then
    drop index uq_order_item_reservations_order_item_wh;
  end if;
end $$;
create unique index if not exists uq_order_item_reservations_order_item_wh_batch
on public.order_item_reservations(order_id, item_id, warehouse_id, batch_id);

-- Replace reservation function to persist per-batch rows (FEFO)
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
  v_item jsonb;
  v_item_id_text text;
  v_requested numeric;
  v_remaining_needed numeric;
  v_batch record;
begin
  if p_order_id is null or p_warehouse_id is null then
    raise exception 'order_id and warehouse_id are required';
  end if;

  for v_item in
    select value from jsonb_array_elements(coalesce(p_items, '[]'::jsonb))
  loop
    v_item_id_text := coalesce(nullif(v_item->>'itemId',''), nullif(v_item->>'id',''));
    v_requested := coalesce(nullif(v_item->>'qty','')::numeric, 0);
    if v_item_id_text is null or v_requested <= 0 then
      continue;
    end if;

    v_remaining_needed := v_requested;

    for v_batch in
      select
        b.id as batch_id,
        b.expiry_date,
        greatest(coalesce(b.quantity_received,0) - coalesce(b.quantity_consumed,0) - coalesce(b.quantity_transferred,0), 0) as remaining
      from public.batches b
      join public.menu_items mi on mi.id::text = v_item_id_text
      where b.item_id::text = v_item_id_text
        and b.expiry_date is not null
        and b.expiry_date >= current_date
      order by b.expiry_date asc, b.created_at asc
    loop
      exit when v_remaining_needed <= 0;
      if coalesce(v_batch.remaining, 0) <= 0 then
        continue;
      end if;
      -- allocate from FEFO batch
      update public.order_item_reservations r
      set quantity = r.quantity + least(v_batch.remaining, v_remaining_needed),
          updated_at = now()
      where r.order_id = p_order_id
        and r.item_id = v_item_id_text
        and r.warehouse_id = p_warehouse_id
        and r.batch_id = v_batch.batch_id;
      if not found then
        insert into public.order_item_reservations(order_id, item_id, warehouse_id, batch_id, quantity, created_at, updated_at)
        values (p_order_id, v_item_id_text, p_warehouse_id, v_batch.batch_id, least(v_batch.remaining, v_remaining_needed), now(), now());
      end if;
      v_remaining_needed := v_remaining_needed - least(v_batch.remaining, v_remaining_needed);
    end loop;

    if v_remaining_needed > 0 then
      raise exception 'INSUFFICIENT_FEFO_BATCH_STOCK_FOR_ITEM_%', v_item_id_text;
    end if;
  end loop;
end;
$$;

select pg_sleep(0.5);
notify pgrst, 'reload schema';
