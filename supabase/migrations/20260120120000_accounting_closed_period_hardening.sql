create or replace function public.trg_block_journal_lines_in_closed_period()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_entry_id uuid;
  v_date timestamptz;
begin
  v_entry_id := coalesce(new.journal_entry_id, old.journal_entry_id);
  if v_entry_id is null then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;
  select je.entry_date into v_date
  from public.journal_entries je
  where je.id = v_entry_id;
  if v_date is null then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;
  if public.is_in_closed_period(v_date) then
    raise exception 'accounting period is closed';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;
drop trigger if exists trg_journal_lines_block_closed_period on public.journal_lines;
create trigger trg_journal_lines_block_closed_period
before insert or update or delete on public.journal_lines
for each row execute function public.trg_block_journal_lines_in_closed_period();
drop trigger if exists trg_audit_accounting_periods on public.accounting_periods;
create trigger trg_audit_accounting_periods
after insert or update on public.accounting_periods
for each row execute function public.audit_row_change();
