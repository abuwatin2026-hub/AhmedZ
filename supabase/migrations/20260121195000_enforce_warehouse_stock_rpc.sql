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

      if v_item_batch_text is null then
        if v_last_batch_id is null then
          raise exception 'Food reservation requires batchId or last_batch_id (item %, warehouse %)', v_item_id_text, p_warehouse_id;
        end if;
        v_item_batch_text := v_last_batch_id::text;
      end if;

      v_existing_entry := v_res_batches->v_item_batch_text;
      v_existing_list :=
        case
          when v_existing_entry is null then '[]'::jsonb
          when jsonb_typeof(v_existing_entry) = 'array' then v_existing_entry
          when jsonb_typeof(v_existing_entry) = 'object' then jsonb_build_array(v_existing_entry)
          else '[]'::jsonb
        end;

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

    if v_item_batch_text is not null then
      select im.unit_cost
      into v_unit_cost
      from public.inventory_movements im
      where im.batch_id = v_item_batch_text::uuid
        and im.movement_type = 'purchase_in'
      order by im.occurred_at asc
      limit 1;
      v_unit_cost := coalesce(v_unit_cost, v_avg_cost);
    elsif v_last_batch_id is not null then
      select im.unit_cost
      into v_unit_cost
      from public.inventory_movements im
      where im.batch_id = v_last_batch_id
        and im.movement_type = 'purchase_in'
      order by im.occurred_at asc
      limit 1;
      v_unit_cost := coalesce(v_unit_cost, v_avg_cost);
    else
      v_unit_cost := v_avg_cost;
    end if;

    update public.stock_management
    set available_quantity = greatest(0, available_quantity - v_requested),
        reserved_quantity = case
          when coalesce(v_is_in_store, false) then reserved_quantity
          else greatest(0, reserved_quantity - v_requested)
        end,
        last_updated = now(),
        updated_at = now(),
        data = case
          when not coalesce(v_is_in_store, false) then (
            -- reduce reservedBatches for the order proportionally from batches with entries
            -- if batchId provided, reduce from that batch only
            case when v_item_batch_text is not null then
              jsonb_set(
                coalesce(v_stock_data, '{}'::jsonb),
                '{reservedBatches}',
                jsonb_set(
                  coalesce(v_stock_data->'reservedBatches','{}'::jsonb),
                  array[v_item_batch_text],
                  case
                    when jsonb_typeof(coalesce(v_stock_data->'reservedBatches','{}'::jsonb)->v_item_batch_text) = 'object' then
                      jsonb_set(
                        coalesce(v_stock_data->'reservedBatches','{}'::jsonb)->v_item_batch_text,
                        '{qty}',
                        to_jsonb(greatest(0, coalesce(nullif((coalesce(v_stock_data->'reservedBatches','{}'::jsonb)->v_item_batch_text)->>'qty', '')::numeric, 0) - v_requested)),
                        true
                      )
                    when jsonb_typeof(coalesce(v_stock_data->'reservedBatches','{}'::jsonb)->v_item_batch_text) = 'array' then
                      (
                        with elems as (
                          select value, ordinality
                          from jsonb_array_elements(coalesce(v_stock_data->'reservedBatches','{}'::jsonb)->v_item_batch_text) with ordinality
                        ),
                        updated as (
                          select
                            case
                              when (value->>'orderId') = p_order_id::text then
                                case
                                  when (coalesce(nullif(value->>'qty','')::numeric, 0) - v_requested) <= 0 then null
                                  else jsonb_set(value, '{qty}', to_jsonb(coalesce(nullif(value->>'qty','')::numeric, 0) - v_requested), true)
                                end
                              else value
                            end as new_value,
                            ordinality
                          from elems
                        )
                        select coalesce(jsonb_agg(new_value order by ordinality) filter (where new_value is not null), '[]'::jsonb)
                      )
                    else coalesce(v_stock_data->'reservedBatches','{}'::jsonb)->v_item_batch_text
                  end
                ),
                true
              )
            else coalesce(v_stock_data, '{}'::jsonb)
            end
          )
          else coalesce(v_stock_data, '{}'::jsonb)
        end
    where (case when v_item_id_uuid is not null then item_id = v_item_id_uuid else item_id::text = v_item_id_text end)
      and warehouse_id = p_warehouse_id;

    v_total_cost := v_requested * v_unit_cost;
    insert into public.order_item_cogs(order_id, item_id, quantity, unit_cost, total_cost, created_at)
    values (p_order_id, v_item_id_text, v_requested, v_unit_cost, v_total_cost, now());

    insert into public.inventory_movements(
      item_id, movement_type, quantity, unit_cost, total_cost,
      reference_table, reference_id, occurred_at, created_by, data, batch_id
    )
    values (
      v_item_id_text, 'sale_out', v_requested, v_unit_cost, v_total_cost,
      'orders', p_order_id::text, now(), auth.uid(), jsonb_build_object('orderId', p_order_id, 'batchId', coalesce(v_item_batch_text::uuid, v_last_batch_id)), coalesce(v_item_batch_text::uuid, v_last_batch_id)
    )
    returning id into v_movement_id;
    perform public.post_inventory_movement(v_movement_id);
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
begin
    if p_warehouse_id is null then
      raise exception 'warehouse_id is required';
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
