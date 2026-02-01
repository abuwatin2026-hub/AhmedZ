drop trigger if exists trg_journal_entries_sync_ar_open_item on public.journal_entries;
drop function if exists public.trg_journal_entries_sync_ar_open_item();

create or replace function public.trg_journal_lines_sync_ar_open_item()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_entry record;
begin
  select je.source_table, je.source_id, je.source_event
  into v_entry
  from public.journal_entries je
  where je.id = coalesce(new.journal_entry_id, old.journal_entry_id)
  limit 1;

  if v_entry.source_table = 'orders' and v_entry.source_event in ('invoiced','delivered') then
    begin
      perform public.sync_ar_on_invoice((v_entry.source_id)::uuid);
    exception when others then
      null;
    end;
  end if;

  return null;
end;
$$;

drop trigger if exists trg_journal_lines_sync_ar_open_item on public.journal_lines;
create constraint trigger trg_journal_lines_sync_ar_open_item
after insert or update or delete on public.journal_lines
deferrable initially deferred
for each row execute function public.trg_journal_lines_sync_ar_open_item();

select pg_sleep(0.5);
notify pgrst, 'reload schema';
