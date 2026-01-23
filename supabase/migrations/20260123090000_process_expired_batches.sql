do $$
begin
  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'stock_wastage'
      and column_name = 'batch_id'
  ) then
    alter table public.stock_wastage
      add column batch_id uuid;
  end if;

  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'stock_wastage'
      and column_name = 'warehouse_id'
  ) then
    if to_regclass('public.warehouses') is not null then
      alter table public.stock_wastage
        add column warehouse_id uuid references public.warehouses(id) on delete set null;
    else
      alter table public.stock_wastage
        add column warehouse_id uuid;
    end if;
  end if;
end $$;

create index if not exists idx_stock_wastage_batch_date on public.stock_wastage(batch_id, created_at desc);
create index if not exists idx_stock_wastage_warehouse_date on public.stock_wastage(warehouse_id, created_at desc);

create or replace function public.process_expired_items()
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  processed_count integer := 0;
  v_wh_id uuid;
  v_has_warehouse boolean := false;
  v_batch record;
  v_stock record;
  v_wastage_qty numeric;
  v_effective_wastage_qty numeric;
  v_wastage_id uuid;
  v_reserved_batches jsonb;
  v_reserved_entry jsonb;
  v_reserved_list jsonb;
  v_order_id uuid;
  v_order_id_text text;
  v_unit_cost numeric;
  v_movement_id uuid;
  v_new_available numeric;
  v_new_reserved numeric;
  v_expired_batch_key text;
  v_reserved_cancel_total numeric;
  v_order_reserved_qty numeric;
  v_need numeric;
  v_candidate record;
  v_candidate_key text;
  v_candidate_entry jsonb;
  v_candidate_list jsonb;
  v_candidate_reserved numeric;
  v_free numeric;
  v_alloc numeric;
  v_list_new jsonb;
  v_key text;
  v_tmp_list jsonb;
  v_tmp_list_new jsonb;
  v_total_available numeric;
  v_qr numeric;
  v_qc numeric;
  v_batch_expiry date;
