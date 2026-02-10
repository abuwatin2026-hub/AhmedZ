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
  new.qty_base := public.item_qty_to_base(new.item_id, new.quantity, new.uom_id);
  return new;
end;
$$;

create or replace function public.trg_set_qty_base_receipt_items()
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
  new.qty_base := public.item_qty_to_base(new.item_id, new.quantity, new.uom_id);
  return new;
end;
$$;

create or replace function public.trg_set_qty_base_inventory_movements()
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
  new.qty_base := public.item_qty_to_base(new.item_id, new.quantity, new.uom_id);
  return new;
end;
$$;

create or replace function public.trg_set_qty_base_transfer_items()
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
  new.qty_base := public.item_qty_to_base(new.item_id, new.quantity, new.uom_id);
  return new;
end;
$$;

notify pgrst, 'reload schema';

