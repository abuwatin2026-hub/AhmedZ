set app.allow_ledger_ddl = '1';

create or replace function public.upsert_item_uom_units(
  p_item_id text,
  p_units jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item text;
  v_base uuid;
  v_base_code text;
  v_keep uuid[];
  v_elem jsonb;
  v_code text;
  v_name text;
  v_qty numeric;
  v_uom uuid;
begin
  if not (auth.role() = 'service_role' or public.has_admin_permission('items.manage') or public.has_admin_permission('inventory.manage')) then
    raise exception 'not allowed';
  end if;

  v_item := nullif(btrim(coalesce(p_item_id, '')), '');
  if v_item is null then
    raise exception 'item_id required';
  end if;

  select base_uom_id
  into v_base
  from public.item_uom
  where item_id = v_item
  limit 1;

  if v_base is null then
    insert into public.item_uom(item_id, base_uom_id, purchase_uom_id, sales_uom_id)
    select
      mi.id,
      public.ensure_uom_code(lower(btrim(coalesce(mi.base_unit, mi.unit_type, 'piece'))), null),
      null,
      null
    from public.menu_items mi
    where mi.id = v_item
    on conflict (item_id) do nothing;

    select base_uom_id
    into v_base
    from public.item_uom
    where item_id = v_item
    limit 1;
  end if;

  if v_base is null then
    raise exception 'base uom missing for item';
  end if;

  select code
  into v_base_code
  from public.uom
  where id = v_base
  limit 1;
  v_base_code := lower(btrim(coalesce(v_base_code, '')));

  v_keep := array[v_base];

  insert into public.item_uom_units(item_id, uom_id, qty_in_base, is_active)
  values (v_item, v_base, 1, true)
  on conflict (item_id, uom_id)
  do update set qty_in_base = excluded.qty_in_base, is_active = true, updated_at = now();

  if p_units is not null and jsonb_typeof(p_units) = 'array' then
    for v_elem in
      select * from jsonb_array_elements(p_units)
    loop
      v_code := lower(btrim(coalesce(v_elem->>'code', '')));
      v_name := btrim(coalesce(v_elem->>'name', ''));
      begin
        v_qty := nullif(btrim(coalesce(v_elem->>'qtyInBase', '')), '')::numeric;
      exception when others then
        v_qty := null;
      end;

      if v_code = '' or v_qty is null or v_qty <= 0 then
        continue;
      end if;

      if v_base_code <> '' and v_code = v_base_code then
        continue;
      end if;

      v_uom := public.ensure_uom_code(v_code, nullif(v_name, ''));
      if v_uom = v_base then
        continue;
      end if;

      if not (v_uom = any(v_keep)) then
        v_keep := array_append(v_keep, v_uom);
      end if;

      insert into public.item_uom_units(item_id, uom_id, qty_in_base, is_active)
      values (v_item, v_uom, v_qty, true)
      on conflict (item_id, uom_id)
      do update set qty_in_base = excluded.qty_in_base, is_active = true, updated_at = now();
    end loop;
  end if;

  update public.item_uom_units
  set is_active = false, updated_at = now()
  where item_id = v_item
    and not (uom_id = any(v_keep));

  return jsonb_build_object(
    'itemId', v_item,
    'baseUomId', v_base::text,
    'activeUomIds', to_jsonb(v_keep)
  );
end;
$$;

revoke all on function public.upsert_item_uom_units(text, jsonb) from public;
grant execute on function public.upsert_item_uom_units(text, jsonb) to authenticated;

notify pgrst, 'reload schema';
