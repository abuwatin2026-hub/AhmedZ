set app.allow_ledger_ddl = '1';

create sequence if not exists public.party_document_seq start 1000;

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
    else 'PD'
  end;
  v_year := to_char(current_date, 'YYYY');
  v_seq := nextval('public.party_document_seq');
  return v_prefix || '-' || v_year || '-' || lpad(v_seq::text, 6, '0');
end;
$$;

revoke all on function public.generate_party_document_number(text) from public;
grant execute on function public.generate_party_document_number(text) to authenticated;

create table if not exists public.party_documents (
  id uuid primary key default gen_random_uuid(),
  doc_type text not null check (doc_type in ('ar_invoice','ap_bill','ar_receipt','ap_payment','advance','custodian')),
  doc_number text not null unique,
  occurred_at timestamptz not null,
  memo text,
  party_id uuid not null references public.financial_parties(id) on delete restrict,
  status text not null default 'draft' check (status in ('draft','posted','voided')),
  journal_entry_id uuid references public.journal_entries(id) on delete set null,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  approved_at timestamptz,
  approved_by uuid references auth.users(id) on delete set null,
  voided_at timestamptz,
  voided_by uuid references auth.users(id) on delete set null,
  void_reason text
);

alter table public.party_documents enable row level security;

drop policy if exists party_documents_select on public.party_documents;
create policy party_documents_select on public.party_documents
for select
using (public.has_admin_permission('accounting.view'));

drop policy if exists party_documents_insert on public.party_documents;
create policy party_documents_insert on public.party_documents
for insert
with check (public.has_admin_permission('accounting.manage'));

drop policy if exists party_documents_update on public.party_documents;
create policy party_documents_update on public.party_documents
for update
using (public.has_admin_permission('accounting.manage'))
with check (public.has_admin_permission('accounting.manage'));

drop policy if exists party_documents_delete_none on public.party_documents;
create policy party_documents_delete_none on public.party_documents
for delete
using (false);

create or replace function public.trg_party_documents_immutable()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'not allowed';
  end if;

  if current_setting('app.accounting_bypass', true) = '1' then
    return new;
  end if;

  if old.status <> 'draft' then
    raise exception 'not allowed';
  end if;

  return new;
end;
$$;

do $$
begin
  if to_regclass('public.party_documents') is not null then
    drop trigger if exists trg_party_documents_immutable on public.party_documents;
    create trigger trg_party_documents_immutable
    before update or delete on public.party_documents
    for each row execute function public.trg_party_documents_immutable();
  end if;
end $$;

create or replace function public.trg_set_journal_entry_status()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.source_table in ('manual','party_documents') then
    new.status := coalesce(nullif(new.status, ''), 'draft');
  else
    new.status := coalesce(nullif(new.status, ''), 'posted');
    if new.status = 'draft' then
      new.status := 'posted';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_journal_entries_set_status on public.journal_entries;
create trigger trg_journal_entries_set_status
before insert on public.journal_entries
for each row execute function public.trg_set_journal_entry_status();

create or replace function public.trg_block_manual_entry_changes()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'not allowed';
  end if;

  if current_setting('app.accounting_bypass', true) = '1' then
    return new;
  end if;

  if old.source_table in ('manual','party_documents') and old.status <> 'draft' then
    raise exception 'not allowed';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_journal_entries_block_manual_changes on public.journal_entries;
create trigger trg_journal_entries_block_manual_changes
before update or delete on public.journal_entries
for each row execute function public.trg_block_manual_entry_changes();

create or replace function public.trg_block_manual_line_changes()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_source_table text;
  v_status text;
begin
  if current_setting('app.accounting_bypass', true) = '1' then
    return coalesce(new, old);
  end if;

  select je.source_table, je.status
  into v_source_table, v_status
  from public.journal_entries je
  where je.id = coalesce(new.journal_entry_id, old.journal_entry_id);

  if v_source_table in ('manual','party_documents') and v_status <> 'draft' then
    raise exception 'not allowed';
  end if;

  return coalesce(new, old);
end;
$$;

drop trigger if exists trg_journal_lines_block_manual_changes on public.journal_lines;
create trigger trg_journal_lines_block_manual_changes
before update or delete on public.journal_lines
for each row execute function public.trg_block_manual_line_changes();

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
  v_entry_id uuid;
  v_line jsonb;
  v_account_code text;
  v_account_id uuid;
  v_debit numeric;
  v_credit numeric;
  v_line_memo text;
  v_cost_center_id uuid;
  v_party_line_id uuid;
  v_currency_code text;
  v_fx_rate numeric;
  v_foreign_amount numeric;
  v_journal_id uuid;
