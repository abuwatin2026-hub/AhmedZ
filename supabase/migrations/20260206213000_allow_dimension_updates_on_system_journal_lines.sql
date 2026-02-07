set app.allow_ledger_ddl = '1';

create or replace function public.trg_block_system_journal_lines_mutation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_source_table text;
  v_only_dims_changed boolean := false;
begin
  select je.source_table
  into v_source_table
  from public.journal_entries je
  where je.id = coalesce(new.journal_entry_id, old.journal_entry_id);

  if coalesce(v_source_table, '') <> '' and v_source_table <> 'manual' then
    if tg_op = 'DELETE' then
      raise exception 'GL is append-only: system journal lines cannot be deleted';
    end if;

    v_only_dims_changed :=
      old.journal_entry_id = new.journal_entry_id
      and old.account_id = new.account_id
      and old.debit = new.debit
      and old.credit = new.credit
      and old.line_memo is not distinct from new.line_memo
      and old.created_at = new.created_at
      and (
        old.cost_center_id is distinct from new.cost_center_id
        or old.dept_id is distinct from new.dept_id
        or old.project_id is distinct from new.project_id
      );

    if v_only_dims_changed then
      return new;
    end if;

    raise exception 'GL is append-only: system journal lines cannot be changed';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

notify pgrst, 'reload schema';

