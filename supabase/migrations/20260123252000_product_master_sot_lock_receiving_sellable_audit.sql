alter table public.menu_items
  add column if not exists name jsonb,
  add column if not exists barcode text,
  add column if not exists price numeric,
  add column if not exists base_unit text,
  add column if not exists is_food boolean,
  add column if not exists expiry_required boolean,
  add column if not exists sellable boolean;

update public.menu_items mi
set
  name = coalesce(
    mi.name,
    case
      when jsonb_typeof(mi.data->'name') = 'object' then mi.data->'name'
      when nullif(btrim(mi.data->>'name'), '') is not null then jsonb_build_object('ar', btrim(mi.data->>'name'), 'en', null)
      else jsonb_build_object('ar', mi.id, 'en', null)
    end
  ),
  barcode = coalesce(
    nullif(btrim(mi.barcode), ''),
    nullif(btrim(mi.data->>'barcode'), '')
  ),
  price = coalesce(
    mi.price,
    case
      when jsonb_typeof(mi.data->'price') = 'number' then (mi.data->>'price')::numeric
      when (mi.data->>'price') ~ '^-?[0-9]+(\.[0-9]+)?$' then (mi.data->>'price')::numeric
      else null
    end,
    0
  ),
  base_unit = coalesce(
    nullif(btrim(mi.base_unit), ''),
    nullif(btrim(mi.unit_type), ''),
    nullif(btrim(mi.data->>'unitType'), ''),
    nullif(btrim(mi.data->>'unit_type'), ''),
    'piece'
  ),
  is_food = coalesce(
    mi.is_food,
    case
      when lower(coalesce(mi.data->>'is_food', mi.data->>'isFood', '')) in ('true','t','1','yes','y') then true
      when lower(coalesce(mi.data->>'is_food', mi.data->>'isFood', '')) in ('false','f','0','no','n') then false
      when lower(coalesce(mi.category, mi.data->>'category', '')) = 'food' then true
      else false
    end
  ),
  expiry_required = coalesce(
    mi.expiry_required,
    case
      when lower(coalesce(mi.data->>'expiry_required', mi.data->>'expiryRequired', '')) in ('true','t','1','yes','y') then true
      when lower(coalesce(mi.data->>'expiry_required', mi.data->>'expiryRequired', '')) in ('false','f','0','no','n') then false
      when lower(coalesce(mi.category, mi.data->>'category', '')) = 'food' then true
      else false
    end
  ),
  sellable = coalesce(
    mi.sellable,
    case
      when lower(coalesce(mi.data->>'sellable', '')) in ('true','t','1','yes','y') then true
      when lower(coalesce(mi.data->>'sellable', '')) in ('false','f','0','no','n') then false
      else true
    end
  );

update public.menu_items
set is_food = true
where expiry_required = true
  and coalesce(is_food, false) = false;

update public.menu_items
set barcode = null
where barcode is not null
  and btrim(barcode) = '';

alter table public.menu_items
  alter column price set default 0,
  alter column price set not null,
  alter column base_unit set default 'piece',
  alter column base_unit set not null,
  alter column is_food set default false,
  alter column is_food set not null,
  alter column expiry_required set default false,
  alter column expiry_required set not null,
  alter column sellable set default true,
  alter column sellable set not null,
  alter column name set not null;

alter table public.menu_items
  drop constraint if exists menu_items_price_non_negative_check;
alter table public.menu_items
  add constraint menu_items_price_non_negative_check
  check (price >= 0);

alter table public.menu_items
  drop constraint if exists menu_items_name_required_check;
alter table public.menu_items
  add constraint menu_items_name_required_check
  check (jsonb_typeof(name) = 'object' and btrim(coalesce(name->>'ar','')) <> '');

alter table public.menu_items
  drop constraint if exists menu_items_expiry_requires_food_check;
alter table public.menu_items
  add constraint menu_items_expiry_requires_food_check
  check (expiry_required = false or is_food = true);

create unique index if not exists menu_items_active_barcode_uniq
on public.menu_items (lower(btrim(barcode)))
where status = 'active'
  and barcode is not null
  and btrim(barcode) <> '';

