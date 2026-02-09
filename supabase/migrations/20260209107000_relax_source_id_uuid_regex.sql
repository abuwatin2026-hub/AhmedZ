set app.allow_ledger_ddl = '1';

create or replace function public.trg_journal_entries_hard_rules()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_max_date timestamptz;
  v_date timestamptz;
  v_is_finance_admin boolean := false;
begin
  if public._is_migration_actor() then
    return new;
  end if;

  v_is_finance_admin := (auth.role() = 'service_role') or public.has_admin_permission('accounting.manage');

  if new.source_table is null or btrim(new.source_table) = '' then
    raise exception 'source_type is required';
  end if;

  if new.source_table = 'manual' then
    if not v_is_finance_admin then
      raise exception 'not allowed';
    end if;
  else
    if new.source_id is null or btrim(new.source_id) = '' then
      raise exception 'source_id is required';
    end if;
    if new.source_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      raise exception 'source_id must be uuid';
    end if;
  end if;

  v_date := coalesce(new.entry_date, now());

  if public.is_in_closed_period(v_date) then
    raise exception 'Accounting period is closed';
  end if;

  if not v_is_finance_admin then
    if (v_date::date) < (current_date - 1) or (v_date::date) > (current_date + 1) then
      raise exception 'Back/forward dating not allowed';
    end if;
  end if;

  select max(je.entry_date) into v_max_date
  from public.journal_entries je;

  if v_max_date is not null and v_date < v_max_date and not v_is_finance_admin then
    raise exception 'Back-dating not allowed';
  end if;

  new.entry_date := v_date;
  return new;
end;
$$;

notify pgrst, 'reload schema';

