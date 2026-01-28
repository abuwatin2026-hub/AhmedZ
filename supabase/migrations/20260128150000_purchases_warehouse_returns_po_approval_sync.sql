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
  v_po_unit_cost numeric;
  v_stock_available numeric;
  v_stock_reserved numeric;
  v_stock_avg_cost numeric;
  v_return_item_total numeric;
  v_return_total numeric := 0;
  v_new_total numeric;
  v_return_id uuid;
  v_movement_id uuid;
  v_stock_item_id_is_uuid boolean;
  v_return_items_item_id_is_uuid boolean;
  v_inventory_movements_item_id_is_uuid boolean;
  v_inventory_movements_reference_id_is_uuid boolean;
  v_has_sm_warehouse boolean := false;
  v_has_im_batch boolean := false;
  v_has_im_warehouse boolean := false;
  v_has_bb boolean := false;
  v_has_bb_warehouse boolean := false;
  v_wh uuid;
  v_received_qty numeric;
  v_prev_returned numeric;
  v_needed numeric;
  v_take numeric;
  v_batch record;
begin
  if not public.can_manage_stock() then
    raise exception 'not allowed';
  end if;
  if p_order_id is null then
    raise exception 'p_order_id is required';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    raise exception 'p_items must be a json array';
  end if;
  if not exists (
    select 1
    from jsonb_array_elements(p_items) e
    where coalesce(nullif(e.value->>'quantity', '')::numeric, 0) > 0
  ) then
    raise exception 'no return items';
  end if;
  v_has_sm_warehouse := exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'stock_management'
      and column_name = 'warehouse_id'
  );
  v_has_bb := to_regclass('public.batch_balances') is not null;
  if v_has_bb then
    v_has_bb_warehouse := exists (
      select 1
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'batch_balances'
        and column_name = 'warehouse_id'
    );
  end if;
  v_has_im_batch := exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'inventory_movements'
      and column_name = 'batch_id'
  );
  v_has_im_warehouse := exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'inventory_movements'
      and column_name = 'warehouse_id'
  );
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
  if v_has_sm_warehouse then
    v_wh := coalesce(v_po.warehouse_id, public._resolve_default_warehouse_id());
    if v_wh is null then
      raise exception 'warehouse_id is required';
    end if;
  else
    v_wh := null;
  end if;
  insert into public.purchase_returns(purchase_order_id, returned_at, created_by, reason)
  values (p_order_id, coalesce(p_occurred_at, now()), auth.uid(), nullif(trim(coalesce(p_reason, '')), ''))
  returning id into v_return_id;
  for v_item in select value from jsonb_array_elements(p_items)
  loop
    v_item_id_text := coalesce(v_item->>'itemId', v_item->>'id');
    v_qty := coalesce(nullif(v_item->>'quantity', '')::numeric, 0);
    if v_item_id_text is null or v_item_id_text = '' then
      raise exception 'Invalid itemId';
    end if;
    if v_qty <= 0 then
      continue;
    end if;
    if coalesce(v_stock_item_id_is_uuid, false)
      or coalesce(v_return_items_item_id_is_uuid, false)
      or coalesce(v_inventory_movements_item_id_is_uuid, false)
    then
      begin
        v_item_id_uuid := v_item_id_text::uuid;
      exception when others then
        raise exception 'Invalid itemId %', v_item_id_text;
      end;
    end if;
    select coalesce(pi.received_quantity, 0), coalesce(pi.unit_cost, 0)
    into v_received_qty, v_po_unit_cost
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
    if v_has_sm_warehouse then
      if coalesce(v_stock_item_id_is_uuid, false) then
        execute $q$
          insert into public.stock_management(item_id, warehouse_id, available_quantity, reserved_quantity, unit, low_stock_threshold, last_updated, data)
          select $1, $2, 0, 0, coalesce(mi.unit_type, 'piece'), 5, now(), '{}'::jsonb
          from public.menu_items mi
          where mi.id::text = $3
          on conflict (item_id, warehouse_id) do nothing
        $q$
        using v_item_id_uuid, v_wh, v_item_id_text;
      else
        execute $q$
          insert into public.stock_management(item_id, warehouse_id, available_quantity, reserved_quantity, unit, low_stock_threshold, last_updated, data)
          select $1, $2, 0, 0, coalesce(mi.unit_type, 'piece'), 5, now(), '{}'::jsonb
          from public.menu_items mi
          where mi.id::text = $3
          on conflict (item_id, warehouse_id) do nothing
        $q$
        using v_item_id_text, v_wh, v_item_id_text;
      end if;
      select
        coalesce(sm.available_quantity, 0),
        coalesce(sm.reserved_quantity, 0),
        coalesce(sm.avg_cost, 0)
      into v_stock_available, v_stock_reserved, v_stock_avg_cost
      from public.stock_management sm
      where sm.item_id::text = v_item_id_text
        and sm.warehouse_id = v_wh
      for update;
    else
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
      select
        coalesce(sm.available_quantity, 0),
        coalesce(sm.reserved_quantity, 0),
        coalesce(sm.avg_cost, 0)
      into v_stock_available, v_stock_reserved, v_stock_avg_cost
      from public.stock_management sm
      where sm.item_id::text = v_item_id_text
      for update;
    end if;
    if not found then
      raise exception 'Stock record not found for item %', v_item_id_text;
    end if;
    if (coalesce(v_stock_available, 0) - coalesce(v_stock_reserved, 0) + 1e-9) < v_qty then
      raise exception 'insufficient stock for return for item %', v_item_id_text;
    end if;
    if v_has_sm_warehouse then
      update public.stock_management
      set available_quantity = available_quantity - v_qty,
          last_updated = now(),
          updated_at = now()
      where item_id::text = v_item_id_text
        and warehouse_id = v_wh;
    else
      update public.stock_management
      set available_quantity = available_quantity - v_qty,
          last_updated = now(),
          updated_at = now()
      where item_id::text = v_item_id_text;
    end if;
    v_return_item_total := v_qty * coalesce(v_po_unit_cost, 0);
    v_return_total := v_return_total + v_return_item_total;
    if coalesce(v_return_items_item_id_is_uuid, false) then
      execute $q$
        insert into public.purchase_return_items(return_id, item_id, quantity, unit_cost, total_cost)
        values ($1, $2, $3, $4, $5)
      $q$
      using v_return_id, v_item_id_uuid, v_qty, v_po_unit_cost, v_return_item_total;
    else
      execute $q$
        insert into public.purchase_return_items(return_id, item_id, quantity, unit_cost, total_cost)
        values ($1, $2, $3, $4, $5)
      $q$
      using v_return_id, v_item_id_text, v_qty, v_po_unit_cost, v_return_item_total;
    end if;
    if coalesce(v_stock_avg_cost, 0) <= 0 then
      v_stock_avg_cost := coalesce(v_po_unit_cost, 0);
    end if;
    v_needed := v_qty;
    if v_has_bb and v_has_bb_warehouse and v_has_im_batch and v_has_im_warehouse then
      for v_batch in
        select bb.batch_id, coalesce(bb.quantity, 0) as qty, bb.expiry_date
        from public.batch_balances bb
        where bb.item_id::text = v_item_id_text
          and bb.warehouse_id = v_wh
          and coalesce(bb.quantity, 0) > 0
        order by (bb.expiry_date is null) asc, bb.expiry_date asc, bb.batch_id asc
        for update
      loop
        exit when v_needed <= 0;
        v_take := least(v_needed, coalesce(v_batch.qty, 0));
        if v_take <= 0 then
          continue;
        end if;
        update public.batch_balances
        set quantity = quantity - v_take,
            updated_at = now()
        where item_id::text = v_item_id_text
          and batch_id = v_batch.batch_id
          and warehouse_id = v_wh;
        if coalesce(v_inventory_movements_item_id_is_uuid, false) then
          if coalesce(v_inventory_movements_reference_id_is_uuid, false) then
            execute $q$
              insert into public.inventory_movements(
                item_id, movement_type, quantity, unit_cost, total_cost,
                reference_table, reference_id, occurred_at, created_by, data, batch_id, warehouse_id
              )
              values (
                $1, 'return_out', $2, $3, ($2 * $3),
                'purchase_returns', $4, coalesce($5, now()), auth.uid(),
                jsonb_build_object('purchaseOrderId', $6, 'purchaseReturnId', $4::text, 'warehouseId', $7::text, 'batchId', $8::text),
                $8, $7
              )
              returning id
            $q$
            into v_movement_id
            using v_item_id_uuid, v_take, v_stock_avg_cost, v_return_id, p_occurred_at, p_order_id, v_wh, v_batch.batch_id;
          else
            execute $q$
              insert into public.inventory_movements(
                item_id, movement_type, quantity, unit_cost, total_cost,
                reference_table, reference_id, occurred_at, created_by, data, batch_id, warehouse_id
              )
              values (
                $1, 'return_out', $2, $3, ($2 * $3),
                'purchase_returns', $4::text, coalesce($5, now()), auth.uid(),
                jsonb_build_object('purchaseOrderId', $6, 'purchaseReturnId', $4::text, 'warehouseId', $7::text, 'batchId', $8::text),
                $8, $7
              )
              returning id
            $q$
            into v_movement_id
            using v_item_id_uuid, v_take, v_stock_avg_cost, v_return_id, p_occurred_at, p_order_id, v_wh, v_batch.batch_id;
          end if;
        else
          if coalesce(v_inventory_movements_reference_id_is_uuid, false) then
            execute $q$
              insert into public.inventory_movements(
                item_id, movement_type, quantity, unit_cost, total_cost,
                reference_table, reference_id, occurred_at, created_by, data, batch_id, warehouse_id
              )
              values (
                $1, 'return_out', $2, $3, ($2 * $3),
                'purchase_returns', $4, coalesce($5, now()), auth.uid(),
                jsonb_build_object('purchaseOrderId', $6, 'purchaseReturnId', $4::text, 'warehouseId', $7::text, 'batchId', $8::text),
                $8, $7
              )
              returning id
            $q$
            into v_movement_id
            using v_item_id_text, v_take, v_stock_avg_cost, v_return_id, p_occurred_at, p_order_id, v_wh, v_batch.batch_id;
          else
            execute $q$
              insert into public.inventory_movements(
                item_id, movement_type, quantity, unit_cost, total_cost,
                reference_table, reference_id, occurred_at, created_by, data, batch_id, warehouse_id
              )
              values (
                $1, 'return_out', $2, $3, ($2 * $3),
                'purchase_returns', $4::text, coalesce($5, now()), auth.uid(),
                jsonb_build_object('purchaseOrderId', $6, 'purchaseReturnId', $4::text, 'warehouseId', $7::text, 'batchId', $8::text),
                $8, $7
              )
              returning id
            $q$
            into v_movement_id
            using v_item_id_text, v_take, v_stock_avg_cost, v_return_id, p_occurred_at, p_order_id, v_wh, v_batch.batch_id;
          end if;
        end if;
        perform public.post_inventory_movement(v_movement_id);
        v_needed := v_needed - v_take;
      end loop;
      if v_needed > 0.000000001 then
        raise exception 'insufficient batch stock for return for item %', v_item_id_text;
      end if;
    else
      if v_has_im_warehouse then
        if coalesce(v_inventory_movements_item_id_is_uuid, false) then
          if coalesce(v_inventory_movements_reference_id_is_uuid, false) then
            execute $q$
              insert into public.inventory_movements(
                item_id, movement_type, quantity, unit_cost, total_cost,
                reference_table, reference_id, occurred_at, created_by, data, warehouse_id
              )
              values (
                $1, 'return_out', $2, $3, ($2 * $3),
                'purchase_returns', $4, coalesce($5, now()), auth.uid(),
                jsonb_build_object('purchaseOrderId', $6, 'purchaseReturnId', $4::text, 'warehouseId', $7::text),
                $7
              )
              returning id
            $q$
            into v_movement_id
            using v_item_id_uuid, v_qty, v_stock_avg_cost, v_return_id, p_occurred_at, p_order_id, v_wh;
          else
            execute $q$
              insert into public.inventory_movements(
                item_id, movement_type, quantity, unit_cost, total_cost,
                reference_table, reference_id, occurred_at, created_by, data, warehouse_id
              )
              values (
                $1, 'return_out', $2, $3, ($2 * $3),
                'purchase_returns', $4::text, coalesce($5, now()), auth.uid(),
                jsonb_build_object('purchaseOrderId', $6, 'purchaseReturnId', $4::text, 'warehouseId', $7::text),
                $7
              )
              returning id
            $q$
            into v_movement_id
            using v_item_id_uuid, v_qty, v_stock_avg_cost, v_return_id, p_occurred_at, p_order_id, v_wh;
          end if;
        else
          if coalesce(v_inventory_movements_reference_id_is_uuid, false) then
            execute $q$
              insert into public.inventory_movements(
                item_id, movement_type, quantity, unit_cost, total_cost,
                reference_table, reference_id, occurred_at, created_by, data, warehouse_id
              )
              values (
                $1, 'return_out', $2, $3, ($2 * $3),
                'purchase_returns', $4, coalesce($5, now()), auth.uid(),
                jsonb_build_object('purchaseOrderId', $6, 'purchaseReturnId', $4::text, 'warehouseId', $7::text),
                $7
              )
              returning id
            $q$
            into v_movement_id
            using v_item_id_text, v_qty, v_stock_avg_cost, v_return_id, p_occurred_at, p_order_id, v_wh;
          else
            execute $q$
              insert into public.inventory_movements(
                item_id, movement_type, quantity, unit_cost, total_cost,
                reference_table, reference_id, occurred_at, created_by, data, warehouse_id
              )
              values (
                $1, 'return_out', $2, $3, ($2 * $3),
                'purchase_returns', $4::text, coalesce($5, now()), auth.uid(),
                jsonb_build_object('purchaseOrderId', $6, 'purchaseReturnId', $4::text, 'warehouseId', $7::text),
                $7
              )
              returning id
            $q$
            into v_movement_id
            using v_item_id_text, v_qty, v_stock_avg_cost, v_return_id, p_occurred_at, p_order_id, v_wh;
          end if;
        end if;
      else
        if coalesce(v_inventory_movements_item_id_is_uuid, false) then
          if coalesce(v_inventory_movements_reference_id_is_uuid, false) then
            execute $q$
              insert into public.inventory_movements(
                item_id, movement_type, quantity, unit_cost, total_cost,
                reference_table, reference_id, occurred_at, created_by, data
              )
              values (
                $1, 'return_out', $2, $3, ($2 * $3),
                'purchase_returns', $4, coalesce($5, now()), auth.uid(),
                jsonb_build_object('purchaseOrderId', $6, 'purchaseReturnId', $4::text)
              )
              returning id
            $q$
            into v_movement_id
            using v_item_id_uuid, v_qty, v_stock_avg_cost, v_return_id, p_occurred_at, p_order_id;
          else
            execute $q$
              insert into public.inventory_movements(
                item_id, movement_type, quantity, unit_cost, total_cost,
                reference_table, reference_id, occurred_at, created_by, data
              )
              values (
                $1, 'return_out', $2, $3, ($2 * $3),
                'purchase_returns', $4::text, coalesce($5, now()), auth.uid(),
                jsonb_build_object('purchaseOrderId', $6, 'purchaseReturnId', $4::text)
              )
              returning id
            $q$
            into v_movement_id
            using v_item_id_uuid, v_qty, v_stock_avg_cost, v_return_id, p_occurred_at, p_order_id;
          end if;
        else
          if coalesce(v_inventory_movements_reference_id_is_uuid, false) then
            execute $q$
              insert into public.inventory_movements(
                item_id, movement_type, quantity, unit_cost, total_cost,
                reference_table, reference_id, occurred_at, created_by, data
              )
              values (
                $1, 'return_out', $2, $3, ($2 * $3),
                'purchase_returns', $4, coalesce($5, now()), auth.uid(),
                jsonb_build_object('purchaseOrderId', $6, 'purchaseReturnId', $4::text)
              )
              returning id
            $q$
            into v_movement_id
            using v_item_id_text, v_qty, v_stock_avg_cost, v_return_id, p_occurred_at, p_order_id;
          else
            execute $q$
              insert into public.inventory_movements(
                item_id, movement_type, quantity, unit_cost, total_cost,
                reference_table, reference_id, occurred_at, created_by, data
              )
              values (
                $1, 'return_out', $2, $3, ($2 * $3),
                'purchase_returns', $4::text, coalesce($5, now()), auth.uid(),
                jsonb_build_object('purchaseOrderId', $6, 'purchaseReturnId', $4::text)
              )
              returning id
            $q$
            into v_movement_id
            using v_item_id_text, v_qty, v_stock_avg_cost, v_return_id, p_occurred_at, p_order_id;
          end if;
        end if;
      end if;
      perform public.post_inventory_movement(v_movement_id);
    end if;
  end loop;
  if coalesce(v_po.total_amount, 0) > 0 and v_return_total > 0 then
    v_new_total := greatest(0, coalesce(v_po.total_amount, 0) - v_return_total);
    update public.purchase_orders
    set total_amount = v_new_total,
        paid_amount = least(coalesce(purchase_orders.paid_amount, 0), v_new_total),
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

