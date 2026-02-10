set app.allow_ledger_ddl = '1';

create or replace function public.upsert_item_uom_unit(
  p_item_id text,
  p_uom_code text,
  p_qty_in_base numeric,
  p_is_default_purchase boolean default false,
  p_is_default_sales boolean default false,
  p_start_date date default null,
  p_end_date date default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item text;
  v_base uuid;
  v_uom uuid;
begin
  if not (auth.role() = 'service_role' or public.has_admin_permission('items.manage') or public.has_admin_permission('inventory.manage')) then
    raise exception 'not allowed';
  end if;

  v_item := nullif(btrim(coalesce(p_item_id, '')), '');
  if v_item is null then
    raise exception 'item_id required';
  end if;
  if coalesce(p_qty_in_base, 0) <= 0 then
    raise exception 'qty_in_base must be > 0';
  end if;

  select base_uom_id into v_base
  from public.item_uom
  where item_id = v_item
  limit 1;

  if v_base is null then
    insert into public.item_uom(item_id, base_uom_id, purchase_uom_id, sales_uom_id)
    select mi.id, public.ensure_uom_code(lower(btrim(coalesce(mi.base_unit, mi.unit_type, 'piece'))), null), null, null
    from public.menu_items mi
    where mi.id = v_item
    on conflict (item_id) do nothing;

    select base_uom_id into v_base
    from public.item_uom
    where item_id = v_item
    limit 1;
  end if;

  if v_base is null then
    raise exception 'base uom missing for item';
  end if;

  insert into public.item_uom_units(item_id, uom_id, qty_in_base, is_active)
  values (v_item, v_base, 1, true)
  on conflict (item_id, uom_id)
  do update set qty_in_base = 1, is_active = true, updated_at = now();

  v_uom := public.ensure_uom_code(p_uom_code, null);

  insert into public.item_uom_units(
    item_id, uom_id, qty_in_base, is_active, is_default_purchase, is_default_sales, start_date, end_date
  )
  values (
    v_item, v_uom, p_qty_in_base, true, coalesce(p_is_default_purchase, false), coalesce(p_is_default_sales, false), p_start_date, p_end_date
  )
  on conflict (item_id, uom_id)
  do update set
    qty_in_base = excluded.qty_in_base,
    is_active = true,
    is_default_purchase = excluded.is_default_purchase,
    is_default_sales = excluded.is_default_sales,
    start_date = excluded.start_date,
    end_date = excluded.end_date,
    updated_at = now();

  if coalesce(p_is_default_purchase, false) then
    update public.item_uom
    set purchase_uom_id = v_uom
    where item_id = v_item;
  end if;

  if coalesce(p_is_default_sales, false) then
    update public.item_uom
    set sales_uom_id = v_uom
    where item_id = v_item;
  end if;

  return jsonb_build_object(
    'itemId', v_item,
    'baseUomId', v_base::text,
    'uomId', v_uom::text,
    'uomCode', (select code from public.uom where id=v_uom),
    'qtyInBase', p_qty_in_base,
    'isDefaultPurchase', coalesce(p_is_default_purchase, false),
    'isDefaultSales', coalesce(p_is_default_sales, false),
    'startDate', p_start_date,
    'endDate', p_end_date
  );
end;
$$;

revoke all on function public.upsert_item_uom_unit(text, text, numeric, boolean, boolean, date, date) from public;
grant execute on function public.upsert_item_uom_unit(text, text, numeric, boolean, boolean, date, date) to authenticated;

create or replace function public.upsert_item_uom_unit_relative(
  p_item_id text,
  p_new_uom_code text,
  p_from_uom_code text,
  p_factor numeric,
  p_is_default_purchase boolean default false,
  p_is_default_sales boolean default false,
  p_start_date date default null,
  p_end_date date default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_from uuid;
  v_base uuid;
  v_qty_base numeric;
begin
  if coalesce(p_factor, 0) <= 0 then
    raise exception 'factor must be > 0';
  end if;
  v_from := public.ensure_uom_code(p_from_uom_code, null);
  select base_uom_id into v_base from public.item_uom where item_id = p_item_id limit 1;
  if v_base is null then
    raise exception 'base uom missing for item';
  end if;
  select qty_in_base into v_qty_base
  from public.item_uom_units
  where item_id = p_item_id and uom_id = v_from and is_active = true
  limit 1;
  if v_qty_base is null then
    raise exception 'missing from uom on item';
  end if;
  return public.upsert_item_uom_unit(
    p_item_id, p_new_uom_code, (v_qty_base * p_factor),
    p_is_default_purchase, p_is_default_sales,
    p_start_date, p_end_date
  );
end;
$$;

revoke all on function public.upsert_item_uom_unit_relative(text, text, text, numeric, boolean, boolean, date, date) from public;
grant execute on function public.upsert_item_uom_unit_relative(text, text, text, numeric, boolean, boolean, date, date) to authenticated;

notify pgrst, 'reload schema';
