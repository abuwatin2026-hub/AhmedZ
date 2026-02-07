set app.allow_ledger_ddl = '1';

create or replace function public._party_open_item_type(p_source_table text, p_source_event text)
returns text
language plpgsql
immutable
as $$
declare
  v_st text := lower(coalesce(p_source_table,''));
  v_ev text := lower(coalesce(p_source_event,''));
begin
  if v_st = 'party_documents' then
    if v_ev = 'ar_invoice' then return 'invoice'; end if;
    if v_ev = 'ap_bill' then return 'bill'; end if;
    if v_ev = 'ar_receipt' then return 'receipt'; end if;
    if v_ev = 'ap_payment' then return 'payment'; end if;
    if v_ev = 'advance' then return 'advance'; end if;
    if v_ev = 'custodian' then return 'advance'; end if;
    if v_ev = 'ar_credit_note' then return 'credit_note'; end if;
    if v_ev = 'ap_credit_note' then return 'credit_note'; end if;
    if v_ev = 'ar_debit_note' then return 'debit_note'; end if;
    if v_ev = 'ap_debit_note' then return 'debit_note'; end if;
    return 'document';
  end if;

  if v_st = 'orders' then
    return 'invoice';
  end if;

  if v_st = 'purchase_orders' then
    return 'bill';
  end if;

  if v_st = 'payments' then
    if v_ev like 'in:%' then return 'receipt'; end if;
    if v_ev like 'out:%' then return 'payment'; end if;
    return 'payment';
  end if;

  if v_st = 'supplier_credit_notes' then
    return 'credit_note';
  end if;

  if v_st = 'manual' then
    return 'manual';
  end if;

  return 'other';
end;
$$;

create or replace function public.upsert_party_open_item_from_party_ledger_entry(p_party_ledger_entry_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ple record;
  v_je record;
  v_role text;
  v_type text;
  v_party_doc_id uuid;
begin
  if p_party_ledger_entry_id is null then
    return;
  end if;

  select *
  into v_ple
  from public.party_ledger_entries ple
  where ple.id = p_party_ledger_entry_id;

  if not found then
    return;
  end if;

  select je.source_table, je.source_id, je.source_event, je.entry_date
  into v_je
  from public.journal_entries je
  where je.id = v_ple.journal_entry_id;

  if coalesce(v_je.source_table,'') = 'settlements' then
    return;
  end if;

  if coalesce(v_je.source_event,'') = 'realized_fx' then
    return;
  end if;

  select psa.role
  into v_role
  from public.party_subledger_accounts psa
  where psa.account_id = v_ple.account_id
    and psa.is_active = true
  limit 1;

  if v_role is null then
    return;
  end if;

  v_type := public._party_open_item_type(v_je.source_table, v_je.source_event);

  v_party_doc_id := null;
  if coalesce(v_je.source_table,'') = 'party_documents' then
    begin
      v_party_doc_id := nullif(v_je.source_id,'')::uuid;
    exception when others then
      v_party_doc_id := null;
    end;
  end if;

  insert into public.party_open_items(
    party_id,
    journal_entry_id,
    journal_line_id,
    account_id,
    direction,
    occurred_at,
    due_date,
    item_role,
    item_type,
    source_table,
    source_id,
    source_event,
    party_document_id,
    currency_code,
    foreign_amount,
    base_amount,
    open_foreign_amount,
    open_base_amount,
    status
  )
  values (
    v_ple.party_id,
    v_ple.journal_entry_id,
    v_ple.journal_line_id,
    v_ple.account_id,
    v_ple.direction,
    v_ple.occurred_at,
    v_ple.occurred_at::date,
    v_role,
    v_type,
    v_je.source_table,
    v_je.source_id,
    v_je.source_event,
    v_party_doc_id,
    upper(coalesce(v_ple.currency_code, public.get_base_currency())),
    v_ple.foreign_amount,
    v_ple.base_amount,
    v_ple.foreign_amount,
    v_ple.base_amount,
    'open'
  )
  on conflict (journal_line_id) do nothing;
end;
$$;

revoke all on function public.upsert_party_open_item_from_party_ledger_entry(uuid) from public;
grant execute on function public.upsert_party_open_item_from_party_ledger_entry(uuid) to authenticated;

create or replace function public.trg_party_ledger_entries_open_items_after_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.upsert_party_open_item_from_party_ledger_entry(new.id);
  return null;
end;
$$;

do $$
begin
  if to_regclass('public.party_ledger_entries') is not null then
    drop trigger if exists trg_party_ledger_entries_open_items_after_insert on public.party_ledger_entries;
    create trigger trg_party_ledger_entries_open_items_after_insert
    after insert on public.party_ledger_entries
    for each row execute function public.trg_party_ledger_entries_open_items_after_insert();
  end if;
end $$;

notify pgrst, 'reload schema';

