alter table public.stock_management
add column if not exists avg_cost numeric not null default 0;
create table if not exists public.inventory_movements (
  id uuid primary key default gen_random_uuid(),
  item_id text not null references public.menu_items(id) on delete cascade,
  movement_type text not null check (movement_type in ('purchase_in','sale_out','wastage_out','adjust_in','adjust_out','return_in','return_out')),
  quantity numeric not null check (quantity > 0),
  unit_cost numeric not null default 0,
  total_cost numeric not null default 0,
  reference_table text,
  reference_id text,
  occurred_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists idx_inventory_movements_item_date on public.inventory_movements(item_id, occurred_at desc);
create index if not exists idx_inventory_movements_ref on public.inventory_movements(reference_table, reference_id);
alter table public.inventory_movements enable row level security;
drop policy if exists inventory_movements_admin_only on public.inventory_movements;
create policy inventory_movements_admin_only
on public.inventory_movements
for all
using (public.is_admin())
with check (public.is_admin());
create table if not exists public.order_item_cogs (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  item_id text not null references public.menu_items(id) on delete cascade,
  quantity numeric not null check (quantity > 0),
  unit_cost numeric not null default 0,
  total_cost numeric not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists idx_order_item_cogs_order on public.order_item_cogs(order_id);
create index if not exists idx_order_item_cogs_item on public.order_item_cogs(item_id);
create index if not exists idx_order_item_cogs_created_at on public.order_item_cogs(created_at desc);
alter table public.order_item_cogs enable row level security;
drop policy if exists order_item_cogs_admin_only on public.order_item_cogs;
create policy order_item_cogs_admin_only
on public.order_item_cogs
for all
using (public.is_admin())
with check (public.is_admin());
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
begin
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
    insert into public.stock_management(item_id, available_quantity, reserved_quantity, unit, low_stock_threshold, last_updated, data)
    select v_pi.item_id, 0, 0, coalesce(mi.unit_type, 'piece'), 5, now(), '{}'::jsonb
    from public.menu_items mi
    where mi.id = v_pi.item_id
    on conflict (item_id) do nothing;

    select coalesce(sm.available_quantity, 0), coalesce(sm.avg_cost, 0)
    into v_old_qty, v_old_avg
    from public.stock_management sm
    where sm.item_id = v_pi.item_id
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
    where item_id = v_pi.item_id;

    update public.menu_items
    set buying_price = v_pi.unit_cost,
        cost_price = v_new_avg,
        updated_at = now()
    where id = v_pi.item_id;

    insert into public.inventory_movements(
      item_id, movement_type, quantity, unit_cost, total_cost,
      reference_table, reference_id, occurred_at, created_by, data
    )
    values (
      v_pi.item_id, 'purchase_in', v_pi.quantity, v_effective_unit_cost, (v_pi.quantity * v_effective_unit_cost),
      'purchase_orders', p_order_id::text, now(), auth.uid(), jsonb_build_object('purchaseOrderId', p_order_id)
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
grant execute on function public.receive_purchase_order(uuid) to anon, authenticated;
create or replace function public.deduct_stock_on_delivery_v2(p_order_id uuid, p_items jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item jsonb;
  v_item_id text;
  v_requested numeric;
  v_available numeric;
  v_reserved numeric;
  v_unit_cost numeric;
  v_total_cost numeric;
  v_movement_id uuid;
begin
  if p_order_id is null then
    raise exception 'p_order_id is required';
  end if;

  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    raise exception 'p_items must be a json array';
  end if;

  perform 1
  from public.orders o
  where o.id = p_order_id;

  if not found then
    raise exception 'order not found';
  end if;

  delete from public.order_item_cogs where order_id = p_order_id;

  for v_item in select value from jsonb_array_elements(p_items)
  loop
    v_item_id := coalesce(v_item->>'itemId', v_item->>'id');
    v_requested := coalesce(nullif(v_item->>'quantity', '')::numeric, 0);

    if v_item_id is null or v_item_id = '' then
      raise exception 'Invalid itemId';
    end if;

    if v_requested <= 0 then
      continue;
    end if;

    select
      coalesce(sm.available_quantity, 0),
      coalesce(sm.reserved_quantity, 0),
      coalesce(sm.avg_cost, 0)
    into v_available, v_reserved, v_unit_cost
    from public.stock_management sm
    where sm.item_id = v_item_id
    for update;

    if not found then
      raise exception 'Stock record not found for item %', v_item_id;
    end if;

    if (v_available + 1e-9) < v_requested then
      raise exception 'Insufficient stock for item % (available %, requested %)', v_item_id, v_available, v_requested;
    end if;

    update public.stock_management
    set available_quantity = greatest(0, available_quantity - v_requested),
        reserved_quantity = greatest(0, reserved_quantity - v_requested),
        last_updated = now(),
        updated_at = now()
    where item_id = v_item_id;

    v_total_cost := v_requested * v_unit_cost;

    insert into public.order_item_cogs(order_id, item_id, quantity, unit_cost, total_cost, created_at)
    values (p_order_id, v_item_id, v_requested, v_unit_cost, v_total_cost, now());

    insert into public.inventory_movements(
      item_id, movement_type, quantity, unit_cost, total_cost,
      reference_table, reference_id, occurred_at, created_by, data
    )
    values (
      v_item_id, 'sale_out', v_requested, v_unit_cost, v_total_cost,
      'orders', p_order_id::text, now(), auth.uid(), jsonb_build_object('orderId', p_order_id)
    )
    returning id into v_movement_id;

    perform public.post_inventory_movement(v_movement_id);
  end loop;
end;
$$;
revoke all on function public.deduct_stock_on_delivery_v2(uuid, jsonb) from public;
grant execute on function public.deduct_stock_on_delivery_v2(uuid, jsonb) to anon, authenticated;
