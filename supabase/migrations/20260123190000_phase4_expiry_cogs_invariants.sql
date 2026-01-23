do $$
declare
  v_constraint_name text;
begin
  if to_regclass('public.inventory_movements') is null then
    return;
  end if;

  alter table public.inventory_movements
    add column if not exists warehouse_id uuid;

  alter table public.inventory_movements
    drop constraint if exists inventory_movements_movement_type_check;

  select c.conname
  into v_constraint_name
  from pg_constraint c
  join pg_class r on r.oid = c.conrelid
  join pg_namespace n on n.oid = r.relnamespace
  where n.nspname = 'public'
    and r.relname = 'inventory_movements'
    and c.contype = 'c'
    and pg_get_constraintdef(c.oid) ilike '%movement_type%'
    and pg_get_constraintdef(c.oid) ilike '%in (%';

  if v_constraint_name is not null then
    execute format('alter table public.inventory_movements drop constraint %I', v_constraint_name);
  end if;

  alter table public.inventory_movements
    add constraint inventory_movements_movement_type_check
    check (
      movement_type in (
        'purchase_in',
        'sale_out',
        'expired_out',
        'wastage_out',
        'adjust_in',
        'adjust_out',
        'return_in',
        'return_out'
      )
    );
end $$;

create or replace function public.post_inventory_movement(p_movement_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_mv record;
  v_entry_id uuid;
  v_inventory uuid;
  v_cogs uuid;
  v_ap uuid;
  v_shrinkage uuid;
  v_gain uuid;
  v_vat_input uuid;
  v_supplier_tax_total numeric;
begin
  if p_movement_id is null then
    raise exception 'p_movement_id is required';
  end if;

  select *
  into v_mv
  from public.inventory_movements im
  where im.id = p_movement_id;

  if not found then
    raise exception 'inventory movement not found';
  end if;

  if v_mv.reference_table = 'production_orders' then
    return;
  end if;

  v_inventory := public.get_account_id_by_code('1410');
  v_cogs := public.get_account_id_by_code('5010');
  v_ap := public.get_account_id_by_code('2010');
  v_shrinkage := public.get_account_id_by_code('5020');
  v_gain := public.get_account_id_by_code('4021');
  v_vat_input := public.get_account_id_by_code('1420');

  v_supplier_tax_total := coalesce(nullif((v_mv.data->>'supplier_tax_total')::numeric, null), 0);

  insert into public.journal_entries(entry_date, memo, source_table, source_id, source_event, created_by)
  values (
    v_mv.occurred_at,
    concat('Inventory movement ', v_mv.movement_type, ' ', v_mv.item_id),
    'inventory_movements',
    v_mv.id::text,
    v_mv.movement_type,
    v_mv.created_by
  )
  on conflict (source_table, source_id, source_event)
  do update set entry_date = excluded.entry_date, memo = excluded.memo
  returning id into v_entry_id;

  delete from public.journal_lines jl where jl.journal_entry_id = v_entry_id;

  if v_mv.movement_type = 'purchase_in' then
    if v_supplier_tax_total > 0 and v_vat_input is not null then
      insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo)
      values
        (v_entry_id, v_inventory, v_mv.total_cost, 0, 'Inventory increase (net)'),
        (v_entry_id, v_vat_input, v_supplier_tax_total, 0, 'VAT recoverable'),
        (v_entry_id, v_ap, 0, v_mv.total_cost + v_supplier_tax_total, 'Supplier payable');
    else
      insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo)
      values
        (v_entry_id, v_inventory, v_mv.total_cost, 0, 'Inventory increase'),
        (v_entry_id, v_ap, 0, v_mv.total_cost, 'Supplier payable');
    end if;
  elsif v_mv.movement_type = 'sale_out' then
    insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo)
    values
      (v_entry_id, v_cogs, v_mv.total_cost, 0, 'COGS'),
      (v_entry_id, v_inventory, 0, v_mv.total_cost, 'Inventory decrease');
  elsif v_mv.movement_type = 'expired_out' then
    insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo)
    values
      (v_entry_id, v_cogs, v_mv.total_cost, 0, 'Expired (COGS)'),
      (v_entry_id, v_inventory, 0, v_mv.total_cost, 'Inventory decrease');
  elsif v_mv.movement_type = 'wastage_out' then
    insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo)
    values
      (v_entry_id, v_cogs, v_mv.total_cost, 0, 'Wastage (COGS)'),
      (v_entry_id, v_inventory, 0, v_mv.total_cost, 'Inventory decrease');
  elsif v_mv.movement_type = 'adjust_out' then
    insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo)
    values
      (v_entry_id, v_shrinkage, v_mv.total_cost, 0, 'Adjustment out'),
      (v_entry_id, v_inventory, 0, v_mv.total_cost, 'Inventory decrease');
  elsif v_mv.movement_type = 'adjust_in' then
    insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo)
    values
      (v_entry_id, v_inventory, v_mv.total_cost, 0, 'Adjustment in'),
      (v_entry_id, v_gain, 0, v_mv.total_cost, 'Inventory gain');
  elsif v_mv.movement_type = 'return_out' then
    insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo)
    values
      (v_entry_id, v_ap, v_mv.total_cost, 0, 'Vendor credit'),
      (v_entry_id, v_inventory, 0, v_mv.total_cost, 'Inventory decrease');
  elsif v_mv.movement_type = 'return_in' then
    insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo)
    values
      (v_entry_id, v_inventory, v_mv.total_cost, 0, 'Inventory restore (return)'),
      (v_entry_id, v_cogs, 0, v_mv.total_cost, 'Reverse COGS');
  end if;
