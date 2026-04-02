-- ============================================================
-- FIX: complete_warehouse_transfer
-- المشكلة: 
--   1. الـ fallback SELECT يقرأ من أي مستودع → يتجاوز فحص الرصيد
--   2. الـ fallback UPDATE يخصم من أي مستودع → يُخرب SM مستودع آخر
-- الحل:
--   1. إزالة الـ fallback غير الآمن
--   2. إذا لم يوجد سجل SM للصنف في المستودع المصدر → خطأ صريح
--   3. تصحيح stock_management لكل الأصناف من inventory_movements
-- ============================================================

-- Step 1: Fix the function
CREATE OR REPLACE FUNCTION public.complete_warehouse_transfer(p_transfer_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare
  v_item record;
  v_from_warehouse uuid;
  v_to_warehouse uuid;
  v_transfer_date date;
  v_shipping_cost numeric;
  v_total_transfer_qty numeric := 0;
  v_unit_shipping_cost numeric := 0;
  v_sm_from record;
  v_is_food boolean;
  v_reserved_batches jsonb;
  v_remaining numeric;
  v_batch record;
  v_batch_reserved numeric;
  v_free numeric;
  v_alloc numeric;
  v_unit_cost numeric;
  v_movement_out uuid;
  v_movement_in uuid;
begin
  perform public._require_stock_manager('complete_warehouse_transfer');

  select from_warehouse_id, to_warehouse_id, transfer_date, coalesce(shipping_cost, 0)
  into v_from_warehouse, v_to_warehouse, v_transfer_date, v_shipping_cost
  from public.warehouse_transfers
  where id = p_transfer_id and status = 'pending'
  for update;

  if not found then
    raise exception 'Transfer not found or not pending';
  end if;

  if v_shipping_cost > 0 then
    select sum(quantity) into v_total_transfer_qty
    from public.warehouse_transfer_items
    where transfer_id = p_transfer_id;

    if v_total_transfer_qty > 0 then
      v_unit_shipping_cost := v_shipping_cost / v_total_transfer_qty;
    end if;
  end if;

  for v_item in
    select id, item_id, quantity, batch_id
    from public.warehouse_transfer_items
    where transfer_id = p_transfer_id
  loop
    -- FIX: Only read SM from the exact source warehouse. No fallback to other warehouses.
    select *
    into v_sm_from
    from public.stock_management sm
    where sm.item_id = v_item.item_id
      and sm.warehouse_id = v_from_warehouse
    for update;

    if not found then
      -- FIX: Raise a clear error if no SM record exists for this item/warehouse
      raise exception 'رصيد الصنف % غير موجود في مستودع المصدر. لا يمكن إتمام التحويل.', v_item.item_id;
    end if;

    select coalesce(mi.category = 'food', false)
    into v_is_food
    from public.menu_items mi
    where mi.id = v_item.item_id;

    v_is_food := coalesce(v_is_food, false);

    -- FIX: Strict stock check — no tolerance bypass for significant quantities
    if coalesce(v_sm_from.available_quantity, 0) + 1e-9 < v_item.quantity then
      raise exception 'رصيد الصنف % في المستودع المصدر غير كافٍ. المتاح: %, المطلوب: %',
        v_item.item_id,
        coalesce(v_sm_from.available_quantity, 0),
        v_item.quantity;
    end if;

    -- FIX: Deduct ONLY from the source warehouse. If not found (impossible now), raise error.
    update public.stock_management
    set
      available_quantity = available_quantity - v_item.quantity,
      last_updated = now(),
      updated_at = now()
    where item_id = v_item.item_id
      and warehouse_id = v_from_warehouse;

    if not found then
      raise exception 'فشل خصم الكمية من مستودع المصدر للصنف %', v_item.item_id;
    end if;

    -- Add to destination warehouse (accumulate, do not overwrite)
    begin
      insert into public.stock_management (item_id, warehouse_id, available_quantity, unit, reserved_quantity, last_updated, updated_at)
      select
        v_item.item_id,
        v_to_warehouse,
        v_item.quantity,
        sm.unit,
        0,
        now(),
        now()
      from public.stock_management sm
      where sm.item_id = v_item.item_id
      limit 1
      on conflict (item_id, warehouse_id)
      do update set
        available_quantity = public.stock_management.available_quantity + excluded.available_quantity,
        last_updated = now(),
        updated_at = now();
    exception
      when unique_violation or sqlstate '42P10' then
        update public.stock_management
        set
          available_quantity = available_quantity + v_item.quantity,
          last_updated = now(),
          updated_at = now()
        where item_id = v_item.item_id
          and warehouse_id = v_to_warehouse;
    end;

    -- Insert inventory movements (non-food path — simple, no batch splitting)
    if not v_is_food or v_item.batch_id is not null then
      -- For non-food OR when batch is explicitly specified
      if v_item.batch_id is not null then
        select im.unit_cost
        into v_unit_cost
        from public.inventory_movements im
        where im.batch_id = v_item.batch_id
          and im.movement_type = 'purchase_in'
        order by im.occurred_at asc
        limit 1;
      end if;

      v_unit_cost := coalesce(v_unit_cost, v_sm_from.avg_cost, 0);

      insert into public.inventory_movements (
        id, item_id, movement_type, quantity, unit_cost, total_cost,
        reference_table, reference_id, occurred_at, created_by, created_at, warehouse_id, data
      )
      values (
        gen_random_uuid(),
        v_item.item_id,
        'transfer_out',
        v_item.quantity,
        v_unit_cost,
        v_unit_cost * v_item.quantity,
        'warehouse_transfers',
        p_transfer_id::text,
        v_transfer_date::timestamptz,
        auth.uid(),
        now(),
        v_from_warehouse,
        jsonb_build_object('warehouseId', v_from_warehouse, 'toWarehouseId', v_to_warehouse, 'batchId', v_item.batch_id)
      )
      returning id into v_movement_out;

      insert into public.inventory_movements (
        id, item_id, movement_type, quantity, unit_cost, total_cost,
        reference_table, reference_id, occurred_at, created_by, created_at, warehouse_id, data
      )
      values (
        gen_random_uuid(),
        v_item.item_id,
        'transfer_in',
        v_item.quantity,
        v_unit_cost + v_unit_shipping_cost,
        (v_unit_cost + v_unit_shipping_cost) * v_item.quantity,
        'warehouse_transfers',
        p_transfer_id::text,
        v_transfer_date::timestamptz,
        auth.uid(),
        now(),
        v_to_warehouse,
        jsonb_build_object('warehouseId', v_to_warehouse, 'fromWarehouseId', v_from_warehouse, 'batchId', v_item.batch_id, 'shippingCostApplied', v_unit_shipping_cost * v_item.quantity)
      )
      returning id into v_movement_in;
      perform public.post_inventory_movement(v_movement_in);
    else
      -- Food path: distribute across batches (FIFO)
      v_remaining := v_item.quantity;

      select coalesce(data->'reservedBatches', '{}'::jsonb)
      into v_reserved_batches
      from public.warehouse_transfer_items
      where id = v_item.id;

      for v_batch in
        select
          b.batch_id,
          b.expiry_date,
          b.remaining_qty
        from public.v_food_batch_balances b
        where b.item_id::text = v_item.item_id
          and b.warehouse_id = v_from_warehouse
          and b.batch_id is not null
          and (b.expiry_date is null or b.expiry_date >= current_date)
          and coalesce(b.remaining_qty, 0) > 0
        order by b.expiry_date asc nulls last, b.batch_id asc
      loop
        if v_remaining <= 0 then
          exit;
        end if;

        select
          coalesce(sum(coalesce(nullif(x->>'qty','')::numeric, 0)), 0)
        into v_batch_reserved
        from jsonb_array_elements(
          case
            when jsonb_typeof(v_reserved_batches -> (v_batch.batch_id::text)) = 'array' then (v_reserved_batches -> (v_batch.batch_id::text))
            when jsonb_typeof(v_reserved_batches -> (v_batch.batch_id::text)) = 'object' then jsonb_build_array(v_reserved_batches -> (v_batch.batch_id::text))
            when jsonb_typeof(v_reserved_batches -> (v_batch.batch_id::text)) = 'number' then jsonb_build_array(jsonb_build_object('qty', (v_reserved_batches -> (v_batch.batch_id::text))))
            else '[]'::jsonb
          end
        ) as x;

        v_free := greatest(coalesce(v_batch.remaining_qty, 0) - coalesce(v_batch_reserved, 0), 0);
        v_alloc := least(v_remaining, v_free);
        if v_alloc <= 0 then
          continue;
        end if;

        select im.unit_cost
        into v_unit_cost
        from public.inventory_movements im
        where im.batch_id = v_batch.batch_id
          and im.movement_type = 'purchase_in'
        order by im.occurred_at asc
        limit 1;

        v_unit_cost := coalesce(v_unit_cost, v_sm_from.avg_cost, 0);

        insert into public.inventory_movements (
          id, item_id, movement_type, quantity, unit_cost, total_cost,
          reference_table, reference_id, occurred_at, created_by, created_at, warehouse_id, data
        )
        values (
          gen_random_uuid(),
          v_item.item_id,
          'transfer_out',
          v_alloc,
          v_unit_cost,
          v_unit_cost * v_alloc,
          'warehouse_transfers',
          p_transfer_id::text,
          v_transfer_date::timestamptz,
          auth.uid(),
          now(),
          v_from_warehouse,
          jsonb_build_object('warehouseId', v_from_warehouse, 'toWarehouseId', v_to_warehouse, 'batchId', v_batch.batch_id)
        )
        returning id into v_movement_out;

        insert into public.inventory_movements (
          id, item_id, movement_type, quantity, unit_cost, total_cost,
          reference_table, reference_id, occurred_at, created_by, created_at, warehouse_id, data
        )
        values (
          gen_random_uuid(),
          v_item.item_id,
          'transfer_in',
          v_alloc,
          v_unit_cost + v_unit_shipping_cost,
          (v_unit_cost + v_unit_shipping_cost) * v_alloc,
          'warehouse_transfers',
          p_transfer_id::text,
          v_transfer_date::timestamptz,
          auth.uid(),
          now(),
          v_to_warehouse,
          jsonb_build_object('warehouseId', v_to_warehouse, 'fromWarehouseId', v_from_warehouse, 'batchId', v_batch.batch_id, 'shippingCostApplied', v_unit_shipping_cost * v_alloc)
        )
        returning id into v_movement_in;
        perform public.post_inventory_movement(v_movement_in);

        v_remaining := v_remaining - v_alloc;
      end loop;

      if v_remaining > 0 then
        v_unit_cost := coalesce(v_sm_from.avg_cost, 0);

        insert into public.inventory_movements (
          id, item_id, movement_type, quantity, unit_cost, total_cost,
          reference_table, reference_id, occurred_at, created_by, created_at, warehouse_id, data
        )
        values (
          gen_random_uuid(),
          v_item.item_id,
          'transfer_out',
          v_remaining,
          v_unit_cost,
          v_unit_cost * v_remaining,
          'warehouse_transfers',
          p_transfer_id::text,
          v_transfer_date::timestamptz,
          auth.uid(),
          now(),
          v_from_warehouse,
          jsonb_build_object('warehouseId', v_from_warehouse, 'toWarehouseId', v_to_warehouse, 'legacyFallback', true)
        )
        returning id into v_movement_out;

        insert into public.inventory_movements (
          id, item_id, movement_type, quantity, unit_cost, total_cost,
          reference_table, reference_id, occurred_at, created_by, created_at, warehouse_id, data
        )
        values (
          gen_random_uuid(),
          v_item.item_id,
          'transfer_in',
          v_remaining,
          v_unit_cost + v_unit_shipping_cost,
          (v_unit_cost + v_unit_shipping_cost) * v_remaining,
          'warehouse_transfers',
          p_transfer_id::text,
          v_transfer_date::timestamptz,
          auth.uid(),
          now(),
          v_to_warehouse,
          jsonb_build_object('warehouseId', v_to_warehouse, 'fromWarehouseId', v_from_warehouse, 'shippingCostApplied', v_unit_shipping_cost * v_remaining, 'legacyFallback', true)
        )
        returning id into v_movement_in;

        perform public.post_inventory_movement(v_movement_in);
        v_remaining := 0;
      end if;
    end if;

    update public.warehouse_transfer_items
    set transferred_quantity = v_item.quantity
    where id = v_item.id;
  end loop;

  update public.warehouse_transfers
  set
    status = 'completed',
    completed_at = now(),
    approved_by = auth.uid()
  where id = p_transfer_id;

  insert into public.system_audit_logs(action, module, details, performed_by, performed_at, metadata)
  values (
    'warehouse_transfer_completed',
    'inventory',
    format('Completed transfer %s from warehouse %s to %s. Shipping Cost Distributed: %s', p_transfer_id, v_from_warehouse, v_to_warehouse, v_shipping_cost),
    auth.uid(),
    now(),
    jsonb_build_object('transferId', p_transfer_id, 'fromWarehouseId', v_from_warehouse, 'toWarehouseId', v_to_warehouse, 'shippingCost', v_shipping_cost)
  );
end;
$function$;

-- =====================================================================
-- Step 2: Recalculate stock_management from inventory_movements
-- =====================================================================
DO $$
DECLARE
  r record;
  v_unit text;
BEGIN
  FOR r IN
    SELECT
      im.item_id::text       AS item_id,
      im.warehouse_id::uuid  AS warehouse_id,
      SUM(CASE
        WHEN im.movement_type IN ('purchase_in','transfer_in','return_in','adjust_in') THEN im.quantity
        ELSE -im.quantity
      END) AS net_qty
    FROM public.inventory_movements im
    WHERE im.warehouse_id IS NOT NULL
      AND im.item_id IS NOT NULL
    GROUP BY im.item_id, im.warehouse_id
  LOOP
    SELECT sm.unit INTO v_unit
    FROM public.stock_management sm
    WHERE sm.item_id = r.item_id
      AND sm.warehouse_id = r.warehouse_id;

    IF v_unit IS NULL THEN
      SELECT sm.unit INTO v_unit
      FROM public.stock_management sm
      WHERE sm.item_id = r.item_id
      LIMIT 1;
    END IF;

    IF v_unit IS NULL THEN
      v_unit := 'piece';
    END IF;

    INSERT INTO public.stock_management (
      item_id, warehouse_id, available_quantity, unit,
      reserved_quantity, last_updated, updated_at
    )
    VALUES (
      r.item_id, r.warehouse_id,
      GREATEST(r.net_qty, 0),
      v_unit,
      0, now(), now()
    )
    ON CONFLICT (item_id, warehouse_id) DO UPDATE SET
      available_quantity = GREATEST(EXCLUDED.available_quantity, 0),
      last_updated = now(),
      updated_at = now();
  END LOOP;
END;
$$;
