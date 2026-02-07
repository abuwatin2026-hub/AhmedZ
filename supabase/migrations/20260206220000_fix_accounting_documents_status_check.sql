set app.allow_ledger_ddl = '1';

do $$
begin
  begin
    alter table public.accounting_documents drop constraint accounting_documents_status_check;
  exception when others then
    null;
  end;
  alter table public.accounting_documents
    add constraint accounting_documents_status_check
    check (status in ('draft','approved','posted','cancelled','reversed'));
end $$;

notify pgrst, 'reload schema';