drop trigger if exists trg_menu_items_harden_definition on public.menu_items;
drop function if exists public.trg_menu_items_harden_definition();

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

  if tg_op = 'INSERT' or new.name is not distinct from old.name then
    if v_name is not null and btrim(coalesce(v_name->>'ar','')) <> '' then
      new.name := v_name;
    end if;
  end if;

  if tg_op = 'INSERT' or new.barcode is not distinct from old.barcode then
    if v_barcode is not null then
      new.barcode := v_barcode;
    end if;
  end if;

  if tg_op = 'INSERT' or new.base_unit is not distinct from old.base_unit then
    if v_unit is not null then
      new.base_unit := v_unit;
    elsif nullif(btrim(coalesce(new.unit_type,'')), '') is not null then
      new.base_unit := new.unit_type;
    end if;
  end if;

  if tg_op = 'INSERT' or new.price is not distinct from old.price then
    if v_price is not null then
      new.price := v_price;
    end if;
  end if;

  if tg_op = 'INSERT' or new.sellable is not distinct from old.sellable then
    if v_sellable is not null then
      new.sellable := v_sellable;
    end if;
  end if;

  if tg_op = 'INSERT' or new.is_food is not distinct from old.is_food then
    if lower(coalesce(new.category, new.data->>'category','')) = 'food' then
      new.is_food := true;
    end if;
  end if;

  if tg_op = 'INSERT' or new.expiry_required is not distinct from old.expiry_required then
    if lower(coalesce(new.data->>'expiry_required', new.data->>'expiryRequired','')) in ('true','t','1','yes','y') then
      new.expiry_required := true;
    elsif lower(coalesce(new.category, new.data->>'category','')) = 'food' then
      new.expiry_required := true;
    end if;
  end if;

  if new.name is null or jsonb_typeof(new.name) <> 'object' or btrim(coalesce(new.name->>'ar','')) = '' then
    raise exception 'name.ar is required';
  end if;
  if new.price is null or new.price < 0 then
    raise exception 'price must be >= 0';
  end if;
  if new.base_unit is null or btrim(new.base_unit) = '' then
    raise exception 'base_unit is required';
  end if;
  if new.expiry_required = true and new.is_food <> true then
    raise exception 'expiry_required=true requires is_food=true';
  end if;

  new.barcode := nullif(btrim(coalesce(new.barcode,'')), '');

  new.unit_type := new.base_unit;

  new.data := jsonb_set(new.data, '{name}', new.name, true);
  new.data := jsonb_set(new.data, '{barcode}', to_jsonb(new.barcode), true);
  new.data := jsonb_set(new.data, '{price}', to_jsonb(new.price), true);
  new.data := jsonb_set(new.data, '{unitType}', to_jsonb(new.base_unit), true);
  new.data := jsonb_set(new.data, '{status}', to_jsonb(new.status), true);
  new.data := jsonb_set(new.data, '{sellable}', to_jsonb(new.sellable), true);

  return new;
end;
$$;

drop trigger if exists trg_menu_items_sot_sync_validate on public.menu_items;
create trigger trg_menu_items_sot_sync_validate
before insert or update on public.menu_items
for each row execute function public.trg_menu_items_sot_sync_validate();

create or replace function public.trg_menu_items_lock_after_first_movement()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
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

drop trigger if exists trg_menu_items_lock_after_first_movement on public.menu_items;
create trigger trg_menu_items_lock_after_first_movement
before update on public.menu_items
for each row execute function public.trg_menu_items_lock_after_first_movement();

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

    -- Ensure batch row exists to satisfy FK fk_inventory_movements_batch
    insert into public.batches(
      id,
      item_id,
      receipt_item_id,
      receipt_id,
      warehouse_id,
      batch_code,
      production_date,
      expiry_date,
      quantity_received,
      quantity_consumed,
      unit_cost,
      data
    )
    values (
      v_batch_id,
      v_item_id,
      null,
      v_receipt_id,
      v_wh,
      null,
      case when v_harvest_iso is null then null else v_harvest_iso::date end,
      case when v_expiry_iso is null then null else v_expiry_iso::date end,
      v_qty,
      0,
      v_effective_unit_cost,
      jsonb_build_object('source','purchase_receipts','purchaseReceiptId', v_receipt_id, 'purchaseOrderId', p_order_id)
    )
    on conflict (id) do nothing;

    insert into public.batch_balances(item_id, batch_id, warehouse_id, quantity, expiry_date)
    values (v_item_id, v_batch_id, v_wh, v_qty, case when v_expiry_iso is null then null else v_expiry_iso::date end)
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

create or replace view public.v_sellable_products as
with stock as (
  select sm.item_id::text as item_id,
         sum(coalesce(sm.available_quantity, 0)) as available_quantity
  from public.stock_management sm
  group by sm.item_id::text
),
valid_batches as (
  select bb.item_id::text as item_id,
         bool_or(coalesce(bb.quantity, 0) > 0 and (bb.expiry_date is null or bb.expiry_date > current_date)) as has_valid_batch
  from public.batch_balances bb
  group by bb.item_id::text
)
select
  mi.id,
  mi.name,
  mi.barcode,
  mi.price,
  mi.base_unit,
  mi.is_food,
  mi.expiry_required,
  mi.sellable,
  mi.status,
  coalesce(s.available_quantity, 0) as available_quantity,
  mi.category,
  mi.is_featured,
  mi.freshness_level,
  mi.data
from public.menu_items mi
left join stock s on s.item_id = mi.id
left join valid_batches vb on vb.item_id = mi.id
where mi.status = 'active'
  and mi.sellable = true
  and coalesce(s.available_quantity, 0) > 0
  and (mi.expiry_required = false or coalesce(vb.has_valid_batch, false) = true);