begin
  if not public.has_admin_permission('accounting.manage') then
    raise exception 'not allowed';
  end if;

  if p_party_id is null then
    raise exception 'party_id is required';
  end if;

  if p_doc_type is null or lower(trim(p_doc_type)) not in ('ar_invoice','ap_bill','ar_receipt','ap_payment','advance','custodian') then
    raise exception 'invalid doc_type';
  end if;

  if p_lines is null or jsonb_typeof(p_lines) <> 'array' then
    raise exception 'p_lines must be a json array';
  end if;

  v_doc_number := public.generate_party_document_number(p_doc_type);
  v_journal_id := coalesce(p_journal_id, public.get_default_journal_id(), '00000000-0000-4000-8000-000000000001'::uuid);

  insert into public.party_documents(doc_type, doc_number, occurred_at, memo, party_id, status, created_by)
  values (
    lower(trim(p_doc_type)),
    v_doc_number,
    coalesce(p_occurred_at, now()),
    nullif(trim(coalesce(p_memo,'')),''),
    p_party_id,
    'draft',
    auth.uid()
  )
  returning id into v_doc_id;

  insert into public.journal_entries(entry_date, memo, source_table, source_id, source_event, created_by, status, journal_id)
  values (
    coalesce(p_occurred_at, now()),
    concat(v_doc_number, case when nullif(trim(coalesce(p_memo,'')),'') is null then '' else concat(' - ', nullif(trim(coalesce(p_memo,'')),'') ) end),
    'party_documents',
    v_doc_id::text,
    lower(trim(p_doc_type)),
    auth.uid(),
    'draft',
    v_journal_id
  )
  returning id into v_entry_id;

  for v_line in select value from jsonb_array_elements(p_lines)
  loop
    v_account_code := nullif(trim(coalesce(v_line->>'accountCode', '')), '');
    v_debit := coalesce(nullif(v_line->>'debit', '')::numeric, 0);
    v_credit := coalesce(nullif(v_line->>'credit', '')::numeric, 0);
    v_line_memo := nullif(trim(coalesce(v_line->>'memo', '')), '');
    v_cost_center_id := nullif(trim(coalesce(v_line->>'costCenterId', '')), '')::uuid;
    v_party_line_id := nullif(trim(coalesce(v_line->>'partyId', '')), '')::uuid;
    v_currency_code := nullif(trim(coalesce(v_line->>'currencyCode', '')), '');
    v_fx_rate := nullif(trim(coalesce(v_line->>'fxRate', '')), '')::numeric;
    v_foreign_amount := nullif(trim(coalesce(v_line->>'foreignAmount', '')), '')::numeric;

    if v_account_code is null then
      raise exception 'accountCode is required';
    end if;

    if v_debit < 0 or v_credit < 0 then
      raise exception 'invalid debit/credit';
    end if;

    if (v_debit > 0 and v_credit > 0) or (v_debit = 0 and v_credit = 0) then
      raise exception 'invalid line amounts';
    end if;

    if v_party_line_id is not null and v_party_line_id <> p_party_id then
      raise exception 'partyId mismatch';
    end if;

    v_account_id := public.get_account_id_by_code(v_account_code);
    if v_account_id is null then
      raise exception 'account not found %', v_account_code;
    end if;

    insert into public.journal_lines(
      journal_entry_id,
      account_id,
      debit,
      credit,
      line_memo,
      cost_center_id,
      party_id,
      currency_code,
      fx_rate,
      foreign_amount
    )
    values (
      v_entry_id,
      v_account_id,
      v_debit,
      v_credit,
      v_line_memo,
      v_cost_center_id,
      v_party_line_id,
      v_currency_code,
      v_fx_rate,
      v_foreign_amount
    );
  end loop;

  perform public.check_journal_entry_balance(v_entry_id);

  perform set_config('app.accounting_bypass', '1', true);
  update public.party_documents
  set journal_entry_id = v_entry_id
  where id = v_doc_id;

  insert into public.system_audit_logs(action, module, details, performed_by, performed_at, metadata, risk_level, reason_code)
  values (
    'party_documents.create',
    'documents',
    v_doc_id::text,
    auth.uid(),
    now(),
    jsonb_build_object('documentId', v_doc_id::text, 'docNumber', v_doc_number, 'docType', lower(trim(p_doc_type)), 'journalEntryId', v_entry_id::text),
    'LOW',
    'DOCUMENT_CREATE'
  );

  return v_doc_id;
end;
$$;

revoke all on function public.create_party_document(text, timestamptz, uuid, text, jsonb, uuid) from public;
grant execute on function public.create_party_document(text, timestamptz, uuid, text, jsonb, uuid) to authenticated;

