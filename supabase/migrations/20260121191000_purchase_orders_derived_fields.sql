create or replace function public.purchase_items_set_total_cost()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.total_cost := coalesce(new.quantity, 0) * coalesce(new.unit_cost, 0);
  return new;
end;
$$;

drop trigger if exists trg_purchase_items_total_cost on public.purchase_items;
create trigger trg_purchase_items_total_cost
before insert or update of quantity, unit_cost
on public.purchase_items
for each row
execute function public.purchase_items_set_total_cost();

create or replace function public.recalc_purchase_order_totals(p_order_id uuid)
returns void
language plpgsql
set search_path = public
as $$
begin
  if p_order_id is null then
    return;
  end if;

  update public.purchase_orders po
  set
    total_amount = coalesce((
      select sum(coalesce(pi.total_cost, coalesce(pi.quantity, 0) * coalesce(pi.unit_cost, 0)))
      from public.purchase_items pi
      where pi.purchase_order_id = p_order_id
    ), 0),
    items_count = coalesce((
      select count(*)
      from public.purchase_items pi
      where pi.purchase_order_id = p_order_id
    ), 0),
    updated_at = now()
  where po.id = p_order_id;
end;
$$;

create or replace function public.purchase_items_after_change()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    perform public.recalc_purchase_order_totals(old.purchase_order_id);
    return old;
  end if;

  if tg_op = 'UPDATE' and (new.purchase_order_id is distinct from old.purchase_order_id) then
    perform public.recalc_purchase_order_totals(old.purchase_order_id);
    perform public.recalc_purchase_order_totals(new.purchase_order_id);
    return new;
  end if;

  perform public.recalc_purchase_order_totals(new.purchase_order_id);
  return new;
end;
$$;

drop trigger if exists trg_purchase_items_recalc on public.purchase_items;
create trigger trg_purchase_items_recalc
after insert or update or delete
on public.purchase_items
for each row
execute function public.purchase_items_after_change();

update public.purchase_items
set total_cost = coalesce(quantity, 0) * coalesce(unit_cost, 0);

update public.purchase_orders po
set
  total_amount = coalesce(x.total_amount, 0),
  items_count = coalesce(x.items_count, 0),
  updated_at = now()
from (
  select
    pi.purchase_order_id,
    sum(coalesce(pi.total_cost, coalesce(pi.quantity, 0) * coalesce(pi.unit_cost, 0))) as total_amount,
    count(*)::int as items_count
  from public.purchase_items pi
  group by pi.purchase_order_id
) x
where po.id = x.purchase_order_id;

