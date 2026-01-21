create or replace function public.purge_purchase_order(p_order_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_is_owner boolean;
  v_has_receipts boolean;
  v_has_payments boolean;
  v_has_movements boolean;
begin
  if p_order_id is null then
    raise exception 'p_order_id is required';
  end if;

  select exists(
    select 1
    from public.admin_users au
    where au.auth_user_id = auth.uid()
      and au.is_active = true
      and au.role = 'owner'
  ) into v_is_owner;

  if not coalesce(v_is_owner, false) then
    raise exception 'not allowed';
  end if;

  select exists(select 1 from public.purchase_receipts pr where pr.purchase_order_id = p_order_id)
  into v_has_receipts;

  select exists(
    select 1
    from public.payments p
    where p.reference_table = 'purchase_orders'
      and p.reference_id::text = p_order_id::text
  ) into v_has_payments;

  select exists(
    select 1
    from public.inventory_movements im
    where (im.reference_table = 'purchase_orders' and im.reference_id::text = p_order_id::text)
       or (im.data ? 'purchaseOrderId' and im.data->>'purchaseOrderId' = p_order_id::text)
  ) into v_has_movements;

  if coalesce(v_has_receipts, false) or coalesce(v_has_payments, false) or coalesce(v_has_movements, false) then
    raise exception 'cannot purge posted purchase order';
  end if;

  insert into public.system_audit_logs(action, module, details, performed_by, performed_at, metadata)
  values (
    'purge',
    'purchases',
    concat('Purged purchase order ', p_order_id::text),
    auth.uid(),
    now(),
    jsonb_build_object('purchaseOrderId', p_order_id::text)
  );

  delete from public.purchase_orders po
  where po.id = p_order_id;
end;
$$;
revoke all on function public.purge_purchase_order(uuid) from public;
grant execute on function public.purge_purchase_order(uuid) to anon, authenticated;
create or replace function public.cancel_purchase_order(
  p_order_id uuid,
  p_reason text default null,
  p_occurred_at timestamptz default now()
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_allowed boolean;
  v_has_receipts boolean;
  v_has_payments boolean;
  v_po record;
begin
  if p_order_id is null then
    raise exception 'p_order_id is required';
  end if;

  select exists(
    select 1
    from public.admin_users au
    where au.auth_user_id = auth.uid()
      and au.is_active = true
      and au.role in ('owner','manager')
  ) into v_allowed;

  if not coalesce(v_allowed, false) then
    raise exception 'not allowed';
  end if;

  select *
  into v_po
  from public.purchase_orders po
  where po.id = p_order_id
  for update;

  if not found then
    raise exception 'purchase order not found';
  end if;

  if v_po.status = 'cancelled' then
    return;
  end if;

  select exists(select 1 from public.purchase_receipts pr where pr.purchase_order_id = p_order_id)
  into v_has_receipts;

  select exists(
    select 1
    from public.payments p
    where p.reference_table = 'purchase_orders'
      and p.reference_id::text = p_order_id::text
  ) into v_has_payments;

  if coalesce(v_has_receipts, false) then
    raise exception 'cannot cancel received purchase order';
  end if;

  if coalesce(v_has_payments, false) or coalesce(v_po.paid_amount, 0) > 0 then
    raise exception 'cannot cancel paid purchase order';
  end if;

  update public.purchase_orders
  set status = 'cancelled',
      notes = case
        when nullif(trim(coalesce(p_reason, '')), '') is null then notes
        when nullif(trim(coalesce(notes, '')), '') is null then concat('[cancel] ', trim(p_reason))
        else concat(notes, E'\n', '[cancel] ', trim(p_reason))
      end,
      updated_at = now()
  where id = p_order_id;

  insert into public.system_audit_logs(action, module, details, performed_by, performed_at, metadata)
  values (
    'cancel',
    'purchases',
    concat('Cancelled purchase order ', p_order_id::text),
    auth.uid(),
    coalesce(p_occurred_at, now()),
    jsonb_build_object('purchaseOrderId', p_order_id::text, 'reason', nullif(trim(coalesce(p_reason, '')), ''))
  );
end;
$$;
revoke all on function public.cancel_purchase_order(uuid, text, timestamptz) from public;
grant execute on function public.cancel_purchase_order(uuid, text, timestamptz) to anon, authenticated;
create or replace function public.create_purchase_return(
  p_order_id uuid,
  p_items jsonb,
  p_reason text default null,
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
  v_total_cost numeric;
  v_return_total numeric := 0;
  v_new_total numeric;
  v_return_id uuid;
  v_movement_id uuid;
  v_stock_item_id_is_uuid boolean;
  v_return_items_item_id_is_uuid boolean;
  v_inventory_movements_item_id_is_uuid boolean;
  v_inventory_movements_reference_id_is_uuid boolean;
  v_received_qty numeric;
  v_prev_returned numeric;
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
  into v_return_items_item_id_is_uuid
  from pg_attribute a
  join pg_class c on a.attrelid = c.oid
  join pg_namespace n on c.relnamespace = n.oid
  join pg_type t on a.atttypid = t.oid
  where n.nspname = 'public'
    and c.relname = 'purchase_return_items'
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

  select (t.typname = 'uuid')
  into v_inventory_movements_reference_id_is_uuid
  from pg_attribute a
  join pg_class c on a.attrelid = c.oid
  join pg_namespace n on c.relnamespace = n.oid
  join pg_type t on a.atttypid = t.oid
  where n.nspname = 'public'
    and c.relname = 'inventory_movements'
    and a.attname = 'reference_id'
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
    raise exception 'cannot return for cancelled purchase order';
  end if;

  insert into public.purchase_returns(purchase_order_id, returned_at, created_by, reason)
  values (p_order_id, coalesce(p_occurred_at, now()), auth.uid(), p_reason)
  returning id into v_return_id;

  for v_item in select value from jsonb_array_elements(p_items)
  loop
    v_item_id_text := coalesce(v_item->>'itemId', v_item->>'id');
    v_qty := coalesce(nullif(v_item->>'quantity', '')::numeric, 0);

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

    select coalesce(pi.received_quantity, 0)
    into v_received_qty
    from public.purchase_items pi
    where pi.purchase_order_id = p_order_id
      and pi.item_id::text = v_item_id_text
    for update;

    if not found then
      raise exception 'item % not found in purchase order', v_item_id_text;
    end if;

    select coalesce(sum(pri.quantity), 0)
    into v_prev_returned
    from public.purchase_returns pr
    join public.purchase_return_items pri on pri.return_id = pr.id
    where pr.purchase_order_id = p_order_id
      and pri.item_id::text = v_item_id_text;

    if (coalesce(v_prev_returned, 0) + v_qty) > (coalesce(v_received_qty, 0) + 1e-9) then
      raise exception 'return exceeds received for item %', v_item_id_text;
    end if;

    select coalesce(sm.avg_cost, 0)
    into v_unit_cost
    from public.stock_management sm
    where sm.item_id::text = v_item_id_text
    for update;

    if not found then
      raise exception 'Stock record not found for item %', v_item_id_text;
    end if;

    v_total_cost := v_qty * v_unit_cost;
    v_return_total := v_return_total + v_total_cost;

    update public.stock_management
    set available_quantity = greatest(0, available_quantity - v_qty),
        last_updated = now(),
        updated_at = now()
    where item_id::text = v_item_id_text;

    if coalesce(v_return_items_item_id_is_uuid, false) then
      execute $q$
        insert into public.purchase_return_items(return_id, item_id, quantity, unit_cost, total_cost)
        values ($1, $2, $3, $4, $5)
      $q$
      using v_return_id, v_item_id_uuid, v_qty, v_unit_cost, v_total_cost;
    else
      execute $q$
        insert into public.purchase_return_items(return_id, item_id, quantity, unit_cost, total_cost)
        values ($1, $2, $3, $4, $5)
      $q$
      using v_return_id, v_item_id_text, v_qty, v_unit_cost, v_total_cost;
    end if;

    if coalesce(v_inventory_movements_item_id_is_uuid, false) then
      if coalesce(v_inventory_movements_reference_id_is_uuid, false) then
        execute $q$
          insert into public.inventory_movements(
            item_id, movement_type, quantity, unit_cost, total_cost,
            reference_table, reference_id, occurred_at, created_by, data
          )
          values (
            $1, 'return_out', $2, $3, $4,
            'purchase_returns', $5, coalesce($6, now()), auth.uid(),
            jsonb_build_object('purchaseOrderId', $7, 'purchaseReturnId', $5)
          )
          returning id
        $q$
        into v_movement_id
        using v_item_id_uuid, v_qty, v_unit_cost, v_total_cost, v_return_id, p_occurred_at, p_order_id;
      else
        execute $q$
          insert into public.inventory_movements(
            item_id, movement_type, quantity, unit_cost, total_cost,
            reference_table, reference_id, occurred_at, created_by, data
          )
          values (
            $1, 'return_out', $2, $3, $4,
            'purchase_returns', $5::text, coalesce($6, now()), auth.uid(),
            jsonb_build_object('purchaseOrderId', $7, 'purchaseReturnId', $5)
          )
          returning id
        $q$
        into v_movement_id
        using v_item_id_uuid, v_qty, v_unit_cost, v_total_cost, v_return_id, p_occurred_at, p_order_id;
      end if;
    else
      if coalesce(v_inventory_movements_reference_id_is_uuid, false) then
        execute $q$
          insert into public.inventory_movements(
            item_id, movement_type, quantity, unit_cost, total_cost,
            reference_table, reference_id, occurred_at, created_by, data
          )
          values (
            $1, 'return_out', $2, $3, $4,
            'purchase_returns', $5, coalesce($6, now()), auth.uid(),
            jsonb_build_object('purchaseOrderId', $7, 'purchaseReturnId', $5)
          )
          returning id
        $q$
        into v_movement_id
        using v_item_id_text, v_qty, v_unit_cost, v_total_cost, v_return_id, p_occurred_at, p_order_id;
      else
        execute $q$
          insert into public.inventory_movements(
            item_id, movement_type, quantity, unit_cost, total_cost,
            reference_table, reference_id, occurred_at, created_by, data
          )
          values (
            $1, 'return_out', $2, $3, $4,
            'purchase_returns', $5::text, coalesce($6, now()), auth.uid(),
            jsonb_build_object('purchaseOrderId', $7, 'purchaseReturnId', $5)
          )
          returning id
        $q$
        into v_movement_id
        using v_item_id_text, v_qty, v_unit_cost, v_total_cost, v_return_id, p_occurred_at, p_order_id;
      end if;
    end if;

    perform public.post_inventory_movement(v_movement_id);
  end loop;

  if coalesce(v_po.total_amount, 0) > 0 and v_return_total > 0 then
    v_new_total := greatest(0, coalesce(v_po.total_amount, 0) - v_return_total);
    update public.purchase_orders
    set total_amount = v_new_total,
        paid_amount = least(coalesce(paid_amount, 0), v_new_total),
        updated_at = now()
    where id = p_order_id;
  end if;

  insert into public.system_audit_logs(action, module, details, performed_by, performed_at, metadata)
  values (
    'return',
    'purchases',
    concat('Created purchase return ', v_return_id::text, ' for PO ', p_order_id::text),
    auth.uid(),
    coalesce(p_occurred_at, now()),
    jsonb_build_object('purchaseOrderId', p_order_id::text, 'purchaseReturnId', v_return_id::text, 'reason', nullif(trim(coalesce(p_reason, '')), ''))
  );

  return v_return_id;
end;
$$;
revoke all on function public.create_purchase_return(uuid, jsonb, text, timestamptz) from public;
grant execute on function public.create_purchase_return(uuid, jsonb, text, timestamptz) to anon, authenticated;
