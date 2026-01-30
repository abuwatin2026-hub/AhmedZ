create table if not exists public.order_item_reservations (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  item_id text not null,
  warehouse_id uuid not null references public.warehouses(id) on delete cascade,
  quantity numeric not null check (quantity > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists uq_order_item_reservations_order_item_wh
on public.order_item_reservations(order_id, item_id, warehouse_id);

create index if not exists idx_order_item_reservations_item_wh
on public.order_item_reservations(item_id, warehouse_id);

create index if not exists idx_order_item_reservations_order
on public.order_item_reservations(order_id);

alter table public.order_item_reservations enable row level security;

drop policy if exists order_item_reservations_admin_only on public.order_item_reservations;
create policy order_item_reservations_admin_only
on public.order_item_reservations
for all
using (public.is_admin())
with check (public.is_admin());

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
  v_actor uuid;
  v_order record;
  v_item jsonb;
  v_item_id_text text;
  v_item_id_uuid uuid;
  v_requested numeric;
  v_stock_data jsonb;
  v_available numeric;
  v_reserved numeric;
  v_res_batches jsonb;
  v_item_batch_text text;
  v_existing_entry jsonb;
  v_existing_list jsonb;
  v_batch_reserved numeric;
  v_free numeric;
  v_new_list jsonb;
  v_remaining_needed numeric;
  v_batch record;
  v_to_add numeric;
  v_entry_new jsonb;
  v_expiry date;
begin
  v_actor := auth.uid();
  if v_actor is null then
    raise exception 'not authenticated';
  end if;
  if p_order_id is null then
    raise exception 'p_order_id is required';
  end if;
  if p_warehouse_id is null then
    raise exception 'warehouse_id is required';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    raise exception 'p_items must be a json array';
  end if;

  select * into v_order
  from public.orders o
  where o.id = p_order_id;
  if not found then
    raise exception 'order not found';
  end if;

  if not public.is_staff() and v_order.customer_auth_user_id <> v_actor then
    raise exception 'not allowed';
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

    select
      coalesce(sm.available_quantity, 0),
      coalesce(sm.reserved_quantity, 0),
      coalesce(sm.data, '{}'::jsonb)
    into v_available, v_reserved, v_stock_data
    from public.stock_management sm
    where (case when v_item_id_uuid is not null then sm.item_id = v_item_id_uuid else sm.item_id::text = v_item_id_text end)
      and sm.warehouse_id = p_warehouse_id
    for update;

    if not found then
      raise exception 'Stock record not found for item % in warehouse %', v_item_id_text, p_warehouse_id;
    end if;

    v_res_batches := coalesce(v_stock_data->'reservedBatches', '{}'::jsonb);

    if exists (
      select 1
      from jsonb_each(v_res_batches) e
      cross join lateral jsonb_array_elements(
        case
          when jsonb_typeof(e.value) = 'array' then e.value
          when jsonb_typeof(e.value) = 'object' then jsonb_build_array(e.value)
          else '[]'::jsonb
        end
      ) r
      where (r->>'orderId') = p_order_id::text
    ) then
      continue;
    end if;

    v_remaining_needed := v_requested;

    if v_item_batch_text is not null then
      select
        greatest(coalesce(b.quantity_received,0) - coalesce(b.quantity_consumed,0) - coalesce(b.quantity_transferred,0), 0) as remaining,
        b.expiry_date
      into v_available, v_expiry
      from public.batches b
      where b.id = v_item_batch_text::uuid
        and b.item_id = v_item_id_text
        and b.warehouse_id = p_warehouse_id
      for update;
      if not found then
        raise exception 'Batch % not found for item % in warehouse %', v_item_batch_text, v_item_id_text, p_warehouse_id;
      end if;
      if v_expiry is not null and v_expiry < current_date then
        raise exception 'BATCH_EXPIRED';
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

      v_new_list := v_existing_list || jsonb_build_array(jsonb_build_object('orderId', p_order_id, 'batchId', v_item_batch_text, 'qty', v_requested));
      v_res_batches := jsonb_set(v_res_batches, array[v_item_batch_text], v_new_list, true);
    else
      for v_batch in
        select
          b.id as batch_id,
          b.expiry_date,
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
        v_existing_entry := v_res_batches->(v_batch.batch_id::text);
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
        v_free := greatest(coalesce(v_batch.remaining, 0) - coalesce(v_batch_reserved, 0), 0);
        v_to_add := least(v_remaining_needed, v_free);
        if v_to_add <= 0 then
          continue;
        end if;
        v_entry_new := v_existing_list || jsonb_build_array(jsonb_build_object('orderId', p_order_id, 'batchId', v_batch.batch_id::text, 'qty', v_to_add));
        v_res_batches := jsonb_set(v_res_batches, array[v_batch.batch_id::text], v_entry_new, true);
        v_remaining_needed := v_remaining_needed - v_to_add;
      end loop;
      if v_remaining_needed > 0 then
        raise exception 'Insufficient batch stock for item % in warehouse % (needed %, reserved %)', v_item_id_text, p_warehouse_id, v_requested, (v_requested - v_remaining_needed);
      end if;
    end if;

    update public.stock_management
    set reserved_quantity = reserved_quantity + v_requested,
        last_updated = now(),
        updated_at = now(),
        data = jsonb_set(coalesce(v_stock_data, '{}'::jsonb), '{reservedBatches}', v_res_batches, true)
    where (case when v_item_id_uuid is not null then item_id = v_item_id_uuid else item_id::text = v_item_id_text end)
      and warehouse_id = p_warehouse_id;

    insert into public.order_item_reservations(order_id, item_id, warehouse_id, quantity, created_at, updated_at)
    values (p_order_id, v_item_id_text, p_warehouse_id, v_requested, now(), now())
    on conflict (order_id, item_id, warehouse_id)
    do update set
      quantity = public.order_item_reservations.quantity + excluded.quantity,
      updated_at = now();
  end loop;
end;
$$;

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
  v_actor uuid;
  v_order record;
  v_item jsonb;
  v_item_id text;
  v_item_id_uuid uuid;
  v_qty numeric;
  v_wh uuid;
  v_stock_data jsonb;
  v_res_batches jsonb;
  v_batch_key text;
  v_entry jsonb;
  v_existing_list jsonb;
  v_entry_new jsonb;
  v_to_release numeric;
  v_take numeric;
  v_released numeric;
begin
  v_actor := auth.uid();
  if v_actor is null then
    raise exception 'not authenticated';
  end if;
  if p_order_id is null then
    raise exception 'p_order_id is required';
  end if;
  if p_warehouse_id is null then
    raise exception 'warehouse_id is required';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    raise exception 'p_items must be a json array';
  end if;

  select * into v_order
  from public.orders o
  where o.id = p_order_id
  for update;
  if not found then
    raise exception 'order not found';
  end if;

  if not public.is_staff() and v_order.customer_auth_user_id <> v_actor then
    raise exception 'not allowed';
  end if;

  v_wh := p_warehouse_id;

  for v_item in select value from jsonb_array_elements(p_items)
  loop
    v_item_id := nullif(trim(coalesce(v_item->>'itemId', v_item->>'id')), '');
    v_qty := coalesce(nullif(v_item->>'quantity','')::numeric, 0);
    if v_item_id is null or v_qty <= 0 then
      continue;
    end if;

    begin
      v_item_id_uuid := v_item_id::uuid;
    exception when others then
      v_item_id_uuid := null;
    end;

    select coalesce(sm.data, '{}'::jsonb)
    into v_stock_data
    from public.stock_management sm
    where (case when v_item_id_uuid is not null then sm.item_id = v_item_id_uuid else sm.item_id::text = v_item_id end)
      and sm.warehouse_id = v_wh
    for update;

    if not found then
      continue;
    end if;

    v_res_batches := coalesce(v_stock_data->'reservedBatches', '{}'::jsonb);
    v_to_release := v_qty;
    v_released := 0;

    for v_batch_key in
      select key
      from jsonb_each(v_res_batches)
      order by key asc
    loop
      exit when v_to_release <= 0;

      v_entry := v_res_batches->v_batch_key;
      v_existing_list :=
        case
          when v_entry is null then '[]'::jsonb
          when jsonb_typeof(v_entry) = 'array' then v_entry
          when jsonb_typeof(v_entry) = 'object' then jsonb_build_array(v_entry)
          else '[]'::jsonb
        end;

      select coalesce(sum(coalesce(nullif(x->>'qty','')::numeric, 0)), 0)
      into v_take
      from jsonb_array_elements(v_existing_list) x
      where (x->>'orderId') = p_order_id::text;

      if coalesce(v_take, 0) <= 0 then
        continue;
      end if;

      v_take := least(v_to_release, v_take);

      with elems as (
        select
          value,
          ordinality,
          (value->>'orderId') as oid,
          coalesce(nullif(value->>'qty','')::numeric, 0) as qty
        from jsonb_array_elements(v_existing_list) with ordinality
      ),
      calc as (
        select
          value,
          ordinality,
          oid,
          qty,
          sum(case when oid = p_order_id::text then qty else 0 end) over (order by ordinality) as pref
        from elems
      ),
      upd as (
        select
          value,
          ordinality,
          oid,
          qty,
          (pref - case when oid = p_order_id::text then qty else 0 end) as prev_pref
        from calc
      ),
      updated as (
        select
          case
            when oid = p_order_id::text then
              case
                when (qty - least(qty, greatest(0, v_take - coalesce(prev_pref, 0)))) <= 0 then null
                else jsonb_set(value, '{qty}', to_jsonb(qty - least(qty, greatest(0, v_take - coalesce(prev_pref, 0)))), true)
              end
            else value
          end as new_value,
          ordinality
        from upd
      )
      select coalesce(jsonb_agg(new_value order by ordinality) filter (where new_value is not null), '[]'::jsonb)
      into v_entry_new
      from updated;

      if jsonb_array_length(v_entry_new) = 0 then
        v_res_batches := v_res_batches - v_batch_key;
      else
        v_res_batches := jsonb_set(v_res_batches, array[v_batch_key], v_entry_new, true);
      end if;

      v_to_release := v_to_release - v_take;
      v_released := v_released + v_take;
    end loop;

    update public.stock_management
    set reserved_quantity = greatest(0, reserved_quantity - coalesce(v_released, 0)),
        updated_at = now(),
        last_updated = now(),
        data = jsonb_set(coalesce(v_stock_data, '{}'::jsonb), '{reservedBatches}', coalesce(v_res_batches, '{}'::jsonb), true)
    where (case when v_item_id_uuid is not null then item_id = v_item_id_uuid else item_id::text = v_item_id end)
      and warehouse_id = v_wh;

    if coalesce(v_released, 0) > 0 then
      update public.order_item_reservations
      set quantity = quantity - v_released,
          updated_at = now()
      where order_id = p_order_id
        and item_id = v_item_id
        and warehouse_id = v_wh;

      delete from public.order_item_reservations r
      where r.order_id = p_order_id
        and r.item_id = v_item_id
        and r.warehouse_id = v_wh
        and r.quantity <= 0;
    end if;
  end loop;
end;
$$;

create or replace function public.trg_consume_order_item_reservation_on_sale_out()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order_id uuid;
  v_source text;
begin
  if new.reference_table <> 'orders' or new.movement_type <> 'sale_out' then
    return new;
  end if;
  if new.warehouse_id is null then
    return new;
  end if;

  begin
    v_order_id := nullif(new.reference_id, '')::uuid;
  exception when others then
    return new;
  end;

  select coalesce(nullif(o.data->>'orderSource',''), '') into v_source
  from public.orders o
  where o.id = v_order_id;

  if coalesce(v_source, '') = 'in_store' then
    return new;
  end if;

  update public.order_item_reservations
  set quantity = quantity - coalesce(new.quantity, 0),
      updated_at = now()
  where order_id = v_order_id
    and item_id = new.item_id::text
    and warehouse_id = new.warehouse_id;

  delete from public.order_item_reservations r
  where r.order_id = v_order_id
    and r.item_id = new.item_id::text
    and r.warehouse_id = new.warehouse_id
    and r.quantity <= 0;

  return new;
end;
$$;

drop trigger if exists trg_inventory_movements_consume_order_item_reservation on public.inventory_movements;
create trigger trg_inventory_movements_consume_order_item_reservation
after insert
on public.inventory_movements
for each row
when (new.reference_table = 'orders' and new.movement_type = 'sale_out')
execute function public.trg_consume_order_item_reservation_on_sale_out();

create or replace function public.get_order_item_reservations(p_order_id uuid)
returns table (
  item_id text,
  warehouse_id uuid,
  quantity numeric,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid;
  v_owner uuid;
begin
  v_actor := auth.uid();
  if v_actor is null then
    raise exception 'not authenticated';
  end if;
  if p_order_id is null then
    raise exception 'p_order_id is required';
  end if;

  select o.customer_auth_user_id into v_owner
  from public.orders o
  where o.id = p_order_id;

  if not found then
    raise exception 'order not found';
  end if;

  if not public.is_staff() and v_owner <> v_actor then
    raise exception 'not allowed';
  end if;

  return query
  select r.item_id, r.warehouse_id, r.quantity, r.created_at, r.updated_at
  from public.order_item_reservations r
  where r.order_id = p_order_id
  order by r.created_at asc, r.item_id asc;
end;
$$;

revoke all on function public.get_order_item_reservations(uuid) from public;
grant execute on function public.get_order_item_reservations(uuid) to authenticated;

select pg_sleep(1);
notify pgrst, 'reload schema';
