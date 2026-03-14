set app.allow_ledger_ddl = '1';

create or replace function public._apply_transfer_in_avg_cost()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.movement_type <> 'transfer_in' then
    return new;
  end if;

  if coalesce(new.reference_table, '') <> 'warehouse_transfers' then
    return new;
  end if;

  if new.warehouse_id is null or new.item_id is null then
    return new;
  end if;

  update public.stock_management sm
  set
    avg_cost = case
      when coalesce(sm.available_quantity, 0) > 0 then
        (
          greatest(coalesce(sm.available_quantity, 0) - coalesce(new.quantity, 0), 0) * coalesce(sm.avg_cost, 0)
          + coalesce(new.quantity, 0) * coalesce(new.unit_cost, 0)
        ) / nullif(coalesce(sm.available_quantity, 0), 0)
      else
        coalesce(new.unit_cost, 0)
    end,
    last_updated = now(),
    updated_at = now()
  where sm.item_id = new.item_id
    and sm.warehouse_id = new.warehouse_id;

  return new;
end;
$$;

notify pgrst, 'reload schema';
