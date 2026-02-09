set app.allow_ledger_ddl = '1';

do $$
begin
  if to_regclass('public.journal_entries') is not null then
    begin
      alter table public.journal_entries add column reference_entry_id uuid;
    exception when duplicate_column then null;
    end;
    begin
      alter table public.journal_entries
        add constraint journal_entries_reference_entry_fk
        foreign key (reference_entry_id) references public.journal_entries(id) on delete restrict;
    exception when duplicate_object then null;
    end;
    create index if not exists idx_journal_entries_reference_entry_id on public.journal_entries(reference_entry_id);
  end if;
end $$;

do $$
begin
  if to_regclass('public.base_currency_restatement_state') is null then
    create table public.base_currency_restatement_state (
      id text primary key,
      old_base_currency text not null,
      new_base_currency text not null,
      locked_at timestamptz not null,
      created_at timestamptz not null default now()
    );
  end if;
end $$;

do $$
begin
  if not exists (select 1 from public.base_currency_restatement_state where id = 'sar_base_lock') then
    insert into public.base_currency_restatement_state(id, old_base_currency, new_base_currency, locked_at)
    select
      'sar_base_lock',
      coalesce(ms.old_base_currency, 'YER'),
      coalesce(ms.new_base_currency, 'SAR'),
      coalesce(ms.locked_at, now())
    from public.base_currency_migration_state ms
    where ms.id = 'sar_base_lock'
    limit 1;
  end if;
end $$;

do $$
begin
  if to_regclass('public.base_currency_restatement_entry_map') is null then
    create table public.base_currency_restatement_entry_map (
      original_journal_entry_id uuid primary key,
      restated_journal_entry_id uuid,
      status text not null default 'pending',
      notes text,
      batch_id uuid,
      created_at timestamptz not null default now()
    );
    create index if not exists idx_base_currency_restatement_entry_map_status on public.base_currency_restatement_entry_map(status);
    create index if not exists idx_base_currency_restatement_entry_map_batch on public.base_currency_restatement_entry_map(batch_id);
  end if;
end $$;

notify pgrst, 'reload schema';

