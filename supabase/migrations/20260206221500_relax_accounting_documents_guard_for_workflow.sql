set app.allow_ledger_ddl = '1';

create or replace function public.trg_accounting_documents_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'accounting_documents are append-only';
  end if;

  if old.document_type is distinct from new.document_type
    or old.source_table is distinct from new.source_table
    or old.source_id is distinct from new.source_id
    or old.branch_id is distinct from new.branch_id
    or old.company_id is distinct from new.company_id
    or old.created_by is distinct from new.created_by
    or old.created_at is distinct from new.created_at
  then
    raise exception 'accounting_documents core fields are immutable';
  end if;

  return new;
end;
$$;

notify pgrst, 'reload schema';

