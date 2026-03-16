do $$
declare
  v_item_id text;
  v_purchase_uom_id text;
  v_sales_uom_id text;
begin
  for v_item_id in
    select x::text
    from unnest(array[
      '7b94bb65-255c-49b7-9089-e556de0938ef',
      '878310b8-d146-4684-a6b2-5cbf72961c9d',
      '336131f7-738e-4dcb-a65b-55f0b122fe1a'
    ]) as t(x)
  loop
    select iuu.uom_id
    into v_purchase_uom_id
    from public.item_uom_units iuu
    where iuu.item_id::text = v_item_id
      and coalesce(iuu.is_active, true) = true
    order by coalesce(iuu.qty_in_base, 0) desc, iuu.created_at asc
    limit 1;

    select iuu.uom_id
    into v_sales_uom_id
    from public.item_uom_units iuu
    where iuu.item_id::text = v_item_id
      and coalesce(iuu.is_active, true) = true
    order by abs(coalesce(iuu.qty_in_base, 0) - 1) asc, iuu.created_at asc
    limit 1;

    if v_purchase_uom_id is null or v_sales_uom_id is null then
      continue;
    end if;

    update public.item_uom
    set purchase_uom_id = v_purchase_uom_id::uuid,
        sales_uom_id = v_sales_uom_id::uuid
    where item_id::text = v_item_id;

    update public.item_uom_units
    set is_default_purchase = (uom_id::text = v_purchase_uom_id),
        is_default_sales = (uom_id::text = v_sales_uom_id)
    where item_id::text = v_item_id;
  end loop;
end;
$$;

notify pgrst, 'reload schema';
