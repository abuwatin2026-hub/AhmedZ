create or replace function public.haversine_distance_meters(
  lat1 double precision,
  lng1 double precision,
  lat2 double precision,
  lng2 double precision
)
returns double precision
language sql
immutable
as $$
  select 2 * 6371000.0 * asin(
    sqrt(
      power(sin(radians((lat2 - lat1) / 2.0)), 2)
      + cos(radians(lat1)) * cos(radians(lat2))
      * power(sin(radians((lng2 - lng1) / 2.0)), 2)
    )
  );
$$;

create or replace function public.orders_validate_delivery_zone_radius()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_source text;
  v_zone_id uuid;
  v_lat double precision;
  v_lng double precision;
  v_zone_lat double precision;
  v_zone_lng double precision;
  v_radius double precision;
  v_is_active boolean;
  v_dist double precision;
begin
  v_source := coalesce(nullif(new.data->>'orderSource',''), '');
  if v_source = 'in_store' then
    return new;
  end if;

  v_zone_id := new.delivery_zone_id;
  if v_zone_id is null
     and nullif(new.data->>'deliveryZoneId','') is not null
     and (new.data->>'deliveryZoneId') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  then
    v_zone_id := (new.data->>'deliveryZoneId')::uuid;
  end if;

  if v_zone_id is null then
    raise exception 'يرجى اختيار منطقة توصيل صحيحة.' using errcode = 'P0001';
  end if;

  if jsonb_typeof(new.data->'location') <> 'object' then
    raise exception 'عذرًا، لا يمكن إرسال الطلب بدون تحديد موقعك على الخريطة.' using errcode = 'P0001';
  end if;

  v_lat := nullif(new.data->'location'->>'lat','')::double precision;
  v_lng := nullif(new.data->'location'->>'lng','')::double precision;
  if v_lat is null or v_lng is null then
    raise exception 'عذرًا، تعذر قراءة إحداثيات موقعك.' using errcode = 'P0001';
  end if;

  select
    nullif(dz.data->'coordinates'->>'lat','')::double precision,
    nullif(dz.data->'coordinates'->>'lng','')::double precision,
    nullif(dz.data->'coordinates'->>'radius','')::double precision,
    dz.is_active
  into v_zone_lat, v_zone_lng, v_radius, v_is_active
  from public.delivery_zones dz
  where dz.id = v_zone_id;

  if not found then
    raise exception 'منطقة التوصيل غير موجودة.' using errcode = 'P0001';
  end if;

  if not coalesce(v_is_active, false) then
    raise exception 'منطقة التوصيل غير مفعلة.' using errcode = 'P0001';
  end if;

  if v_zone_lat is null or v_zone_lng is null or v_radius is null or v_radius <= 0 then
    raise exception 'تعذر التحقق من نطاق منطقة التوصيل. يرجى التواصل مع الإدارة.' using errcode = 'P0001';
  end if;

  v_dist := public.haversine_distance_meters(v_lat, v_lng, v_zone_lat, v_zone_lng);
  if v_dist > v_radius then
    raise exception 'عذرًا، موقعك خارج نطاق منطقة التوصيل.' using errcode = 'P0001';
  end if;

  new.delivery_zone_id := v_zone_id;
  new.data := jsonb_set(new.data, '{deliveryZoneId}', to_jsonb(v_zone_id::text), true);
  return new;
end;
$$;

drop trigger if exists trg_orders_validate_delivery_zone_radius on public.orders;
create trigger trg_orders_validate_delivery_zone_radius
before insert or update on public.orders
for each row
execute function public.orders_validate_delivery_zone_radius();
