do $$
begin
  if to_regclass('public.admin_users') is not null then
    create or replace function public.is_admin()
    returns boolean
    language sql
    stable
    as $fn$
      select exists (
        select 1
        from public.admin_users au
        where au.id = auth.uid()
          and coalesce(au.data->>'role','') = 'admin'
          and coalesce((au.data->>'isActive')::boolean, true) = true
      );
    $fn$;
  end if;
end $$;

do $$
begin
  if to_regclass('public.item_categories') is not null then
    alter table public.item_categories enable row level security;
    drop policy if exists item_categories_select_all on public.item_categories;
    create policy item_categories_select_all on public.item_categories for select using (true);
    drop policy if exists item_categories_write_admin on public.item_categories;
    create policy item_categories_write_admin on public.item_categories for all using (public.is_admin()) with check (public.is_admin());
    grant select on public.item_categories to anon, authenticated;
  end if;
end $$;

do $$
begin
  if to_regclass('public.unit_types') is not null then
    alter table public.unit_types enable row level security;
    drop policy if exists unit_types_select_all on public.unit_types;
    create policy unit_types_select_all on public.unit_types for select using (true);
    drop policy if exists unit_types_write_admin on public.unit_types;
    create policy unit_types_write_admin on public.unit_types for all using (public.is_admin()) with check (public.is_admin());
    grant select on public.unit_types to anon, authenticated;
  end if;
end $$;

do $$
begin
  if to_regclass('public.freshness_levels') is not null then
    alter table public.freshness_levels enable row level security;
    drop policy if exists freshness_levels_select_all on public.freshness_levels;
    create policy freshness_levels_select_all on public.freshness_levels for select using (true);
    drop policy if exists freshness_levels_write_admin on public.freshness_levels;
    create policy freshness_levels_write_admin on public.freshness_levels for all using (public.is_admin()) with check (public.is_admin());
    grant select on public.freshness_levels to anon, authenticated;
  end if;
end $$;

do $$
begin
  if to_regclass('public.item_groups') is not null then
    alter table public.item_groups enable row level security;
    drop policy if exists item_groups_select_all on public.item_groups;
    create policy item_groups_select_all on public.item_groups for select using (true);
    drop policy if exists item_groups_write_admin on public.item_groups;
    create policy item_groups_write_admin on public.item_groups for all using (public.is_admin()) with check (public.is_admin());
    grant select on public.item_groups to anon, authenticated;
  end if;
end $$;

select pg_sleep(0.2);
notify pgrst, 'reload schema';
