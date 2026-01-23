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
  v_entry jsonb;
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
          greatest(coalesce(b.quantity_received,0) - coalesce(b.quantity_consumed,0) - coalesce(b.quantity_transferred,0), 0) as remaining
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
              greatest(coalesce(b.quantity_received,0) - coalesce(b.quantity_consumed,0) - coalesce(b.quantity_transferred,0), 0) as remaining
            from public.batches b
            where b.item_id = v_item_id_text
              and b.warehouse_id = p_warehouse_id
              and (b.expiry_date is null or b.expiry_date >= current_date)
              and greatest(coalesce(b.quantity_received,0) - coalesce(b.quantity_consumed,0) - coalesce(b.quantity_transferred,0), 0) > 0
            order by b.expiry_date asc nulls last, b.created_at asc, b.id asc
            for update
          loop
            exit when v_remaining_needed <= 0;
            v_batch_remaining := coalesce(v_batch.remaining, 0);
            if v_batch_remaining <= 0 then
              continue;
            end if;
            v_entry := v_res_batches->(v_batch.batch_id::text);
            v_existing_list :=
              case
                when v_entry is null then '[]'::jsonb
                when jsonb_typeof(v_entry) = 'array' then v_entry
                when jsonb_typeof(v_entry) = 'object' then jsonb_build_array(v_entry)
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

create or replace function public.inv_negative_stock()
returns table(
  item_id text,
  warehouse_id uuid,
  available_quantity numeric,
  reserved_quantity numeric
)
language sql
security definer
set search_path = public
as $$
  select sm.item_id::text, sm.warehouse_id, sm.available_quantity, sm.reserved_quantity
  from public.stock_management sm
  where sm.available_quantity < 0
     or sm.reserved_quantity < 0;
$$;

create or replace function public.inv_negative_batch_remaining()
returns table(
  batch_id uuid,
  item_id text,
  warehouse_id uuid,
  quantity_received numeric,
  quantity_consumed numeric,
  quantity_transferred numeric,
  remaining_qty numeric
)
language sql
security definer
set search_path = public
as $$
  select
    b.id,
    b.item_id::text,
    b.warehouse_id,
    b.quantity_received,
    b.quantity_consumed,
    b.quantity_transferred,
    (coalesce(b.quantity_received,0) - coalesce(b.quantity_consumed,0) - coalesce(b.quantity_transferred,0)) as remaining_qty
  from public.batches b
  where (coalesce(b.quantity_received,0) - coalesce(b.quantity_consumed,0) - coalesce(b.quantity_transferred,0)) < -0.0001;
$$;

create or replace function public.inv_duplicate_sale_out_lines()
returns table(
  order_id text,
  item_id text,
  batch_id uuid,
  warehouse_id uuid,
  cnt bigint
)
language sql
security definer
set search_path = public
as $$
  select
    im.reference_id as order_id,
    im.item_id,
    im.batch_id,
    im.warehouse_id,
    count(*) as cnt
  from public.inventory_movements im
  where im.reference_table = 'orders'
    and im.movement_type = 'sale_out'
    and im.batch_id is not null
  group by 1,2,3,4
  having count(*) > 1;
$$;

create or replace function public.inv_duplicate_transfer_movements()
returns table(
  transfer_id text,
  movement_type text,
  item_id text,
  batch_id uuid,
  warehouse_id uuid,
  cnt bigint
)
language sql
security definer
set search_path = public
as $$
  select
    im.reference_id as transfer_id,
    im.movement_type,
    im.item_id,
    im.batch_id,
    im.warehouse_id,
    count(*) as cnt
  from public.inventory_movements im
  where im.reference_table = 'inventory_transfers'
    and im.movement_type in ('transfer_out','transfer_in')
  group by 1,2,3,4,5
  having count(*) > 1;
$$;

