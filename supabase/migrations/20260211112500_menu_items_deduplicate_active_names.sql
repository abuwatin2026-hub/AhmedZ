set app.allow_ledger_ddl = '1';

do $$
begin
  -- Deduplicate Arabic names for active items by appending a short suffix
  with dups as (
    select
      id,
      created_at,
      lower(btrim(coalesce(name->>'ar',''))) as n,
      row_number() over (partition by lower(btrim(coalesce(name->>'ar',''))) order by created_at asc, id asc) as rn
    from public.menu_items
    where status = 'active'
      and btrim(coalesce(name->>'ar','')) <> ''
  ),
  to_fix as (
    select id
    from dups
    where rn > 1
  )
  update public.menu_items mi
  set name = jsonb_set(
    mi.name,
    '{ar}',
    to_jsonb(concat(mi.name->>'ar', ' #', right(mi.id, 4))),
    true
  )
  where mi.id in (select id from to_fix);

  -- Deduplicate English names similarly
  with dups_en as (
    select
      id,
      created_at,
      lower(btrim(coalesce(name->>'en',''))) as n,
      row_number() over (partition by lower(btrim(coalesce(name->>'en',''))) order by created_at asc, id asc) as rn
    from public.menu_items
    where status = 'active'
      and btrim(coalesce(name->>'en','')) <> ''
  ),
  to_fix_en as (
    select id
    from dups_en
    where rn > 1
  )
  update public.menu_items mi
  set name = jsonb_set(
    mi.name,
    '{en}',
    to_jsonb(concat(mi.name->>'en', ' #', right(mi.id, 4))),
    true
  )
  where mi.id in (select id from to_fix_en);
end $$;

notify pgrst, 'reload schema';
