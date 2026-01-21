create or replace function public.deduct_stock_on_delivery_v2(p_order_id uuid, p_items jsonb)
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
  v_unit_cost numeric;
  v_total_cost numeric;
  v_movement_id uuid;
  v_stock_item_id_is_uuid boolean;
  v_is_in_store boolean;
  v_batch_id uuid;
  v_item_batch_text text;
  v_is_food boolean;
  v_stock_data jsonb;
  v_reserved_batches jsonb;
  v_reserved_for_order jsonb;
  v_key text;
  v_value jsonb;
  v_use_reserved boolean;
  v_reserved_total numeric;
  v_available_fefo numeric;
  v_remaining_needed numeric;
  v_reserved_for_batch numeric;
  v_effective_remaining numeric;
  v_alloc numeric;
  v_entry jsonb;
  v_entry_qty numeric;
  v_entry_new jsonb;
  v_batch record;
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

  select (coalesce(nullif(o.data->>'orderSource',''), '') = 'in_store')
  into v_is_in_store
  from public.orders o
  where o.id = p_order_id;

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

    if coalesce(v_stock_item_id_is_uuid, false) then
      begin
        v_item_id_uuid := v_item_id_text::uuid;
      exception when others then
        raise exception 'Invalid itemId %', v_item_id_text;
      end;

      select
        coalesce(sm.available_quantity, 0),
        coalesce(sm.reserved_quantity, 0),
        coalesce(sm.avg_cost, 0),
        sm.last_batch_id,
        coalesce(sm.data, '{}'::jsonb)
      into v_available, v_reserved, v_avg_cost, v_batch_id, v_stock_data
      from public.stock_management sm
      where sm.item_id = v_item_id_uuid
      for update;
    else
      select
        coalesce(sm.available_quantity, 0),
        coalesce(sm.reserved_quantity, 0),
        coalesce(sm.avg_cost, 0),
        sm.last_batch_id,
        coalesce(sm.data, '{}'::jsonb)
      into v_available, v_reserved, v_avg_cost, v_batch_id, v_stock_data
      from public.stock_management sm
      where sm.item_id::text = v_item_id_text
      for update;
    end if;

    if not found then
      raise exception 'Stock record not found for item %', v_item_id_text;
    end if;

    select coalesce(mi.category = 'food', false)
    into v_is_food
    from public.menu_items mi
    where mi.id = v_item_id_text;

    if not found and v_item_id_uuid is not null then
      select coalesce(mi.category = 'food', false)
      into v_is_food
      from public.menu_items mi
      where mi.id = v_item_id_uuid::text;
    end if;

    if not coalesce(v_is_food, false) then
      if (v_available + 1e-9) < v_requested then
        raise exception 'Insufficient stock for item % (available %, requested %)', v_item_id_text, v_available, v_requested;
      end if;

      if v_item_batch_text is not null then
        begin
          v_batch_id := v_item_batch_text::uuid;
        exception when others then
          v_batch_id := v_batch_id;
        end;
      end if;

      if v_batch_id is not null then
        select im.unit_cost
        into v_unit_cost
        from public.inventory_movements im
        where im.batch_id = v_batch_id
          and im.movement_type = 'purchase_in'
        order by im.occurred_at asc
        limit 1;

        v_unit_cost := coalesce(v_unit_cost, (select coalesce(sm2.avg_cost, 0) from public.stock_management sm2 where (case when coalesce(v_stock_item_id_is_uuid, false) then sm2.item_id = v_item_id_uuid else sm2.item_id::text = v_item_id_text end)));
      else
        v_unit_cost := v_avg_cost;
      end if;

      if not coalesce(v_is_in_store, false) then
        if (v_reserved + 1e-9) < v_requested then
          raise exception 'Insufficient reserved stock for item % (reserved %, requested %)', v_item_id_text, v_reserved, v_requested;
        end if;
      end if;

      if coalesce(v_stock_item_id_is_uuid, false) then
        update public.stock_management
        set available_quantity = greatest(0, available_quantity - v_requested),
            reserved_quantity = case
              when coalesce(v_is_in_store, false) then reserved_quantity
              else greatest(0, reserved_quantity - v_requested)
            end,
            last_updated = now(),
            updated_at = now()
        where item_id = v_item_id_uuid;
      else
        update public.stock_management
        set available_quantity = greatest(0, available_quantity - v_requested),
            reserved_quantity = case
              when coalesce(v_is_in_store, false) then reserved_quantity
              else greatest(0, reserved_quantity - v_requested)
            end,
            last_updated = now(),
            updated_at = now()
        where item_id::text = v_item_id_text;
      end if;

      v_total_cost := v_requested * v_unit_cost;

      insert into public.order_item_cogs(order_id, item_id, quantity, unit_cost, total_cost, created_at)
      values (p_order_id, v_item_id_text, v_requested, v_unit_cost, v_total_cost, now());

      insert into public.inventory_movements(
        item_id, movement_type, quantity, unit_cost, total_cost,
        reference_table, reference_id, occurred_at, created_by, data, batch_id
      )
      values (
        v_item_id_text, 'sale_out', v_requested, v_unit_cost, v_total_cost,
        'orders', p_order_id::text, now(), auth.uid(), jsonb_build_object('orderId', p_order_id, 'batchId', v_batch_id), v_batch_id
      )
      returning id into v_movement_id;

      perform public.post_inventory_movement(v_movement_id);
    else
      v_reserved_batches := coalesce(v_stock_data->'reservedBatches', '{}'::jsonb);
      v_reserved_for_order := '{}'::jsonb;
      v_use_reserved := false;
      v_reserved_total := 0;
      v_available_fefo := 0;

      if not coalesce(v_is_in_store, false) then
        select coalesce(
          jsonb_object_agg(batch_id_text, to_jsonb(reserved_qty)),
          '{}'::jsonb
        )
        into v_reserved_for_order
        from (
          select
            e.key as batch_id_text,
            sum(coalesce(nullif(r->>'qty','')::numeric, 0)) as reserved_qty
          from jsonb_each(v_reserved_batches) e
          cross join lateral jsonb_array_elements(
            case
              when jsonb_typeof(e.value) = 'array' then e.value
              when jsonb_typeof(e.value) = 'object' then jsonb_build_array(e.value)
              else '[]'::jsonb
            end
          ) as r
          where (r->>'orderId') = p_order_id::text
          group by e.key
          having sum(coalesce(nullif(r->>'qty','')::numeric, 0)) > 0
        ) s;

        if jsonb_object_length(v_reserved_for_order) = 0 then
          raise exception 'Missing batch reservation for food item % in order %', v_item_id_text, p_order_id;
        end if;

        select coalesce(sum((value)::numeric), 0)
        into v_reserved_total
        from jsonb_each_text(v_reserved_for_order);

        if (v_reserved_total + 1e-9) < v_requested then
          raise exception 'Insufficient reserved stock for food item % in order % (reserved %, requested %)', v_item_id_text, p_order_id, v_reserved_total, v_requested;
        end if;

        v_use_reserved := true;
      end if;

      v_remaining_needed := v_requested;

      if v_use_reserved then
        for v_batch in
          with reserved as (
            select
              (key)::uuid as batch_id,
              (value)::numeric as reserved_qty
            from jsonb_each_text(v_reserved_for_order)
          ),
          purchases as (
            select
              im.batch_id,
              im.quantity as received_qty,
              case
                when (im.data->>'expiryDate') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then (im.data->>'expiryDate')::date
                else null
              end as expiry_date
            from public.inventory_movements im
            where im.item_id = v_item_id_text
              and im.movement_type = 'purchase_in'
              and im.batch_id is not null
          ),
          consumed as (
            select
              im.batch_id,
              sum(im.quantity) as consumed_qty
            from public.inventory_movements im
            where im.item_id = v_item_id_text
              and im.movement_type in ('sale_out','wastage_out','adjust_out','return_out')
              and im.batch_id is not null
            group by im.batch_id
          ),
          remaining as (
            select
              p.batch_id,
              p.expiry_date,
              greatest(coalesce(p.received_qty, 0) - coalesce(c.consumed_qty, 0), 0) as remaining_qty
            from purchases p
            left join consumed c on c.batch_id = p.batch_id
            where p.expiry_date is not null
              and p.expiry_date >= current_date
          )
          select r.batch_id, r.reserved_qty, rem.expiry_date, rem.remaining_qty
          from reserved r
          join remaining rem on rem.batch_id = r.batch_id
          order by rem.expiry_date asc, rem.batch_id asc
        loop
          if v_batch.expiry_date is null or v_batch.expiry_date < current_date then
            raise exception 'Cannot deliver expired or invalid food batch % for item %', v_batch.batch_id, v_item_id_text;
          end if;

          v_reserved_for_batch := coalesce(v_batch.reserved_qty, 0);
          v_effective_remaining := least(coalesce(v_batch.remaining_qty, 0), v_reserved_for_batch);
          if v_effective_remaining <= 0 then
            continue;
          end if;
          v_alloc := least(v_remaining_needed, v_effective_remaining);

          v_entry := v_reserved_batches->v_batch.batch_id::text;
          if v_entry is null then
            raise exception 'Missing reservation entry for batch % while delivering order %', v_batch.batch_id, p_order_id;
          end if;

          if jsonb_typeof(v_entry) = 'object' then
            if (v_entry->>'orderId') is not null and (v_entry->>'orderId') <> p_order_id::text then
              raise exception 'Reservation ownership mismatch for batch % (expected order %, found %)', v_batch.batch_id, p_order_id, (v_entry->>'orderId');
            end if;
            v_entry_qty := coalesce(nullif(v_entry->>'qty','')::numeric, 0);
            if (v_entry_qty + 1e-9) < v_alloc then
              raise exception 'Reserved qty mismatch for batch % (reserved %, deliver %)', v_batch.batch_id, v_entry_qty, v_alloc;
            end if;
            if (v_entry_qty - v_alloc) <= 0 then
              v_reserved_batches := v_reserved_batches - v_batch.batch_id::text;
            else
              v_reserved_batches := jsonb_set(
                v_reserved_batches,
                array[v_batch.batch_id::text],
                jsonb_set(v_entry, '{qty}', to_jsonb(v_entry_qty - v_alloc), true),
                true
              );
            end if;
          elsif jsonb_typeof(v_entry) = 'array' then
            select coalesce(sum(coalesce(nullif((x->>'qty'),'')::numeric, 0)), 0)
            into v_entry_qty
            from jsonb_array_elements(v_entry) as x
            where (x->>'orderId') = p_order_id::text;

            if (v_entry_qty + 1e-9) < v_alloc then
              raise exception 'Reserved qty mismatch for batch % (reserved %, deliver %)', v_batch.batch_id, v_entry_qty, v_alloc;
            end if;

            with elems as (
              select value, ordinality
              from jsonb_array_elements(v_entry) with ordinality
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
              v_reserved_batches := v_reserved_batches - v_batch.batch_id::text;
            else
              v_reserved_batches := jsonb_set(v_reserved_batches, array[v_batch.batch_id::text], v_entry_new, true);
            end if;
          else
            raise exception 'Invalid reservation entry for batch %', v_batch.batch_id;
          end if;
          v_batch_id := v_batch.batch_id;

          select im.unit_cost
          into v_unit_cost
          from public.inventory_movements im
          where im.batch_id = v_batch_id
            and im.movement_type = 'purchase_in'
          order by im.occurred_at asc
          limit 1;

          v_unit_cost := coalesce(v_unit_cost, v_avg_cost);
          v_total_cost := v_alloc * v_unit_cost;

          insert into public.order_item_cogs(order_id, item_id, quantity, unit_cost, total_cost, created_at)
          values (p_order_id, v_item_id_text, v_alloc, v_unit_cost, v_total_cost, now());

          insert into public.inventory_movements(
            item_id, movement_type, quantity, unit_cost, total_cost,
            reference_table, reference_id, occurred_at, created_by, data, batch_id
          )
          values (
            v_item_id_text, 'sale_out', v_alloc, v_unit_cost, v_total_cost,
            'orders', p_order_id::text, now(), auth.uid(),
            jsonb_build_object('orderId', p_order_id, 'batchId', v_batch_id, 'expiryDate', v_batch.expiry_date),
            v_batch_id
          )
          returning id into v_movement_id;

          perform public.post_inventory_movement(v_movement_id);

          v_remaining_needed := v_remaining_needed - v_alloc;
          exit when v_remaining_needed <= 0;
        end loop;
      else
        for v_batch in
          with purchases as (
            select
              im.batch_id,
              im.quantity as received_qty,
              case
                when (im.data->>'expiryDate') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then (im.data->>'expiryDate')::date
                else null
              end as expiry_date
            from public.inventory_movements im
            where im.item_id = v_item_id_text
              and im.movement_type = 'purchase_in'
              and im.batch_id is not null
          ),
          consumed as (
            select
              im.batch_id,
              sum(im.quantity) as consumed_qty
            from public.inventory_movements im
            where im.item_id = v_item_id_text
              and im.movement_type in ('sale_out','wastage_out','adjust_out','return_out')
              and im.batch_id is not null
            group by im.batch_id
          )
          select
            p.batch_id,
            p.expiry_date,
            greatest(coalesce(p.received_qty, 0) - coalesce(c.consumed_qty, 0), 0) as remaining_qty
          from purchases p
          left join consumed c on c.batch_id = p.batch_id
          where p.expiry_date is not null
            and p.expiry_date >= current_date
          order by p.expiry_date asc, p.batch_id asc
        loop
          if v_batch.expiry_date is null or v_batch.expiry_date < current_date then
            raise exception 'Cannot deliver expired or invalid food batch % for item %', v_batch.batch_id, v_item_id_text;
          end if;

          v_entry := v_reserved_batches->v_batch.batch_id::text;
          if v_entry is not null and jsonb_typeof(v_entry) = 'object' then
            if coalesce(nullif(v_entry->>'qty','')::numeric, 0) > 0 then
              continue;
            end if;
          elsif v_entry is not null and jsonb_typeof(v_entry) = 'array' then
            select coalesce(sum(coalesce(nullif((x->>'qty'),'')::numeric, 0)), 0)
            into v_entry_qty
            from jsonb_array_elements(v_entry) as x;
            if v_entry_qty > 0 then
              continue;
            end if;
          elsif v_entry is not null and jsonb_typeof(v_entry) = 'number' then
            if coalesce(nullif(v_entry::text,'')::numeric, 0) > 0 then
              continue;
            end if;
          end if;

          v_effective_remaining := coalesce(v_batch.remaining_qty, 0);
          if v_effective_remaining <= 0 then
            continue;
          end if;
          v_alloc := least(v_remaining_needed, v_effective_remaining);
          v_batch_id := v_batch.batch_id;

          select im.unit_cost
          into v_unit_cost
          from public.inventory_movements im
          where im.batch_id = v_batch_id
            and im.movement_type = 'purchase_in'
          order by im.occurred_at asc
          limit 1;

          v_unit_cost := coalesce(v_unit_cost, v_avg_cost);
          v_total_cost := v_alloc * v_unit_cost;

          insert into public.order_item_cogs(order_id, item_id, quantity, unit_cost, total_cost, created_at)
          values (p_order_id, v_item_id_text, v_alloc, v_unit_cost, v_total_cost, now());

          insert into public.inventory_movements(
            item_id, movement_type, quantity, unit_cost, total_cost,
            reference_table, reference_id, occurred_at, created_by, data, batch_id
          )
          values (
            v_item_id_text, 'sale_out', v_alloc, v_unit_cost, v_total_cost,
            'orders', p_order_id::text, now(), auth.uid(),
            jsonb_build_object('orderId', p_order_id, 'batchId', v_batch_id, 'expiryDate', v_batch.expiry_date),
            v_batch_id
          )
          returning id into v_movement_id;

          perform public.post_inventory_movement(v_movement_id);

          v_remaining_needed := v_remaining_needed - v_alloc;
          exit when v_remaining_needed <= 0;
        end loop;
      end if;

      if v_remaining_needed > 0 then
        raise exception 'Insufficient non-expired stock for food item % (remaining %)', v_item_id_text, v_remaining_needed;
      end if;

      if coalesce(v_stock_item_id_is_uuid, false) then
        update public.stock_management
        set available_quantity = greatest(0, available_quantity - v_requested),
            reserved_quantity = case
              when coalesce(v_is_in_store, false) then reserved_quantity
              else greatest(0, reserved_quantity - v_requested)
            end,
            last_updated = now(),
            updated_at = now(),
            data = case
              when v_use_reserved then jsonb_set(coalesce(v_stock_data, '{}'::jsonb), '{reservedBatches}', v_reserved_batches, true)
              else coalesce(v_stock_data, '{}'::jsonb)
            end
        where item_id = v_item_id_uuid;
      else
        update public.stock_management
        set available_quantity = greatest(0, available_quantity - v_requested),
            reserved_quantity = case
              when coalesce(v_is_in_store, false) then reserved_quantity
              else greatest(0, reserved_quantity - v_requested)
            end,
            last_updated = now(),
            updated_at = now(),
            data = case
              when v_use_reserved then jsonb_set(coalesce(v_stock_data, '{}'::jsonb), '{reservedBatches}', v_reserved_batches, true)
              else coalesce(v_stock_data, '{}'::jsonb)
            end
        where item_id::text = v_item_id_text;
      end if;
    end if;
  end loop;
end;
$$;
revoke all on function public.deduct_stock_on_delivery_v2(uuid, jsonb) from public;
revoke execute on function public.deduct_stock_on_delivery_v2(uuid, jsonb) from anon;
grant execute on function public.deduct_stock_on_delivery_v2(uuid, jsonb) to authenticated;

