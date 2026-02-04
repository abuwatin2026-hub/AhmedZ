do $$
begin
  if to_regclass('public.item_groups') is null then
    create table public.item_groups (
      id uuid primary key default gen_random_uuid(),
      category_key text not null references public.item_categories(key) on delete cascade,
      key text not null,
      is_active boolean not null default true,
      data jsonb not null default '{}'::jsonb,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );
  end if;
end $$;

do $$
begin
  begin
    create unique index if not exists idx_item_groups_category_key_key on public.item_groups(category_key, key);
  exception when undefined_table then
    null;
  end;
  begin
    create index if not exists idx_item_groups_category_key on public.item_groups(category_key);
  exception when undefined_table then
    null;
  end;
end $$;

drop trigger if exists trg_item_groups_updated_at on public.item_groups;
create trigger trg_item_groups_updated_at
before update on public.item_groups
for each row execute function public.set_updated_at();

alter table public.item_groups enable row level security;

drop policy if exists item_groups_select_all on public.item_groups;
create policy item_groups_select_all
on public.item_groups
for select
using (true);

drop policy if exists item_groups_write_admin on public.item_groups;
create policy item_groups_write_admin
on public.item_groups
for all
using (public.is_admin())
with check (public.is_admin());

select pg_sleep(0.2);
notify pgrst, 'reload schema';
