create or replace function public.validate_sales_return_inventory_reference()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.reference_table = 'sales_returns' and new.movement_type = 'return_in' then
    if nullif(trim(coalesce(new.reference_id, '')), '') is null then
      raise exception 'sales_returns return_in requires reference_id';
    end if;

    if not exists (
      select 1
      from public.sales_returns sr
      where sr.id::text = new.reference_id
    ) then
      raise exception 'invalid sales_return reference_id: %', new.reference_id;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_validate_sales_return_inventory_reference on public.inventory_movements;
create trigger trg_validate_sales_return_inventory_reference
before insert or update of reference_table, reference_id, movement_type
on public.inventory_movements
for each row
execute function public.validate_sales_return_inventory_reference();

notify pgrst, 'reload schema';
