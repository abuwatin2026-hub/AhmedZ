-- ERP Audit Fix: deduct items without batches + trigger warehouse check
-- 1) deduct_stock_on_delivery_v2: when item has no batches (or no remaining batch qty), allow non-batch deduction (movement with batch_id null)
-- 2) trg_orders_require_sale_out_on_delivered: when order has warehouse_id, require movement to match warehouse

-- 1) Patch deduct_stock_on_delivery_v2: after batch loop, if v_remaining_needed > 0 and NO batches with remaining exist, do non-batch deduction
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
  v_item jsonb;
  v_item_id_text text;
  v_item_id_uuid uuid;
  v_requested numeric;
  v_available numeric;
  v_reserved numeric;
  v_avg_cost numeric;
  v_total_cost numeric;
  v_movement_id uuid;
  v_last_batch_id uuid;
  v_item_batch_text text;
  v_is_in_store boolean;
  v_stock_data jsonb;
  v_res_batches jsonb;
  v_reserved_for_order jsonb;
  v_reserved_total numeric;
  v_entry jsonb;
  v_entry_new jsonb;
  v_has_batch_remaining boolean;
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

  if exists (
    select 1
    from public.inventory_movements im
    where im.reference_table = 'orders'
      and im.reference_id = p_order_id::text
      and im.warehouse_id = p_warehouse_id
      and im.movement_type = 'sale_out'
  ) then
    return;
  end if;

  select (coalesce(nullif(o.data->>'orderSource',''), '') = 'in_store')
  into v_is_in_store
  from public.orders o
  where o.id = p_order_id
  for update;
  if not found then
    raise exception 'order not found';
  end if;

  delete from public.order_item_cogs where order_id = p_order_id;

  for v_item in select value from jsonb_array_elements(p_items)
  loop
    v_item_id_text := coalesce(v_item->>'itemId', v_item->>'id');
    v_requested := coalesce(nullif(v_item->>'quantity', '')::numeric, 0);
    v_item_batch_text := nullif(v_item->>'batchId', '');
    if v_item_id_text is null or v_item_id_text = '' then
      raise exception 'Invalid itemId';
    end if;
    if v_requested <= 0 then
      continue;
    end if;
    begin
      v_item_id_uuid := v_item_id_text::uuid;
    exception when others then
      v_item_id_uuid := null;
    end;

    select
      coalesce(sm.available_quantity, 0),
      coalesce(sm.reserved_quantity, 0),
      coalesce(sm.avg_cost, 0),
      sm.last_batch_id,
      coalesce(sm.data, '{}'::jsonb)
    into v_available, v_reserved, v_avg_cost, v_last_batch_id, v_stock_data
    from public.stock_management sm
    where (case when v_item_id_uuid is not null then sm.item_id = v_item_id_uuid else sm.item_id::text = v_item_id_text end)
      and sm.warehouse_id = p_warehouse_id
    for update;

    if not found then
      raise exception 'Stock record not found for item % in warehouse %', v_item_id_text, p_warehouse_id;
    end if;

    if (v_available + 1e-9) < v_requested then
      raise exception 'Insufficient stock for item % in warehouse % (available %, requested %)', v_item_id_text, p_warehouse_id, v_available, v_requested;
    end if;

    if not coalesce(v_is_in_store, false) then
      v_res_batches := coalesce(v_stock_data->'reservedBatches', '{}'::jsonb);
      select coalesce(
        jsonb_object_agg(batch_id_text, to_jsonb(reserved_qty)),
        '{}'::jsonb
      )
      into v_reserved_for_order
      from (
        select
          e.key as batch_id_text,
          sum(coalesce(nullif(r->>'qty','')::numeric, 0)) as reserved_qty
        from jsonb_each(v_res_batches) e
        cross join lateral jsonb_array_elements(
          case
            when jsonb_typeof(e.value) = 'array' then e.value
            when jsonb_typeof(e.value) = 'object' then jsonb_build_array(e.value)
            else '[]'::jsonb
          end
        ) as r
        where (r->>'orderId') = p_order_id::text
        group by e.key
      ) s;

      select coalesce(sum((value)::numeric), 0)
      into v_reserved_total
      from jsonb_each_text(v_reserved_for_order);

      if (v_reserved_total + 1e-9) < v_requested then
        raise exception 'Insufficient reserved stock for item % in warehouse % (reserved %, requested %)', v_item_id_text, p_warehouse_id, v_reserved_total, v_requested;
      end if;
    end if;

    declare
      v_remaining_needed numeric := v_requested;
      v_batch record;
      v_alloc numeric;
      v_batch_remaining numeric;
      v_batch_unit_cost numeric;
      v_qr numeric;
      v_qc numeric;
      v_reserved_qty_for_batch numeric;
      v_batch_key text;
      v_existing_list jsonb;
    begin
      if v_item_batch_text is not null then
        select 
          b.id as batch_id,
          b.unit_cost,
          b.expiry_date,
          greatest(coalesce(b.quantity_received,0) - coalesce(b.quantity_consumed,0) - coalesce(b.quantity_transferred,0), 0) as remaining
        into v_batch
        from public.batches b
        where b.id = v_item_batch_text::uuid
          and b.item_id = v_item_id_text
          and b.warehouse_id = p_warehouse_id
        for update;
        if not found then
          raise exception 'Batch % not found for item % in warehouse %', v_item_batch_text, v_item_id_text, p_warehouse_id;
        end if;
        if v_batch.expiry_date is not null and v_batch.expiry_date < current_date then
          raise exception 'BATCH_EXPIRED';
        end if;
        v_alloc := least(v_remaining_needed, coalesce(v_batch.remaining, 0));
        if not coalesce(v_is_in_store, false) then
          v_reserved_qty_for_batch := coalesce(nullif((v_reserved_for_order->>v_item_batch_text), '')::numeric, 0);
          v_alloc := least(v_alloc, v_reserved_qty_for_batch);
        end if;
        if v_alloc > 0 then
          update public.batches
          set quantity_consumed = quantity_consumed + v_alloc
          where id = v_batch.batch_id
          returning quantity_received, quantity_consumed into v_qr, v_qc;
          if coalesce(v_qc,0) > coalesce(v_qr,0) then
            raise exception 'Over-consumption detected for batch %', v_batch.batch_id;
          end if;
          v_batch_unit_cost := coalesce(v_batch.unit_cost, v_avg_cost, 0);
          v_total_cost := v_alloc * v_batch_unit_cost;
          insert into public.order_item_cogs(order_id, item_id, quantity, unit_cost, total_cost, created_at)
          values (p_order_id, v_item_id_text, v_alloc, v_batch_unit_cost, v_total_cost, now());
          insert into public.inventory_movements(
            item_id, movement_type, quantity, unit_cost, total_cost,
            reference_table, reference_id, occurred_at, created_by, data, batch_id, warehouse_id
          )
          values (
            v_item_id_text, 'sale_out', v_alloc, v_batch_unit_cost, v_total_cost,
            'orders', p_order_id::text, now(), auth.uid(),
            jsonb_build_object('orderId', p_order_id, 'warehouseId', p_warehouse_id, 'batchId', v_batch.batch_id),
            v_batch.batch_id,
            p_warehouse_id
          )
          returning id into v_movement_id;
          perform public.post_inventory_movement(v_movement_id);

          if not coalesce(v_is_in_store, false) then
            v_batch_key := v_batch.batch_id::text;
            v_entry := v_res_batches->v_batch_key;
            v_existing_list :=
              case
                when v_entry is null then '[]'::jsonb
                when jsonb_typeof(v_entry) = 'array' then v_entry
                when jsonb_typeof(v_entry) = 'object' then jsonb_build_array(v_entry)
                else '[]'::jsonb
              end;
            with elems as (
              select value, ordinality
              from jsonb_array_elements(v_existing_list) with ordinality
            ),
            updated as (
              select
                case
                  when (value->>'orderId') = p_order_id::text then
                    case
                      when (coalesce(nullif(value->>'qty','')::numeric, 0) - v_alloc) <= 0 then null
                      else jsonb_set(value, '{qty}', to_jsonb(coalesce(nullif(value->>'qty','')::numeric, 0) - v_alloc), true)
                    end
                  else value
                end as new_value,
                ordinality
              from elems
            )
            select coalesce(jsonb_agg(new_value order by ordinality) filter (where new_value is not null), '[]'::jsonb)
            into v_entry_new
            from updated;
            if jsonb_array_length(v_entry_new) = 0 then
              v_res_batches := v_res_batches - v_batch_key;
            else
              v_res_batches := jsonb_set(v_res_batches, array[v_batch_key], v_entry_new, true);
            end if;
          end if;

          v_remaining_needed := v_remaining_needed - v_alloc;
        end if;
      end if;

      for v_batch in
        select 
          b.id as batch_id,
          b.unit_cost,
          b.expiry_date,
          greatest(coalesce(b.quantity_received,0) - coalesce(b.quantity_consumed,0) - coalesce(b.quantity_transferred,0), 0) as remaining
        from public.batches b
        where b.item_id = v_item_id_text
          and b.warehouse_id = p_warehouse_id
          and greatest(coalesce(b.quantity_received,0) - coalesce(b.quantity_consumed,0) - coalesce(b.quantity_transferred,0), 0) > 0
          and (v_item_batch_text is null or b.id <> v_item_batch_text::uuid)
        order by b.expiry_date asc nulls last, b.created_at asc, b.id asc
        for update
      loop
        exit when v_remaining_needed <= 0;
        if v_batch.expiry_date is not null and v_batch.expiry_date < current_date then
          raise exception 'BATCH_EXPIRED';
        end if;
        v_batch_remaining := coalesce(v_batch.remaining, 0);
        if v_batch_remaining <= 0 then
          continue;
        end if;
        v_alloc := least(v_remaining_needed, v_batch_remaining);
        if not coalesce(v_is_in_store, false) then
          v_reserved_qty_for_batch := coalesce(nullif((v_reserved_for_order->>v_batch.batch_id::text), '')::numeric, 0);
          v_alloc := least(v_alloc, v_reserved_qty_for_batch);
          if v_alloc <= 0 then
            continue;
          end if;
        end if;
        update public.batches
        set quantity_consumed = quantity_consumed + v_alloc
        where id = v_batch.batch_id
        returning quantity_received, quantity_consumed into v_qr, v_qc;
        if coalesce(v_qc,0) > coalesce(v_qr,0) then
          raise exception 'Over-consumption detected for batch %', v_batch.batch_id;
        end if;
        v_batch_unit_cost := coalesce(v_batch.unit_cost, v_avg_cost, 0);
        v_total_cost := v_alloc * v_batch_unit_cost;
        insert into public.order_item_cogs(order_id, item_id, quantity, unit_cost, total_cost, created_at)
        values (p_order_id, v_item_id_text, v_alloc, v_batch_unit_cost, v_total_cost, now());
        insert into public.inventory_movements(
          item_id, movement_type, quantity, unit_cost, total_cost,
          reference_table, reference_id, occurred_at, created_by, data, batch_id, warehouse_id
        )
        values (
          v_item_id_text, 'sale_out', v_alloc, v_batch_unit_cost, v_total_cost,
          'orders', p_order_id::text, now(), auth.uid(),
          jsonb_build_object('orderId', p_order_id, 'warehouseId', p_warehouse_id, 'batchId', v_batch.batch_id),
          v_batch.batch_id,
          p_warehouse_id
        )
        returning id into v_movement_id;
        perform public.post_inventory_movement(v_movement_id);

        if not coalesce(v_is_in_store, false) then
          v_batch_key := v_batch.batch_id::text;
          v_entry := v_res_batches->v_batch_key;
          v_existing_list :=
            case
              when v_entry is null then '[]'::jsonb
              when jsonb_typeof(v_entry) = 'array' then v_entry
              when jsonb_typeof(v_entry) = 'object' then jsonb_build_array(v_entry)
              else '[]'::jsonb
            end;
          with elems as (
            select value, ordinality
            from jsonb_array_elements(v_existing_list) with ordinality
          ),
          updated as (
            select
              case
                when (value->>'orderId') = p_order_id::text then
                  case
                    when (coalesce(nullif(value->>'qty','')::numeric, 0) - v_alloc) <= 0 then null
                    else jsonb_set(value, '{qty}', to_jsonb(coalesce(nullif(value->>'qty','')::numeric, 0) - v_alloc), true)
                  end
                else value
              end as new_value,
              ordinality
            from elems
          )
          select coalesce(jsonb_agg(new_value order by ordinality) filter (where new_value is not null), '[]'::jsonb)
          into v_entry_new
          from updated;
          if jsonb_array_length(v_entry_new) = 0 then
            v_res_batches := v_res_batches - v_batch_key;
          else
            v_res_batches := jsonb_set(v_res_batches, array[v_batch_key], v_entry_new, true);
          end if;
        end if;

        v_remaining_needed := v_remaining_needed - v_alloc;
      end loop;

      -- ERP Audit Fix: when no batches exist (or not enough), allow non-batch deduction for in_store or when zero batch remaining
      if v_remaining_needed > 0 then
        select exists (
          select 1
          from public.batches b
          where b.item_id = v_item_id_text
            and b.warehouse_id = p_warehouse_id
            and (coalesce(b.quantity_received,0) - coalesce(b.quantity_consumed,0) - coalesce(b.quantity_transferred,0)) > 0
        ) into v_has_batch_remaining;

        if not v_has_batch_remaining then
          -- No batches with remaining: deduct from stock_management only (batch_id null)
          v_total_cost := v_remaining_needed * coalesce(v_avg_cost, 0);
          insert into public.order_item_cogs(order_id, item_id, quantity, unit_cost, total_cost, created_at)
          values (p_order_id, v_item_id_text, v_remaining_needed, coalesce(v_avg_cost, 0), v_total_cost, now());
          insert into public.inventory_movements(
            item_id, movement_type, quantity, unit_cost, total_cost,
            reference_table, reference_id, occurred_at, created_by, data, batch_id, warehouse_id
          )
          values (
            v_item_id_text, 'sale_out', v_remaining_needed, coalesce(v_avg_cost, 0), v_total_cost,
            'orders', p_order_id::text, now(), auth.uid(),
            jsonb_build_object('orderId', p_order_id, 'warehouseId', p_warehouse_id, 'noBatch', true),
            null,
            p_warehouse_id
          )
          returning id into v_movement_id;
          perform public.post_inventory_movement(v_movement_id);
          v_remaining_needed := 0;
        end if;
      end if;

      if v_remaining_needed > 0 then
        if not coalesce(v_is_in_store, false) then
          raise exception 'Insufficient reserved batch stock for item % in warehouse % (requested %, reserved %, delivered %)', v_item_id_text, p_warehouse_id, v_requested, v_reserved_total, (v_requested - v_remaining_needed);
        else
          raise exception 'Insufficient batch stock for item % in warehouse % (needed %, available %)', v_item_id_text, p_warehouse_id, v_requested, (v_requested - v_remaining_needed);
        end if;
      end if;
    end;

    update public.stock_management
    set available_quantity = greatest(0, available_quantity - v_requested),
        reserved_quantity = case
          when coalesce(v_is_in_store, false) then reserved_quantity
          else greatest(0, reserved_quantity - v_requested)
        end,
        last_updated = now(),
        updated_at = now(),
        data = case
          when not coalesce(v_is_in_store, false) then jsonb_set(coalesce(v_stock_data, '{}'::jsonb), '{reservedBatches}', coalesce(v_res_batches, '{}'::jsonb), true)
          else coalesce(v_stock_data, '{}'::jsonb)
        end
    where (case when v_item_id_uuid is not null then item_id = v_item_id_uuid else item_id::text = v_item_id_text end)
      and warehouse_id = p_warehouse_id;
  end loop;
end;
$$;

comment on function public.deduct_stock_on_delivery_v2(uuid, jsonb, uuid) is 'ERP Audit: supports items without batches (non-batch deduction with batch_id null)';

-- 2) Trigger: when order has warehouse_id, require sale_out movement to match that warehouse
create or replace function public.trg_orders_require_sale_out_on_delivered()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_wh uuid;
begin
  if new.status = 'delivered' and (old.status is distinct from new.status) then
    v_wh := coalesce(
      nullif(trim(coalesce(new.data->>'warehouseId', '')), '')::uuid,
      (select w.id from public.warehouses w where w.code = 'MAIN' limit 1)
    );
    if not exists (
      select 1
      from public.inventory_movements im
      where im.reference_table = 'orders'
        and im.reference_id = new.id::text
        and im.movement_type = 'sale_out'
        and (v_wh is null or im.warehouse_id = v_wh)
    ) then
      raise exception 'cannot mark delivered without stock movements for this order/warehouse';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_orders_require_sale_out_on_delivered on public.orders;
create trigger trg_orders_require_sale_out_on_delivered
before update of status
on public.orders
for each row
execute function public.trg_orders_require_sale_out_on_delivered();
