set app.allow_ledger_ddl = '1';

do $$
declare
  v_fallback_id uuid := '00000000-0000-4000-8000-000000000001'::uuid;
  v_code text;
  v_candidates text[] := array['GEN','GEN_SYS','SYS','DEFAULT','GENERAL'];
  c text;
begin
  if to_regclass('public.journals') is null then
    return;
  end if;

  if not exists (select 1 from public.journals j where j.id = v_fallback_id) then
    v_code := null;
    foreach c in array v_candidates
    loop
      if not exists (select 1 from public.journals j where j.code = c) then
        v_code := c;
        exit;
      end if;
    end loop;
    if v_code is null then
      v_code := 'SYS_' || left(md5(v_fallback_id::text), 6);
    end if;

    insert into public.journals(id, code, name, is_default, is_active)
    values (v_fallback_id, v_code, 'دفتر اليومية العام', true, true);
  else
    update public.journals
    set name = 'دفتر اليومية العام',
        is_active = true
    where id = v_fallback_id;
  end if;

  update public.journals set is_default = false where is_default = true and id <> v_fallback_id;
  update public.journals set is_default = true where id = v_fallback_id;

  if to_regclass('public.journal_entries') is not null then
    begin
      alter table public.journal_entries
        alter column journal_id set default '00000000-0000-4000-8000-000000000001'::uuid;
    exception when others then
      null;
    end;

    update public.journal_entries je
    set journal_id = v_fallback_id
    where je.journal_id is null
      or not exists (select 1 from public.journals j where j.id = je.journal_id);
  end if;
end $$;

create or replace function public.trg_set_journal_entry_journal_id()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_fallback uuid := '00000000-0000-4000-8000-000000000001'::uuid;
begin
  if new.journal_id is null or not exists (select 1 from public.journals j where j.id = new.journal_id) then
    new.journal_id := v_fallback;
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
