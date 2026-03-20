-- =============================================================================
-- Migration: Fix Voucher Critical Issues
-- Date: 2026-03-21
-- Fixes:
--   #1 CRITICAL: trg_journal_entries_set_document — correct document_type for manual vouchers
--   #2 CRITICAL: Backfill missing accounting_documents for existing manual journal entries
--   #3 CRITICAL: Auto-assign document_number on voucher creation (not just on print)
--   #4 CRITICAL: submit_voucher_for_approval — add permission check
--   #5 CRITICAL: void_journal_entry — link reversal via reference_entry_id
--   #6 MEDIUM:   approve_voucher — use accounting.approve not accounting.manage
--   #7 MEDIUM:   create_manual_voucher — add system_audit_logs entry on creation
-- =============================================================================

-- ──────────────────────────────────────────────────────────────────────────────
-- FIX #1: Rewrite trg_journal_entries_set_document
-- Problem: manual vouchers always get document_type = 'manual' regardless of
--          source_event (receipt/payment/journal). Also if get_default_branch_id()
--          returns null the insert into accounting_documents fails silently
--          leaving document_id pointing to a non-existent UUID.
-- ──────────────────────────────────────────────────────────────────────────────
create or replace function public.trg_journal_entries_set_document()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_branch  uuid;
  v_company uuid;
  v_doc_type text;
  v_dir      text;
begin
  -- Resolve branch / company and document_type from source
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
      v_doc_type := case when coalesce(v_dir,'') = 'in' then 'receipt' else 'payment' end;

    elsif new.source_table = 'orders' then
      select branch_id, company_id into v_branch, v_company
        from public.orders where id = new.source_id::uuid;
      v_doc_type := 'invoice';

    elsif new.source_table = 'manual' then
      -- FIX: derive document_type from source_event, not a hardcoded 'manual'
      v_doc_type := case
        when coalesce(new.source_event,'') = 'receipt'  then 'receipt'
        when coalesce(new.source_event,'') = 'payment'  then 'payment'
        when coalesce(new.source_event,'') = 'journal'  then 'manual'
        else 'manual'
      end;
      v_branch  := coalesce(public.get_default_branch_id(),  '00000000-0000-4000-8000-000000000001'::uuid);
      v_company := coalesce(public.get_default_company_id(), '00000000-0000-4000-8000-000000000001'::uuid);

    else
      v_branch  := coalesce(public.get_default_branch_id(),  '00000000-0000-4000-8000-000000000001'::uuid);
      v_company := coalesce(public.get_default_company_id(), '00000000-0000-4000-8000-000000000001'::uuid);
      v_doc_type := 'movement';
    end if;

    new.branch_id  := coalesce(new.branch_id,  v_branch);
    new.company_id := coalesce(new.company_id, v_company);
  end if;

  -- Create accounting_document if not already linked
  if new.document_id is null then
    -- FIX: use new.id::text as source_id (always stable, non-null) for 'manual' entries
    declare
      v_src_id text;
    begin
      v_src_id := case
        when new.source_table = 'manual' then new.id::text
        else coalesce(new.source_id, new.id::text)
      end;

      new.document_id := public.create_accounting_document(
        coalesce(v_doc_type, 'movement'),
        coalesce(new.source_table, 'manual'),
        v_src_id,
        coalesce(new.branch_id,  '00000000-0000-4000-8000-000000000001'::uuid),
        coalesce(new.company_id, '00000000-0000-4000-8000-000000000001'::uuid),
        new.memo
      );
    exception when others then
      -- Log but don't break the transaction
      raise warning 'trg_journal_entries_set_document: could not create accounting_document: %', sqlerrm;
    end;
  end if;

  return new;
end;
$$;


-- ──────────────────────────────────────────────────────────────────────────────
-- FIX #2: Backfill accounting_documents for existing manual journal entries
--          that have a broken document_id (UUID pointing nowhere)
-- ──────────────────────────────────────────────────────────────────────────────
do $$
declare
  r          record;
  v_doc_type text;
  v_doc_id   uuid;
  v_branch   uuid;
  v_company  uuid;
