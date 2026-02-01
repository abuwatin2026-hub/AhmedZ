-- Enforce warehouse-aware stock operations
-- Minimal changes: require p_warehouse_id and scope all stock operations to (item_id, warehouse_id)
-- No table or UI changes

-- Drop legacy signatures to avoid accidental usage without warehouse
drop function if exists public.reserve_stock_for_order(jsonb);
drop function if exists public.reserve_stock_for_order(jsonb, uuid);
drop function if exists public.release_reserved_stock_for_order(jsonb);
drop function if exists public.release_reserved_stock_for_order(jsonb, uuid);
drop function if exists public.deduct_stock_on_delivery_v2(uuid, jsonb);
drop function if exists public.confirm_order_delivery(uuid, jsonb, jsonb);

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
  v_item jsonb;
  v_item_id_text text;
  v_item_id_uuid uuid;
  v_requested numeric;
  v_available numeric;
  v_reserved numeric;
  v_stock_data jsonb;
  v_is_food boolean;
  v_last_batch_id uuid;
  v_item_batch_text text;
  v_res_batches jsonb;
  v_existing_entry jsonb;
  v_existing_list jsonb;
  v_new_list jsonb;
  v_batch_reserved numeric;
  v_free numeric;
begin
  if p_warehouse_id is null then
    raise exception 'warehouse_id is required';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    raise exception 'p_items must be a json array';
  end if;

  for v_item in select value from jsonb_array_elements(p_items)
  loop
    v_item_id_text := coalesce(v_item->>'itemId', v_item->>'id');
    v_requested := coalesce(nullif(v_item->>'quantity','')::numeric, 0);
    v_item_batch_text := nullif(v_item->>'batchId', '');
    if v_item_id_text is null or v_item_id_text = '' then
      raise exception 'Invalid itemId';
    end if;
    if v_requested <= 0 then
      raise exception 'Invalid requested quantity for item %', v_item_id_text;
    end if;

    begin
      v_item_id_uuid := v_item_id_text::uuid;
    exception when others then
      v_item_id_uuid := null;
    end;

    select coalesce(mi.category = 'food', false)
    into v_is_food
    from public.menu_items mi
    where mi.id = v_item_id_text;

    if v_item_id_uuid is not null and not found then
      select coalesce(mi.category = 'food', false)
      into v_is_food
      from public.menu_items mi
      where mi.id = v_item_id_uuid::text;
    end if;

    select
      coalesce(sm.available_quantity, 0),
      coalesce(sm.reserved_quantity, 0),
      coalesce(sm.data, '{}'::jsonb),
      sm.last_batch_id
    into v_available, v_reserved, v_stock_data, v_last_batch_id
    from public.stock_management sm
    where (case when v_item_id_uuid is not null then sm.item_id = v_item_id_uuid else sm.item_id::text = v_item_id_text end)
      and sm.warehouse_id = p_warehouse_id
    for update;

    if not found then
      raise exception 'Stock record not found for item % in warehouse %', v_item_id_text, p_warehouse_id;
    end if;

    if not coalesce(v_is_food, false) then
      if (v_available - v_reserved) + 1e-9 < v_requested then
        raise exception 'Insufficient stock for item % in warehouse % (available %, reserved %, requested %)', v_item_id_text, p_warehouse_id, v_available, v_reserved, v_requested;
      end if;

      update public.stock_management
      set reserved_quantity = reserved_quantity + v_requested,
          last_updated = now(),
          updated_at = now()
      where (case when v_item_id_uuid is not null then item_id = v_item_id_uuid else item_id::text = v_item_id_text end)
        and warehouse_id = p_warehouse_id;
    else
      if p_order_id is null then
        raise exception 'p_order_id is required for food reservations (item %, warehouse %)', v_item_id_text, p_warehouse_id;
      end if;

      v_res_batches := coalesce(v_stock_data->'reservedBatches', '{}'::jsonb);

      if v_item_batch_text is not null then
        select 
          greatest(coalesce(b.quantity_received,0) - coalesce(b.quantity_consumed,0), 0) as remaining
        into v_available
        from public.batches b
        where b.id = v_item_batch_text::uuid
          and b.item_id = v_item_id_text
          and b.warehouse_id = p_warehouse_id
        for update;
        if not found then
          raise exception 'Batch % not found for item % in warehouse %', v_item_batch_text, v_item_id_text, p_warehouse_id;
        end if;
        if v_available + 1e-9 < v_requested then
          raise exception 'Insufficient batch remaining for item % in warehouse % (batch %, remaining %, requested %)', v_item_id_text, p_warehouse_id, v_item_batch_text, v_available, v_requested;
        end if;

        v_existing_entry := v_res_batches->v_item_batch_text;
        v_existing_list :=
          case
            when v_existing_entry is null then '[]'::jsonb
            when jsonb_typeof(v_existing_entry) = 'array' then v_existing_entry
            when jsonb_typeof(v_existing_entry) = 'object' then jsonb_build_array(v_existing_entry)
            else '[]'::jsonb
          end;

        select coalesce(sum(coalesce(nullif(x->>'qty','')::numeric, 0)), 0)
        into v_batch_reserved
        from jsonb_array_elements(v_existing_list) as x;

        v_free := greatest(coalesce(v_available, 0) - coalesce(v_batch_reserved, 0), 0);
        if v_free + 1e-9 < v_requested then
          raise exception 'Insufficient non-reserved batch remaining for item % in warehouse % (batch %, free %, requested %)', v_item_id_text, p_warehouse_id, v_item_batch_text, v_free, v_requested;
        end if;

        with elems as (
          select value, ordinality
          from jsonb_array_elements(v_existing_list) with ordinality
        )
        select
          case
            when exists (select 1 from elems where (value->>'orderId') = p_order_id::text) then (
              select coalesce(
                jsonb_agg(
                  case
                    when (value->>'orderId') = p_order_id::text then
                      jsonb_set(
                        jsonb_set(value, '{batchId}', to_jsonb(v_item_batch_text), true),
                        '{qty}',
                        to_jsonb(coalesce(nullif(value->>'qty','')::numeric, 0) + v_requested),
                        true
                      )
                    else value
                  end
                  order by ordinality
                ),
                '[]'::jsonb
              )
            )
            else (
              (select coalesce(jsonb_agg(value order by ordinality), '[]'::jsonb) from elems)
              || jsonb_build_array(jsonb_build_object('orderId', p_order_id, 'batchId', v_item_batch_text, 'qty', v_requested))
            )
          end
        into v_new_list;

        v_res_batches := jsonb_set(v_res_batches, array[v_item_batch_text], v_new_list, true);

        update public.stock_management
        set reserved_quantity = reserved_quantity + v_requested,
            last_updated = now(),
            updated_at = now(),
            data = jsonb_set(coalesce(v_stock_data, '{}'::jsonb), '{reservedBatches}', v_res_batches, true)
        where (case when v_item_id_uuid is not null then item_id = v_item_id_uuid else item_id::text = v_item_id_text end)
          and warehouse_id = p_warehouse_id;
      else
        declare
          v_remaining_needed numeric := v_requested;
          v_batch record;
          v_batch_remaining numeric;
          v_entry_new jsonb;
          v_to_add numeric;
        begin
          for v_batch in
            select 
              b.id as batch_id,
              greatest(coalesce(b.quantity_received,0) - coalesce(b.quantity_consumed,0), 0) as remaining
            from public.batches b
            where b.item_id = v_item_id_text
              and b.warehouse_id = p_warehouse_id
              and (b.expiry_date is null or b.expiry_date >= current_date)
              and greatest(coalesce(b.quantity_received,0) - coalesce(b.quantity_consumed,0), 0) > 0
            order by b.expiry_date asc nulls last, b.created_at asc, b.id asc
            for update
          loop
            exit when v_remaining_needed <= 0;
            v_batch_remaining := coalesce(v_batch.remaining, 0);
            if v_batch_remaining <= 0 then
              continue;
            end if;
            v_existing_entry := v_res_batches->v_batch.batch_id::text;
            v_existing_list :=
              case
                when v_existing_entry is null then '[]'::jsonb
                when jsonb_typeof(v_existing_entry) = 'array' then v_existing_entry
                when jsonb_typeof(v_existing_entry) = 'object' then jsonb_build_array(v_existing_entry)
                else '[]'::jsonb
              end;

            select coalesce(sum(coalesce(nullif(x->>'qty','')::numeric, 0)), 0)
            into v_batch_reserved
            from jsonb_array_elements(v_existing_list) as x;

            v_free := greatest(coalesce(v_batch_remaining, 0) - coalesce(v_batch_reserved, 0), 0);
            v_to_add := least(v_remaining_needed, v_free);
            if v_to_add <= 0 then
              continue;
            end if;

            with elems as (
              select value, ordinality
              from jsonb_array_elements(v_existing_list) with ordinality
            )
            select
              case
                when exists (select 1 from elems where (value->>'orderId') = p_order_id::text) then (
                  select coalesce(
                    jsonb_agg(
                      case
                        when (value->>'orderId') = p_order_id::text then
                          jsonb_set(
                            value,
                            '{qty}',
                            to_jsonb(coalesce(nullif(value->>'qty','')::numeric, 0) + v_to_add),
                            true
                          )
                        else value
                      end
                      order by ordinality
                    ),
                    '[]'::jsonb
                  )
                )
                else (
                  (select coalesce(jsonb_agg(value order by ordinality), '[]'::jsonb) from elems)
                  || jsonb_build_array(jsonb_build_object('orderId', p_order_id, 'batchId', v_batch.batch_id::text, 'qty', v_to_add))
                )
              end
            into v_entry_new;
            v_res_batches := jsonb_set(v_res_batches, array[v_batch.batch_id::text], v_entry_new, true);
            v_remaining_needed := v_remaining_needed - v_to_add;
          end loop;
          if v_remaining_needed > 0 then
            raise exception 'Insufficient batch stock for item % in warehouse % (needed %, reserved %)', v_item_id_text, p_warehouse_id, v_requested, (v_requested - v_remaining_needed);
          end if;
          update public.stock_management
          set reserved_quantity = reserved_quantity + v_requested,
              last_updated = now(),
              updated_at = now(),
              data = jsonb_set(coalesce(v_stock_data, '{}'::jsonb), '{reservedBatches}', v_res_batches, true)
          where (case when v_item_id_uuid is not null then item_id = v_item_id_uuid else item_id::text = v_item_id_text end)
            and warehouse_id = p_warehouse_id;
        end;
      end if;
    end if;
  end loop;
