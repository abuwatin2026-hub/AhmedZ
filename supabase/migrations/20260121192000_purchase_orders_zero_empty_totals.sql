create or replace function public.purchase_orders_recalc_after_insert()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  perform public.recalc_purchase_order_totals(new.id);
  return new;
end;
$$;

drop trigger if exists trg_purchase_orders_recalc_after_insert on public.purchase_orders;
create trigger trg_purchase_orders_recalc_after_insert
after insert
on public.purchase_orders
for each row
execute function public.purchase_orders_recalc_after_insert();

update public.purchase_orders po
set
  total_amount = 0,
  items_count = 0,
  updated_at = now()
where not exists (
  select 1
  from public.purchase_items pi
  where pi.purchase_order_id = po.id
);

