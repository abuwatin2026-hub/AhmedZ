do $$
begin
  if to_regclass('public.delivery_zones') is null then
    return;
  end if;

  insert into public.delivery_zones(id, name, is_active, delivery_fee, data)
  values (
    '11111111-1111-4111-8111-111111111111'::uuid,
    'في المحل',
    true,
    0,
    jsonb_build_object(
      'id','11111111-1111-4111-8111-111111111111',
      'name', jsonb_build_object('ar','في المحل','en','In Store'),
      'isActive', true,
      'deliveryFee', 0,
      'estimatedTime', 0
    )
  )
  on conflict (id) do update
  set name = excluded.name,
      is_active = excluded.is_active,
      delivery_fee = excluded.delivery_fee,
      data = excluded.data,
      updated_at = now();
end $$;

notify pgrst, 'reload schema';
