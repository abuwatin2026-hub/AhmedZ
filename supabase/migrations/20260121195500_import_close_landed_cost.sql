-- Close import shipment: distribute landed cost and update related movements atomically
-- Minimal patch, transactional, no UX or schema changes

create or replace function public.trg_close_import_shipment()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item record;
  v_sm record;
  v_im record;
  v_avail numeric;
  v_total_current numeric;
  v_total_adjusted numeric;
  v_new_avg numeric;
begin
  -- Only act on first transition to 'closed'
  if coalesce(new.status, '') <> 'closed' then
    return new;
  end if;
  if coalesce(old.status, '') = 'closed' then
    return new;
  end if;

  -- Ensure destination warehouse exists
  if new.destination_warehouse_id is null then
    raise exception 'destination_warehouse_id is required to close import shipment %', new.id;
  end if;

  -- 1) Distribute landed cost across shipment items
  perform public.calculate_shipment_landed_cost(new.id);

  -- 2) For each item in this shipment, update only the purchase_in movement of the last batch in the destination warehouse,
  --    and recompute avg_cost in stock_management based on that movement delta only (no past recomputation).
  for v_item in
    select isi.item_id::text as item_id_text,
           coalesce(isi.quantity, 0) as qty,
           coalesce(isi.landing_cost_per_unit, 0) as landed_unit
    from public.import_shipments_items isi
    where isi.shipment_id = new.id
  loop
    -- Fetch stock record for (item, warehouse)
    select sm.*
    into v_sm
    from public.stock_management sm
    where (case
            when pg_typeof(sm.item_id)::text = 'uuid' then sm.item_id::text = v_item.item_id_text
            else sm.item_id::text = v_item.item_id_text
          end)
      and sm.warehouse_id = new.destination_warehouse_id
    for update;

    if not found then
      raise exception 'Stock record not found for item % in warehouse %', v_item.item_id_text, new.destination_warehouse_id;
    end if;

    if v_sm.last_batch_id is null then
      raise exception 'Missing last_batch_id for item % in warehouse %', v_item.item_id_text, new.destination_warehouse_id;
    end if;

  -- Locate the purchase_in movement that created that batch
  select im.*
  into v_im
  from public.inventory_movements im
  where im.batch_id = v_sm.last_batch_id
    and im.movement_type = 'purchase_in'
  limit 1
  for update;

  if not found then
    raise exception 'Purchase-in movement for batch % not found (item % warehouse %)', v_sm.last_batch_id, v_item.item_id_text, new.destination_warehouse_id;
  end if;

    -- Guard assumption: last_batch_id must correspond to a receipt movement relevant to closing this shipment
    if coalesce(v_im.reference_table, '') <> 'purchase_receipts' then
      raise exception 'Last batch % is not linked to a receipt movement (item % warehouse %)', v_sm.last_batch_id, v_item.item_id_text, new.destination_warehouse_id;
    end if;
    if new.actual_arrival_date is not null and v_im.occurred_at < new.actual_arrival_date then
      raise exception 'Receipt movement for batch % predates shipment arrival (item % warehouse %)', v_sm.last_batch_id, v_item.item_id_text, new.destination_warehouse_id;
    end if;

  -- Update movement unit_cost to landed cost for this shipment item
  update public.inventory_movements
  set unit_cost = v_item.landed_unit,
      total_cost = (coalesce(v_im.quantity, 0) * v_item.landed_unit)
  where id = v_im.id;

    -- Recompute avg_cost using delta of this movement only
    v_avail := coalesce(v_sm.available_quantity, 0);
    if v_avail > 0 then
      v_total_current := (coalesce(v_sm.avg_cost, 0) * v_avail);
    v_total_adjusted := v_total_current
                      - (coalesce(v_im.unit_cost, 0) * coalesce(v_im.quantity, 0))
                      + (v_item.landed_unit * coalesce(v_im.quantity, 0));
    v_new_avg := v_total_adjusted / v_avail;
    update public.stock_management
    set avg_cost = v_new_avg,
        updated_at = now(),
        last_updated = now()
    where id = v_sm.id;
    else
      -- Protect avg_cost when available_quantity = 0: skip recomputation
      -- The batch correction will affect future average when quantities increase
    end if;
  end loop;

  -- If we reach here, the close can proceed; return NEW row unchanged
  return new;
exception
  when others then
    -- Any failure prevents closing (transactional)
    raise;
end;
$$;
revoke all on function public.trg_close_import_shipment() from public;
grant execute on function public.trg_close_import_shipment() to anon, authenticated;

drop trigger if exists trg_import_shipment_close on public.import_shipments;
create trigger trg_import_shipment_close
after update on public.import_shipments
for each row
when (new.status = 'closed' and (old.status is distinct from new.status))
execute function public.trg_close_import_shipment();