create or replace function public.inv_journal_entries_for_transfer_movements()
returns table(
  journal_entry_id uuid,
  movement_id uuid,
  movement_type text
)
language sql
security definer
set search_path = public
as $$
  select
    je.id as journal_entry_id,
    im.id as movement_id,
    im.movement_type
  from public.journal_entries je
  join public.inventory_movements im
    on je.source_table = 'inventory_movements'
   and je.source_id = im.id::text
  where im.movement_type in ('transfer_out','transfer_in');
$$;

create or replace function public.inv_cogs_outside_inventory_movements()
returns table(
  journal_entry_id uuid,
  movement_id uuid,
  movement_type text,
  cogs_account_id uuid
)
language sql
security definer
set search_path = public
as $$
  with cogs as (
    select public.get_account_id_by_code('5010') as account_id
  )
  select
    je.id as journal_entry_id,
    im.id as movement_id,
    im.movement_type,
    c.account_id as cogs_account_id
  from public.journal_entries je
  join public.inventory_movements im
    on je.source_table = 'inventory_movements'
   and je.source_id = im.id::text
  join public.journal_lines jl
    on jl.journal_entry_id = je.id
  cross join cogs c
  where c.account_id is not null
    and jl.account_id = c.account_id
    and im.movement_type not in ('sale_out','expired_out','wastage_out');
$$;

