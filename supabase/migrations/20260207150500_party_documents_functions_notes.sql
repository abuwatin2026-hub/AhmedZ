set app.allow_ledger_ddl = '1';

create or replace function public.create_party_document(
  p_doc_type text,
  p_occurred_at timestamptz,
  p_party_id uuid,
  p_memo text,
  p_lines jsonb,
  p_journal_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_doc_id uuid;
  v_doc_number text;
begin
  if not public.has_admin_permission('accounting.manage') then
    raise exception 'not allowed';
  end if;

  if p_party_id is null then
    raise exception 'party_id is required';
  end if;

  if p_doc_type is null or lower(trim(p_doc_type)) not in (
    'ar_invoice','ap_bill','ar_receipt','ap_payment','advance','custodian',
    'ar_credit_note','ap_credit_note','ar_debit_note','ap_debit_note'
  ) then
    raise exception 'invalid doc_type';
  end if;

  if p_lines is null or jsonb_typeof(p_lines) <> 'array' then
    raise exception 'p_lines must be a json array';
  end if;

  v_doc_number := public.generate_party_document_number(p_doc_type);

  insert into public.party_documents(doc_type, doc_number, occurred_at, memo, party_id, status, created_by, lines)
  values (
    lower(trim(p_doc_type)),
    v_doc_number,
    coalesce(p_occurred_at, now()),
    nullif(trim(coalesce(p_memo,'')),''),
    p_party_id,
    'draft',
    auth.uid(),
    p_lines
  )
  returning id into v_doc_id;

  insert into public.system_audit_logs(action, module, details, performed_by, performed_at, metadata, risk_level, reason_code)
  values (
    'party_documents.create',
    'documents',
    v_doc_id::text,
    auth.uid(),
    now(),
    jsonb_build_object('documentId', v_doc_id::text, 'docNumber', v_doc_number, 'docType', lower(trim(p_doc_type))),
    'LOW',
    'DOCUMENT_CREATE'
  );

  return v_doc_id;
end;
$$;

revoke all on function public.create_party_document(text, timestamptz, uuid, text, jsonb, uuid) from public;
grant execute on function public.create_party_document(text, timestamptz, uuid, text, jsonb, uuid) to authenticated;

notify pgrst, 'reload schema';

