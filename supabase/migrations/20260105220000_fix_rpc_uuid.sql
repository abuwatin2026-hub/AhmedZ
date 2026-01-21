-- Recreate functions with UUID casting to handle schema mismatch (DB has uuid, migration has text)
drop function if exists public.reserve_stock_for_order(jsonb);
drop function if exists public.release_reserved_stock_for_order(jsonb);

create or replace function public.reserve_stock_for_order(p_items jsonb, p_order_id uuid default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item jsonb;
  v_item_id text;
  v_item_id_uuid uuid;
  v_requested numeric;
  v_available numeric;
  v_reserved numeric;
  v_stock_data jsonb;
  v_stock_item_id_is_uuid boolean;
  v_is_food boolean;
  v_reserved_batches jsonb;
  v_remaining_needed numeric;
  v_reserved_total numeric;
  v_reserved_for_batch numeric;
  v_effective_remaining numeric;
  v_alloc numeric;
  v_expired_qty numeric;
  v_invalid_qty numeric;
  v_existing_qty numeric;
  v_existing_entry jsonb;
  v_res_list jsonb;
  v_res_list_new jsonb;
  v_batch record;
begin
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

  for v_item in select value from jsonb_array_elements(p_items)
  loop
    v_item_id := coalesce(v_item->>'itemId', v_item->>'id');
    v_requested := coalesce(nullif(v_item->>'quantity','')::numeric, 0);

    if v_item_id is null or v_item_id = '' then
      raise exception 'Invalid itemId';
    end if;
    if v_requested <= 0 then
      raise exception 'Invalid requested quantity for item %', v_item_id;
    end if;

    if coalesce(v_stock_item_id_is_uuid, false) then
      begin
        v_item_id_uuid := v_item_id::uuid;
      exception when others then
        raise exception 'Invalid itemId %', v_item_id;
      end;

      select
        coalesce(sm.available_quantity, 0),
        coalesce(sm.reserved_quantity, 0),
        coalesce(sm.data, '{}'::jsonb)
      into v_available, v_reserved, v_stock_data
      from public.stock_management sm
      where sm.item_id = v_item_id_uuid
      for update;
    else
      select
        coalesce(sm.available_quantity, 0),
        coalesce(sm.reserved_quantity, 0),
        coalesce(sm.data, '{}'::jsonb)
      into v_available, v_reserved, v_stock_data
      from public.stock_management sm
      where sm.item_id::text = v_item_id
      for update;
    end if;

    if not found then
      raise exception 'Stock record not found for item %', v_item_id;
    end if;

    select coalesce(mi.category = 'food', false)
    into v_is_food
    from public.menu_items mi
    where mi.id = v_item_id;

    if not found and v_item_id_uuid is not null then
      select coalesce(mi.category = 'food', false)
      into v_is_food
      from public.menu_items mi
      where mi.id = v_item_id_uuid::text;
    end if;

    if not coalesce(v_is_food, false) then
      if (v_available - v_reserved) + 1e-9 < v_requested then
        raise exception 'Insufficient stock for item % (available %, reserved %, requested %)', v_item_id, v_available, v_reserved, v_requested;
      end if;
    else
      if p_order_id is null then
        raise exception 'p_order_id is required for food reservations (item %)', v_item_id;
      end if;

      v_reserved_batches := coalesce(v_stock_data->'reservedBatches', '{}'::jsonb);
      v_remaining_needed := v_requested;
      v_reserved_total := 0;
      v_expired_qty := 0;
      v_invalid_qty := 0;

      select
        coalesce(sum(case when r.remaining_qty > 0 and r.expiry_date is null then r.remaining_qty else 0 end), 0),
        coalesce(sum(case when r.remaining_qty > 0 and r.expiry_date < current_date then r.remaining_qty else 0 end), 0)
      into v_invalid_qty, v_expired_qty
      from (
        with purchases as (
          select
            im.batch_id,
            im.quantity as received_qty,
            case
              when (im.data->>'expiryDate') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then (im.data->>'expiryDate')::date
              else null
            end as expiry_date
          from public.inventory_movements im
          where im.item_id = v_item_id
            and im.movement_type = 'purchase_in'
            and im.batch_id is not null
        ),
        consumed as (
          select
            im.batch_id,
            sum(im.quantity) as consumed_qty
          from public.inventory_movements im
          where im.item_id = v_item_id
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
      ) r;

      if (v_invalid_qty + v_expired_qty) > 0 then
        raise exception 'Food item % has expired or invalid stock (invalid %, expired %)', v_item_id, v_invalid_qty, v_expired_qty;
      end if;

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
          where im.item_id = v_item_id
            and im.movement_type = 'purchase_in'
            and im.batch_id is not null
        ),
        consumed as (
          select
            im.batch_id,
            sum(im.quantity) as consumed_qty
          from public.inventory_movements im
          where im.item_id = v_item_id
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
        v_existing_entry := v_reserved_batches->v_batch.batch_id::text;

        if v_existing_entry is not null and jsonb_typeof(v_existing_entry) = 'number' then
          continue;
        end if;

        v_res_list := case
          when v_existing_entry is null then '[]'::jsonb
          when jsonb_typeof(v_existing_entry) = 'array' then v_existing_entry
          when jsonb_typeof(v_existing_entry) = 'object' then jsonb_build_array(v_existing_entry)
          else '[]'::jsonb
        end;

        select
          coalesce(sum(coalesce(nullif(e.value->>'qty','')::numeric, 0)), 0),
          coalesce(sum(case when (e.value->>'orderId') = p_order_id::text then coalesce(nullif(e.value->>'qty','')::numeric, 0) else 0 end), 0)
        into v_reserved_for_batch, v_existing_qty
        from jsonb_array_elements(v_res_list) as e(value);

        v_effective_remaining := v_batch.remaining_qty - v_reserved_for_batch;
        if v_effective_remaining <= 0 then
          continue;
        end if;
        v_alloc := least(v_remaining_needed, v_effective_remaining);

        with elems as (
          select value, ordinality
          from jsonb_array_elements(v_res_list) with ordinality
        )
        select
          case
            when exists (select 1 from elems where (value->>'orderId') = p_order_id::text) then (
              select coalesce(
                jsonb_agg(
                  case
                    when (value->>'orderId') = p_order_id::text then
                      jsonb_set(
                        jsonb_set(value, '{batchId}', to_jsonb(v_batch.batch_id), true),
                        '{qty}',
                        to_jsonb(coalesce(nullif(value->>'qty','')::numeric, 0) + v_alloc),
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
              || jsonb_build_array(jsonb_build_object('orderId', p_order_id, 'batchId', v_batch.batch_id, 'qty', v_alloc))
            )
          end
        into v_res_list_new;

        v_reserved_batches := jsonb_set(v_reserved_batches, array[v_batch.batch_id::text], v_res_list_new, true);
        v_reserved_total := v_reserved_total + v_alloc;
        v_remaining_needed := v_remaining_needed - v_alloc;
        exit when v_remaining_needed <= 0;
      end loop;

      if v_remaining_needed > 0 then
        raise exception 'Insufficient non-expired stock for food item % (requested %, available %)', v_item_id, v_requested, v_reserved_total;
      end if;
    end if;

    if coalesce(v_stock_item_id_is_uuid, false) then
      update public.stock_management
      set reserved_quantity = reserved_quantity + v_requested,
          last_updated = now(),
          updated_at = now(),
          data = case
            when coalesce(v_is_food, false) then jsonb_set(coalesce(v_stock_data, '{}'::jsonb), '{reservedBatches}', v_reserved_batches, true)
            else coalesce(v_stock_data, '{}'::jsonb)
          end
      where item_id = v_item_id_uuid;
    else
      update public.stock_management
      set reserved_quantity = reserved_quantity + v_requested,
          last_updated = now(),
          updated_at = now(),
          data = case
            when coalesce(v_is_food, false) then jsonb_set(coalesce(v_stock_data, '{}'::jsonb), '{reservedBatches}', v_reserved_batches, true)
            else coalesce(v_stock_data, '{}'::jsonb)
          end
      where item_id::text = v_item_id;
    end if;
  end loop;
end;
$$;
create or replace function public.release_reserved_stock_for_order(p_items jsonb, p_order_id uuid default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item jsonb;
  v_item_id text;
  v_item_id_uuid uuid;
  v_requested numeric;
  v_stock_item_id_is_uuid boolean;
  v_is_food boolean;
  v_stock_data jsonb;
  v_reserved_batches jsonb;
  v_has_object_reservations boolean;
  v_release_remaining numeric;
  v_released_total numeric;
  v_reserved_for_batch numeric;
  v_alloc numeric;
  v_entry jsonb;
  v_entry_qty numeric;
  v_entry_new jsonb;
  v_batch record;
begin
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

  for v_item in select value from jsonb_array_elements(p_items)
  loop
    v_item_id := coalesce(v_item->>'itemId', v_item->>'id');
    v_requested := coalesce(nullif(v_item->>'quantity','')::numeric, 0);

    if v_item_id is null or v_item_id = '' then
      raise exception 'Invalid itemId';
    end if;
    if v_requested <= 0 then
      continue;
    end if;

    if coalesce(v_stock_item_id_is_uuid, false) then
      begin
        v_item_id_uuid := v_item_id::uuid;
      exception when others then
        raise exception 'Invalid itemId %', v_item_id;
      end;

      select coalesce(sm.data, '{}'::jsonb)
      into v_stock_data
      from public.stock_management sm
      where sm.item_id = v_item_id_uuid
      for update;
    else
      select coalesce(sm.data, '{}'::jsonb)
      into v_stock_data
      from public.stock_management sm
      where sm.item_id::text = v_item_id
      for update;
    end if;

    select coalesce(mi.category = 'food', false)
    into v_is_food
    from public.menu_items mi
    where mi.id = v_item_id;

    if not found and v_item_id_uuid is not null then
      select coalesce(mi.category = 'food', false)
      into v_is_food
      from public.menu_items mi
      where mi.id = v_item_id_uuid::text;
    end if;

    if coalesce(v_is_food, false) then
      v_reserved_batches := coalesce(v_stock_data->'reservedBatches', '{}'::jsonb);

      select exists (
        select 1
        from jsonb_each(v_reserved_batches) e
        where jsonb_typeof(e.value) in ('object','array')
      )
      into v_has_object_reservations;

      if p_order_id is null and coalesce(v_has_object_reservations, false) then
        raise exception 'p_order_id is required to release food reservations (item %)', v_item_id;
      end if;

      v_release_remaining := v_requested;
      v_released_total := 0;

      if p_order_id is not null then
        for v_batch in
          with reserved as (
            select
              (key)::uuid as batch_id,
              sum(coalesce(nullif(r->>'qty','')::numeric, 0)) as reserved_qty
            from jsonb_each(v_reserved_batches)
            cross join lateral jsonb_array_elements(
              case
                when jsonb_typeof(value) = 'array' then value
                when jsonb_typeof(value) = 'object' then jsonb_build_array(value)
                else '[]'::jsonb
              end
            ) as r
            where (r->>'orderId') = p_order_id::text
            group by key
          ),
          batch_expiry as (
            select
              im.batch_id,
              max(case
                when (im.data->>'expiryDate') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then (im.data->>'expiryDate')::date
                else null
              end) as expiry_date
            from public.inventory_movements im
            where im.item_id = v_item_id
              and im.batch_id is not null
            group by im.batch_id
          )
          select r.batch_id, r.reserved_qty, b.expiry_date
          from reserved r
          left join batch_expiry b on b.batch_id = r.batch_id
          order by b.expiry_date asc nulls last, r.batch_id asc
        loop
          v_reserved_for_batch := coalesce(v_batch.reserved_qty, 0);
          if v_reserved_for_batch <= 0 then
            continue;
          end if;
          v_alloc := least(v_release_remaining, v_reserved_for_batch);
          v_released_total := v_released_total + v_alloc;

          v_entry := v_reserved_batches->v_batch.batch_id::text;
          if v_entry is not null and jsonb_typeof(v_entry) = 'object' then
            if (v_entry->>'orderId') is not null and (v_entry->>'orderId') <> p_order_id::text then
              raise exception 'Reservation ownership mismatch for batch % (expected order %, found %)', v_batch.batch_id, p_order_id, (v_entry->>'orderId');
            end if;
            v_entry_qty := coalesce(nullif(v_entry->>'qty','')::numeric, 0);
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
          elsif v_entry is not null and jsonb_typeof(v_entry) = 'array' then
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
            raise exception 'Missing reservation entry for batch % while releasing order %', v_batch.batch_id, p_order_id;
          end if;

          v_release_remaining := v_release_remaining - v_alloc;
          exit when v_release_remaining <= 0;
        end loop;
      else
        for v_batch in
          with reserved as (
            select (key)::uuid as batch_id, (value)::numeric as reserved_qty
            from jsonb_each_text(v_reserved_batches)
          ),
          batch_expiry as (
            select
              im.batch_id,
              max(case
                when (im.data->>'expiryDate') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then (im.data->>'expiryDate')::date
                else null
              end) as expiry_date
            from public.inventory_movements im
            where im.item_id = v_item_id
              and im.batch_id is not null
            group by im.batch_id
          )
          select r.batch_id, r.reserved_qty, b.expiry_date
          from reserved r
          left join batch_expiry b on b.batch_id = r.batch_id
          order by b.expiry_date asc nulls last, r.batch_id asc
        loop
          v_reserved_for_batch := coalesce(v_batch.reserved_qty, 0);
          if v_reserved_for_batch <= 0 then
            continue;
          end if;
          v_alloc := least(v_release_remaining, v_reserved_for_batch);
          v_released_total := v_released_total + v_alloc;
          if (v_reserved_for_batch - v_alloc) <= 0 then
            v_reserved_batches := v_reserved_batches - v_batch.batch_id::text;
          else
            v_reserved_batches := jsonb_set(v_reserved_batches, array[v_batch.batch_id::text], to_jsonb(v_reserved_for_batch - v_alloc), true);
          end if;
          v_release_remaining := v_release_remaining - v_alloc;
          exit when v_release_remaining <= 0;
        end loop;
      end if;

      if coalesce(v_stock_item_id_is_uuid, false) then
        update public.stock_management
        set reserved_quantity = greatest(0, reserved_quantity - v_released_total),
            last_updated = now(),
            updated_at = now(),
            data = jsonb_set(coalesce(v_stock_data, '{}'::jsonb), '{reservedBatches}', v_reserved_batches, true)
        where item_id = v_item_id_uuid;
      else
        update public.stock_management
        set reserved_quantity = greatest(0, reserved_quantity - v_released_total),
            last_updated = now(),
            updated_at = now(),
            data = jsonb_set(coalesce(v_stock_data, '{}'::jsonb), '{reservedBatches}', v_reserved_batches, true)
        where item_id::text = v_item_id;
      end if;
    else
      if coalesce(v_stock_item_id_is_uuid, false) then
        update public.stock_management
        set reserved_quantity = greatest(0, reserved_quantity - v_requested),
            last_updated = now(),
            updated_at = now()
        where item_id = v_item_id_uuid;
      else
        update public.stock_management
        set reserved_quantity = greatest(0, reserved_quantity - v_requested),
            last_updated = now(),
            updated_at = now()
        where item_id::text = v_item_id;
      end if;
    end if;
  end loop;
end;
$$;
create or replace function public.deduct_stock_on_delivery(p_items jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item jsonb;
  v_item_id text;
  v_item_id_uuid uuid;
  v_requested numeric;
  v_stock_item_id_is_uuid boolean;
begin
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

  for v_item in select value from jsonb_array_elements(p_items)
  loop
    v_item_id := coalesce(v_item->>'itemId', v_item->>'id');
    v_requested := coalesce(nullif(v_item->>'quantity','')::numeric, 0);

    if v_item_id is null or v_item_id = '' then
      raise exception 'Invalid itemId';
    end if;
    if v_requested <= 0 then
      continue;
    end if;

    if coalesce(v_stock_item_id_is_uuid, false) then
      begin
        v_item_id_uuid := v_item_id::uuid;
      exception when others then
        raise exception 'Invalid itemId %', v_item_id;
      end;

      update public.stock_management
      set available_quantity = greatest(0, available_quantity - v_requested),
          reserved_quantity = greatest(0, reserved_quantity - v_requested),
          last_updated = now(),
          updated_at = now()
      where item_id = v_item_id_uuid;
    else
      update public.stock_management
      set available_quantity = greatest(0, available_quantity - v_requested),
          reserved_quantity = greatest(0, reserved_quantity - v_requested),
          last_updated = now(),
          updated_at = now()
      where item_id::text = v_item_id;
    end if;
  end loop;
end;
$$;
