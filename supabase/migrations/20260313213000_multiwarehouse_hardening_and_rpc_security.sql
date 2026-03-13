set app.allow_ledger_ddl = '1';

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
  v_item_id text;
  v_requested numeric;
  v_needed numeric;
  v_is_food boolean;
  v_batch record;
  v_reserved_other numeric;
  v_free numeric;
  v_alloc numeric;
  v_rows integer;
  v_factor numeric;
  v_uom_code text;
  v_unit_type text;
  v_weight numeric;
  v_item_warehouse_id uuid;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;
  if p_order_id is null or p_warehouse_id is null then
    raise exception 'order_id and warehouse_id are required';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    raise exception 'p_items must be a json array';
  end if;

  for v_item in select value from jsonb_array_elements(coalesce(p_items, '[]'::jsonb))
  loop
    v_item_id := coalesce(nullif(v_item->>'itemId',''), nullif(v_item->>'id',''));
    v_item_warehouse_id := coalesce(public._uuid_or_null(v_item->>'warehouseId'), p_warehouse_id);
    v_requested := coalesce(nullif(v_item->>'quantity','')::numeric, nullif(v_item->>'qty','')::numeric, 0);
    if v_item_id is null or v_item_id = '' or v_requested <= 0 then
      continue;
    end if;

    v_unit_type := lower(coalesce(nullif(v_item->>'unitType',''), nullif(v_item->>'unit',''), ''));
    if v_unit_type = 'kg' or v_unit_type = 'gram' then
      v_weight := coalesce(nullif(v_item->>'weight','')::numeric, null);
      v_needed := coalesce(v_weight, v_requested);
    else
      v_factor := coalesce(nullif(v_item->>'uomQtyInBase','')::numeric, nullif(v_item->>'uom_qty_in_base','')::numeric, 0);
      if coalesce(v_factor, 0) <= 0 then
        v_uom_code := lower(btrim(coalesce(nullif(v_item->>'uomCode',''), nullif(v_item->>'uom_code',''), nullif(v_item->>'uom',''), nullif(v_item->>'unitType',''), nullif(v_item->>'unit',''))));
        if nullif(v_uom_code, '') is not null and to_regclass('public.item_uom_units') is not null and to_regclass('public.uom') is not null then
          select iuu.qty_in_base
          into v_factor
          from public.item_uom_units iuu
          join public.uom u on u.id = iuu.uom_id
          where iuu.item_id = v_item_id::text
            and iuu.is_active = true
            and lower(u.code) = v_uom_code
          limit 1;
        end if;
      end if;
      v_needed := v_requested * coalesce(nullif(v_factor, 0), 1);
    end if;

    if v_needed <= 0 then
      continue;
    end if;

    select (coalesce(mi.category,'') = 'food')
    into v_is_food
    from public.menu_items mi
    where mi.id::text = v_item_id::text;

    delete from public.order_item_reservations r
    where r.order_id = p_order_id
      and r.item_id = v_item_id::text
      and r.warehouse_id = v_item_warehouse_id;

    for v_batch in
      select
        b.id as batch_id,
        b.expiry_date,
        b.unit_cost,
        greatest(
          coalesce(b.quantity_received,0)
          - coalesce(b.quantity_consumed,0)
          - coalesce(b.quantity_transferred,0),
          0
        ) as remaining_qty
      from public.batches b
      where b.item_id::text = v_item_id::text
        and b.warehouse_id = v_item_warehouse_id
        and coalesce(b.status, 'active') = 'active'
        and (
          not coalesce(v_is_food, false)
          or (b.expiry_date is null or b.expiry_date >= current_date)
        )
      order by b.expiry_date asc nulls last, b.created_at asc, b.id asc
      for update
    loop
      exit when v_needed <= 0;
      if coalesce(v_batch.remaining_qty, 0) <= 0 then
        continue;
      end if;

      select coalesce(sum(r2.quantity), 0)
      into v_reserved_other
      from public.order_item_reservations r2
      where r2.batch_id = v_batch.batch_id
        and r2.warehouse_id = v_item_warehouse_id
        and r2.order_id <> p_order_id;

      v_free := greatest(coalesce(v_batch.remaining_qty, 0) - coalesce(v_reserved_other, 0), 0);
      if v_free <= 0 then
        continue;
      end if;

      v_alloc := least(v_needed, v_free);
      if v_alloc <= 0 then
        continue;
      end if;

      insert into public.order_item_reservations(order_id, item_id, warehouse_id, batch_id, quantity, created_at, updated_at)
      values (p_order_id, v_item_id::text, v_item_warehouse_id, v_batch.batch_id, v_alloc, now(), now());

      v_needed := v_needed - v_alloc;
    end loop;

    if v_needed > 0 then
      raise exception 'INSUFFICIENT_FEFO_BATCH_STOCK_FOR_ITEM_%_WAREHOUSE_%', v_item_id, v_item_warehouse_id;
    end if;

    insert into public.stock_management(item_id, warehouse_id, available_quantity, reserved_quantity, unit, low_stock_threshold, avg_cost, last_updated, updated_at, data)
    select mi.id, v_item_warehouse_id, 0, 0, coalesce(mi.base_unit, mi.unit_type, 'piece'), 5, 0, now(), now(), '{}'::jsonb
    from public.menu_items mi
    where mi.id = v_item_id::text
    on conflict (item_id, warehouse_id) do nothing;

    update public.stock_management sm
    set reserved_quantity = coalesce((
          select sum(r.quantity)
          from public.order_item_reservations r
          where r.item_id = v_item_id::text
            and r.warehouse_id = v_item_warehouse_id
        ), 0),
        available_quantity = coalesce((
          select sum(
            greatest(coalesce(b.quantity_received,0) - coalesce(b.quantity_consumed,0) - coalesce(b.quantity_transferred,0), 0)
          )
          from public.batches b
          where b.item_id::text = v_item_id::text
            and b.warehouse_id = v_item_warehouse_id
            and coalesce(b.status,'active') = 'active'
            and (
              not coalesce(v_is_food, false)
              or (b.expiry_date is null or b.expiry_date >= current_date)
            )
        ), 0),
        last_updated = now(),
        updated_at = now()
    where sm.item_id::text = v_item_id::text
      and sm.warehouse_id = v_item_warehouse_id;
    get diagnostics v_rows = row_count;
    if coalesce(v_rows, 0) = 0 then
      raise exception 'STOCK_ROW_NOT_FOUND_FOR_ITEM_%_WAREHOUSE_%', v_item_id, v_item_warehouse_id;
    end if;
  end loop;