begin
  -- Temporarily bypass immutability trigger so we can update document_id
  perform set_config('app.accounting_bypass', '1', true);

  for r in
    select je.id, je.source_event, je.memo, je.branch_id, je.company_id, je.document_id
    from public.journal_entries je
    where je.source_table = 'manual'
      and (
        je.document_id is null
        or not exists (
          select 1 from public.accounting_documents ad where ad.id = je.document_id
        )
      )
  loop
    v_doc_type := case
      when coalesce(r.source_event,'') = 'receipt' then 'receipt'
      when coalesce(r.source_event,'') = 'payment' then 'payment'
      else 'manual'
    end;

    v_branch  := coalesce(r.branch_id,  public.get_default_branch_id(),  '00000000-0000-4000-8000-000000000001'::uuid);
    v_company := coalesce(r.company_id, public.get_default_company_id(), '00000000-0000-4000-8000-000000000001'::uuid);

    -- Check if a document already exists by source_id
    select id into v_doc_id
    from public.accounting_documents
    where source_table = 'manual' and source_id = r.id::text;

    if v_doc_id is null then
      insert into public.accounting_documents(
        document_type, source_table, source_id, branch_id, company_id, status, memo
      ) values (
        v_doc_type, 'manual', r.id::text, v_branch, v_company, 'posted', r.memo
      )
      returning id into v_doc_id;
    end if;

    -- Link journal entry to its accounting_document
    update public.journal_entries
      set document_id = v_doc_id
    where id = r.id;

    raise notice 'Backfilled accounting_document % for journal_entry %', v_doc_id, r.id;
  end loop;

  perform set_config('app.accounting_bypass', '0', true);
end;
$$;


