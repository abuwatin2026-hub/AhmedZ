-- PHASE A/B/C: Safety + Batch core refactor for food retail correctness

-- ==========================================
-- Helpers
-- ==========================================

create or replace function public._resolve_default_warehouse_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select w.id
  from public.warehouses w
  where w.is_active = true
  order by (upper(coalesce(w.code, '')) = 'MAIN') desc, w.code asc
  limit 1;
$$;

revoke all on function public._resolve_default_warehouse_id() from public;
grant execute on function public._resolve_default_warehouse_id() to authenticated;

create or replace function public._require_staff(p_action text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;
  if not public.is_staff() then
    raise exception 'not allowed: %', coalesce(p_action, 'operation');
  end if;
end;
$$;

revoke all on function public._require_staff(text) from public;
grant execute on function public._require_staff(text) to authenticated;

create or replace function public._require_stock_manager(p_action text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;
  if not public.has_admin_permission('stock.manage') then
    raise exception 'not allowed: %', coalesce(p_action, 'stock');
  end if;
end;
$$;

revoke all on function public._require_stock_manager(text) from public;
grant execute on function public._require_stock_manager(text) to authenticated;

-- ==========================================
-- Batch balances and reservations (per warehouse)
-- ==========================================

create table if not exists public.batch_balances (
  item_id text not null,
  batch_id uuid not null,
  warehouse_id uuid not null references public.warehouses(id) on delete cascade,
  quantity numeric not null default 0 check (quantity >= 0),
  expiry_date date null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (item_id, batch_id, warehouse_id)
);

create index if not exists idx_batch_balances_item_wh on public.batch_balances(item_id, warehouse_id);
create index if not exists idx_batch_balances_expiry on public.batch_balances(warehouse_id, expiry_date);

alter table public.batch_balances enable row level security;
drop policy if exists batch_balances_admin_only on public.batch_balances;
create policy batch_balances_admin_only
on public.batch_balances
for all
using (public.is_admin())
with check (public.is_admin());

create table if not exists public.batch_reservations (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  item_id text not null,
  batch_id uuid not null,
  warehouse_id uuid not null references public.warehouses(id) on delete cascade,
  quantity numeric not null check (quantity > 0),
  created_at timestamptz not null default now()
);

create unique index if not exists uq_batch_reservation_order_item_batch_wh
on public.batch_reservations(order_id, item_id, batch_id, warehouse_id);

create index if not exists idx_batch_reservations_item_wh on public.batch_reservations(item_id, warehouse_id);
create index if not exists idx_batch_reservations_order on public.batch_reservations(order_id);

alter table public.batch_reservations enable row level security;
drop policy if exists batch_reservations_admin_only on public.batch_reservations;
create policy batch_reservations_admin_only
on public.batch_reservations
for all
using (public.is_admin())
with check (public.is_admin());

-- Prevent duplicate sale_out rows for the same (order,item,batch,warehouse)
create unique index if not exists uq_inv_sale_out_order_item_batch_wh
on public.inventory_movements(reference_table, reference_id, movement_type, item_id, batch_id, warehouse_id)
where reference_table = 'orders' and movement_type = 'sale_out';

-- ==========================================
-- Backfill batch_balances (best-effort)
-- - Legacy movements without warehouse_id are treated as MAIN warehouse.
-- - Balances are derived from movements per (item,batch,warehouse).
-- ==========================================

do $$
declare
  v_main uuid;
begin
  select public._resolve_default_warehouse_id() into v_main;
  if v_main is null then
    return;
  end if;

  insert into public.batch_balances(item_id, batch_id, warehouse_id, quantity, expiry_date, created_at, updated_at)
  with mv as (
    select
      im.item_id::text as item_id,
      im.batch_id,
      coalesce(im.warehouse_id, v_main) as warehouse_id,
      im.movement_type,
      im.quantity,
      case
        when (im.data->>'expiryDate') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then (im.data->>'expiryDate')::date
        else null
      end as expiry_date
    from public.inventory_movements im
    where im.batch_id is not null
  ),
  agg as (
    select
      item_id,
      batch_id,
      warehouse_id,
      greatest(
        coalesce(sum(case when movement_type in ('purchase_in','adjust_in','return_in') then quantity else 0 end),0)
        - coalesce(sum(case when movement_type in ('sale_out','wastage_out','adjust_out','return_out') then quantity else 0 end),0),
        0
      ) as qty,
      max(expiry_date) as expiry_date
    from mv
    group by item_id, batch_id, warehouse_id
  )
  select a.item_id, a.batch_id, a.warehouse_id, a.qty, a.expiry_date, now(), now()
  from agg a
  where a.qty > 0
  on conflict (item_id, batch_id, warehouse_id)
  do update set
    quantity = excluded.quantity,
    expiry_date = coalesce(excluded.expiry_date, public.batch_balances.expiry_date),
    updated_at = now();

  update public.stock_management sm
  set available_quantity = coalesce((
      select sum(bb.quantity)
      from public.batch_balances bb
      where bb.item_id = sm.item_id::text
        and bb.warehouse_id = sm.warehouse_id
    ), 0),
    updated_at = now(),
    last_updated = now()
  where sm.warehouse_id is not null;
end;
$$;

-- ==========================================
-- Batch-aware reservations (FEFO, expiry-safe)
-- ==========================================

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

create or replace function public.release_reserved_stock_for_order(
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
  v_to_release numeric;
  v_row record;
  v_take numeric;
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
      continue;
    end if;

    v_to_release := v_qty;
    for v_row in
      select id, batch_id, quantity
      from public.batch_reservations
      where order_id = p_order_id
        and item_id = v_item_id
        and warehouse_id = v_wh
      order by created_at desc, id desc
    loop
      exit when v_to_release <= 0;
      v_take := least(v_to_release, v_row.quantity);
      if v_take >= v_row.quantity then
        delete from public.batch_reservations where id = v_row.id;
      else
        update public.batch_reservations
        set quantity = quantity - v_take
        where id = v_row.id;
      end if;
      v_to_release := v_to_release - v_take;
    end loop;

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

revoke all on function public.release_reserved_stock_for_order(jsonb, uuid, uuid) from public;
grant execute on function public.release_reserved_stock_for_order(jsonb, uuid, uuid) to authenticated;

-- ==========================================
-- Batch-aware deduction (FEFO), expiry-safe, warehouse-safe
-- ==========================================

create or replace function public.deduct_stock_on_delivery_v2(
  p_order_id uuid,
  p_items jsonb,
  p_warehouse_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order record;
  v_is_in_store boolean;
  v_item jsonb;
  v_item_id text;
  v_requested numeric;
  v_remaining numeric;
  v_batch record;
  v_reserved_total numeric;
  v_reserved_other numeric;
  v_available numeric;
  v_alloc numeric;
  v_unit_cost numeric;
  v_total_cost numeric;
  v_movement_id uuid;
  v_sm record;
begin
  perform public._require_staff('deduct_stock_on_delivery_v2');

  if p_order_id is null then
    raise exception 'p_order_id is required';
  end if;
  if p_warehouse_id is null then
    raise exception 'warehouse_id is required';
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

  if exists (
    select 1
    from public.inventory_movements im
    where im.reference_table = 'orders'
      and im.reference_id = p_order_id::text
      and im.movement_type = 'sale_out'
      and im.warehouse_id = p_warehouse_id
  ) then
    return;
  end if;

  v_is_in_store := coalesce(nullif(v_order.data->>'orderSource',''), '') = 'in_store';

  delete from public.order_item_cogs where order_id = p_order_id;

  for v_item in select value from jsonb_array_elements(p_items)
  loop
    v_item_id := nullif(trim(coalesce(v_item->>'itemId', v_item->>'id')), '');
    v_requested := coalesce(nullif(v_item->>'quantity','')::numeric, 0);
    if v_item_id is null or v_requested <= 0 then
      continue;
    end if;

    select * into v_sm
    from public.stock_management sm
    where sm.item_id::text = v_item_id
      and sm.warehouse_id = p_warehouse_id
    for update;
    if not found then
      raise exception 'stock record not found for item % in warehouse %', v_item_id, p_warehouse_id;
    end if;

    if not v_is_in_store then
      select coalesce(sum(br.quantity), 0)
      into v_reserved_total
      from public.batch_reservations br
      where br.order_id = p_order_id
        and br.item_id = v_item_id
        and br.warehouse_id = p_warehouse_id;

      if (v_reserved_total + 1e-9) < v_requested then
        raise exception 'insufficient reserved stock for item %', v_item_id;
      end if;
    end if;

    v_remaining := v_requested;

    if not v_is_in_store then
      for v_batch in
        select
          br.id as reservation_id,
          br.batch_id,
          br.quantity as reserved_qty,
          bb.expiry_date,
          bb.quantity as balance_qty
        from public.batch_reservations br
        join public.batch_balances bb
          on bb.item_id = br.item_id
         and bb.batch_id = br.batch_id
         and bb.warehouse_id = br.warehouse_id
        where br.order_id = p_order_id
          and br.item_id = v_item_id
          and br.warehouse_id = p_warehouse_id
        order by bb.expiry_date asc nulls last, br.created_at asc, br.id asc
      loop
        exit when v_remaining <= 0;
        if v_batch.expiry_date is not null and v_batch.expiry_date < current_date then
          raise exception 'cannot sell expired batch % for item %', v_batch.batch_id, v_item_id;
        end if;
        v_alloc := least(v_remaining, coalesce(v_batch.reserved_qty, 0), coalesce(v_batch.balance_qty, 0));
        if v_alloc <= 0 then
          continue;
        end if;

        update public.batch_balances
        set quantity = quantity - v_alloc,
            updated_at = now()
        where item_id = v_item_id
          and batch_id = v_batch.batch_id
          and warehouse_id = p_warehouse_id;

        if v_alloc >= v_batch.reserved_qty then
          delete from public.batch_reservations where id = v_batch.reservation_id;
        else
          update public.batch_reservations
          set quantity = quantity - v_alloc
          where id = v_batch.reservation_id;
        end if;

        select im.unit_cost
        into v_unit_cost
        from public.inventory_movements im
        where im.batch_id = v_batch.batch_id
          and im.item_id::text = v_item_id
          and im.movement_type = 'purchase_in'
        order by im.occurred_at asc
        limit 1;
        v_unit_cost := coalesce(v_unit_cost, coalesce(v_sm.avg_cost, 0));
        v_total_cost := v_alloc * v_unit_cost;

        insert into public.order_item_cogs(order_id, item_id, quantity, unit_cost, total_cost, created_at)
        values (p_order_id, v_item_id, v_alloc, v_unit_cost, v_total_cost, now());

        insert into public.inventory_movements(
          item_id, movement_type, quantity, unit_cost, total_cost,
          reference_table, reference_id, occurred_at, created_by, data, batch_id, warehouse_id
        )
        values (
          v_item_id, 'sale_out', v_alloc, v_unit_cost, v_total_cost,
          'orders', p_order_id::text, now(), auth.uid(),
          jsonb_build_object('orderId', p_order_id, 'batchId', v_batch.batch_id, 'warehouseId', p_warehouse_id, 'expiryDate', v_batch.expiry_date),
          v_batch.batch_id,
          p_warehouse_id
        )
        returning id into v_movement_id;

        perform public.post_inventory_movement(v_movement_id);

        v_remaining := v_remaining - v_alloc;
      end loop;
    else
      for v_batch in
        select
          bb.batch_id,
          bb.quantity as balance_qty,
          bb.expiry_date
        from public.batch_balances bb
        where bb.item_id = v_item_id
          and bb.warehouse_id = p_warehouse_id
          and bb.quantity > 0
          and (bb.expiry_date is null or bb.expiry_date >= current_date)
        order by bb.expiry_date asc nulls last, bb.batch_id asc
      loop
        exit when v_remaining <= 0;

        select coalesce(sum(br.quantity), 0)
        into v_reserved_other
        from public.batch_reservations br
        where br.item_id = v_item_id
          and br.warehouse_id = p_warehouse_id
          and br.batch_id = v_batch.batch_id;

        v_available := greatest(coalesce(v_batch.balance_qty, 0) - coalesce(v_reserved_other, 0), 0);
        if v_available <= 0 then
          continue;
        end if;
        v_alloc := least(v_remaining, v_available);
        if v_alloc <= 0 then
          continue;
        end if;

        update public.batch_balances
        set quantity = quantity - v_alloc,
            updated_at = now()
        where item_id = v_item_id
          and batch_id = v_batch.batch_id
          and warehouse_id = p_warehouse_id;

        select im.unit_cost
        into v_unit_cost
        from public.inventory_movements im
        where im.batch_id = v_batch.batch_id
          and im.item_id::text = v_item_id
          and im.movement_type = 'purchase_in'
        order by im.occurred_at asc
        limit 1;
        v_unit_cost := coalesce(v_unit_cost, coalesce(v_sm.avg_cost, 0));
        v_total_cost := v_alloc * v_unit_cost;

        insert into public.order_item_cogs(order_id, item_id, quantity, unit_cost, total_cost, created_at)
        values (p_order_id, v_item_id, v_alloc, v_unit_cost, v_total_cost, now());

        insert into public.inventory_movements(
          item_id, movement_type, quantity, unit_cost, total_cost,
          reference_table, reference_id, occurred_at, created_by, data, batch_id, warehouse_id
        )
        values (
          v_item_id, 'sale_out', v_alloc, v_unit_cost, v_total_cost,
          'orders', p_order_id::text, now(), auth.uid(),
          jsonb_build_object('orderId', p_order_id, 'batchId', v_batch.batch_id, 'warehouseId', p_warehouse_id, 'expiryDate', v_batch.expiry_date),
          v_batch.batch_id,
          p_warehouse_id
        )
        returning id into v_movement_id;

        perform public.post_inventory_movement(v_movement_id);

        v_remaining := v_remaining - v_alloc;
      end loop;
    end if;

    if v_remaining > 0 then
      raise exception 'insufficient FEFO-valid stock for item %', v_item_id;
    end if;

    update public.stock_management sm
    set available_quantity = coalesce((
          select sum(bb.quantity)
          from public.batch_balances bb
          where bb.item_id = v_item_id
            and bb.warehouse_id = p_warehouse_id
        ), 0),
        reserved_quantity = coalesce((
          select sum(br.quantity)
          from public.batch_reservations br
          where br.item_id = v_item_id
            and br.warehouse_id = p_warehouse_id
        ), 0),
        updated_at = now(),
        last_updated = now()
    where sm.item_id::text = v_item_id
      and sm.warehouse_id = p_warehouse_id;
  end loop;
end;
$$;

revoke all on function public.deduct_stock_on_delivery_v2(uuid, jsonb, uuid) from public;
grant execute on function public.deduct_stock_on_delivery_v2(uuid, jsonb, uuid) to authenticated;

-- ==========================================
-- Idempotent delivery confirmation
-- ==========================================

create or replace function public.confirm_order_delivery(
  p_order_id uuid,
  p_items jsonb,
  p_updated_data jsonb,
  p_warehouse_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order record;
begin
  perform public._require_staff('confirm_order_delivery');
  if p_order_id is null then
    raise exception 'p_order_id is required';
  end if;
  if p_warehouse_id is null then
    raise exception 'warehouse_id is required';
  end if;

  select * into v_order
  from public.orders o
  where o.id = p_order_id
  for update;
  if not found then
    raise exception 'order not found';
  end if;

  if lower(coalesce(v_order.status,'')) = 'delivered' then
    return;
  end if;

  if exists (
    select 1
    from public.inventory_movements im
    where im.reference_table = 'orders'
      and im.reference_id = p_order_id::text
      and im.movement_type = 'sale_out'
      and im.warehouse_id = p_warehouse_id
  ) then
    update public.orders
    set status = 'delivered',
        data = coalesce(p_updated_data, data),
        updated_at = now()
    where id = p_order_id;
    return;
  end if;

  perform public.deduct_stock_on_delivery_v2(p_order_id, p_items, p_warehouse_id);

  update public.orders
  set status = 'delivered',
      data = coalesce(p_updated_data, data),
      updated_at = now()
  where id = p_order_id;
end;
$$;

revoke all on function public.confirm_order_delivery(uuid, jsonb, jsonb, uuid) from public;
grant execute on function public.confirm_order_delivery(uuid, jsonb, jsonb, uuid) to authenticated;

-- ==========================================
-- Wastage and expiry (RBAC + batch/warehouse correctness)
-- ==========================================

create or replace function public.record_wastage_light(
  p_item_id uuid,
  p_warehouse_id uuid,
  p_batch_id uuid default null,
  p_quantity numeric,
  p_unit text default 'piece',
  p_reason text default null,
  p_occurred_at timestamptz default now()
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid;
  v_wh uuid;
  v_item_id text;
  v_needed numeric;
  v_batch record;
  v_reserved_other numeric;
  v_available numeric;
  v_alloc numeric;
  v_unit_cost numeric;
  v_total_cost numeric;
  v_movement_id uuid;
begin
  perform public._require_stock_manager('record_wastage_light');

  v_actor := auth.uid();
  if p_item_id is null or p_quantity is null or p_quantity <= 0 then
    raise exception 'invalid params';
  end if;

  v_item_id := p_item_id::text;
  v_wh := coalesce(p_warehouse_id, public._resolve_default_warehouse_id());
  if v_wh is null then
    raise exception 'warehouse_id is required';
  end if;

  v_needed := p_quantity;

  if p_batch_id is not null then
    select bb.batch_id, bb.quantity, bb.expiry_date
    into v_batch
    from public.batch_balances bb
    where bb.item_id = v_item_id
      and bb.warehouse_id = v_wh
      and bb.batch_id = p_batch_id
    for update;
    if not found then
      raise exception 'batch not found for item %', v_item_id;
    end if;

    select coalesce(sum(br.quantity), 0)
    into v_reserved_other
    from public.batch_reservations br
    where br.item_id = v_item_id
      and br.warehouse_id = v_wh
      and br.batch_id = p_batch_id;

    v_available := greatest(coalesce(v_batch.quantity, 0) - coalesce(v_reserved_other, 0), 0);
    if v_available + 1e-9 < v_needed then
      raise exception 'insufficient unreserved stock for wastage';
    end if;
  end if;

  for v_batch in
    select bb.batch_id, bb.quantity, bb.expiry_date
    from public.batch_balances bb
    where bb.item_id = v_item_id
      and bb.warehouse_id = v_wh
      and bb.quantity > 0
      and (p_batch_id is null or bb.batch_id = p_batch_id)
    order by bb.expiry_date asc nulls last, bb.batch_id asc
  loop
    exit when v_needed <= 0;

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

    update public.batch_balances
    set quantity = quantity - v_alloc,
        updated_at = now()
    where item_id = v_item_id
      and batch_id = v_batch.batch_id
      and warehouse_id = v_wh;

    select im.unit_cost
    into v_unit_cost
    from public.inventory_movements im
    where im.batch_id = v_batch.batch_id
      and im.item_id::text = v_item_id
      and im.movement_type = 'purchase_in'
    order by im.occurred_at asc
    limit 1;
    v_unit_cost := coalesce(v_unit_cost, 0);
    v_total_cost := v_alloc * v_unit_cost;

    insert into public.inventory_movements(
      item_id, movement_type, quantity, unit_cost, total_cost,
      reference_table, reference_id, occurred_at, created_by, data, batch_id, warehouse_id
    )
    values (
      v_item_id, 'wastage_out', v_alloc, v_unit_cost, v_total_cost,
      'accounting_light_entries', null, coalesce(p_occurred_at, now()), v_actor,
      jsonb_build_object('reason', coalesce(p_reason,''), 'warehouseId', v_wh, 'batchId', v_batch.batch_id, 'expiryDate', v_batch.expiry_date),
      v_batch.batch_id, v_wh
    )
    returning id into v_movement_id;
    perform public.post_inventory_movement(v_movement_id);

    insert into public.accounting_light_entries(
      entry_type, item_id, warehouse_id, batch_id, quantity, unit, unit_cost, total_cost,
      occurred_at, debit_account, credit_account, created_by, notes, source_ref
    )
    values (
      'wastage', v_item_id, v_wh, v_batch.batch_id, v_alloc, p_unit,
      coalesce(v_unit_cost,0), v_total_cost, coalesce(p_occurred_at, now()),
      'shrinkage', 'inventory', v_actor, p_reason, v_movement_id::text
    );

    v_needed := v_needed - v_alloc;
  end loop;

  if v_needed > 0 then
    raise exception 'insufficient unreserved stock for wastage';
  end if;

  update public.stock_management sm
  set available_quantity = coalesce((
        select sum(bb.quantity)
        from public.batch_balances bb
        where bb.item_id = v_item_id
          and bb.warehouse_id = v_wh
      ), 0),
      reserved_quantity = coalesce((
        select sum(br.quantity)
        from public.batch_reservations br
        where br.item_id = v_item_id
          and br.warehouse_id = v_wh
      ), 0),
      updated_at = now(),
      last_updated = now()
  where sm.item_id::text = v_item_id
    and sm.warehouse_id = v_wh;

  insert into public.system_audit_logs(action, module, details, performed_by, performed_at, metadata)
  values (
    'wastage.recorded',
    'stock',
    coalesce(p_reason,''),
    v_actor,
    now(),
    jsonb_build_object('itemId', v_item_id, 'warehouseId', v_wh, 'batchId', p_batch_id, 'quantity', p_quantity, 'unitCost', null)
  );
end;
$$;

revoke all on function public.record_wastage_light(uuid, uuid, uuid, numeric, text, text, timestamptz) from public;
grant execute on function public.record_wastage_light(uuid, uuid, uuid, numeric, text, text, timestamptz) to authenticated;

create or replace function public.process_expiry_light(
  p_warehouse_id uuid default null,
  p_now timestamptz default now()
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid;
  v_wh uuid;
  v_processed integer := 0;
  v_row record;
  v_reserved numeric;
  v_unit_cost numeric;
  v_movement_id uuid;
  v_total_cost numeric;
begin
  perform public._require_stock_manager('process_expiry_light');

  v_actor := auth.uid();
  v_wh := coalesce(p_warehouse_id, public._resolve_default_warehouse_id());
  if v_wh is null then
    raise exception 'warehouse_id is required';
  end if;

  for v_row in
    select bb.item_id, bb.batch_id, bb.quantity, bb.expiry_date
    from public.batch_balances bb
    where bb.warehouse_id = v_wh
      and bb.quantity > 0
      and bb.expiry_date is not null
      and bb.expiry_date < current_date
    order by bb.expiry_date asc, bb.batch_id asc
  loop
    select coalesce(sum(br.quantity), 0)
    into v_reserved
    from public.batch_reservations br
    where br.item_id = v_row.item_id
      and br.batch_id = v_row.batch_id
      and br.warehouse_id = v_wh;

    if v_reserved > 0 then
      raise exception 'cannot process expiry for reserved batch %', v_row.batch_id;
    end if;

    select im.unit_cost
    into v_unit_cost
    from public.inventory_movements im
    where im.batch_id = v_row.batch_id
      and im.item_id::text = v_row.item_id
      and im.movement_type = 'purchase_in'
    order by im.occurred_at asc
    limit 1;
    v_unit_cost := coalesce(v_unit_cost, 0);
    v_total_cost := coalesce(v_row.quantity, 0) * v_unit_cost;

    update public.batch_balances
    set quantity = 0,
        updated_at = now()
    where item_id = v_row.item_id
      and batch_id = v_row.batch_id
      and warehouse_id = v_wh;

    insert into public.inventory_movements(
      item_id, movement_type, quantity, unit_cost, total_cost,
      reference_table, reference_id, occurred_at, created_by, data, batch_id, warehouse_id
    )
    values (
      v_row.item_id, 'wastage_out', v_row.quantity, v_unit_cost, v_total_cost,
      'accounting_light_entries', null, coalesce(p_now, now()), v_actor,
      jsonb_build_object('reason','expiry','warehouseId', v_wh, 'batchId', v_row.batch_id, 'expiredOn', v_row.expiry_date),
      v_row.batch_id, v_wh
    )
    returning id into v_movement_id;
    perform public.post_inventory_movement(v_movement_id);

    insert into public.accounting_light_entries(
      entry_type, item_id, warehouse_id, batch_id, quantity, unit, unit_cost, total_cost,
      occurred_at, debit_account, credit_account, created_by, notes, source_ref
    )
    values (
      'expiry', v_row.item_id, v_wh, v_row.batch_id, v_row.quantity, null,
      v_unit_cost, v_total_cost, coalesce(p_now, now()),
      'shrinkage', 'inventory', v_actor, 'expiry', v_movement_id::text
    );

    update public.stock_management sm
    set available_quantity = coalesce((
          select sum(bb.quantity)
          from public.batch_balances bb
          where bb.item_id = v_row.item_id
            and bb.warehouse_id = v_wh
        ), 0),
        reserved_quantity = coalesce((
          select sum(br.quantity)
          from public.batch_reservations br
          where br.item_id = v_row.item_id
            and br.warehouse_id = v_wh
        ), 0),
        updated_at = now(),
        last_updated = now()
    where sm.item_id::text = v_row.item_id
      and sm.warehouse_id = v_wh;

    insert into public.system_audit_logs(action, module, details, performed_by, performed_at, metadata)
    values (
      'expiry.processed',
      'stock',
      'batch expired',
      v_actor,
      now(),
      jsonb_build_object('itemId', v_row.item_id, 'warehouseId', v_wh, 'batchId', v_row.batch_id, 'quantity', v_row.quantity, 'unitCost', v_unit_cost)
    );

    v_processed := v_processed + 1;
  end loop;

  return v_processed;
end;
$$;

revoke all on function public.process_expiry_light(uuid, timestamptz) from public;
grant execute on function public.process_expiry_light(uuid, timestamptz) to authenticated;

-- ==========================================
-- Patch create_order_secure to reserve correct quantities for weight items
-- (no UI change; server-side correctness)
-- ==========================================

create or replace function public.create_order_secure(
    p_items jsonb,
    p_delivery_zone_id uuid,
    p_payment_method text,
    p_notes text,
    p_address text,
    p_location jsonb,
    p_customer_name text,
    p_phone_number text,
    p_is_scheduled boolean,
    p_scheduled_at timestamptz,
    p_coupon_code text default null,
    p_points_redeemed_value numeric default 0
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_user_id uuid;
    v_order_id uuid;
    v_item_input jsonb;
    v_menu_item record;
    v_menu_item_data jsonb;
    v_cart_item jsonb;
    v_final_items jsonb := '[]'::jsonb;
    v_subtotal numeric := 0;
    v_total numeric := 0;
    v_delivery_fee numeric := 0;
    v_discount_amount numeric := 0;
    v_tax_amount numeric := 0;
    v_tax_rate numeric := 0;
    v_points_earned numeric := 0;
    v_settings jsonb;
    v_zone_data jsonb;
    v_line_total numeric;
    v_addons_price numeric;
    v_unit_price numeric;
    v_base_price numeric;
    v_addon_key text;
    v_addon_qty numeric;
    v_addon_def jsonb;
    v_grade_id text;
    v_grade_def jsonb;
    v_weight numeric;
    v_quantity numeric;
    v_unit_type text;
    v_delivery_pin text;
    v_available_addons jsonb;
    v_selected_addons_map jsonb;
    v_final_selected_addons jsonb;
    v_points_settings jsonb;
    v_currency_val_per_point numeric;
    v_points_per_currency numeric;
    v_coupon_record record;
    v_stock_items jsonb := '[]'::jsonb;
    v_item_name_ar text;
    v_item_name_en text;
    v_priced_unit numeric;
    v_pricing_qty numeric;
    v_warehouse_id uuid;
    v_stock_qty numeric;
begin
    v_user_id := auth.uid();
    if v_user_id is null then
        raise exception 'User not authenticated';
    end if;

    select w.id
    into v_warehouse_id
    from public.warehouses w
    where w.is_active = true
    order by (upper(coalesce(w.code, '')) = 'MAIN') desc, w.code asc
    limit 1;

    if v_warehouse_id is null then
      raise exception 'No active warehouse found';
    end if;

    select data into v_settings from public.app_settings where id = 'singleton';
    if v_settings is null then
        v_settings := '{}'::jsonb;
    end if;

    for v_item_input in select * from jsonb_array_elements(p_items)
    loop
        select * into v_menu_item from public.menu_items where id = (v_item_input->>'itemId');
        if not found then
            raise exception 'Item not found: %', v_item_input->>'itemId';
        end if;
        
        v_menu_item_data := v_menu_item.data;
        v_item_name_ar := v_menu_item_data->'name'->>'ar';
        v_item_name_en := v_menu_item_data->'name'->>'en';

        v_quantity := coalesce((v_item_input->>'quantity')::numeric, 0);
        v_weight := coalesce((v_item_input->>'weight')::numeric, 0);
        v_unit_type := coalesce(v_menu_item.unit_type, 'piece');

        if v_unit_type in ('kg', 'gram') then
            if v_weight <= 0 then
              raise exception 'Weight must be positive for item %', v_menu_item.id;
            end if;
            if v_quantity <= 0 then v_quantity := 1; end if;
            v_pricing_qty := v_weight;
            v_priced_unit := public.get_item_price_with_discount(v_menu_item.id::text, v_user_id, v_pricing_qty);
            v_base_price := v_priced_unit * v_weight;
            v_stock_qty := v_weight;
        else
            if v_quantity <= 0 then raise exception 'Quantity must be positive for item %', v_menu_item.id; end if;
            v_pricing_qty := v_quantity;
            v_priced_unit := public.get_item_price_with_discount(v_menu_item.id::text, v_user_id, v_pricing_qty);
            v_base_price := v_priced_unit;
            v_stock_qty := v_quantity;
        end if;

        v_grade_id := v_item_input->>'gradeId';
        v_grade_def := null;
        if v_grade_id is not null and (v_menu_item_data->'availableGrades') is not null then
            select value into v_grade_def
            from jsonb_array_elements(v_menu_item_data->'availableGrades')
            where value->>'id' = v_grade_id;
            
            if v_grade_def is not null then
                v_priced_unit := v_priced_unit * coalesce((v_grade_def->>'priceMultiplier')::numeric, 1.0);
                v_base_price := v_base_price * coalesce((v_grade_def->>'priceMultiplier')::numeric, 1.0);
            end if;
        end if;

        v_addons_price := 0;
        v_available_addons := coalesce(v_menu_item_data->'addons', '[]'::jsonb);
        v_selected_addons_map := coalesce(v_item_input->'selectedAddons', '{}'::jsonb);
        v_final_selected_addons := '{}'::jsonb;
        
        for v_addon_key in select jsonb_object_keys(v_selected_addons_map)
        loop
            v_addon_qty := (v_selected_addons_map->>v_addon_key)::numeric;
            if v_addon_qty > 0 then
                select value into v_addon_def
                from jsonb_array_elements(v_available_addons)
                where value->>'id' = v_addon_key;
                
                if v_addon_def is not null then
                    v_addons_price := v_addons_price + ((v_addon_def->>'price')::numeric * v_addon_qty);
                    v_final_selected_addons := jsonb_set(
                        v_final_selected_addons,
                        array[v_addon_key],
                        jsonb_build_object('addon', v_addon_def, 'quantity', v_addon_qty)
                    );
                end if;
            end if;
        end loop;

        if v_unit_type in ('kg', 'gram') then
            v_unit_price := v_base_price + v_addons_price;
            v_line_total := (v_base_price + v_addons_price) * v_quantity;
        else
            v_unit_price := v_priced_unit + v_addons_price;
            v_line_total := (v_priced_unit + v_addons_price) * v_quantity;
        end if;
        
        v_subtotal := v_subtotal + v_line_total;

        v_cart_item := v_menu_item_data || jsonb_build_object(
            'quantity', v_quantity,
            'weight', v_weight,
            'selectedAddons', v_final_selected_addons,
            'selectedGrade', v_grade_def,
            'cartItemId', gen_random_uuid()::text,
            'price', v_priced_unit
        );
        if v_unit_type = 'gram' then
          v_cart_item := v_cart_item || jsonb_build_object('pricePerUnit', (v_priced_unit * 1000));
        end if;
        
        v_final_items := v_final_items || v_cart_item;
        
        v_stock_items := v_stock_items || jsonb_build_object(
            'itemId', v_menu_item.id,
            'quantity', v_stock_qty
        );
    end loop;

    if p_delivery_zone_id is not null then
        select data into v_zone_data from public.delivery_zones where id = p_delivery_zone_id;
        if v_zone_data is not null and (v_zone_data->>'isActive')::boolean then
            v_delivery_fee := coalesce((v_zone_data->>'deliveryFee')::numeric, 0);
        else
            v_delivery_fee := coalesce((v_settings->'deliverySettings'->>'baseFee')::numeric, 0);
        end if;
    else
        v_delivery_fee := coalesce((v_settings->'deliverySettings'->>'baseFee')::numeric, 0);
    end if;

    if (v_settings->'deliverySettings'->>'freeDeliveryThreshold') is not null and
       v_subtotal >= (v_settings->'deliverySettings'->>'freeDeliveryThreshold')::numeric then
        v_delivery_fee := 0;
    end if;

    if p_coupon_code is not null and length(p_coupon_code) > 0 then
        select * into v_coupon_record from public.coupons where lower(code) = lower(p_coupon_code) and is_active = true;
        if found then
            if (v_coupon_record.data->>'expiresAt') is not null and (v_coupon_record.data->>'expiresAt')::timestamptz < now() then
                raise exception 'Coupon expired';
            end if;
            if (v_coupon_record.data->>'minOrderAmount') is not null and v_subtotal < (v_coupon_record.data->>'minOrderAmount')::numeric then
                raise exception 'Order amount too low for coupon';
            end if;
            if (v_coupon_record.data->>'usageLimit') is not null and
               coalesce((v_coupon_record.data->>'usageCount')::int, 0) >= (v_coupon_record.data->>'usageLimit')::int then
                raise exception 'Coupon usage limit reached';
            end if;
            
            if (v_coupon_record.data->>'type') = 'percentage' then
                v_discount_amount := v_subtotal * ((v_coupon_record.data->>'value')::numeric / 100);
                if (v_coupon_record.data->>'maxDiscount') is not null then
                    v_discount_amount := least(v_discount_amount, (v_coupon_record.data->>'maxDiscount')::numeric);
                end if;
            else
                v_discount_amount := (v_coupon_record.data->>'value')::numeric;
            end if;
            
            v_discount_amount := least(v_discount_amount, v_subtotal);
            
            update public.coupons
            set data = jsonb_set(data, '{usageCount}', (coalesce((data->>'usageCount')::int, 0) + 1)::text::jsonb)
            where id = v_coupon_record.id;
        else
            v_discount_amount := 0;
        end if;
    end if;

    if p_points_redeemed_value > 0 then
        v_points_settings := v_settings->'loyaltySettings';
        if (v_points_settings->>'enabled')::boolean then
            v_currency_val_per_point := coalesce((v_points_settings->>'currencyValuePerPoint')::numeric, 0);
            if v_currency_val_per_point > 0 then
                declare
                    v_user_points int;
                    v_points_needed numeric;
                begin
                    select loyalty_points into v_user_points from public.customers where auth_user_id = v_user_id;
                    v_points_needed := p_points_redeemed_value / v_currency_val_per_point;
                    
                    if coalesce(v_user_points, 0) < v_points_needed then
                        raise exception 'Insufficient loyalty points';
                    end if;
                    
                    update public.customers
                    set loyalty_points = loyalty_points - v_points_needed::int
                    where auth_user_id = v_user_id;
                    
                    v_discount_amount := v_discount_amount + p_points_redeemed_value;
                end;
            end if;
        end if;
    end if;

    if (v_settings->'taxSettings'->>'enabled')::boolean then
        v_tax_rate := coalesce((v_settings->'taxSettings'->>'rate')::numeric, 0);
        v_tax_amount := greatest(0, v_subtotal - v_discount_amount) * (v_tax_rate / 100);
    end if;

    v_total := greatest(0, v_subtotal - v_discount_amount) + v_delivery_fee + v_tax_amount;

    v_points_settings := v_settings->'loyaltySettings';
    if (v_points_settings->>'enabled')::boolean then
        v_points_per_currency := coalesce((v_points_settings->>'pointsPerCurrencyUnit')::numeric, 0);
        v_points_earned := floor(v_subtotal * v_points_per_currency);
    end if;

    v_delivery_pin := floor(random() * 9000 + 1000)::text;

    insert into public.orders (
        customer_auth_user_id,
        status,
        invoice_number,
        data
    )
    values (
        v_user_id,
        case when p_is_scheduled then 'scheduled' else 'pending' end,
        null,
        jsonb_build_object(
            'id', gen_random_uuid(),
            'userId', v_user_id,
            'orderSource', 'online',
            'items', v_final_items,
            'subtotal', v_subtotal,
            'deliveryFee', v_delivery_fee,
            'discountAmount', v_discount_amount,
            'total', v_total,
            'taxAmount', v_tax_amount,
            'taxRate', v_tax_rate,
            'pointsEarned', v_points_earned,
            'pointsRedeemedValue', p_points_redeemed_value,
            'deliveryZoneId', p_delivery_zone_id,
            'paymentMethod', p_payment_method,
            'notes', p_notes,
            'address', p_address,
            'location', p_location,
            'customerName', p_customer_name,
            'phoneNumber', p_phone_number,
            'isScheduled', p_is_scheduled,
            'scheduledAt', p_scheduled_at,
            'deliveryPin', v_delivery_pin,
            'appliedCouponCode', p_coupon_code,
            'warehouseId', v_warehouse_id
        )
    )
    returning id into v_order_id;

    update public.orders
    set data = jsonb_set(data, '{id}', to_jsonb(v_order_id::text))
    where id = v_order_id
    returning data into v_item_input;

    perform public.reserve_stock_for_order(v_stock_items, v_order_id, v_warehouse_id);

    insert into public.order_events (order_id, action, actor_type, actor_id, to_status, payload)
    values (
        v_order_id,
        'order.created',
        'customer',
        v_user_id,
        case when p_is_scheduled then 'scheduled' else 'pending' end,
        jsonb_build_object('total', v_total, 'method', p_payment_method)
    );

    return v_item_input;
end;
$$;

revoke all on function public.create_order_secure(jsonb, uuid, text, text, text, jsonb, text, text, boolean, timestamptz, text, numeric) from public;
grant execute on function public.create_order_secure(jsonb, uuid, text, text, text, jsonb, text, text, boolean, timestamptz, text, numeric) to authenticated;

-- ==========================================
-- Update partial purchase receiving to populate batch_balances (default warehouse)
-- ==========================================

create or replace function public.receive_purchase_order_partial(
  p_order_id uuid,
  p_items jsonb,
  p_occurred_at timestamptz default now()
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_po record;
  v_item jsonb;
  v_item_id text;
  v_qty numeric;
  v_unit_cost numeric;
  v_old_qty numeric;
  v_old_avg numeric;
  v_new_qty numeric;
  v_effective_unit_cost numeric;
  v_new_avg numeric;
  v_receipt_id uuid;
  v_receipt_total numeric := 0;
  v_all_received boolean := true;
  v_ordered numeric;
  v_received numeric;
  v_expiry text;
  v_harvest text;
  v_expiry_iso text;
  v_harvest_iso text;
  v_category text;
  v_batch_id uuid;
  v_movement_id uuid;
  v_wh uuid;
begin
  perform public._require_staff('receive_purchase_order_partial');

  if p_order_id is null then
    raise exception 'p_order_id is required';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    raise exception 'p_items must be a json array';
  end if;

  v_wh := public._resolve_default_warehouse_id();
  if v_wh is null then
    raise exception 'warehouse_id is required';
  end if;

  select * into v_po
  from public.purchase_orders
  where id = p_order_id
  for update;
  if not found then
    raise exception 'purchase order not found';
  end if;
  if v_po.status = 'cancelled' then
    raise exception 'cannot receive cancelled purchase order';
  end if;

  insert into public.purchase_receipts(purchase_order_id, received_at, created_by)
  values (p_order_id, coalesce(p_occurred_at, now()), auth.uid())
  returning id into v_receipt_id;

  for v_item in select value from jsonb_array_elements(p_items)
  loop
    v_item_id := coalesce(v_item->>'itemId', v_item->>'id');
    v_qty := coalesce(nullif(v_item->>'quantity', '')::numeric, 0);
    v_unit_cost := coalesce(nullif(v_item->>'unitCost', '')::numeric, 0);
    v_expiry := nullif(v_item->>'expiryDate', '');
    v_harvest := nullif(v_item->>'harvestDate', '');
    v_expiry_iso := null;
    v_harvest_iso := null;
    v_category := null;

    if v_item_id is null or v_item_id = '' then
      raise exception 'Invalid itemId';
    end if;
    if v_qty <= 0 then
      continue;
    end if;

    select coalesce(pi.quantity, 0), coalesce(pi.received_quantity, 0), coalesce(pi.unit_cost, 0)
    into v_ordered, v_received, v_unit_cost
    from public.purchase_items pi
    where pi.purchase_order_id = p_order_id
      and pi.item_id = v_item_id
    for update;
    if not found then
      raise exception 'item % not found in purchase order', v_item_id;
    end if;
    if (v_received + v_qty) > (v_ordered + 1e-9) then
      raise exception 'received exceeds ordered for item %', v_item_id;
    end if;

    insert into public.stock_management(item_id, warehouse_id, available_quantity, reserved_quantity, unit, low_stock_threshold, last_updated, data)
    select v_item_id, v_wh, 0, 0, coalesce(mi.unit_type, 'piece'), 5, now(), '{}'::jsonb
    from public.menu_items mi
    where mi.id = v_item_id
    on conflict (item_id, warehouse_id) do nothing;

    select coalesce(sm.available_quantity, 0), coalesce(sm.avg_cost, 0)
    into v_old_qty, v_old_avg
    from public.stock_management sm
    where sm.item_id::text = v_item_id
      and sm.warehouse_id = v_wh
    for update;

    select (v_unit_cost + coalesce(mi.transport_cost, 0) + coalesce(mi.supply_tax_cost, 0)), mi.category
    into v_effective_unit_cost, v_category
    from public.menu_items mi
    where mi.id = v_item_id;

    if v_expiry is not null then
      if left(v_expiry, 10) !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
        raise exception 'expiryDate must be ISO date (YYYY-MM-DD) for item %', v_item_id;
      end if;
      v_expiry_iso := left(v_expiry, 10);
    end if;
    if v_harvest is not null then
      if left(v_harvest, 10) !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
        raise exception 'harvestDate must be ISO date (YYYY-MM-DD) for item %', v_item_id;
      end if;
      v_harvest_iso := left(v_harvest, 10);
    end if;
    if coalesce(v_category, '') = 'food' and v_expiry_iso is null then
      raise exception 'expiryDate is required for food item %', v_item_id;
    end if;

    v_new_qty := v_old_qty + v_qty;
    if v_new_qty <= 0 then
      v_new_avg := v_effective_unit_cost;
    else
      v_new_avg := ((v_old_qty * v_old_avg) + (v_qty * v_effective_unit_cost)) / v_new_qty;
    end if;

    v_batch_id := gen_random_uuid();

    update public.stock_management
    set available_quantity = available_quantity + v_qty,
        avg_cost = v_new_avg,
        last_updated = now(),
        updated_at = now()
    where item_id::text = v_item_id
      and warehouse_id = v_wh;

    insert into public.batch_balances(item_id, batch_id, warehouse_id, quantity, expiry_date)
    values (v_item_id, v_batch_id, v_wh, v_qty, v_expiry_iso::date)
    on conflict (item_id, batch_id, warehouse_id)
    do update set
      quantity = public.batch_balances.quantity + excluded.quantity,
      expiry_date = coalesce(excluded.expiry_date, public.batch_balances.expiry_date),
      updated_at = now();

    update public.menu_items
    set buying_price = v_unit_cost,
        cost_price = v_new_avg,
        updated_at = now()
    where id = v_item_id;

    update public.purchase_items
    set received_quantity = received_quantity + v_qty
    where purchase_order_id = p_order_id
      and item_id = v_item_id;

    insert into public.purchase_receipt_items(receipt_id, item_id, quantity, unit_cost, total_cost)
    values (v_receipt_id, v_item_id, v_qty, v_effective_unit_cost, (v_qty * v_effective_unit_cost));

    v_receipt_total := v_receipt_total + (v_qty * v_effective_unit_cost);

    insert into public.inventory_movements(
      item_id, movement_type, quantity, unit_cost, total_cost,
      reference_table, reference_id, occurred_at, created_by, data, batch_id, warehouse_id
    )
    values (
      v_item_id, 'purchase_in', v_qty, v_effective_unit_cost, (v_qty * v_effective_unit_cost),
      'purchase_receipts', v_receipt_id::text, coalesce(p_occurred_at, now()), auth.uid(),
      jsonb_build_object('purchaseOrderId', p_order_id, 'purchaseReceiptId', v_receipt_id, 'batchId', v_batch_id, 'expiryDate', v_expiry_iso, 'harvestDate', v_harvest_iso, 'warehouseId', v_wh),
      v_batch_id,
      v_wh
    )
    returning id into v_movement_id;
    perform public.post_inventory_movement(v_movement_id);
  end loop;

  for v_item_id, v_ordered, v_received in
    select pi.item_id, coalesce(pi.quantity, 0), coalesce(pi.received_quantity, 0)
    from public.purchase_items pi
    where pi.purchase_order_id = p_order_id
  loop
    if (v_received + 1e-9) < v_ordered then
      v_all_received := false;
      exit;
    end if;
  end loop;

  update public.purchase_orders
  set status = case when v_all_received then 'completed' else 'partial' end,
      updated_at = now()
  where id = p_order_id;

  return v_receipt_id;
end;
$$;

revoke all on function public.receive_purchase_order_partial(uuid, jsonb, timestamptz) from public;
grant execute on function public.receive_purchase_order_partial(uuid, jsonb, timestamptz) to authenticated;

-- ==========================================
-- Batch-safe warehouse transfer (auto FEFO allocation from source)
-- ==========================================

create or replace function public.complete_warehouse_transfer(p_transfer_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item record;
  v_from_warehouse uuid;
  v_to_warehouse uuid;
  v_transfer_date date;
  v_needed numeric;
  v_batch record;
  v_reserved_other numeric;
  v_available numeric;
  v_alloc numeric;
  v_unit_cost numeric;
begin
  perform public._require_stock_manager('complete_warehouse_transfer');

  select from_warehouse_id, to_warehouse_id, transfer_date
  into v_from_warehouse, v_to_warehouse, v_transfer_date
  from public.warehouse_transfers
  where id = p_transfer_id and status = 'pending'
  for update;
  if not found then
    raise exception 'Transfer not found or not pending';
  end if;

  for v_item in
    select item_id, quantity
    from public.warehouse_transfer_items
    where transfer_id = p_transfer_id
  loop
    v_needed := v_item.quantity;
    if v_needed <= 0 then
      continue;
    end if;

    for v_batch in
      select bb.batch_id, bb.quantity, bb.expiry_date
      from public.batch_balances bb
      where bb.item_id = v_item.item_id
        and bb.warehouse_id = v_from_warehouse
        and bb.quantity > 0
        and (bb.expiry_date is null or bb.expiry_date >= current_date)
      order by bb.expiry_date asc nulls last, bb.batch_id asc
    loop
      exit when v_needed <= 0;

      select coalesce(sum(br.quantity), 0)
      into v_reserved_other
      from public.batch_reservations br
      where br.item_id = v_item.item_id
        and br.warehouse_id = v_from_warehouse
        and br.batch_id = v_batch.batch_id;

      v_available := greatest(coalesce(v_batch.quantity, 0) - coalesce(v_reserved_other, 0), 0);
      if v_available <= 0 then
        continue;
      end if;

      v_alloc := least(v_needed, v_available);
      if v_alloc <= 0 then
        continue;
      end if;

      update public.batch_balances
      set quantity = quantity - v_alloc,
          updated_at = now()
      where item_id = v_item.item_id
        and batch_id = v_batch.batch_id
        and warehouse_id = v_from_warehouse;

      insert into public.batch_balances(item_id, batch_id, warehouse_id, quantity, expiry_date)
      values (v_item.item_id, v_batch.batch_id, v_to_warehouse, v_alloc, v_batch.expiry_date)
      on conflict (item_id, batch_id, warehouse_id)
      do update set
        quantity = public.batch_balances.quantity + excluded.quantity,
        expiry_date = coalesce(excluded.expiry_date, public.batch_balances.expiry_date),
        updated_at = now();

      select im.unit_cost
      into v_unit_cost
      from public.inventory_movements im
      where im.batch_id = v_batch.batch_id
        and im.item_id::text = v_item.item_id::text
        and im.movement_type = 'purchase_in'
      order by im.occurred_at asc
      limit 1;
      v_unit_cost := coalesce(v_unit_cost, 0);

      insert into public.inventory_movements(
        item_id, movement_type, quantity, unit_cost, total_cost,
        reference_table, reference_id, occurred_at, created_by, data, batch_id, warehouse_id
      )
      values (
        v_item.item_id, 'adjust_out', v_alloc, v_unit_cost, v_alloc * v_unit_cost,
        'warehouse_transfers', p_transfer_id::text, v_transfer_date::timestamptz, auth.uid(),
        jsonb_build_object('transferId', p_transfer_id, 'fromWarehouseId', v_from_warehouse, 'toWarehouseId', v_to_warehouse, 'batchId', v_batch.batch_id, 'expiryDate', v_batch.expiry_date),
        v_batch.batch_id,
        v_from_warehouse
      );

      insert into public.inventory_movements(
        item_id, movement_type, quantity, unit_cost, total_cost,
        reference_table, reference_id, occurred_at, created_by, data, batch_id, warehouse_id
      )
      values (
        v_item.item_id, 'adjust_in', v_alloc, v_unit_cost, v_alloc * v_unit_cost,
        'warehouse_transfers', p_transfer_id::text, v_transfer_date::timestamptz, auth.uid(),
        jsonb_build_object('transferId', p_transfer_id, 'fromWarehouseId', v_from_warehouse, 'toWarehouseId', v_to_warehouse, 'batchId', v_batch.batch_id, 'expiryDate', v_batch.expiry_date),
        v_batch.batch_id,
        v_to_warehouse
      );

      v_needed := v_needed - v_alloc;
    end loop;

    if v_needed > 0 then
      raise exception 'Insufficient FEFO-valid stock for item % in source warehouse', v_item.item_id;
    end if;

    update public.stock_management sm
    set available_quantity = coalesce((
          select sum(bb.quantity)
          from public.batch_balances bb
          where bb.item_id = v_item.item_id
            and bb.warehouse_id = v_from_warehouse
        ), 0),
        updated_at = now(),
        last_updated = now()
    where sm.item_id::text = v_item.item_id::text
      and sm.warehouse_id = v_from_warehouse;

    update public.stock_management sm
    set available_quantity = coalesce((
          select sum(bb.quantity)
          from public.batch_balances bb
          where bb.item_id = v_item.item_id
            and bb.warehouse_id = v_to_warehouse
        ), 0),
        updated_at = now(),
        last_updated = now()
    where sm.item_id::text = v_item.item_id::text
      and sm.warehouse_id = v_to_warehouse;

    update public.warehouse_transfer_items
    set transferred_quantity = v_item.quantity
    where transfer_id = p_transfer_id
      and item_id = v_item.item_id;
  end loop;

  update public.warehouse_transfers
  set status = 'completed',
      completed_at = now(),
      approved_by = auth.uid()
  where id = p_transfer_id;

  insert into public.system_audit_logs(action, module, details, performed_by, performed_at, metadata)
  values (
    'warehouse_transfer_completed',
    'inventory',
    format('Completed transfer %s', p_transfer_id),
    auth.uid(),
    now(),
    jsonb_build_object('transferId', p_transfer_id, 'fromWarehouseId', v_from_warehouse, 'toWarehouseId', v_to_warehouse)
  );
end;
$$;

revoke all on function public.complete_warehouse_transfer(uuid) from public;
grant execute on function public.complete_warehouse_transfer(uuid) to authenticated;

-- ==========================================
-- Patch receive_purchase_order (full) to be batch/warehouse safe
-- - Requires staff
-- - Defaults to MAIN warehouse
-- - Rejects food items without explicit expiryDate (use partial receipt)
-- ==========================================

create or replace function public.receive_purchase_order(p_order_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_po record;
  v_pi record;
  v_old_qty numeric;
  v_old_avg numeric;
  v_new_qty numeric;
  v_effective_unit_cost numeric;
  v_new_avg numeric;
  v_movement_id uuid;
  v_batch_id uuid;
  v_wh uuid;
  v_category text;
begin
  perform public._require_staff('receive_purchase_order');

  if p_order_id is null then
    raise exception 'purchase order not found';
  end if;

  v_wh := public._resolve_default_warehouse_id();
  if v_wh is null then
    raise exception 'warehouse_id is required';
  end if;

  select *
  into v_po
  from public.purchase_orders
  where id = p_order_id
  for update;

  if not found then
    raise exception 'purchase order not found';
  end if;

  if v_po.status = 'cancelled' then
    raise exception 'cannot receive cancelled purchase order';
  end if;

  for v_pi in
    select pi.item_id, pi.quantity, pi.unit_cost
    from public.purchase_items pi
    where pi.purchase_order_id = p_order_id
  loop
    select mi.category
    into v_category
    from public.menu_items mi
    where mi.id = v_pi.item_id;

    if coalesce(v_category,'') = 'food' then
      raise exception 'expiryDate is required for food item % (use partial receiving)', v_pi.item_id;
    end if;

    v_batch_id := gen_random_uuid();

    insert into public.stock_management(item_id, warehouse_id, available_quantity, reserved_quantity, unit, low_stock_threshold, last_updated, data)
    select v_pi.item_id, v_wh, 0, 0, coalesce(mi.unit_type, 'piece'), 5, now(), '{}'::jsonb
    from public.menu_items mi
    where mi.id = v_pi.item_id
    on conflict (item_id, warehouse_id) do nothing;

    select coalesce(sm.available_quantity, 0), coalesce(sm.avg_cost, 0)
    into v_old_qty, v_old_avg
    from public.stock_management sm
    where sm.item_id::text = v_pi.item_id::text
      and sm.warehouse_id = v_wh
    for update;

    select (v_pi.unit_cost + coalesce(mi.transport_cost, 0) + coalesce(mi.supply_tax_cost, 0))
    into v_effective_unit_cost
    from public.menu_items mi
    where mi.id = v_pi.item_id;

    v_new_qty := v_old_qty + v_pi.quantity;
    if v_new_qty <= 0 then
      v_new_avg := v_effective_unit_cost;
    else
      v_new_avg := ((v_old_qty * v_old_avg) + (v_pi.quantity * v_effective_unit_cost)) / v_new_qty;
    end if;

    update public.stock_management
    set available_quantity = available_quantity + v_pi.quantity,
        avg_cost = v_new_avg,
        last_updated = now(),
        updated_at = now()
    where item_id::text = v_pi.item_id::text
      and warehouse_id = v_wh;

    insert into public.batch_balances(item_id, batch_id, warehouse_id, quantity, expiry_date)
    values (v_pi.item_id::text, v_batch_id, v_wh, v_pi.quantity, null)
    on conflict (item_id, batch_id, warehouse_id)
    do update set
      quantity = public.batch_balances.quantity + excluded.quantity,
      updated_at = now();

    update public.menu_items
    set buying_price = v_pi.unit_cost,
        cost_price = v_new_avg,
        updated_at = now()
    where id = v_pi.item_id;

    insert into public.inventory_movements(
      item_id, movement_type, quantity, unit_cost, total_cost,
      reference_table, reference_id, occurred_at, created_by, data, batch_id, warehouse_id
    )
    values (
      v_pi.item_id, 'purchase_in', v_pi.quantity, v_effective_unit_cost, (v_pi.quantity * v_effective_unit_cost),
      'purchase_orders', p_order_id::text, now(), auth.uid(), jsonb_build_object('purchaseOrderId', p_order_id, 'batchId', v_batch_id, 'warehouseId', v_wh),
      v_batch_id, v_wh
    )
    returning id into v_movement_id;

    perform public.post_inventory_movement(v_movement_id);
  end loop;

  update public.purchase_orders
  set status = 'completed',
      updated_at = now()
  where id = p_order_id;
end;
$$;

revoke all on function public.receive_purchase_order(uuid) from public;
grant execute on function public.receive_purchase_order(uuid) to authenticated;

-- ==========================================
-- Patch manage_menu_item_stock to maintain batch balances (default MAIN warehouse)
-- - Removes reliance on last_batch_id for adjustments
-- ==========================================

create or replace function public.manage_menu_item_stock(
  p_item_id uuid,
  p_quantity numeric,
  p_unit text,
  p_reason text,
  p_user_id uuid default auth.uid(),
  p_low_stock_threshold numeric default 5,
  p_is_wastage boolean default false,
  p_batch_id uuid default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_wh uuid;
  v_current record;
  v_old_qty numeric;
  v_old_avg numeric;
  v_diff numeric;
  v_batch record;
  v_reserved_other numeric;
  v_available numeric;
  v_needed numeric;
  v_alloc numeric;
  v_unit_cost numeric;
  v_total_cost numeric;
  v_movement_id uuid;
  v_history_id uuid;
  v_movement_type text;
  v_new_batch_id uuid;
begin
  if p_reason is null or btrim(p_reason) = '' then
    raise exception 'reason is required';
  end if;
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;
  if not public.has_admin_permission('stock.manage') then
    raise exception 'not allowed';
  end if;

  if p_item_id is null then
    raise exception 'item_id is required';
  end if;
  if p_quantity is null or p_quantity < 0 then
    raise exception 'invalid quantity';
  end if;

  v_wh := public._resolve_default_warehouse_id();
  if v_wh is null then
    raise exception 'warehouse_id is required';
  end if;

  insert into public.stock_management(item_id, warehouse_id, available_quantity, reserved_quantity, unit, low_stock_threshold, avg_cost, last_updated, updated_at, data)
  select p_item_id::text, v_wh, 0, 0, coalesce(p_unit, 'piece'), coalesce(p_low_stock_threshold, 5), 0, now(), now(), '{}'::jsonb
  on conflict (item_id, warehouse_id) do nothing;

  select coalesce(sm.available_quantity, 0), coalesce(sm.avg_cost, 0)
  into v_old_qty, v_old_avg
  from public.stock_management sm
  where sm.item_id::text = p_item_id::text
    and sm.warehouse_id = v_wh
  for update;

  v_diff := p_quantity - v_old_qty;

  if v_diff = 0 then
    update public.stock_management
    set unit = coalesce(p_unit, unit),
        low_stock_threshold = coalesce(p_low_stock_threshold, low_stock_threshold),
        updated_at = now(),
        last_updated = now()
    where item_id::text = p_item_id::text
      and warehouse_id = v_wh;
    return;
  end if;

  if v_diff > 0 then
    v_movement_type := 'adjust_in';
    v_new_batch_id := coalesce(p_batch_id, gen_random_uuid());

    insert into public.batch_balances(item_id, batch_id, warehouse_id, quantity, expiry_date)
    values (p_item_id::text, v_new_batch_id, v_wh, v_diff, null)
    on conflict (item_id, batch_id, warehouse_id)
    do update set
      quantity = public.batch_balances.quantity + excluded.quantity,
      updated_at = now();

    v_unit_cost := v_old_avg;
    v_total_cost := v_diff * v_unit_cost;

    insert into public.inventory_movements(
      item_id, movement_type, quantity, unit_cost, total_cost,
      reference_table, reference_id, occurred_at, created_by, data, batch_id, warehouse_id
    )
    values (
      p_item_id::text, v_movement_type, v_diff, v_unit_cost, v_total_cost,
      'stock_history', null, now(), p_user_id,
      jsonb_build_object('reason', p_reason, 'warehouseId', v_wh, 'batchId', v_new_batch_id),
      v_new_batch_id, v_wh
    )
    returning id into v_movement_id;
    perform public.post_inventory_movement(v_movement_id);
  else
    v_movement_type := case when p_is_wastage then 'wastage_out' else 'adjust_out' end;
    v_needed := abs(v_diff);

    for v_batch in
      select bb.batch_id, bb.quantity, bb.expiry_date
      from public.batch_balances bb
      where bb.item_id = p_item_id::text
        and bb.warehouse_id = v_wh
        and bb.quantity > 0
        and (p_batch_id is null or bb.batch_id = p_batch_id)
      order by bb.expiry_date asc nulls last, bb.batch_id asc
    loop
      exit when v_needed <= 0;

      select coalesce(sum(br.quantity), 0)
      into v_reserved_other
      from public.batch_reservations br
      where br.item_id = p_item_id::text
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

      update public.batch_balances
      set quantity = quantity - v_alloc,
          updated_at = now()
      where item_id = p_item_id::text
        and batch_id = v_batch.batch_id
        and warehouse_id = v_wh;

      select im.unit_cost
      into v_unit_cost
      from public.inventory_movements im
      where im.batch_id = v_batch.batch_id
        and im.item_id::text = p_item_id::text
        and im.movement_type = 'purchase_in'
      order by im.occurred_at asc
      limit 1;
      v_unit_cost := coalesce(v_unit_cost, v_old_avg);
      v_total_cost := v_alloc * v_unit_cost;

      insert into public.inventory_movements(
        item_id, movement_type, quantity, unit_cost, total_cost,
        reference_table, reference_id, occurred_at, created_by, data, batch_id, warehouse_id
      )
      values (
        p_item_id::text, v_movement_type, v_alloc, v_unit_cost, v_total_cost,
        'stock_history', null, now(), p_user_id,
        jsonb_build_object('reason', p_reason, 'warehouseId', v_wh, 'batchId', v_batch.batch_id, 'expiryDate', v_batch.expiry_date),
        v_batch.batch_id, v_wh
      )
      returning id into v_movement_id;

      perform public.post_inventory_movement(v_movement_id);

      v_needed := v_needed - v_alloc;
    end loop;

    if v_needed > 0 then
      raise exception 'insufficient unreserved stock for adjustment';
    end if;
  end if;

  v_history_id := gen_random_uuid();
  insert into public.stock_history(id, item_id, date, data)
  values (v_history_id, p_item_id::text, now()::date, jsonb_build_object('reason', p_reason, 'changedBy', p_user_id, 'fromQuantity', v_old_qty, 'toQuantity', p_quantity));

  update public.stock_management
  set available_quantity = coalesce((
        select sum(bb.quantity)
        from public.batch_balances bb
        where bb.item_id = p_item_id::text
          and bb.warehouse_id = v_wh
      ), 0),
      reserved_quantity = coalesce((
        select sum(br.quantity)
        from public.batch_reservations br
        where br.item_id = p_item_id::text
          and br.warehouse_id = v_wh
      ), 0),
      unit = coalesce(p_unit, unit),
      low_stock_threshold = coalesce(p_low_stock_threshold, low_stock_threshold),
      avg_cost = v_old_avg,
      last_updated = now(),
      updated_at = now()
  where item_id::text = p_item_id::text
    and warehouse_id = v_wh;

  update public.menu_items
  set data = jsonb_set(data, '{availableStock}', to_jsonb(p_quantity), true),
      updated_at = now()
  where id = p_item_id::text;

  insert into public.system_audit_logs(action, module, details, performed_by, performed_at, metadata)
  values (
    case when p_is_wastage then 'wastage_recorded' else 'stock_update' end,
    'stock',
    p_reason,
    p_user_id,
    now(),
    jsonb_build_object('itemId', p_item_id::text, 'warehouseId', v_wh, 'fromQuantity', v_old_qty, 'toQuantity', p_quantity, 'delta', v_diff)
  );
end;
$$;

revoke all on function public.manage_menu_item_stock(uuid, numeric, text, text, uuid, numeric, boolean, uuid) from public;
grant execute on function public.manage_menu_item_stock(uuid, numeric, text, text, uuid, numeric, boolean, uuid) to authenticated;
