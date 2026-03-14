set app.allow_ledger_ddl = '1';

create or replace function public._apply_transfer_in_avg_cost()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_prev_qty numeric := 0;
  v_prev_avg numeric := 0;
  v_new_avg numeric := 0;
begin
  if new.movement_type <> 'transfer_in' then
    return new;
  end if;

  if new.warehouse_id is null or new.item_id is null then
    return new;
  end if;

  select
    greatest(coalesce(sm.available_quantity, 0) - coalesce(new.quantity, 0), 0),
    coalesce(sm.avg_cost, 0)
  into v_prev_qty, v_prev_avg
  from public.stock_management sm
  where sm.item_id = new.item_id
    and sm.warehouse_id = new.warehouse_id
  for update;

  v_new_avg := case
    when coalesce(v_prev_qty, 0) + coalesce(new.quantity, 0) > 0 then
      ((coalesce(v_prev_qty, 0) * coalesce(v_prev_avg, 0)) + (coalesce(new.quantity, 0) * coalesce(new.unit_cost, 0)))
      / (coalesce(v_prev_qty, 0) + coalesce(new.quantity, 0))
    else
      coalesce(new.unit_cost, 0)
  end;

  update public.stock_management
  set
    avg_cost = v_new_avg,
    last_updated = now(),
    updated_at = now()
  where item_id = new.item_id
    and warehouse_id = new.warehouse_id;

  return new;
end;
$$;

do $$
begin
  if exists (
    select 1 from pg_trigger
    where tgname = 'trg_apply_transfer_in_avg_cost'
  ) then
    execute 'drop trigger trg_apply_transfer_in_avg_cost on public.inventory_movements';
  end if;
end $$;

create trigger trg_apply_transfer_in_avg_cost
after insert on public.inventory_movements
for each row
execute function public._apply_transfer_in_avg_cost();

notify pgrst, 'reload schema';
