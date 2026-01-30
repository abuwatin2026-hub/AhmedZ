drop trigger if exists trg_orders_require_sale_out_on_delivered on public.orders;
drop function if exists public.trg_orders_require_sale_out_on_delivered();

create or replace function public.trg_orders_require_sale_out_on_delivered()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'delivered' and (old.status is distinct from new.status) then
    if not exists (
      select 1
      from public.inventory_movements im
      where im.reference_table = 'orders'
        and im.reference_id = new.id::text
        and im.movement_type = 'sale_out'
    ) then
      raise exception 'cannot mark delivered without stock movements';
    end if;
  end if;
  return new;
end;
$$;

create constraint trigger trg_orders_require_sale_out_on_delivered
after update of status
on public.orders
deferrable initially deferred
for each row
execute function public.trg_orders_require_sale_out_on_delivered();

select pg_sleep(1);
notify pgrst, 'reload schema';
