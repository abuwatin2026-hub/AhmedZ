create or replace function public.trg_inventory_movements_ensure_batch_exists()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_wh uuid;
  v_expiry date;
  v_prod date;
begin
  if new.movement_type <> 'purchase_in' then
    return new;
  end if;
  if new.batch_id is null then
    return new;
  end if;
  if exists (select 1 from public.batches b where b.id = new.batch_id) then
    return new;
  end if;

  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;
  if not public.has_admin_permission('stock.manage') then
    raise exception 'not allowed';
  end if;

  v_wh := coalesce(new.warehouse_id, public._resolve_default_warehouse_id());
  v_expiry := case
    when (new.data->>'expiryDate') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then (new.data->>'expiryDate')::date
    else null
  end;
  v_prod := case
    when (new.data->>'harvestDate') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then (new.data->>'harvestDate')::date
    else null
  end;

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
    unit_cost,
    status,
    locked_at,
    data
  )
  values (
    new.batch_id,
    new.item_id::text,
    null,
    null,
    v_wh,
    null,
    v_prod,
    v_expiry,
    coalesce(new.quantity, 0),
    0,
    coalesce(new.unit_cost, 0),
    'active',
    null,
    jsonb_build_object('autoCreated', true, 'sourceTable', coalesce(new.reference_table, ''), 'sourceId', coalesce(new.reference_id, ''))
  )
  on conflict (id) do nothing;

  return new;
end;
$$;

drop trigger if exists trg_inventory_movements_ensure_batch_exists on public.inventory_movements;
create trigger trg_inventory_movements_ensure_batch_exists
before insert
on public.inventory_movements
for each row
when (new.movement_type = 'purchase_in' and new.batch_id is not null)
execute function public.trg_inventory_movements_ensure_batch_exists();

revoke all on function public.trg_inventory_movements_ensure_batch_exists() from public;
grant execute on function public.trg_inventory_movements_ensure_batch_exists() to authenticated;
