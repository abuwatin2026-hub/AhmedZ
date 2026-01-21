do $$
begin
  if not exists (
    select 1
    from public.delivery_zones
    where id = '11111111-1111-4111-8111-111111111111'::uuid
  ) then
    insert into public.delivery_zones (id, name, is_active, delivery_fee, data)
    values (
      '11111111-1111-4111-8111-111111111111'::uuid,
      'المحل',
      true,
      0,
      jsonb_build_object(
        'id', '11111111-1111-4111-8111-111111111111',
        'name', jsonb_build_object('ar', 'المحل', 'en', 'In-store'),
        'deliveryFee', 0,
        'estimatedTime', 0,
        'isActive', true
      )
    );
  end if;
end $$;

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'orders'
      and column_name = 'delivery_zone_id'
  ) then
    update public.orders
    set
      delivery_zone_id = '11111111-1111-4111-8111-111111111111'::uuid,
      data = case
        when jsonb_typeof(data->'invoiceSnapshot') = 'object' then
          jsonb_set(
            jsonb_set(
              data,
              '{deliveryZoneId}',
              to_jsonb('11111111-1111-4111-8111-111111111111'::text),
              true
            ),
            '{invoiceSnapshot,deliveryZoneId}',
            to_jsonb('11111111-1111-4111-8111-111111111111'::text),
            true
          )
        else
          jsonb_set(
            data,
            '{deliveryZoneId}',
            to_jsonb('11111111-1111-4111-8111-111111111111'::text),
            true
          )
      end
    where coalesce(nullif(data->>'orderSource',''), '') = 'in_store'
      and (
        delivery_zone_id is null
        or nullif(data->>'deliveryZoneId','') is null
      );
  end if;
end $$;