create or replace function public.approve_party_document(p_document_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_doc public.party_documents%rowtype;
  v_debit numeric;
  v_credit numeric;
begin
  if not public.has_admin_permission('accounting.approve') then
    raise exception 'not allowed';
  end if;
  if p_document_id is null then
    raise exception 'document_id is required';
  end if;

  select * into v_doc
  from public.party_documents
  where id = p_document_id
  for update;

  if not found then
    raise exception 'document not found';
  end if;

  if v_doc.status <> 'draft' then
    return coalesce(v_doc.journal_entry_id, p_document_id);
  end if;

  if v_doc.journal_entry_id is null then
    raise exception 'missing journal_entry_id';
  end if;

  select coalesce(sum(jl.debit), 0), coalesce(sum(jl.credit), 0)
  into v_debit, v_credit
  from public.journal_lines jl
  where jl.journal_entry_id = v_doc.journal_entry_id;

  if v_debit <= 0 and v_credit <= 0 then
    raise exception 'empty entry';
  end if;

  if abs(coalesce(v_debit, 0) - coalesce(v_credit, 0)) > 1e-6 then
    raise exception 'entry not balanced';
  end if;

  perform set_config('app.accounting_bypass', '1', true);
  update public.journal_entries
  set status = 'posted',
      approved_by = auth.uid(),
      approved_at = now()
  where id = v_doc.journal_entry_id;

  update public.party_documents
  set status = 'posted',
      approved_by = auth.uid(),
      approved_at = now()
  where id = p_document_id;

  insert into public.system_audit_logs(action, module, details, performed_by, performed_at, metadata, risk_level, reason_code)
  values (
    'party_documents.approve',
    'documents',
    p_document_id::text,
    auth.uid(),
    now(),
    jsonb_build_object('documentId', p_document_id::text, 'docNumber', v_doc.doc_number, 'docType', v_doc.doc_type, 'journalEntryId', v_doc.journal_entry_id::text),
    'MEDIUM',
    'DOCUMENT_APPROVE'
  );

  return v_doc.journal_entry_id;
end;
$$;

revoke all on function public.approve_party_document(uuid) from public;
grant execute on function public.approve_party_document(uuid) to authenticated;

create or replace function public.void_party_document(p_document_id uuid, p_reason text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_doc public.party_documents%rowtype;
  v_reason text;
  v_new_entry uuid;
begin
  if not public.has_admin_permission('accounting.void') then
    raise exception 'not allowed';
  end if;
  if p_document_id is null then
    raise exception 'document_id is required';
  end if;

  v_reason := nullif(trim(coalesce(p_reason,'')),'');
  if v_reason is null then
    raise exception 'reason required';
  end if;

  select * into v_doc
  from public.party_documents
  where id = p_document_id
  for update;

  if not found then
    raise exception 'document not found';
  end if;

  if v_doc.status = 'voided' then
    return coalesce(v_doc.journal_entry_id, p_document_id);
  end if;

  perform public.set_audit_reason(v_reason);

  perform set_config('app.accounting_bypass', '1', true);

  if v_doc.journal_entry_id is not null then
    if v_doc.status = 'posted' then
      v_new_entry := public.void_journal_entry(v_doc.journal_entry_id, v_reason);
    else
      update public.journal_entries
      set status = 'voided',
          voided_by = auth.uid(),
          voided_at = now(),
          void_reason = v_reason
      where id = v_doc.journal_entry_id;
      v_new_entry := v_doc.journal_entry_id;
    end if;
  end if;

  update public.party_documents
  set status = 'voided',
      voided_by = auth.uid(),
      voided_at = now(),
      void_reason = v_reason
  where id = p_document_id;

  insert into public.system_audit_logs(action, module, details, performed_by, performed_at, metadata, risk_level, reason_code)
  values (
    'party_documents.void',
    'documents',
    p_document_id::text,
    auth.uid(),
    now(),
    jsonb_build_object('documentId', p_document_id::text, 'docNumber', v_doc.doc_number, 'docType', v_doc.doc_type, 'journalEntryId', coalesce(v_doc.journal_entry_id, '00000000-0000-0000-0000-000000000000'::uuid)::text, 'newEntryId', coalesce(v_new_entry, '00000000-0000-0000-0000-000000000000'::uuid)::text),
    'HIGH',
    v_reason
  );

  return coalesce(v_new_entry, v_doc.journal_entry_id, p_document_id);
end;
$$;

revoke all on function public.void_party_document(uuid, text) from public;
grant execute on function public.void_party_document(uuid, text) to authenticated;

notify pgrst, 'reload schema';

