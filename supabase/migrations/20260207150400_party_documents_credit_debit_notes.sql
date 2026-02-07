set app.allow_ledger_ddl = '1';

do $$
begin
  begin
    alter table public.party_documents drop constraint if exists party_documents_doc_type_check;
  exception when others then
    null;
  end;
  alter table public.party_documents
    add constraint party_documents_doc_type_check
    check (doc_type in ('ar_invoice','ap_bill','ar_receipt','ap_payment','advance','custodian','ar_credit_note','ap_credit_note','ar_debit_note','ap_debit_note'));
end $$;

create or replace function public.generate_party_document_number(p_doc_type text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_prefix text;
  v_year text;
  v_seq bigint;
begin
  v_prefix := case lower(coalesce(p_doc_type,''))
    when 'ar_invoice' then 'ARI'
    when 'ap_bill' then 'APB'
    when 'ar_receipt' then 'ARR'
    when 'ap_payment' then 'APP'
    when 'advance' then 'ADV'
    when 'custodian' then 'CST'
    when 'ar_credit_note' then 'ARC'
    when 'ap_credit_note' then 'APC'
    when 'ar_debit_note' then 'ARD'
    when 'ap_debit_note' then 'APD'
    else 'PD'
  end;
  v_year := to_char(current_date, 'YYYY');
  v_seq := nextval('public.party_document_seq');
  return v_prefix || '-' || v_year || '-' || lpad(v_seq::text, 6, '0');
end;
$$;

revoke all on function public.generate_party_document_number(text) from public;
grant execute on function public.generate_party_document_number(text) to authenticated;

notify pgrst, 'reload schema';

