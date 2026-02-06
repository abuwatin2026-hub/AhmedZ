select set_config('app.allow_ledger_ddl', '1', true);

do $$
declare
  v_conname text;
begin
  select c.conname
  into v_conname
  from pg_constraint c
  join pg_class r on r.oid = c.conrelid
  join pg_namespace n on n.oid = r.relnamespace
  where n.nspname = 'public'
    and r.relname = 'accounting_documents'
    and c.contype = 'c'
    and pg_get_constraintdef(c.oid) ilike '%document_type%in%';

  if v_conname is not null then
    execute format('alter table public.accounting_documents drop constraint %I', v_conname);
  end if;
exception when others then
  null;
end $$;

alter table public.accounting_documents
  add constraint accounting_documents_document_type_check
  check (document_type in ('po','grn','invoice','payment','receipt','writeoff','manual','movement'));

create or replace function public.trg_journal_entries_set_document()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_branch uuid;
  v_company uuid;
  v_doc_type text;
  v_dir text;
begin
  if new.branch_id is null then
    if new.source_table = 'inventory_movements' then
      select branch_id, company_id into v_branch, v_company
      from public.inventory_movements where id = new.source_id::uuid;
      v_doc_type := 'movement';
    elsif new.source_table = 'purchase_receipts' then
      select branch_id, company_id into v_branch, v_company
      from public.purchase_receipts where id = new.source_id::uuid;
      v_doc_type := 'grn';
    elsif new.source_table = 'supplier_invoices' then
      select branch_id, company_id into v_branch, v_company
      from public.supplier_invoices where id = new.source_id::uuid;
      v_doc_type := 'invoice';
    elsif new.source_table = 'payments' then
      select branch_id, company_id, direction into v_branch, v_company, v_dir
      from public.payments where id = new.source_id::uuid;
      if coalesce(v_dir,'') = 'in' then
        v_doc_type := 'receipt';
      else
        v_doc_type := 'payment';
      end if;
    elsif new.source_table = 'orders' then
      select branch_id, company_id into v_branch, v_company
      from public.orders where id = new.source_id::uuid;
      v_doc_type := 'invoice';
    elsif new.source_table = 'manual' then
      v_branch := public.get_default_branch_id();
      v_company := public.get_default_company_id();
      v_doc_type := 'manual';
    else
      v_branch := public.get_default_branch_id();
      v_company := public.get_default_company_id();
      v_doc_type := 'movement';
    end if;
    new.branch_id := coalesce(new.branch_id, v_branch);
    new.company_id := coalesce(new.company_id, v_company);
  end if;
  if new.document_id is null then
    new.document_id := public.create_accounting_document(
      coalesce(v_doc_type, 'movement'),
      coalesce(new.source_table, 'manual'),
      coalesce(new.source_id, new.id::text),
      new.branch_id,
      new.company_id,
      new.memo
    );
  end if;
  return new;
end;
$$;

notify pgrst, 'reload schema';