end;
$$;
revoke all on function public.reserve_stock_for_order(jsonb, uuid, uuid) from public;
grant execute on function public.reserve_stock_for_order(jsonb, uuid, uuid) to anon, authenticated;

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
  v_item jsonb;
  v_item_id_text text;
  v_item_id_uuid uuid;
  v_requested numeric;
  v_is_food boolean;
  v_stock_data jsonb;
  v_res_batches jsonb;
  v_entry jsonb;
  v_entry_new jsonb;
  v_release_remaining numeric;
  v_released_total numeric;
  v_item_batch_text text;
begin
  if p_warehouse_id is null then
    raise exception 'warehouse_id is required';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    raise exception 'p_items must be a json array';
  end if;

  for v_item in select value from jsonb_array_elements(p_items)
  loop
    v_item_id_text := coalesce(v_item->>'itemId', v_item->>'id');
    v_requested := coalesce(nullif(v_item->>'quantity','')::numeric, 0);
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

    select coalesce(mi.category = 'food', false)
    into v_is_food
    from public.menu_items mi
    where mi.id = v_item_id_text;
    if v_item_id_uuid is not null and not found then
      select coalesce(mi.category = 'food', false)
      into v_is_food
      from public.menu_items mi
      where mi.id = v_item_id_uuid::text;
    end if;

    select coalesce(sm.data, '{}'::jsonb)
    into v_stock_data
    from public.stock_management sm
    where (case when v_item_id_uuid is not null then sm.item_id = v_item_id_uuid else sm.item_id::text = v_item_id_text end)
      and sm.warehouse_id = p_warehouse_id
    for update;

    if not found then
      raise exception 'Stock record not found for item % in warehouse %', v_item_id_text, p_warehouse_id;
    end if;

    if not coalesce(v_is_food, false) then
      update public.stock_management
      set reserved_quantity = greatest(0, reserved_quantity - v_requested),
          last_updated = now(),
          updated_at = now()
      where (case when v_item_id_uuid is not null then item_id = v_item_id_uuid else item_id::text = v_item_id_text end)
        and warehouse_id = p_warehouse_id;
    else
      v_res_batches := coalesce(v_stock_data->'reservedBatches', '{}'::jsonb);
      if p_order_id is null then
        raise exception 'p_order_id is required to release food reservations (item %, warehouse %)', v_item_id_text, p_warehouse_id;
      end if;

      v_release_remaining := v_requested;
      v_released_total := 0;

      if v_item_batch_text is not null then
        v_entry := v_res_batches->v_item_batch_text;
        if v_entry is null then
          continue;
        end if;
        if jsonb_typeof(v_entry) = 'object' then
          if (v_entry->>'orderId') <> p_order_id::text then
            raise exception 'Reservation ownership mismatch for batch % (expected order %, found %)', v_item_batch_text, p_order_id, (v_entry->>'orderId');
          end if;
          if (coalesce(nullif(v_entry->>'qty','')::numeric, 0) - v_release_remaining) <= 0 then
            v_res_batches := v_res_batches - v_item_batch_text;
            v_released_total := v_released_total + coalesce(nullif(v_entry->>'qty','')::numeric, 0);
          else
            v_res_batches := jsonb_set(
              v_res_batches,
              array[v_item_batch_text],
              jsonb_set(v_entry, '{qty}', to_jsonb(coalesce(nullif(v_entry->>'qty','')::numeric, 0) - v_release_remaining), true),
              true
            );
            v_released_total := v_released_total + v_release_remaining;
          end if;
        elsif jsonb_typeof(v_entry) = 'array' then
          with elems as (
            select value, ordinality
            from jsonb_array_elements(v_entry) with ordinality
          ),
          updated as (
            select
              case
                when (value->>'orderId') = p_order_id::text then
                  case
                    when (coalesce(nullif(value->>'qty','')::numeric, 0) - v_release_remaining) <= 0 then null
                    else jsonb_set(value, '{qty}', to_jsonb(coalesce(nullif(value->>'qty','')::numeric, 0) - v_release_remaining), true)
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
            v_res_batches := v_res_batches - v_item_batch_text;
            v_released_total := v_released_total + v_release_remaining;
          else
            v_res_batches := jsonb_set(v_res_batches, array[v_item_batch_text], v_entry_new, true);
            v_released_total := v_released_total + v_release_remaining;
          end if;
        end if;
      end if;

      update public.stock_management
      set reserved_quantity = greatest(0, reserved_quantity - v_released_total),
          last_updated = now(),
          updated_at = now(),
          data = jsonb_set(coalesce(v_stock_data, '{}'::jsonb), '{reservedBatches}', v_res_batches, true)
      where (case when v_item_id_uuid is not null then item_id = v_item_id_uuid else item_id::text = v_item_id_text end)
        and warehouse_id = p_warehouse_id;
    end if;
  end loop;
end;
$$;
revoke all on function public.release_reserved_stock_for_order(jsonb, uuid, uuid) from public;
grant execute on function public.release_reserved_stock_for_order(jsonb, uuid, uuid) to anon, authenticated;

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
  v_unit_cost numeric;
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
  v_entry_qty numeric;
  v_entry_new jsonb;
begin
  if p_order_id is null then
    raise exception 'p_order_id is required';
  end if;
  if p_warehouse_id is null then
    raise exception 'warehouse_id is required';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    raise exception 'p_items must be a json array';
  end if;

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

    -- تخصيص FEFO على مستوى الدُفعات مع قفل صفّي
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
      -- إن تم تمرير batchId، ابدأ به أولاً
      if v_item_batch_text is not null then
        select 
          b.id as batch_id,
          b.unit_cost,
          b.expiry_date,
          greatest(coalesce(b.quantity_received,0) - coalesce(b.quantity_consumed,0), 0) as remaining
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
          raise exception 'Cannot deliver expired batch % for item %', v_batch.batch_id, v_item_id_text;
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

      -- تخصيص ما تبقى وفق FEFO من جدول الدُفعات
      for v_batch in
        select 
          b.id as batch_id,
          b.unit_cost,
          b.expiry_date,
          greatest(coalesce(b.quantity_received,0) - coalesce(b.quantity_consumed,0), 0) as remaining
        from public.batches b
        where b.item_id = v_item_id_text
          and b.warehouse_id = p_warehouse_id
          and (b.expiry_date is null or b.expiry_date >= current_date)
          and greatest(coalesce(b.quantity_received,0) - coalesce(b.quantity_consumed,0), 0) > 0
          and (v_item_batch_text is null or b.id <> v_item_batch_text::uuid)
        order by b.expiry_date asc nulls last, b.created_at asc, b.id asc
        for update
      loop
        exit when v_remaining_needed <= 0;
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

    -- تم إدراج الحركات لكل تخصيص دفعي أعلاه
  end loop;
end;
$$;
revoke all on function public.deduct_stock_on_delivery_v2(uuid, jsonb, uuid) from public;
grant execute on function public.deduct_stock_on_delivery_v2(uuid, jsonb, uuid) to anon, authenticated;

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
    if p_warehouse_id is null then
      raise exception 'warehouse_id is required';
    end if;

    select *
    into v_order
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
    ) then
      update public.orders
      set status = 'delivered',
          data = p_updated_data,
          updated_at = now()
      where id = p_order_id;
      return;
    end if;

    perform public.deduct_stock_on_delivery_v2(p_order_id, p_items, p_warehouse_id);
    update public.orders
    set status = 'delivered',
        data = p_updated_data,
        updated_at = now()
    where id = p_order_id;
end;
$$;
grant execute on function public.confirm_order_delivery(uuid, jsonb, jsonb, uuid) to authenticated;

-- Backward-compat stubs that enforce explicit warehouse_id
create or replace function public.reserve_stock_for_order(p_items jsonb, p_order_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  raise exception 'warehouse_id is required';
end;
$$;
grant execute on function public.reserve_stock_for_order(jsonb, uuid) to anon, authenticated;

create or replace function public.release_reserved_stock_for_order(p_items jsonb, p_order_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  raise exception 'warehouse_id is required';
end;
$$;
grant execute on function public.release_reserved_stock_for_order(jsonb, uuid) to anon, authenticated;

create or replace function public.deduct_stock_on_delivery_v2(p_order_id uuid, p_items jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  raise exception 'warehouse_id is required';
end;
$$;
grant execute on function public.deduct_stock_on_delivery_v2(uuid, jsonb) to anon, authenticated;

create or replace function public.confirm_order_delivery(
    p_order_id uuid,
    p_items jsonb,
    p_updated_data jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  raise exception 'warehouse_id is required';
end;
$$;
grant execute on function public.confirm_order_delivery(uuid, jsonb, jsonb) to authenticated;
