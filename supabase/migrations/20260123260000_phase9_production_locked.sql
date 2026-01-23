-- Phase 9: Production lock (no feature expansion)

-- 1) Tighten menu_items SELECT (clients must use v_sellable_products)
drop policy if exists menu_items_select_all on public.menu_items;
create policy menu_items_select_all
on public.menu_items
for select
using (public.is_staff());

-- 2) Sellable view must bypass underlying RLS (single sales source)
alter view public.v_sellable_products set (security_invoker = false);
grant select on public.v_sellable_products to anon, authenticated;

-- 3) Stop columns->data back-sync + enforce staff checks for SECURITY DEFINER triggers/functions
create or replace function public.trg_menu_items_sot_sync_validate()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name jsonb;
  v_barcode text;
  v_unit text;
  v_price_text text;
  v_price numeric;
  v_sellable boolean;
  v_bool_text text;
begin
  if auth.uid() is null then
    if current_user not in ('postgres','supabase_admin') then
      raise exception 'not authenticated';
    end if;
  else
    perform public._require_staff('menu_items_update');
  end if;

  if new.data is null then
    new.data := '{}'::jsonb;
  end if;
  if jsonb_typeof(new.data) <> 'object' then
    raise exception 'menu_items.data must be an object';
  end if;

  v_name := case when jsonb_typeof(new.data->'name') = 'object' then new.data->'name' else null end;
  v_barcode := nullif(btrim(coalesce(new.data->>'barcode','')), '');
  v_unit := nullif(btrim(coalesce(new.data->>'unitType', new.data->>'baseUnit', new.data->>'base_unit','')), '');
  v_price_text := nullif(btrim(coalesce(new.data->>'price','')), '');
  if v_price_text is not null and v_price_text ~ '^-?[0-9]+(\.[0-9]+)?$' then
    v_price := v_price_text::numeric;
  else
    v_price := null;
  end if;
  v_bool_text := lower(nullif(btrim(coalesce(new.data->>'sellable','')), ''));
  if v_bool_text in ('true','t','1','yes','y') then
    v_sellable := true;
  elsif v_bool_text in ('false','f','0','no','n') then
    v_sellable := false;
  else
    v_sellable := null;
  end if;

  if tg_op = 'INSERT' then
    if new.name is null and v_name is not null then
      new.name := v_name;
    end if;
    if new.barcode is null and v_barcode is not null then
      new.barcode := v_barcode;
    end if;
    if new.base_unit is null then
      if v_unit is not null then
        new.base_unit := v_unit;
      elsif nullif(btrim(coalesce(new.unit_type,'')), '') is not null then
        new.base_unit := new.unit_type;
      end if;
    end if;
    if new.price is null and v_price is not null then
      new.price := v_price;
    end if;
    if new.sellable is null and v_sellable is not null then
      new.sellable := v_sellable;
    end if;
    if new.is_food is null then
      new.is_food := (lower(coalesce(new.category, new.data->>'category','')) = 'food');
    end if;
    if new.expiry_required is null then
      if lower(coalesce(new.data->>'expiry_required', new.data->>'expiryRequired','')) in ('true','t','1','yes','y') then
        new.expiry_required := true;
      else
        new.expiry_required := (lower(coalesce(new.category, new.data->>'category','')) = 'food');
      end if;
    end if;
  end if;

  new.barcode := nullif(btrim(coalesce(new.barcode,'')), '');

  if new.name is null or jsonb_typeof(new.name) <> 'object' or btrim(coalesce(new.name->>'ar','')) = '' then
    raise exception 'name.ar is required';
  end if;
  if new.price is null or new.price < 0 then
    raise exception 'price must be >= 0';
  end if;
  if new.base_unit is null or btrim(new.base_unit) = '' then
    raise exception 'base_unit is required';
  end if;
  if new.sellable is null then
    new.sellable := true;
  end if;
  if new.is_food is null then
    new.is_food := false;
  end if;
  if new.expiry_required is null then
    new.expiry_required := false;
  end if;
  if new.expiry_required = true and new.is_food <> true then
    raise exception 'expiry_required=true requires is_food=true';
  end if;

  new.unit_type := new.base_unit;

  return new;
end;
$$;

