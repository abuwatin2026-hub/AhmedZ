do $$
declare
  v_now timestamptz := now();
begin
  with distinct_keys as (
    select distinct nullif(trim(category), '') as key
    from public.menu_items
    where nullif(trim(category), '') is not null
  ),
  missing as (
    select dk.key
    from distinct_keys dk
    left join public.item_categories ic on ic.key = dk.key
    where ic.key is null
  ),
  rows_to_insert as (
    select
      gen_random_uuid() as id,
      m.key as key,
      case
        when m.key = 'grocery' then jsonb_build_object('ar', 'مواد غذائية', 'en', 'Groceries')
        else jsonb_build_object('ar', m.key, 'en', m.key)
      end as name
    from missing m
  )
  insert into public.item_categories(id, key, is_active, data, created_at, updated_at)
  select
    r.id,
    r.key,
    true,
    jsonb_build_object(
      'id', r.id::text,
      'key', r.key,
      'name', r.name,
      'isActive', true,
      'createdAt', v_now,
      'updatedAt', v_now
    ),
    v_now,
    v_now
  from rows_to_insert r;
end;
$$;

