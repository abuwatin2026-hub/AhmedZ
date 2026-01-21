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
  v_item_id_text text;
  v_item_id_uuid uuid;
  v_qty numeric;
  v_unit_cost numeric;
  v_effective_unit_cost numeric;
  v_old_qty numeric;
  v_old_avg numeric;
  v_new_qty numeric;
  v_new_avg numeric;
  v_ordered numeric;
  v_received numeric;
  v_receipt_id uuid;
  v_receipt_total numeric := 0;
  v_movement_id uuid;
  v_all_received boolean := true;
  v_stock_item_id_is_uuid boolean;
  v_receipt_items_item_id_is_uuid boolean;
  v_inventory_movements_item_id_is_uuid boolean;
begin
  if not public.is_admin() then
    raise exception 'not allowed';
  end if;

  if p_order_id is null then
    raise exception 'p_order_id is required';
  end if;

  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    raise exception 'p_items must be a json array';
  end if;

  select (t.typname = 'uuid')
  into v_stock_item_id_is_uuid
  from pg_attribute a
  join pg_class c on a.attrelid = c.oid
  join pg_namespace n on c.relnamespace = n.oid
  join pg_type t on a.atttypid = t.oid
  where n.nspname = 'public'
    and c.relname = 'stock_management'
    and a.attname = 'item_id'
    and a.attnum > 0
    and not a.attisdropped;

  select (t.typname = 'uuid')
  into v_receipt_items_item_id_is_uuid
  from pg_attribute a
  join pg_class c on a.attrelid = c.oid
  join pg_namespace n on c.relnamespace = n.oid
  join pg_type t on a.atttypid = t.oid
  where n.nspname = 'public'
    and c.relname = 'purchase_receipt_items'
    and a.attname = 'item_id'
    and a.attnum > 0
    and not a.attisdropped;

  select (t.typname = 'uuid')
  into v_inventory_movements_item_id_is_uuid
  from pg_attribute a
  join pg_class c on a.attrelid = c.oid
  join pg_namespace n on c.relnamespace = n.oid
  join pg_type t on a.atttypid = t.oid
  where n.nspname = 'public'
    and c.relname = 'inventory_movements'
    and a.attname = 'item_id'
    and a.attnum > 0
    and not a.attisdropped;

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

  insert into public.purchase_receipts(purchase_order_id, received_at, created_by)
  values (p_order_id, coalesce(p_occurred_at, now()), auth.uid())
  returning id into v_receipt_id;

  for v_item in select value from jsonb_array_elements(p_items)
  loop
    v_item_id_text := coalesce(v_item->>'itemId', v_item->>'id');
    v_qty := coalesce(nullif(v_item->>'quantity', '')::numeric, 0);
    v_unit_cost := coalesce(nullif(v_item->>'unitCost', '')::numeric, 0);

    if v_item_id_text is null or v_item_id_text = '' then
      raise exception 'Invalid itemId';
    end if;

    begin
      v_item_id_uuid := v_item_id_text::uuid;
    exception when others then
      raise exception 'Invalid itemId %', v_item_id_text;
    end;

    if v_qty <= 0 then
      continue;
    end if;

    select coalesce(pi.quantity, 0), coalesce(pi.received_quantity, 0), coalesce(pi.unit_cost, 0)
    into v_ordered, v_received, v_unit_cost
    from public.purchase_items pi
    where pi.purchase_order_id = p_order_id
      and pi.item_id::text = v_item_id_text
    for update;

    if not found then
      raise exception 'item % not found in purchase order', v_item_id_text;
    end if;

    if (v_received + v_qty) > (v_ordered + 1e-9) then
      raise exception 'received exceeds ordered for item % (ordered %, received %, add %)', v_item_id_text, v_ordered, v_received, v_qty;
    end if;

    if coalesce(v_stock_item_id_is_uuid, false) then
      execute $q$
        insert into public.stock_management(item_id, available_quantity, reserved_quantity, unit, low_stock_threshold, last_updated, data)
        select $1, 0, 0, coalesce(mi.unit_type, 'piece'), 5, now(), '{}'::jsonb
        from public.menu_items mi
        where mi.id::text = $2
        on conflict (item_id) do nothing
      $q$
      using v_item_id_uuid, v_item_id_text;
    else
      execute $q$
        insert into public.stock_management(item_id, available_quantity, reserved_quantity, unit, low_stock_threshold, last_updated, data)
        select $1, 0, 0, coalesce(mi.unit_type, 'piece'), 5, now(), '{}'::jsonb
        from public.menu_items mi
        where mi.id::text = $2
        on conflict (item_id) do nothing
      $q$
      using v_item_id_text, v_item_id_text;
    end if;

    select coalesce(sm.available_quantity, 0), coalesce(sm.avg_cost, 0)
    into v_old_qty, v_old_avg
    from public.stock_management sm
    where sm.item_id::text = v_item_id_text
    for update;

    select (v_unit_cost + coalesce(mi.transport_cost, 0) + coalesce(mi.supply_tax_cost, 0))
    into v_effective_unit_cost
    from public.menu_items mi
    where mi.id::text = v_item_id_text;

    v_new_qty := v_old_qty + v_qty;
    if v_new_qty <= 0 then
      v_new_avg := v_effective_unit_cost;
    else
      v_new_avg := ((v_old_qty * v_old_avg) + (v_qty * v_effective_unit_cost)) / v_new_qty;
    end if;

    update public.stock_management
    set available_quantity = available_quantity + v_qty,
        avg_cost = v_new_avg,
        last_updated = now(),
        updated_at = now()
    where item_id::text = v_item_id_text;

    update public.menu_items
    set buying_price = v_unit_cost,
        cost_price = v_new_avg,
        updated_at = now()
    where id::text = v_item_id_text;

    update public.purchase_items
    set received_quantity = received_quantity + v_qty
    where purchase_order_id = p_order_id
      and item_id::text = v_item_id_text;

    if coalesce(v_receipt_items_item_id_is_uuid, false) then
      execute $q$
        insert into public.purchase_receipt_items(receipt_id, item_id, quantity, unit_cost, total_cost)
        values ($1, $2, $3, $4, ($3 * $4))
      $q$
      using v_receipt_id, v_item_id_uuid, v_qty, v_effective_unit_cost;
    else
      execute $q$
        insert into public.purchase_receipt_items(receipt_id, item_id, quantity, unit_cost, total_cost)
        values ($1, $2, $3, $4, ($3 * $4))
      $q$
      using v_receipt_id, v_item_id_text, v_qty, v_effective_unit_cost;
    end if;

    v_receipt_total := v_receipt_total + (v_qty * v_effective_unit_cost);

    if coalesce(v_inventory_movements_item_id_is_uuid, false) then
      execute $q$
        insert into public.inventory_movements(
          item_id, movement_type, quantity, unit_cost, total_cost,
          reference_table, reference_id, occurred_at, created_by, data
        )
        values (
          $1, 'purchase_in', $2, $3, ($2 * $3),
          'purchase_receipts', $4::text, coalesce($5, now()), auth.uid(),
          jsonb_build_object(
            'purchaseOrderId', $6,
            'purchaseReceiptId', $4,
            'supplier_tax_unit', coalesce((select mi.supply_tax_cost from public.menu_items mi where mi.id::text = $7), 0),
            'supplier_tax_total', coalesce((select mi.supply_tax_cost from public.menu_items mi where mi.id::text = $7), 0) * $2
          )
        )
        returning id
      $q$
      into v_movement_id
      using v_item_id_uuid, v_qty, v_effective_unit_cost, v_receipt_id, p_occurred_at, p_order_id, v_item_id_text;
    else
      execute $q$
        insert into public.inventory_movements(
          item_id, movement_type, quantity, unit_cost, total_cost,
          reference_table, reference_id, occurred_at, created_by, data
        )
        values (
          $1, 'purchase_in', $2, $3, ($2 * $3),
          'purchase_receipts', $4::text, coalesce($5, now()), auth.uid(),
          jsonb_build_object(
            'purchaseOrderId', $6,
            'purchaseReceiptId', $4,
            'supplier_tax_unit', coalesce((select mi.supply_tax_cost from public.menu_items mi where mi.id::text = $7), 0),
            'supplier_tax_total', coalesce((select mi.supply_tax_cost from public.menu_items mi where mi.id::text = $7), 0) * $2
          )
        )
        returning id
      $q$
      into v_movement_id
      using v_item_id_text, v_qty, v_effective_unit_cost, v_receipt_id, p_occurred_at, p_order_id, v_item_id_text;
    end if;

    perform public.post_inventory_movement(v_movement_id);
  end loop;

  for v_item_id_text, v_ordered, v_received in
    select pi.item_id::text, coalesce(pi.quantity, 0), coalesce(pi.received_quantity, 0)
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