create or replace function public.trg_sync_po_approval_to_purchase_order()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_po_id uuid;
  v_all_received boolean := true;
  v_item record;
  v_total numeric;
begin
  if tg_op <> 'UPDATE' then
    return new;
  end if;
  if new.target_table <> 'purchase_orders'
     or new.request_type <> 'po'
     or new.status is not distinct from old.status then
    return new;
  end if;
  begin
    v_po_id := nullif(trim(coalesce(new.target_id, '')), '')::uuid;
  exception when others then
    return new;
  end;
  select coalesce(total_amount, 0)
  into v_total
  from public.purchase_orders
  where id = v_po_id;
  if not found then
    return new;
  end if;
  update public.purchase_orders
  set approval_status = new.status,
      approval_request_id = new.id,
      requires_approval = public.approval_required('po', v_total),
      updated_at = now()
  where id = v_po_id;
  if new.status <> 'approved' then
    return new;
  end if;
  for v_item in
    select coalesce(pi.quantity, 0) as ordered, coalesce(pi.received_quantity, 0) as received
    from public.purchase_items pi
    where pi.purchase_order_id = v_po_id
  loop
    if (coalesce(v_item.received, 0) + 1e-9) < coalesce(v_item.ordered, 0) then
      v_all_received := false;
      exit;
    end if;
  end loop;
  if v_all_received then
    update public.purchase_orders
    set status = 'completed',
        approval_status = 'approved',
        approval_request_id = new.id,
        requires_approval = public.approval_required('po', v_total),
        updated_at = now()
    where id = v_po_id
      and status = 'partial';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_sync_po_approval_to_purchase_order on public.approval_requests;
