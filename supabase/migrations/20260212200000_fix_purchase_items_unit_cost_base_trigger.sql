set app.allow_ledger_ddl = '1';

create or replace function public.trg_set_qty_base_purchase_items()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_base uuid;
begin
  select base_uom_id into v_base from public.item_uom where item_id = new.item_id limit 1;
  if v_base is null then
    raise exception 'base uom missing for item';
  end if;
  if new.uom_id is null then
    new.uom_id := v_base;
  end if;

  begin
    new.qty_base := public.item_qty_to_base(new.item_id, new.quantity, new.uom_id);
  exception when others then
    new.qty_base := coalesce(new.quantity, 0);
  end;

  begin
    new.unit_cost_base := public.item_unit_cost_to_base(new.item_id, new.unit_cost, new.uom_id);
  exception when others then
    new.unit_cost_base := coalesce(new.unit_cost, 0);
  end;

  return new;
end;
$$;

do $$
begin
  if to_regclass('public.purchase_items') is null then
    return;
  end if;
  drop trigger if exists trg_set_qty_base_purchase_items on public.purchase_items;
  create trigger trg_set_qty_base_purchase_items
  before insert or update on public.purchase_items
  for each row execute function public.trg_set_qty_base_purchase_items();
end $$;

do $$
declare
  v_row record;
  v_base uuid;
begin
  if to_regclass('public.purchase_items') is null then
    return;
  end if;
  if to_regclass('public.item_uom') is null then
    return;
  end if;

  for v_row in
    select id, item_id, uom_id, quantity, unit_cost, unit_cost_base
    from public.purchase_items
    where (unit_cost_base is null or unit_cost_base = 0)
       or uom_id is null
  loop
    select base_uom_id into v_base from public.item_uom where item_id = v_row.item_id limit 1;
    if v_base is null then
      continue;
    end if;
    update public.purchase_items pi
    set uom_id = coalesce(pi.uom_id, v_base),
        qty_base = coalesce(pi.qty_base, public.item_qty_to_base(pi.item_id, pi.quantity, coalesce(pi.uom_id, v_base))),
        unit_cost_base = case
          when coalesce(pi.unit_cost_base, 0) > 0 then pi.unit_cost_base
          else public.item_unit_cost_to_base(pi.item_id, pi.unit_cost, coalesce(pi.uom_id, v_base))
        end
    where pi.id = v_row.id;
  end loop;
end $$;

notify pgrst, 'reload schema';