end;
$$;

create or replace function public.reserve_stock_for_order(
  p_items jsonb,
  p_order_id uuid default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_default_warehouse uuid;
begin
  v_default_warehouse := coalesce(public._resolve_default_admin_warehouse_id(), public._resolve_default_warehouse_id());
  if v_default_warehouse is null then
    raise exception 'warehouse_id is required';
  end if;
  perform public.reserve_stock_for_order(p_items, p_order_id, v_default_warehouse);
end;
$$;

do $$
declare
  v_sig regprocedure;
begin
  v_sig := to_regprocedure('public.reserve_stock_for_order(jsonb,uuid,uuid)');
  if v_sig is not null then
    execute format('revoke all on function %s from public', v_sig);
    execute format('revoke all on function %s from anon', v_sig);
    execute format('grant execute on function %s to authenticated', v_sig);
    execute format('grant execute on function %s to service_role', v_sig);
  end if;

  v_sig := to_regprocedure('public.reserve_stock_for_order(jsonb,uuid)');
  if v_sig is not null then
    execute format('revoke all on function %s from public', v_sig);
    execute format('revoke all on function %s from anon', v_sig);
    execute format('grant execute on function %s to authenticated', v_sig);
    execute format('grant execute on function %s to service_role', v_sig);
  end if;
end $$;

do $$
declare
  v_sig regprocedure;
begin
  foreach v_sig in array array[
    to_regprocedure('public.complete_warehouse_transfer(uuid)'),
    to_regprocedure('public.cancel_warehouse_transfer(uuid,text)'),
    to_regprocedure('public.confirm_order_delivery(uuid,jsonb,jsonb,uuid)'),
    to_regprocedure('public.confirm_order_delivery(uuid,jsonb,jsonb)'),
    to_regprocedure('public.confirm_order_delivery(jsonb)'),
    to_regprocedure('public.confirm_order_delivery_with_credit(uuid,jsonb,jsonb,uuid)'),
    to_regprocedure('public.confirm_order_delivery_with_credit(uuid,jsonb,jsonb)'),
    to_regprocedure('public.confirm_order_delivery_with_credit(jsonb)')
  ]
  loop
    if v_sig is null then
      continue;
    end if;
    execute format('revoke all on function %s from anon', v_sig);
    execute format('grant execute on function %s to authenticated', v_sig);
    execute format('grant execute on function %s to service_role', v_sig);
  end loop;
end $$;

notify pgrst, 'reload schema';
