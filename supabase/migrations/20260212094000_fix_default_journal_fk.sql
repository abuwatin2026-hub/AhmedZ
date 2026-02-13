set app.allow_ledger_ddl = '1';

do $$
declare
  v_fallback_id uuid := '00000000-0000-4000-8000-000000000001'::uuid;
  v_has_any boolean := false;
  v_has_default boolean := false;
  v_default_id uuid;
begin
  if to_regclass('public.journals') is null then
    create table public.journals (
      id uuid primary key,
      code text not null unique,
      name text not null,
      description text,
      is_default boolean not null default false,
      is_active boolean not null default true,
      created_at timestamptz not null default now(),
      created_by uuid references auth.users(id) on delete set null
    );
    alter table public.journals enable row level security;
  end if;

  select exists(select 1 from public.journals) into v_has_any;

  insert into public.journals(id, code, name, is_default, is_active)
  values (v_fallback_id, 'GEN', 'دفتر اليومية العام', false, true)
  on conflict (code) do update
  set name = excluded.name,
      is_active = true;

  select exists(select 1 from public.journals where is_default = true) into v_has_default;
  if not v_has_default then
    update public.journals set is_default = false where is_default = true;
    update public.journals set is_default = true where id = v_fallback_id;
  end if;

  select public.get_default_journal_id() into v_default_id;
  if v_default_id is null then
    update public.journals set is_default = false where is_default = true;
    update public.journals set is_default = true, is_active = true where id = v_fallback_id;
    select public.get_default_journal_id() into v_default_id;
  end if;

  if to_regclass('public.journal_entries') is not null then
    begin
      alter table public.journal_entries
        alter column journal_id set default public.get_default_journal_id();
    exception when others then
      null;
    end;

    begin
      update public.journal_entries je
      set journal_id = coalesce(v_default_id, v_fallback_id)
      where je.journal_id is null
        or not exists (select 1 from public.journals j where j.id = je.journal_id);
    exception when others then
      null;
    end;
  end if;
end $$;

create or replace function public.trg_set_journal_entry_journal_id()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_default uuid;
begin
  v_default := public.get_default_journal_id();
  if new.journal_id is null or not exists (select 1 from public.journals j where j.id = new.journal_id) then
    new.journal_id := coalesce(v_default, '00000000-0000-4000-8000-000000000001'::uuid);
  end if;
  return new;
end;
$$;

do $$
begin
  if to_regclass('public.journal_entries') is null then
    return;
  end if;
  drop trigger if exists trg_journal_entries_set_journal_id on public.journal_entries;
  create trigger trg_journal_entries_set_journal_id
  before insert or update on public.journal_entries
  for each row execute function public.trg_set_journal_entry_journal_id();
end $$;

notify pgrst, 'reload schema';
