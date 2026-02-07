set app.allow_ledger_ddl = '1';

do $$
declare
  v_bad int := 0;
  v_sample text;
begin
  if to_regclass('public.journal_lines') is null then
    return;
  end if;

  select count(1)
  into v_bad
  from public.journal_lines jl
  where coalesce(jl.debit, 0) = 0
    and coalesce(jl.credit, 0) = 0;

  if v_bad > 0 then
    select string_agg(id::text, ',')
    into v_sample
    from (
      select jl.id
      from public.journal_lines jl
      where coalesce(jl.debit, 0) = 0
        and coalesce(jl.credit, 0) = 0
      limit 5
    ) s;

    raise exception 'journal_lines has % invalid zero-amount lines (sample ids: %)', v_bad, coalesce(v_sample, '');
  end if;

  if not exists (
    select 1
    from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
    where n.nspname = 'public'
      and t.relname = 'journal_lines'
      and c.conname = 'journal_lines_one_side_nonzero'
  ) then
    alter table public.journal_lines
      add constraint journal_lines_one_side_nonzero
      check ((coalesce(debit, 0) > 0) <> (coalesce(credit, 0) > 0))
      not valid;
  end if;

  begin
    alter table public.journal_lines
      validate constraint journal_lines_one_side_nonzero;
  exception when others then
    raise;
  end;
end $$;

notify pgrst, 'reload schema';