create table if not exists public.product_audit_log (
  id uuid primary key default gen_random_uuid(),
  item_id text not null,
  field text not null,
  old_value text,
  new_value text,
  updated_at timestamptz not null default now()
);

create index if not exists idx_product_audit_log_item_id on public.product_audit_log(item_id);
create index if not exists idx_product_audit_log_updated_at on public.product_audit_log(updated_at);

create or replace function public.trg_product_audit_log()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
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

drop trigger if exists trg_product_audit_log on public.menu_items;
create trigger trg_product_audit_log
after update on public.menu_items
for each row execute function public.trg_product_audit_log();

create or replace function public.get_item_price(
  p_item_id text,
  p_quantity numeric,
  p_customer_id uuid default null
)
returns numeric
language plpgsql
security definer
set search_path = public
as $$
declare
  v_customer_type text;
  v_special_price numeric;
  v_tier_price numeric;
  v_base_price numeric;
begin
  if p_customer_id is null then
    v_customer_type := 'retail';
  else
    if auth.uid() is null then
      v_customer_type := 'retail';
    elsif p_customer_id <> auth.uid() and not public.is_admin() then
      v_customer_type := 'retail';
    else
      select coalesce(customer_type, 'retail') into v_customer_type
      from public.customers
      where auth_user_id = p_customer_id;

      if not found then
        v_customer_type := 'retail';
      end if;

      select special_price into v_special_price
      from public.customer_special_prices
      where customer_id = p_customer_id
        and item_id = p_item_id
        and (valid_from is null or valid_from <= current_date)
        and (valid_to is null or valid_to >= current_date);

      if v_special_price is not null then
        return v_special_price;
      end if;
    end if;
  end if;

  select price into v_tier_price
  from public.price_tiers
  where item_id = p_item_id
    and customer_type = v_customer_type
    and min_quantity <= p_quantity
    and (max_quantity is null or max_quantity >= p_quantity)
    and is_active = true
    and (valid_from is null or valid_from <= current_date)
    and (valid_to is null or valid_to >= current_date)
  order by min_quantity desc
  limit 1;

  if v_tier_price is not null then
    return v_tier_price;
  end if;

  select mi.price into v_base_price
  from public.menu_items mi
  where mi.id = p_item_id;

  return coalesce(v_base_price, 0);
end;
$$;

create or replace function public.get_item_price_with_discount(
  p_item_id text,
  p_customer_id uuid default null,
  p_quantity numeric default 1
)
returns numeric
language plpgsql
security definer
set search_path = public
as $$
declare
  v_customer_type text := 'retail';
  v_special_price numeric;
  v_tier_price numeric;
  v_tier_discount numeric;
  v_base_unit_price numeric;
  v_final_unit_price numeric;
begin
  if p_item_id is null or btrim(p_item_id) = '' then
    raise exception 'p_item_id is required';
  end if;
  if p_quantity is null or p_quantity <= 0 then
    p_quantity := 1;
  end if;

  select mi.price
  into v_base_unit_price
  from public.menu_items mi
  where mi.id = p_item_id;

  if not found then
    raise exception 'Item not found: %', p_item_id;
  end if;

  if p_customer_id is not null then
    select coalesce(c.customer_type, 'retail')
    into v_customer_type
    from public.customers c
    where c.auth_user_id = p_customer_id;

    if not found then
      v_customer_type := 'retail';
    end if;

    select csp.special_price
    into v_special_price
    from public.customer_special_prices csp
    where csp.customer_id = p_customer_id
      and csp.item_id = p_item_id
      and csp.is_active = true
      and (csp.valid_from is null or csp.valid_from <= now())
      and (csp.valid_to is null or csp.valid_to >= now())
    order by csp.created_at desc
    limit 1;

    if v_special_price is not null then
      return v_special_price;
    end if;
  end if;

  select pt.price, pt.discount_percentage
  into v_tier_price, v_tier_discount
  from public.price_tiers pt
  where pt.item_id = p_item_id
    and pt.customer_type = v_customer_type
    and pt.is_active = true
    and pt.min_quantity <= p_quantity
    and (pt.max_quantity is null or pt.max_quantity >= p_quantity)
    and (pt.valid_from is null or pt.valid_from <= now())
    and (pt.valid_to is null or pt.valid_to >= now())
  order by pt.min_quantity desc
  limit 1;

  if v_tier_price is not null and v_tier_price > 0 then
    v_final_unit_price := v_tier_price;
  else
    v_final_unit_price := v_base_unit_price;
    if coalesce(v_tier_discount, 0) > 0 then
      v_final_unit_price := v_base_unit_price * (1 - (least(100, greatest(0, v_tier_discount)) / 100));
    end if;
  end if;

  return coalesce(v_final_unit_price, 0);
end;
$$;
