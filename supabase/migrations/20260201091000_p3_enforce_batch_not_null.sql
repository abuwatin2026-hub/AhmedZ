do $$
begin
  if exists (select 1 from public.inventory_movements where batch_id is null) then
    raise exception 'inventory_movements.batch_id has NULL rows; cannot enforce NOT NULL';
  end if;
  if exists (select 1 from public.order_item_reservations where batch_id is null) then
    raise exception 'order_item_reservations.batch_id has NULL rows; cannot enforce NOT NULL';
  end if;
end $$;

alter table public.inventory_movements
  alter column batch_id set not null;

alter table public.order_item_reservations
  alter column batch_id set not null;

select pg_sleep(0.5);
notify pgrst, 'reload schema';