create trigger trg_sync_po_approval_to_purchase_order
after update on public.approval_requests
for each row execute function public.trg_sync_po_approval_to_purchase_order();

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
  v_receipt_req_id uuid;
  v_po_req_id uuid;
begin
  perform public._require_staff('receive_purchase_order_partial');
  if p_order_id is null then
    raise exception 'p_order_id is required';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    raise exception 'p_items must be a json array';
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
  v_wh := coalesce(v_po.warehouse_id, public._resolve_default_warehouse_id());
  if v_wh is null then
    raise exception 'warehouse_id is required';
  end if;
  select ar.id
  into v_receipt_req_id
  from public.approval_requests ar
  where ar.target_table = 'purchase_orders'
    and ar.target_id = p_order_id::text
    and ar.request_type = 'receipt'
    and ar.status = 'approved'
  order by ar.created_at desc
  limit 1;
  if public.approval_required('receipt', coalesce(v_po.total_amount, 0)) and v_receipt_req_id is null then
    raise exception 'purchase receipt requires approval';
  end if;
  insert into public.purchase_receipts(purchase_order_id, received_at, created_by, approval_status, approval_request_id, requires_approval)
  values (
    p_order_id,
    coalesce(p_occurred_at, now()),
    auth.uid(),
    case when v_receipt_req_id is null then 'pending' else 'approved' end,
    v_receipt_req_id,
    public.approval_required('receipt', coalesce(v_po.total_amount, 0))
  )
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
  select ar.id
  into v_po_req_id
  from public.approval_requests ar
  where ar.target_table = 'purchase_orders'
    and ar.target_id = p_order_id::text
    and ar.request_type = 'po'
    and ar.status = 'approved'
  order by ar.created_at desc
  limit 1;
  if v_all_received then
    if v_po_req_id is not null or not public.approval_required('po', coalesce(v_po.total_amount, 0)) then
      update public.purchase_orders
      set status = 'completed',
          updated_at = now(),
          approval_status = case when v_po_req_id is not null then 'approved' else approval_status end,
          approval_request_id = coalesce(approval_request_id, v_po_req_id)
      where id = p_order_id;
    else
      update public.purchase_orders
      set status = 'partial',
          updated_at = now()
      where id = p_order_id;
    end if;
  else
    update public.purchase_orders
    set status = 'partial',
        updated_at = now()
    where id = p_order_id;
  end if;
  return v_receipt_id;
end;
$$;

revoke all on function public.receive_purchase_order_partial(uuid, jsonb, timestamptz) from public;
grant execute on function public.receive_purchase_order_partial(uuid, jsonb, timestamptz) to authenticated;
