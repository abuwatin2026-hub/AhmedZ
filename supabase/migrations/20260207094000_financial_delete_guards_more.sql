set app.allow_ledger_ddl = '1';

do $$
begin
  if to_regclass('public.accounting_documents') is not null then
    create or replace function public.trg_forbid_delete_posted_accounting_documents()
    returns trigger
    language plpgsql
    security definer
    set search_path = public
    as $fn$
    begin
      if coalesce(old.status, '') = 'posted' then
        raise exception 'cannot delete posted accounting document; create reversal instead';
      end if;

      if exists (
        select 1
        from public.journal_entries je
        where je.document_id = old.id
        limit 1
      ) then
        raise exception 'cannot delete accounting document with journal entries; create reversal instead';
      end if;

      if exists (
        select 1
        from public.accounting_documents d
        where d.reversed_document_id = old.id
        limit 1
      ) then
        raise exception 'cannot delete accounting document referenced by reversals';
      end if;

      return old;
    end;
    $fn$;

    drop trigger if exists trg_accounting_documents_forbid_delete_posted on public.accounting_documents;
    create trigger trg_accounting_documents_forbid_delete_posted
    before delete on public.accounting_documents
    for each row execute function public.trg_forbid_delete_posted_accounting_documents();
  end if;

  if to_regclass('public.bank_statement_batches') is not null then
    create or replace function public.trg_forbid_delete_bank_statement_batches()
    returns trigger
    language plpgsql
    security definer
    set search_path = public
    as $fn$
    begin
      if coalesce(old.status, 'open') <> 'open' then
        raise exception 'cannot delete closed bank statement batch';
      end if;

      if exists (
        select 1
        from public.bank_statement_lines l
        where l.batch_id = old.id
        limit 1
      ) then
        raise exception 'cannot delete bank statement batch with lines';
      end if;

      if exists (
        select 1
        from public.bank_reconciliation_matches m
        join public.bank_statement_lines l on l.id = m.statement_line_id
        where l.batch_id = old.id
        limit 1
      ) then
        raise exception 'cannot delete bank statement batch with reconciliation matches';
      end if;

      return old;
    end;
    $fn$;

    drop trigger if exists trg_bank_statement_batches_forbid_delete on public.bank_statement_batches;
    create trigger trg_bank_statement_batches_forbid_delete
    before delete on public.bank_statement_batches
    for each row execute function public.trg_forbid_delete_bank_statement_batches();
  end if;
end $$;

notify pgrst, 'reload schema';