create or replace function public.trg_menu_items_lock_after_first_movement()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    if current_user not in ('postgres','supabase_admin') then
      raise exception 'not authenticated';
    end if;
  else
    perform public._require_staff('menu_items_update');
  end if;

  if (new.base_unit is distinct from old.base_unit)
     or (new.is_food is distinct from old.is_food)
     or (new.expiry_required is distinct from old.expiry_required)
  then
    if exists (
      select 1
      from public.inventory_movements im
      where im.item_id::text = new.id
      limit 1
    ) then
      raise exception 'cannot modify base_unit/is_food/expiry_required after first stock movement';
    end if;
  end if;

  return new;
end;
$$;

create or replace function public.trg_product_audit_log()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    if current_user not in ('postgres','supabase_admin') then
      raise exception 'not authenticated';
    end if;
  else
    perform public._require_staff('audit_write');
  end if;

  if old.name is distinct from new.name then
    insert into public.product_audit_log(item_id, field, old_value, new_value, updated_at)
    values (new.id, 'name', old.name::text, new.name::text, now());
  end if;

  if old.barcode is distinct from new.barcode then
    insert into public.product_audit_log(item_id, field, old_value, new_value, updated_at)
    values (new.id, 'barcode', old.barcode, new.barcode, now());
  end if;

  if old.price is distinct from new.price then
    insert into public.product_audit_log(item_id, field, old_value, new_value, updated_at)
    values (new.id, 'price', old.price::text, new.price::text, now());
  end if;

  if old.sellable is distinct from new.sellable then
    insert into public.product_audit_log(item_id, field, old_value, new_value, updated_at)
    values (new.id, 'sellable', old.sellable::text, new.sellable::text, now());
  end if;

  if old.status is distinct from new.status then
    insert into public.product_audit_log(item_id, field, old_value, new_value, updated_at)
    values (new.id, 'status', old.status, new.status, now());
  end if;

  return new;
end;
$$;

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
  v_expiry_required boolean := false;
  v_batch_id uuid;
  v_movement_id uuid;
  v_wh uuid;
begin
  perform public._require_staff('inventory_receive');

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
    v_expiry_required := false;

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
    select v_item_id, v_wh, 0, 0, coalesce(mi.base_unit, mi.unit_type, 'piece'), 5, now(), '{}'::jsonb
    from public.menu_items mi
    where mi.id = v_item_id
    on conflict (item_id, warehouse_id) do nothing;

    select coalesce(sm.available_quantity, 0), coalesce(sm.avg_cost, 0)
    into v_old_qty, v_old_avg
    from public.stock_management sm
    where sm.item_id::text = v_item_id
      and sm.warehouse_id = v_wh
    for update;

    select (v_unit_cost + coalesce(mi.transport_cost, 0) + coalesce(mi.supply_tax_cost, 0)), coalesce(mi.expiry_required, false)
    into v_effective_unit_cost, v_expiry_required
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

    if v_expiry_required and v_expiry_iso is null then
      raise exception 'expiryDate is required for item %', v_item_id;
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
    values (v_item_id, v_batch_id, v_wh, v_qty, case when v_expiry_iso is null then null else v_expiry_iso::date end)
    on conflict (item_id, batch_id, warehouse_id)
    do update set
      quantity = public.batch_balances.quantity + excluded.quantity,
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

-- 4) Batch immutability (expiry is sacred)
create or replace function public.trg_batch_balances_expiry_immutable()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    if current_user not in ('postgres','supabase_admin') then
      raise exception 'not authenticated';
    end if;
  else
    perform public._require_staff('inventory_receive');
  end if;

  if old.expiry_date is distinct from new.expiry_date then
    raise exception 'expiry_date is immutable';
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
  if auth.uid() is null then
    if current_user not in ('postgres','supabase_admin') then
      raise exception 'not authenticated';
    end if;
  else
    perform public._require_stock_manager('batch_balances_sync');
  end if;

  if new.movement_type <> 'purchase_in' then
    return new;
  end if;
  if new.batch_id is null then
    raise exception 'purchase_in requires batch_id';
  end if;
  v_wh := new.warehouse_id;
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
    updated_at = now();

  return new;
end;
$$;

drop trigger if exists trg_inventory_movements_purchase_in_sync_batch_balances on public.inventory_movements;
create trigger trg_inventory_movements_purchase_in_sync_batch_balances
after insert
on public.inventory_movements
for each row
when (new.movement_type = 'purchase_in')
execute function public.trg_inventory_movements_purchase_in_sync_batch_balances();