create or replace function public.dispatch_inventory_transfer(
  p_transfer_id uuid,
  p_idempotency_key text default null,
  p_cancel boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid;
  v_transfer record;
  v_item record;
  v_sm record;
  v_reserved_batches jsonb;
  v_reserved_list jsonb;
  v_reserved_sum numeric;
  v_remaining numeric;
  v_expiry_date date;
  v_movement_id uuid;
begin
  v_actor := auth.uid();
  if not public.is_admin() then
    raise exception 'not allowed';
  end if;
  if p_transfer_id is null then
    raise exception 'p_transfer_id is required';
  end if;

  perform pg_advisory_xact_lock(hashtext(p_transfer_id::text));

  select *
  into v_transfer
  from public.inventory_transfers it
  where it.id = p_transfer_id
  for update;

  if not found then
    raise exception 'transfer not found';
  end if;

  if p_idempotency_key is not null and btrim(p_idempotency_key) <> '' then
    if v_transfer.dispatch_idempotency_key is not null and v_transfer.dispatch_idempotency_key = p_idempotency_key then
      return jsonb_build_object('status', v_transfer.state, 'transferId', p_transfer_id::text);
    end if;
  end if;

  if v_transfer.state = 'CANCELLED' then
    return jsonb_build_object('status', 'CANCELLED', 'transferId', p_transfer_id::text);
  end if;

  if p_cancel then
    if v_transfer.state <> 'CREATED' then
      raise exception 'cannot cancel transfer in state %', v_transfer.state;
    end if;
    update public.inventory_transfers
    set state = 'CANCELLED',
        updated_at = now(),
        dispatch_idempotency_key = nullif(btrim(p_idempotency_key), '')
    where id = p_transfer_id;
    return jsonb_build_object('status', 'CANCELLED', 'transferId', p_transfer_id::text);
  end if;

  if v_transfer.state <> 'CREATED' then
    return jsonb_build_object('status', v_transfer.state, 'transferId', p_transfer_id::text);
  end if;

  for v_item in
    select *
    from public.inventory_transfer_items iti
    where iti.transfer_id = p_transfer_id
    order by iti.created_at asc, iti.id asc
    for update
  loop
    if exists (
      select 1
      from public.inventory_movements im
      where im.reference_table = 'inventory_transfers'
        and im.reference_id = p_transfer_id::text
        and im.movement_type = 'transfer_out'
        and im.item_id = v_item.item_id
        and im.batch_id = v_item.source_batch_id
        and im.warehouse_id is not distinct from v_transfer.from_warehouse_id
    ) then
      update public.inventory_transfer_items
      set dispatched_qty = quantity,
          updated_at = now()
      where id = v_item.id;
      continue;
    end if;

    select *
    into v_sm
    from public.stock_management sm
    where sm.item_id::text = v_item.item_id
      and sm.warehouse_id = v_transfer.from_warehouse_id
    for update;

    if not found then
      raise exception 'Stock record not found for item % in source warehouse', v_item.item_id;
    end if;

    if (coalesce(v_sm.available_quantity,0) - coalesce(v_sm.reserved_quantity,0)) + 1e-9 < v_item.quantity then
      raise exception 'Insufficient non-reserved stock for item % in source warehouse', v_item.item_id;
    end if;

    select
      greatest(
        coalesce(b.quantity_received,0)
        - coalesce(b.quantity_consumed,0)
        - coalesce(b.quantity_transferred,0),
        0
      ),
      b.expiry_date
    into v_remaining, v_expiry_date
    from public.batches b
    where b.id = v_item.source_batch_id
      and b.warehouse_id = v_transfer.from_warehouse_id
    for update;

    if not found then
      raise exception 'Batch not found for transfer item';
    end if;

    if v_expiry_date is not null and v_expiry_date < current_date then
      raise exception 'BATCH_EXPIRED';
    end if;

    v_reserved_batches := coalesce(v_sm.data->'reservedBatches', '{}'::jsonb);
    v_reserved_list := v_reserved_batches->(v_item.source_batch_id::text);
    if v_reserved_list is not null then
      v_reserved_list :=
        case
          when jsonb_typeof(v_reserved_list) = 'array' then v_reserved_list
          when jsonb_typeof(v_reserved_list) = 'object' then jsonb_build_array(v_reserved_list)
          else '[]'::jsonb
        end;
      select coalesce(sum(coalesce(nullif(x->>'qty','')::numeric, 0)), 0)
      into v_reserved_sum
      from jsonb_array_elements(v_reserved_list) as x;
      if coalesce(v_reserved_sum,0) > 0 then
        raise exception 'Cannot transfer reserved batch stock';
      end if;
    end if;

    if coalesce(v_remaining,0) + 1e-9 < v_item.quantity then
      raise exception 'Insufficient batch remaining for transfer';
    end if;

    update public.batches
    set quantity_transferred = quantity_transferred + v_item.quantity
    where id = v_item.source_batch_id;

    update public.stock_management
    set available_quantity = greatest(0, available_quantity - v_item.quantity),
        last_updated = now(),
        updated_at = now()
    where item_id::text = v_item.item_id
      and warehouse_id = v_transfer.from_warehouse_id;

    insert into public.inventory_movements(
      item_id, movement_type, quantity, unit_cost, total_cost,
      reference_table, reference_id, occurred_at, created_by, data, batch_id, warehouse_id
    )
    values (
      v_item.item_id,
      'transfer_out',
      v_item.quantity,
      v_item.unit_cost,
      0,
      'inventory_transfers',
      p_transfer_id::text,
      now(),
      v_actor,
      jsonb_build_object(
        'transferId', p_transfer_id,
        'direction', 'out',
        'fromWarehouseId', v_transfer.from_warehouse_id,
        'toWarehouseId', v_transfer.to_warehouse_id,
        'sourceBatchId', v_item.source_batch_id
      ),
      v_item.source_batch_id,
      v_transfer.from_warehouse_id
    )
    returning id into v_movement_id;

    perform public.post_inventory_movement(v_movement_id);

    update public.inventory_transfer_items
    set dispatched_qty = quantity,
        updated_at = now()
    where id = v_item.id;
  end loop;

  update public.inventory_transfers
  set state = 'IN_TRANSIT',
      dispatched_by = v_actor,
      dispatched_at = now(),
      updated_at = now(),
      dispatch_idempotency_key = nullif(btrim(p_idempotency_key), '')
  where id = p_transfer_id;

  return jsonb_build_object('status', 'IN_TRANSIT', 'transferId', p_transfer_id::text);
end;
$$;

create or replace function public.receive_inventory_transfer(
  p_transfer_id uuid,
  p_idempotency_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid;
  v_transfer record;
  v_item record;
  v_source_batch record;
  v_dest_batch_id uuid;
  v_old_qty numeric;
  v_old_avg numeric;
  v_new_qty numeric;
  v_new_avg numeric;
  v_movement_id uuid;
begin
  v_actor := auth.uid();
  if not public.is_admin() then
    raise exception 'not allowed';
  end if;
  if p_transfer_id is null then
    raise exception 'p_transfer_id is required';
  end if;

  perform pg_advisory_xact_lock(hashtext(p_transfer_id::text));

  select *
  into v_transfer
  from public.inventory_transfers it
  where it.id = p_transfer_id
  for update;

  if not found then
    raise exception 'transfer not found';
  end if;

  if p_idempotency_key is not null and btrim(p_idempotency_key) <> '' then
    if v_transfer.receive_idempotency_key is not null and v_transfer.receive_idempotency_key = p_idempotency_key then
      return jsonb_build_object('status', v_transfer.state, 'transferId', p_transfer_id::text);
    end if;
  end if;

  if v_transfer.state = 'RECEIVED' then
    return jsonb_build_object('status', 'RECEIVED', 'transferId', p_transfer_id::text);
  end if;

  if v_transfer.state <> 'IN_TRANSIT' then
    raise exception 'cannot receive transfer in state %', v_transfer.state;
  end if;

  for v_item in
    select *
    from public.inventory_transfer_items iti
    where iti.transfer_id = p_transfer_id
    order by iti.created_at asc, iti.id asc
    for update
  loop
    if coalesce(v_item.received_qty, 0) > 0 then
      continue;
    end if;

    if v_item.received_batch_id is null then
      update public.inventory_transfer_items
      set received_batch_id = gen_random_uuid()
      where id = v_item.id
        and received_batch_id is null
      returning received_batch_id into v_dest_batch_id;

      if v_dest_batch_id is null then
        continue;
      end if;
    else
      v_dest_batch_id := v_item.received_batch_id;
    end if;

    if exists (
      select 1
      from public.inventory_movements im
      where im.reference_table = 'inventory_transfers'
        and im.reference_id = p_transfer_id::text
        and im.movement_type = 'transfer_in'
        and im.item_id = v_item.item_id
        and im.batch_id = v_dest_batch_id
        and im.warehouse_id is not distinct from v_transfer.to_warehouse_id
    ) then
      update public.inventory_transfer_items
      set received_qty = quantity,
          received_batch_id = v_dest_batch_id,
          updated_at = now()
      where id = v_item.id;
      continue;
    end if;

    select *
    into v_source_batch
    from public.batches b
    where b.id = v_item.source_batch_id
    for update;

    if not found then
      raise exception 'source batch not found';
    end if;

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
      quantity_transferred,
      unit_cost,
      data
    )
    values (
      v_dest_batch_id,
      v_item.item_id,
      null,
      null,
      v_transfer.to_warehouse_id,
      v_source_batch.batch_code,
      v_source_batch.production_date,
      v_source_batch.expiry_date,
      v_item.quantity,
      0,
      0,
      v_item.unit_cost,
      jsonb_build_object(
        'source', 'inventory_transfer',
        'transferId', p_transfer_id,
        'sourceBatchId', v_item.source_batch_id,
        'fromWarehouseId', v_transfer.from_warehouse_id
      )
    )
    on conflict (id) do nothing;

    select coalesce(sm.available_quantity,0), coalesce(sm.avg_cost,0)
    into v_old_qty, v_old_avg
    from public.stock_management sm
    where sm.item_id::text = v_item.item_id
      and sm.warehouse_id = v_transfer.to_warehouse_id
    for update;

    if not found then
      insert into public.stock_management(item_id, warehouse_id, available_quantity, reserved_quantity, unit, low_stock_threshold, avg_cost, last_updated, updated_at, data)
      select mi.id, v_transfer.to_warehouse_id, 0, 0, coalesce(mi.unit_type,'piece'), 5, 0, now(), now(), '{}'::jsonb
      from public.menu_items mi
      where mi.id = v_item.item_id
      on conflict (item_id, warehouse_id) do nothing;

      select coalesce(sm.available_quantity,0), coalesce(sm.avg_cost,0)
      into v_old_qty, v_old_avg
      from public.stock_management sm
      where sm.item_id::text = v_item.item_id
        and sm.warehouse_id = v_transfer.to_warehouse_id
      for update;
    end if;

    v_new_qty := v_old_qty + v_item.quantity;
    if v_new_qty <= 0 then
      v_new_avg := v_item.unit_cost;
    else
      v_new_avg := ((v_old_qty * v_old_avg) + (v_item.quantity * v_item.unit_cost)) / v_new_qty;
    end if;

    update public.stock_management
    set available_quantity = available_quantity + v_item.quantity,
        avg_cost = v_new_avg,
        last_updated = now(),
        updated_at = now()
    where item_id::text = v_item.item_id
      and warehouse_id = v_transfer.to_warehouse_id;

    insert into public.inventory_movements(
      item_id, movement_type, quantity, unit_cost, total_cost,
      reference_table, reference_id, occurred_at, created_by, data, batch_id, warehouse_id
    )
    values (
      v_item.item_id,
      'transfer_in',
      v_item.quantity,
      v_item.unit_cost,
      0,
      'inventory_transfers',
      p_transfer_id::text,
      now(),
      v_actor,
      jsonb_build_object(
        'transferId', p_transfer_id,
        'direction', 'in',
        'fromWarehouseId', v_transfer.from_warehouse_id,
        'toWarehouseId', v_transfer.to_warehouse_id,
        'sourceBatchId', v_item.source_batch_id
      ),
      v_dest_batch_id,
      v_transfer.to_warehouse_id
    )
    returning id into v_movement_id;

    perform public.post_inventory_movement(v_movement_id);

    update public.inventory_transfer_items
    set received_qty = quantity,
        received_batch_id = v_dest_batch_id,
        updated_at = now()
    where id = v_item.id;
  end loop;

  update public.inventory_transfers
  set state = 'RECEIVED',
      received_by = v_actor,
      received_at = now(),
      updated_at = now(),
      receive_idempotency_key = nullif(btrim(p_idempotency_key), '')
  where id = p_transfer_id;

  return jsonb_build_object('status', 'RECEIVED', 'transferId', p_transfer_id::text);
end;
$$;

create or replace function public.inv_transfer_state_mismatch()
returns table(
  transfer_id uuid,
  state text,
  item_id text,
  source_batch_id uuid,
  expected_qty numeric,
  out_qty numeric,
  in_qty numeric
)
language sql
security definer
set search_path = public
as $$
  with items as (
    select iti.transfer_id, iti.item_id, iti.source_batch_id, iti.quantity
    from public.inventory_transfer_items iti
  ),
  out_mv as (
    select im.reference_id::uuid as transfer_id, im.item_id, im.batch_id as source_batch_id, sum(im.quantity) as qty
    from public.inventory_movements im
    where im.reference_table = 'inventory_transfers'
      and im.movement_type = 'transfer_out'
    group by 1,2,3
  ),
  in_mv as (
    select im.reference_id::uuid as transfer_id, im.item_id, (im.data->>'sourceBatchId')::uuid as source_batch_id, sum(im.quantity) as qty
    from public.inventory_movements im
    where im.reference_table = 'inventory_transfers'
      and im.movement_type = 'transfer_in'
      and (im.data ? 'sourceBatchId')
    group by 1,2,3
  )
  select
    it.id as transfer_id,
    it.state,
    i.item_id,
    i.source_batch_id,
    i.quantity as expected_qty,
    coalesce(o.qty, 0) as out_qty,
    coalesce(n.qty, 0) as in_qty
  from public.inventory_transfers it
  join items i on i.transfer_id = it.id
  left join out_mv o on o.transfer_id = it.id and o.item_id = i.item_id and o.source_batch_id = i.source_batch_id
  left join in_mv n on n.transfer_id = it.id and n.item_id = i.item_id and n.source_batch_id = i.source_batch_id
  where (it.state in ('IN_TRANSIT','RECEIVED') and coalesce(o.qty,0) <> i.quantity)
     or (it.state = 'RECEIVED' and coalesce(n.qty,0) <> i.quantity);
$$;
