create or replace function public.trg_apply_import_shipment_landed_cost_on_delivered()
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
  if new.destination_warehouse_id is null then
    raise exception 'destination_warehouse_id is required to apply landed cost on delivered for shipment %', new.id;
  end if;
  perform public.calculate_shipment_landed_cost(new.id);
  for v_item in
    select isi.item_id::text as item_id_text,
           coalesce(isi.quantity, 0) as qty,
           coalesce(isi.landing_cost_per_unit, 0) as landed_unit
    from public.import_shipments_items isi
    where isi.shipment_id = new.id
  loop
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
    if coalesce(v_im.reference_table, '') <> 'purchase_receipts' then
      raise exception 'Last batch % is not linked to a receipt movement (item % warehouse %)', v_sm.last_batch_id, v_item.item_id_text, new.destination_warehouse_id;
    end if;
    if new.actual_arrival_date is not null and v_im.occurred_at < new.actual_arrival_date then
      raise exception 'Receipt movement for batch % predates shipment arrival (item % warehouse %)', v_sm.last_batch_id, v_item.item_id_text, new.destination_warehouse_id;
    end if;
    update public.batches b
    set unit_cost = v_item.landed_unit,
        updated_at = now()
    where b.item_id = v_item.item_id_text
      and b.warehouse_id = new.destination_warehouse_id
      and coalesce(b.quantity_consumed,0) < coalesce(b.quantity_received,0)
      and exists (
        select 1
        from public.inventory_movements im2
        where im2.batch_id = b.id
          and im2.movement_type = 'purchase_in'
          and im2.reference_table = 'purchase_receipts'
          and (new.actual_arrival_date is null or im2.occurred_at >= new.actual_arrival_date)
      );
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
      where (case
              when pg_typeof(stock_management.item_id)::text = 'uuid' then stock_management.item_id::text = v_item.item_id_text
              else stock_management.item_id::text = v_item.item_id_text
            end)
        and stock_management.warehouse_id = new.destination_warehouse_id;
    end if;
  end loop;
  return new;
exception
  when others then
    raise;
end;
$$;
revoke all on function public.trg_apply_import_shipment_landed_cost_on_delivered() from public;
grant execute on function public.trg_apply_import_shipment_landed_cost_on_delivered() to service_role;
drop trigger if exists trg_import_shipment_delivered_close on public.import_shipments;
create trigger trg_import_shipment_delivered_close
after update on public.import_shipments
for each row
when (new.status = 'delivered' and (old.status is distinct from new.status))
execute function public.trg_apply_import_shipment_landed_cost_on_delivered();