-- ──────────────────────────────────────────────────────────────────────────────
-- FIX #3: Auto-assign document_number when a manual voucher is created/posted
--         Update create_manual_voucher to call ensure_accounting_document_number
-- ──────────────────────────────────────────────────────────────────────────────
create or replace function public.create_manual_voucher(
  p_voucher_type text,
  p_entry_date   timestamptz,
  p_memo         text,
  p_lines        jsonb,
  p_journal_id   uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_entry_id   uuid;
  v_line       jsonb;
  v_account_code text;
  v_account_id   uuid;
  v_debit        numeric;
  v_credit       numeric;
  v_memo         text;
  v_cost_center_id uuid;
  v_journal_id   uuid;
  v_party_id     uuid;
  v_currency_code text;
  v_fx_rate      numeric;
  v_foreign_amount numeric;
  v_type         text;
  v_base         text;
  v_entry_date   timestamptz;
  v_shift_id     uuid;
  v_has_cash_account boolean := false;
  v_cash_account_code_prefix varchar := '1010';
  v_doc_id       uuid;
begin
  if not public.has_admin_permission('accounting.manage') then
    raise exception 'not allowed';
  end if;

  v_type := lower(nullif(btrim(coalesce(p_voucher_type,'')), ''));
  if v_type not in ('receipt','payment','journal') then
    raise exception 'invalid voucher_type';
  end if;

  if p_lines is null or jsonb_typeof(p_lines) <> 'array' then
    raise exception 'p_lines must be a json array';
  end if;

  -- Preliminary Check: Does this voucher involve a Cash account?
  for v_line in select value from jsonb_array_elements(p_lines)
  loop
    v_account_code := nullif(trim(coalesce(v_line->>'accountCode', '')), '');
    if v_account_code is not null and v_account_code like v_cash_account_code_prefix || '%' then
       v_has_cash_account := true;
       exit;
    end if;
  end loop;

  -- Resolve active cash shift for the current user
  v_shift_id := public._resolve_open_shift_for_cash(auth.uid());

  -- Strict Control: enforce active shift if a cash account is used
  if v_has_cash_account and v_shift_id is null then
    raise exception 'لا يمكنك إنشاء سند نقدي بدون فتح وردية صندوق أولاً.';
  end if;

  v_base       := public.get_base_currency();
  v_entry_date := coalesce(p_entry_date, now());
  v_memo       := nullif(trim(coalesce(p_memo, '')), '');
  v_journal_id := coalesce(p_journal_id, public.get_default_journal_id(), '00000000-0000-4000-8000-000000000001'::uuid);

  insert into public.journal_entries(
    entry_date, memo, source_table, source_id, source_event,
    created_by, journal_id, shift_id
  )
  values (
    v_entry_date, v_memo, 'manual', null, v_type,
    auth.uid(), v_journal_id, v_shift_id
  )
  returning id into v_entry_id;

  -- Process lines
  for v_line in select value from jsonb_array_elements(p_lines)
  loop
    v_account_code    := nullif(trim(coalesce(v_line->>'accountCode', '')), '');
    v_debit           := coalesce(nullif(v_line->>'debit',  '')::numeric, 0);
    v_credit          := coalesce(nullif(v_line->>'credit', '')::numeric, 0);
    v_cost_center_id  := nullif(v_line->>'costCenterId', '')::uuid;
    v_party_id        := nullif(v_line->>'partyId', '')::uuid;

    if v_account_code is null then
      raise exception 'account code is required for each line';
    end if;

    select id into v_account_id
    from public.chart_of_accounts
    where code = v_account_code and is_active = true;

    if v_account_id is null then
      raise exception 'account not found: %', v_account_code;
    end if;

    -- FX handling
    v_currency_code  := upper(nullif(trim(coalesce(v_line->>'currencyCode', '')), ''));
    v_foreign_amount := null;
    v_fx_rate        := null;

    if v_currency_code is not null and v_currency_code <> '' then
      if not exists (select 1 from public.currencies where code = v_currency_code and is_active = true) then
        raise exception 'unsupported currency: %', v_currency_code;
      end if;
      if v_currency_code = v_base then
        v_currency_code  := null;
        v_foreign_amount := null;
        v_fx_rate        := null;
      else
        if (v_debit > 0 and (v_foreign_amount is null or v_foreign_amount <= 0)) or
           (v_credit > 0 and (v_foreign_amount is null or v_foreign_amount <= 0)) then
             v_currency_code  := null;
             v_foreign_amount := null;
             v_fx_rate        := null;
        else
          begin
            v_fx_rate := nullif(v_line->>'fxRate', '')::numeric;
            if v_fx_rate is not null and v_fx_rate <= 0 then
              v_fx_rate := null;
            end if;
          exception when others then
            v_fx_rate := null;
          end;

          if v_fx_rate is null then
            v_fx_rate := public.get_fx_rate(v_currency_code, v_base);
            if v_fx_rate is null or v_fx_rate <= 0 then
              raise exception 'no valid fx rate for %', v_currency_code;
            end if;
          end if;

          if v_debit > 0 then
            v_debit := public._money_round(v_foreign_amount * v_fx_rate);
          else
            v_credit := public._money_round(v_foreign_amount * v_fx_rate);
          end if;
        end if;
      end if;
    end if;

    insert into public.journal_lines(
      journal_entry_id, account_id, debit, credit, line_memo,
      cost_center_id, party_id, currency_code, fx_rate, foreign_amount
    ) values (
      v_entry_id, v_account_id, v_debit, v_credit,
      nullif(trim(coalesce(v_line->>'memo', '')), ''),
      v_cost_center_id, v_party_id, v_currency_code, v_fx_rate, v_foreign_amount
    );
  end loop;

  perform public.verify_journal_entry_balance(v_entry_id);

  -- FIX #3: Auto-assign document number immediately after creation
  select document_id into v_doc_id
  from public.journal_entries where id = v_entry_id;

  if v_doc_id is not null then
    begin
      perform public.ensure_accounting_document_number(v_doc_id);
    exception when others then
      raise warning 'create_manual_voucher: could not assign document_number: %', sqlerrm;
    end;
  end if;

  -- FIX #7: Log creation in system_audit_logs
  begin
    insert into public.system_audit_logs(
      action, module, details, performed_by, performed_at, metadata, risk_level
    ) values (
      'journal_entries.create', 'accounting', v_entry_id::text, auth.uid(), now(),
      jsonb_build_object('voucherType', p_voucher_type, 'entryId', v_entry_id, 'memo', p_memo),
      'MEDIUM'
    );
  exception when others then null; end;

  return v_entry_id;
end;
$$;

revoke all on function public.create_manual_voucher(text, timestamptz, text, jsonb, uuid) from public;
grant execute on function public.create_manual_voucher(text, timestamptz, text, jsonb, uuid) to authenticated;


-- ──────────────────────────────────────────────────────────────────────────────
-- FIX #4: submit_voucher_for_approval — add permission check
-- ──────────────────────────────────────────────────────────────────────────────
create or replace function public.submit_voucher_for_approval(
  p_entry_id uuid,
  p_notes    text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_entry record;
  v_diff  numeric;
begin
  -- FIX #4: Permission check — only accounting.manage users can submit
  if not (public.is_owner() or public.has_admin_permission('accounting.manage')) then
    raise exception 'غير مصرح لك بتقديم السندات للاعتماد — يلزم صلاحية accounting.manage';
  end if;

  select * into v_entry from public.journal_entries where id = p_entry_id;
  if not found then raise exception 'القيد غير موجود'; end if;

  if v_entry.source_table <> 'manual' then
    raise exception 'لا يمكن تقديم قيود النظام للاعتماد — فقط السندات اليدوية';
  end if;

  -- Only creator or owner can submit their own voucher
  if v_entry.created_by <> auth.uid() and not public.is_owner() then
    raise exception 'لا يمكنك تقديم سند أنشأه شخص آخر';
  end if;

  if v_entry.status <> 'draft' then
    raise exception 'القيد يجب أن يكون مسودة (draft) للتقديم. الحالة الحالية: %', v_entry.status;
  end if;

  -- Check entry is balanced before submitting
  select abs(sum(debit) - sum(credit)) into v_diff
  from public.journal_lines where journal_entry_id = p_entry_id;
  if coalesce(v_diff, 0) > 0.01 then
    raise exception 'القيد غير متوازن (فرق: %) — ضبطه قبل التقديم', v_diff;
  end if;

  perform set_config('app.accounting_bypass', '1', true);
  update public.journal_entries
  set status = 'pending_approval',
      memo   = case when p_notes is not null then coalesce(memo,'') || ' | ملاحظة: ' || p_notes else memo end
  where id = p_entry_id;
  perform set_config('app.accounting_bypass', '0', true);

  insert into public.voucher_approval_log(
    entry_id, action, performed_by, reason, previous_status, new_status
  ) values (
    p_entry_id, 'submitted', auth.uid(), p_notes, 'draft', 'pending_approval'
  );

  return jsonb_build_object('success', true, 'status', 'pending_approval', 'entry_id', p_entry_id);
end;
$$;

revoke all on function public.submit_voucher_for_approval(uuid, text) from public;
grant execute on function public.submit_voucher_for_approval(uuid, text) to authenticated;


-- ──────────────────────────────────────────────────────────────────────────────
-- FIX #5: void_journal_entry — link reversal entry via reference_entry_id
-- ──────────────────────────────────────────────────────────────────────────────
create or replace function public.void_journal_entry(
  p_entry_id uuid,
  p_reason   text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_entry        public.journal_entries%rowtype;
  v_new_entry_id uuid;
  v_line         record;
  v_reason       text;
begin
  if not public.has_admin_permission('accounting.void') then
    raise exception 'not allowed';
  end if;
  if p_entry_id is null then
    raise exception 'p_entry_id is required';
  end if;

  select * into v_entry from public.journal_entries where id = p_entry_id;
  if not found then
    raise exception 'journal entry not found';
  end if;

  -- Cannot void a draft manual voucher (use cancel instead)
  if v_entry.source_table = 'manual' and v_entry.status = 'draft' then
    raise exception 'not allowed';
  end if;

  v_reason := nullif(trim(coalesce(p_reason,'')), '');
  if v_reason is null then
    raise exception 'reason required';
  end if;

  perform public.set_audit_reason(v_reason);
  perform set_config('app.accounting_bypass', '1', true);

  -- Mark original entry as voided
  update public.journal_entries
  set status     = 'voided',
      voided_by  = auth.uid(),
      voided_at  = now(),
      void_reason = v_reason
  where id = p_entry_id;

  -- Create reversal entry (swapped debit/credit), status defaults to 'posted'
  insert into public.journal_entries(
    entry_date, memo, source_table, source_id, source_event,
    created_by, reference_entry_id
  )
  values (
    now(),
    concat('Void ', p_entry_id::text, ' ', coalesce(v_entry.memo,'')),
    'journal_entries',
    p_entry_id::text,
    'void',
    auth.uid(),
    p_entry_id  -- FIX #5: link reversal to original
  )
  returning id into v_new_entry_id;

  -- Copy lines with debit/credit swapped
  for v_line in
    select account_id, debit, credit, line_memo, cost_center_id,
           party_id, currency_code, fx_rate, foreign_amount
    from public.journal_lines where journal_entry_id = p_entry_id
  loop
    insert into public.journal_lines(
      journal_entry_id, account_id, debit, credit, line_memo, cost_center_id,
      party_id, currency_code, fx_rate, foreign_amount
    )
    values (
      v_new_entry_id, v_line.account_id,
      v_line.credit, v_line.debit,  -- swapped
      coalesce(v_line.line_memo,'') || ' (reversal)',
      v_line.cost_center_id, v_line.party_id,
      v_line.currency_code, v_line.fx_rate, v_line.foreign_amount
    );
  end loop;

  -- FIX #5: Also update original entry's reference_entry_id to point to reversal
  update public.journal_entries
    set reference_entry_id = v_new_entry_id
  where id = p_entry_id;

  perform set_config('app.accounting_bypass', '0', true);

  -- Audit log
  insert into public.system_audit_logs(
    action, module, details, performed_by, performed_at, metadata, risk_level, reason_code
  )
  values (
    'journal_entries.void', 'accounting', p_entry_id::text, auth.uid(), now(),
    jsonb_build_object('voidOf', p_entry_id::text, 'newEntryId', v_new_entry_id::text),
    'HIGH', v_reason
  );

  return v_new_entry_id;
end;
$$;

revoke all on function public.void_journal_entry(uuid, text) from public;
grant execute on function public.void_journal_entry(uuid, text) to authenticated;


-- ──────────────────────────────────────────────────────────────────────────────
-- FIX #6: approve_voucher — use accounting.approve not accounting.manage
-- ──────────────────────────────────────────────────────────────────────────────
create or replace function public.approve_voucher(
  p_entry_id uuid,
  p_notes    text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_entry record;
begin
  -- FIX #6: use accounting.approve (not accounting.manage)
  if not (public.is_owner() or public.has_admin_permission('accounting.approve')) then
    raise exception 'صلاحية الاعتماد مخصصة للمالك أو من يملك accounting.approve فقط';
  end if;

  select * into v_entry from public.journal_entries where id = p_entry_id;
  if not found then raise exception 'القيد غير موجود'; end if;

  if v_entry.status <> 'pending_approval' then
    raise exception 'القيد يجب أن يكون في انتظار الاعتماد. الحالة الحالية: %', v_entry.status;
  end if;

  -- Maker ≠ Checker (owner bypasses this restriction)
  if v_entry.created_by = auth.uid() and not public.is_owner() then
    raise exception 'لا يمكن اعتماد قيد أنشأته بنفسك (مبدأ Maker/Checker)';
  end if;

  perform set_config('app.accounting_bypass', '1', true);
  update public.journal_entries
    set status = 'posted'
  where id = p_entry_id;
  perform set_config('app.accounting_bypass', '0', true);

  insert into public.voucher_approval_log(
    entry_id, action, performed_by, reason, previous_status, new_status
  )
  values (p_entry_id, 'approved', auth.uid(), p_notes, 'pending_approval', 'posted');

  return jsonb_build_object('success', true, 'status', 'posted', 'entry_id', p_entry_id);
end;
$$;

revoke all on function public.approve_voucher(uuid, text) from public;
grant execute on function public.approve_voucher(uuid, text) to authenticated;


-- ──────────────────────────────────────────────────────────────────────────────
-- FIX #2b: Backfill document_number for all existing manual vouchers
--           that now have a valid accounting_document
-- ──────────────────────────────────────────────────────────────────────────────
do $$
declare
  r record;
begin
  for r in
    select je.document_id
    from public.journal_entries je
    where je.source_table = 'manual'
      and je.document_id is not null
      and exists (
        select 1 from public.accounting_documents ad
        where ad.id = je.document_id and (ad.document_number is null or ad.document_number = '')
      )
  loop
    begin
      perform public.ensure_accounting_document_number(r.document_id);
    exception when others then
      raise warning 'could not assign document_number for document %: %', r.document_id, sqlerrm;
    end;
  end loop;
end;
$$;


-- ──────────────────────────────────────────────────────────────────────────────
-- Grant / permissions
-- ──────────────────────────────────────────────────────────────────────────────
grant execute on function public.trg_journal_entries_set_document() to authenticated;