end;
$$;

create or replace view public.v_cogs_movements as
select im.*
from public.inventory_movements im
where im.movement_type in ('sale_out', 'expired_out', 'wastage_out');

create or replace function public.inv_sale_out_from_expired_batches()
returns table(
  movement_id uuid,
  item_id text,
  batch_id uuid,
  movement_created_at date,
  batch_expiry_date date,
  warehouse_id uuid,
  reference_id text
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if exists (
    select 1
    from information_schema.columns c
    where c.table_schema = 'public'
      and c.table_name = 'inventory_movements'
      and c.column_name = 'warehouse_id'
  ) then
    return query
    select
      im.id as movement_id,
      im.item_id,
      im.batch_id,
      im.created_at::date as movement_created_at,
      b.expiry_date as batch_expiry_date,
      im.warehouse_id,
      im.reference_id
    from public.inventory_movements im
    join public.batches b on b.id = im.batch_id
    where im.movement_type = 'sale_out'
      and b.expiry_date is not null
      and b.expiry_date < im.created_at::date;
  else
    return query
    select
      im.id as movement_id,
      im.item_id,
      im.batch_id,
      im.created_at::date as movement_created_at,
      b.expiry_date as batch_expiry_date,
      null::uuid as warehouse_id,
      im.reference_id
    from public.inventory_movements im
    join public.batches b on b.id = im.batch_id
    where im.movement_type = 'sale_out'
      and b.expiry_date is not null
      and b.expiry_date < im.created_at::date;
  end if;
end;
$$;

create or replace function public.inv_expired_batches_with_remaining()
returns table(
  batch_id uuid,
  item_id text,
  warehouse_id uuid,
  expiry_date date,
  remaining_qty numeric
)
language sql
security definer
set search_path = public
as $$
  select
    b.id as batch_id,
    b.item_id,
    b.warehouse_id,
    b.expiry_date,
    greatest(coalesce(b.quantity_received,0) - coalesce(b.quantity_consumed,0), 0) as remaining_qty
  from public.batches b
  where b.expiry_date is not null
    and b.expiry_date < current_date
    and greatest(coalesce(b.quantity_received,0) - coalesce(b.quantity_consumed,0), 0) > 0;
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
          greatest(coalesce(b.quantity_received,0) - coalesce(b.quantity_consumed,0), 0) as remaining
        from public.batches b
        where b.item_id = v_item_id_text
          and b.warehouse_id = p_warehouse_id
          and greatest(coalesce(b.quantity_received,0) - coalesce(b.quantity_consumed,0), 0) > 0
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
  if not public.is_admin() then
    raise exception 'not allowed';
  end if;

  v_has_warehouse := (to_regclass('public.warehouses') is not null);

  for v_batch in
    select *
    from public.v_food_batch_balances v
    where v.expiry_date is not null
      and v.expiry_date < current_date
      and greatest(coalesce(v.remaining_qty, 0), 0) > 0
    order by v.expiry_date asc, v.batch_id asc
  loop
    processed_count := processed_count + 1;
    v_wh_id := v_batch.warehouse_id;

    if v_has_warehouse then
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

    v_effective_wastage_qty := v_wastage_qty;

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

    v_reserved_cancel_total := 0;

    for v_order_id_text, v_order_reserved_qty in
      select
        (e->>'orderId') as order_id_text,
        coalesce(nullif(e->>'qty','')::numeric, 0) as qty
      from jsonb_array_elements(v_reserved_list) e
    loop
      if v_order_id_text is null or v_order_id_text = '' then
        continue;
      end if;
      begin
        v_order_id := v_order_id_text::uuid;
      exception when others then
        v_order_id := null;
      end;
      if v_order_id is null then
        continue;
      end if;

      v_need := greatest(coalesce(v_order_reserved_qty, 0), 0);
      if v_need <= 0 then
        continue;
      end if;

      v_reserved_cancel_total := v_reserved_cancel_total + v_need;

      for v_candidate in
        select
          b2.batch_id,
          b2.expiry_date,
          b2.remaining_qty
        from public.v_food_batch_balances b2
        where b2.item_id = v_batch.item_id
          and b2.warehouse_id is not distinct from v_wh_id
          and b2.batch_id <> v_batch.batch_id
          and (b2.expiry_date is null or b2.expiry_date >= current_date)
          and greatest(coalesce(b2.remaining_qty, 0), 0) > 0
        order by b2.expiry_date asc nulls last, b2.batch_id asc
      loop
        exit when v_need <= 0;

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
        if v_free <= 0 then
          continue;
        end if;

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
            when exists (select 1 from elems where (value->>'orderId') = v_order_id::text) then (
              select coalesce(
                jsonb_agg(
                  case
                    when (value->>'orderId') = v_order_id::text then
                      jsonb_set(
                        value,
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
              || jsonb_build_array(jsonb_build_object('orderId', v_order_id, 'batchId', v_candidate_key, 'qty', v_alloc))
            )
          end
        into v_list_new;

        v_reserved_batches := jsonb_set(v_reserved_batches, array[v_candidate_key], v_list_new, true);

        v_need := v_need - v_alloc;
      end loop;
    end loop;

    v_tmp_list := '[]'::jsonb;
    for v_key in
      select key
      from jsonb_each(v_reserved_batches)
    loop
      if v_key <> v_expired_batch_key then
        continue;
      end if;
      v_tmp_list := coalesce(v_reserved_batches->v_key, '[]'::jsonb);
    end loop;

    v_reserved_batches := v_reserved_batches - v_expired_batch_key;

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
      'expired_out',
      v_effective_wastage_qty,
      v_unit_cost,
      v_effective_wastage_qty * v_unit_cost,
      'batches',
      v_batch.batch_id::text,
      now(),
      auth.uid(),
      jsonb_build_object(
        'reason', 'expiry',
        'expiryDate', coalesce(v_batch_expiry, v_batch.expiry_date),
        'warehouseId', v_wh_id,
        'batchId', v_batch.batch_id
      ),
      v_batch.batch_id,
      v_wh_id
    )
    returning id into v_movement_id;

    perform public.post_inventory_movement(v_movement_id);
  end loop;

  return json_build_object('success', true, 'processed_count', processed_count);
end;
$$;

create or replace function public.sync_offline_pos_sale(
  p_offline_id text,
  p_order_id uuid,
  p_order_data jsonb,
  p_items jsonb,
  p_warehouse_id uuid,
  p_payments jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid;
  v_existing_state text;
  v_err text;
  v_result jsonb;
  v_payment jsonb;
  v_i int := 0;
begin
  v_actor := auth.uid();
  if not public.is_staff() then
    raise exception 'not allowed';
  end if;

  if p_offline_id is null or btrim(p_offline_id) = '' then
    raise exception 'p_offline_id is required';
  end if;
  if p_order_id is null then
    raise exception 'p_order_id is required';
  end if;
  if p_warehouse_id is null then
    raise exception 'p_warehouse_id is required';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    raise exception 'p_items must be a json array';
  end if;
  if p_payments is null then
    p_payments := '[]'::jsonb;
  end if;
  if jsonb_typeof(p_payments) <> 'array' then
    raise exception 'p_payments must be a json array';
  end if;

  perform pg_advisory_xact_lock(hashtext(p_offline_id));

  select s.state
  into v_existing_state
  from public.pos_offline_sales s
  where s.offline_id = p_offline_id
  for update;

  if found and v_existing_state = 'DELIVERED' then
    return jsonb_build_object('status', 'DELIVERED', 'orderId', p_order_id::text, 'offlineId', p_offline_id);
  end if;

  insert into public.pos_offline_sales(offline_id, order_id, warehouse_id, state, payload, created_by, created_at, updated_at)
  values (p_offline_id, p_order_id, p_warehouse_id, 'SYNCED', coalesce(p_order_data, '{}'::jsonb), v_actor, now(), now())
  on conflict (offline_id)
  do update set
    order_id = excluded.order_id,
    warehouse_id = excluded.warehouse_id,
    state = case when public.pos_offline_sales.state = 'DELIVERED' then 'DELIVERED' else 'SYNCED' end,
    payload = excluded.payload,
    created_by = coalesce(public.pos_offline_sales.created_by, excluded.created_by),
    updated_at = now();

  select * from public.orders o where o.id = p_order_id for update;
  if not found then
    insert into public.orders(id, customer_auth_user_id, status, invoice_number, data, created_at, updated_at)
    values (
      p_order_id,
      v_actor,
      'pending',
      null,
      coalesce(p_order_data, '{}'::jsonb),
      now(),
      now()
    );
  else
    update public.orders
    set data = coalesce(p_order_data, data),
        updated_at = now()
    where id = p_order_id;
  end if;

  begin
    perform public.confirm_order_delivery(p_order_id, p_items, coalesce(p_order_data, '{}'::jsonb), p_warehouse_id);
  exception when others then
    v_err := sqlerrm;
    update public.pos_offline_sales
    set state = case
          when v_err = 'BATCH_EXPIRED' then 'CONFLICT'
          when v_err ilike '%insufficient%' then 'CONFLICT'
          when v_err ilike '%expired%' then 'CONFLICT'
          when v_err ilike '%reservation%' then 'CONFLICT'
          else 'FAILED'
        end,
        last_error = v_err,
        updated_at = now()
    where offline_id = p_offline_id;
    update public.orders
    set data = jsonb_set(coalesce(data, '{}'::jsonb), '{offlineState}', to_jsonb('CONFLICT'::text), true),
        updated_at = now()
    where id = p_order_id;
    return jsonb_build_object(
      'status',
      'CONFLICT',
      'orderId',
      p_order_id::text,
      'offlineId',
      p_offline_id,
      'error',
      case when v_err = 'BATCH_EXPIRED' then 'BATCH_EXPIRED' else v_err end
    );
  end;

  for v_payment in
    select value
    from jsonb_array_elements(p_payments)
  loop
    begin
      perform public.record_order_payment(
        p_order_id,
        coalesce(nullif(v_payment->>'amount','')::numeric, 0),
        coalesce(nullif(v_payment->>'method',''), ''),
        coalesce(nullif(v_payment->>'occurredAt','')::timestamptz, now()),
        'offline:' || p_offline_id || ':' || v_i::text
      );
    exception when others then
      null;
    end;
    v_i := v_i + 1;
  end loop;

  update public.pos_offline_sales
  set state = 'DELIVERED',
      last_error = null,
      updated_at = now()
  where offline_id = p_offline_id;

  update public.orders
  set data = jsonb_set(coalesce(data, '{}'::jsonb), '{offlineState}', to_jsonb('DELIVERED'::text), true),
      updated_at = now()
  where id = p_order_id;

  v_result := jsonb_build_object('status', 'DELIVERED', 'orderId', p_order_id::text, 'offlineId', p_offline_id);
  return v_result;
end;
$$;

revoke all on function public.sync_offline_pos_sale(text, uuid, jsonb, jsonb, uuid, jsonb) from public;
grant execute on function public.sync_offline_pos_sale(text, uuid, jsonb, jsonb, uuid, jsonb) to authenticated;