begin
  v_has_warehouse := exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'stock_management'
      and column_name = 'warehouse_id'
  );

  for v_batch in
    select
      b.item_id::text as item_id,
      b.batch_id,
      b.warehouse_id,
      b.expiry_date,
      b.remaining_qty
    from public.v_food_batch_balances b
    join public.menu_items mi on mi.id = b.item_id
    where mi.category = 'food'
      and b.batch_id is not null
      and b.expiry_date is not null
      and b.expiry_date < current_date
      and coalesce(b.remaining_qty, 0) > 0
  loop
    v_wh_id := null;
    if v_has_warehouse then
      v_wh_id := v_batch.warehouse_id;
      if v_wh_id is null and to_regclass('public.warehouses') is not null then
        select w.id
        into v_wh_id
        from public.warehouses w
        where upper(coalesce(w.code, '')) = 'MAIN'
        order by w.code asc
        limit 1;

        if v_wh_id is null then
          select w.id
          into v_wh_id
          from public.warehouses w
          order by w.code asc
          limit 1;
        end if;

        if v_wh_id is null then
          raise exception 'No warehouse found for expiry processing';
        end if;
      end if;
    end if;

    v_wastage_qty := greatest(coalesce(v_batch.remaining_qty, 0), 0);
    if v_wastage_qty <= 0 then
      continue;
    end if;

    if v_has_warehouse and v_wh_id is not null then
      select *
      into v_stock
      from public.stock_management sm
      where sm.item_id::text = v_batch.item_id
        and sm.warehouse_id = v_wh_id
      for update;
    else
      select *
      into v_stock
      from public.stock_management sm
      where sm.item_id::text = v_batch.item_id
      for update;
    end if;

    if not found then
      continue;
    end if;

    v_effective_wastage_qty := least(v_wastage_qty, greatest(coalesce(v_stock.available_quantity, 0), 0));
    if v_effective_wastage_qty <= 0 then
      continue;
    end if;

    select
      b.quantity_received,
      b.quantity_consumed,
      b.unit_cost,
      b.expiry_date
    into v_qr, v_qc, v_unit_cost, v_batch_expiry
    from public.batches b
    where b.id = v_batch.batch_id
      and b.item_id::text = v_batch.item_id::text
      and (not v_has_warehouse or b.warehouse_id is not distinct from v_wh_id)
    for update;

    if not found then
      continue;
    end if;

    v_unit_cost := coalesce(v_unit_cost, v_stock.avg_cost, 0);

    v_reserved_batches := coalesce(v_stock.data->'reservedBatches', '{}'::jsonb);
    v_expired_batch_key := v_batch.batch_id::text;
    v_reserved_entry := v_reserved_batches->v_expired_batch_key;
    v_reserved_list :=
      case
        when v_reserved_entry is null then '[]'::jsonb
        when jsonb_typeof(v_reserved_entry) = 'array' then v_reserved_entry
        when jsonb_typeof(v_reserved_entry) = 'object' then jsonb_build_array(v_reserved_entry)
        else '[]'::jsonb
      end;

    v_reserved_batches := v_reserved_batches - v_expired_batch_key;
    v_reserved_cancel_total := 0;

    for v_reserved_entry in
      select value
      from jsonb_array_elements(v_reserved_list)
    loop
      v_order_id_text := nullif(v_reserved_entry->>'orderId', '');
      v_order_reserved_qty := coalesce(nullif(v_reserved_entry->>'qty','')::numeric, 0);
      if v_order_id_text is null or v_order_reserved_qty <= 0 then
        continue;
      end if;

      v_need := v_order_reserved_qty;

      for v_candidate in
        select
          b2.batch_id,
          b2.warehouse_id,
          b2.expiry_date,
          b2.remaining_qty
        from public.v_food_batch_balances b2
        where b2.item_id::text = v_batch.item_id
          and b2.batch_id is not null
          and (not v_has_warehouse or b2.warehouse_id = v_wh_id)
          and b2.expiry_date is not null
          and b2.expiry_date >= current_date
          and coalesce(b2.remaining_qty, 0) > 0
        order by b2.expiry_date asc, b2.batch_id asc
      loop
        if v_candidate.batch_id = v_batch.batch_id then
          continue;
        end if;

        v_candidate_key := v_candidate.batch_id::text;
        v_candidate_entry := v_reserved_batches->v_candidate_key;
        v_candidate_list :=
          case
            when v_candidate_entry is null then '[]'::jsonb
            when jsonb_typeof(v_candidate_entry) = 'array' then v_candidate_entry
            when jsonb_typeof(v_candidate_entry) = 'object' then jsonb_build_array(v_candidate_entry)
            else '[]'::jsonb
          end;

        select coalesce(sum(coalesce(nullif(x->>'qty','')::numeric, 0)), 0)
        into v_candidate_reserved
        from jsonb_array_elements(v_candidate_list) as x;

        v_free := greatest(coalesce(v_candidate.remaining_qty, 0) - coalesce(v_candidate_reserved, 0), 0);
        v_alloc := least(v_need, v_free);
        if v_alloc <= 0 then
          continue;
        end if;

        with elems as (
          select value, ordinality
          from jsonb_array_elements(v_candidate_list) with ordinality
        )
        select
          case
            when exists (select 1 from elems where (value->>'orderId') = v_order_id_text) then (
              select coalesce(
                jsonb_agg(
                  case
                    when (value->>'orderId') = v_order_id_text then
                      jsonb_set(
                        jsonb_set(value, '{batchId}', to_jsonb(v_candidate_key), true),
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
              || jsonb_build_array(jsonb_build_object('orderId', v_order_id_text, 'batchId', v_candidate_key, 'qty', v_alloc))
            )
          end
        into v_list_new;

        v_reserved_batches := jsonb_set(v_reserved_batches, array[v_candidate_key], v_list_new, true);

        v_need := v_need - v_alloc;
        exit when v_need <= 0;
      end loop;

      if v_need > 0 then
        begin
          v_order_id := v_order_id_text::uuid;
          perform public.cancel_order(v_order_id, 'BATCH_EXPIRED');
        exception when others then
          null;
        end;

        for v_key in
          select key from jsonb_each(v_reserved_batches)
        loop
          v_tmp_list :=
            case
              when jsonb_typeof(v_reserved_batches->v_key) = 'array' then (v_reserved_batches->v_key)
              when jsonb_typeof(v_reserved_batches->v_key) = 'object' then jsonb_build_array(v_reserved_batches->v_key)
              else '[]'::jsonb
            end;

          with elems as (
            select value, ordinality
            from jsonb_array_elements(v_tmp_list) with ordinality
          ),
          updated as (
            select
              case
                when (value->>'orderId') = v_order_id_text then null
                else value
              end as new_value,
              ordinality
            from elems
          )
          select coalesce(jsonb_agg(new_value order by ordinality) filter (where new_value is not null), '[]'::jsonb)
          into v_tmp_list_new
          from updated;

          if jsonb_array_length(v_tmp_list_new) = 0 then
            v_reserved_batches := v_reserved_batches - v_key;
          else
            v_reserved_batches := jsonb_set(v_reserved_batches, array[v_key], v_tmp_list_new, true);
          end if;
        end loop;

        v_reserved_cancel_total := v_reserved_cancel_total + v_order_reserved_qty;
      end if;
    end loop;

    v_new_available := greatest(0, coalesce(v_stock.available_quantity, 0) - v_effective_wastage_qty);
    v_new_reserved := greatest(0, coalesce(v_stock.reserved_quantity, 0) - least(greatest(coalesce(v_reserved_cancel_total, 0), 0), greatest(coalesce(v_stock.reserved_quantity, 0), 0)));

    update public.batches
    set quantity_consumed = quantity_consumed + v_effective_wastage_qty
    where id = v_batch.batch_id
    returning quantity_received, quantity_consumed into v_qr, v_qc;

    if coalesce(v_qc, 0) > coalesce(v_qr, 0) then
      raise exception 'Over-consumption detected for expired batch %', v_batch.batch_id;
    end if;

    update public.stock_management
    set available_quantity = v_new_available,
        reserved_quantity = v_new_reserved,
        last_updated = now(),
        updated_at = now(),
        data = jsonb_set(
          jsonb_set(
            jsonb_set(coalesce(data, '{}'::jsonb), '{availableQuantity}', to_jsonb(v_new_available), true),
            '{reservedQuantity}',
            to_jsonb(v_new_reserved),
            true
          ),
          '{reservedBatches}',
          v_reserved_batches,
          true
        )
    where item_id::text = v_batch.item_id
      and (not v_has_warehouse or warehouse_id = v_wh_id);

    insert into public.stock_wastage (
      item_id,
      quantity,
      unit_type,
      cost_at_time,
      reason,
      notes,
      reported_by,
      created_at,
      batch_id,
      warehouse_id
    )
    select
      mi.id,
      v_effective_wastage_qty,
      mi.unit_type,
      v_unit_cost,
      'auto_expired',
      'Auto-processed batch expiry detection',
      auth.uid(),
      now(),
      v_batch.batch_id,
      v_wh_id
    from public.menu_items mi
    where mi.id = v_batch.item_id
    returning id into v_wastage_id;

    insert into public.inventory_movements(
      item_id, movement_type, quantity, unit_cost, total_cost,
      reference_table, reference_id, occurred_at, created_by, data, batch_id, warehouse_id
    )
    values (
      v_batch.item_id,
      'wastage_out',
      v_effective_wastage_qty,
      v_unit_cost,
      v_effective_wastage_qty * v_unit_cost,
      'stock_wastage',
      v_wastage_id::text,
      now(),
      auth.uid(),
      jsonb_build_object(
        'reason', 'auto_expired',
        'expiryDate', coalesce(v_batch_expiry, v_batch.expiry_date),
        'warehouseId', v_wh_id,
        'stockWastageId', v_wastage_id
      ),
      v_batch.batch_id
      ,
      v_wh_id
    )
    returning id into v_movement_id;

    perform public.post_inventory_movement(v_movement_id);

    select coalesce(sum(coalesce(sm.available_quantity, 0)), 0)
    into v_total_available
    from public.stock_management sm
    where sm.item_id::text = v_batch.item_id;

    update public.menu_items
    set data = jsonb_set(coalesce(data, '{}'::jsonb), '{availableStock}', to_jsonb(v_total_available), true),
        updated_at = now()
    where id = v_batch.item_id;

    processed_count := processed_count + 1;
  end loop;

  return json_build_object(
    'success', true,
    'processed_count', processed_count
  );
exception when others then
  return json_build_object(
    'success', false,
    'error', sqlerrm
  );
end;
$$;

revoke all on function public.process_expired_items() from public;
grant execute on function public.process_expired_items() to anon, authenticated;
