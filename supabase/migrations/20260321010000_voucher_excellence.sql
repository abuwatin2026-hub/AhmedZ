-- =============================================================================
-- Migration: Voucher System — Complete Excellence
-- Date: 2026-03-21
-- Fixes:
--   #1: create_manual_voucher → explicitly set status = 'draft'
--   #2: New RPC: update_manual_voucher_draft — edit lines on an existing draft
--   #3: recall_voucher — add missing permission check
-- =============================================================================

-- ──────────────────────────────────────────────────────────────────────────────
-- FIX #1: create_manual_voucher → status = 'draft' (was defaulting to 'posted')
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
  v_memo         text;
begin
  if not public.has_admin_permission('accounting.manage') then
    raise exception 'not allowed';
  end if;

  v_type := lower(nullif(btrim(coalesce(p_voucher_type,'')), ''));
  if v_type not in ('receipt','payment','journal') then
    raise exception 'invalid voucher_type: %', p_voucher_type;
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

  -- FIX #1: explicitly set status = 'draft'
  perform set_config('app.accounting_bypass', '1', true);
  insert into public.journal_entries(
    entry_date, memo, source_table, source_id, source_event,
    created_by, journal_id, shift_id, status
  )
  values (
    v_entry_date, v_memo, 'manual', null, v_type,
    auth.uid(), v_journal_id, v_shift_id, 'draft'
  )
  returning id into v_entry_id;
  perform set_config('app.accounting_bypass', '0', true);

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
    v_foreign_amount := coalesce(nullif(v_line->>'foreignAmount','')::numeric, null);
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
        if (v_debit > 0 and (v_foreign_amount is null or v_foreign_amount <= 0)) and
           (v_credit > 0 and (v_foreign_amount is null or v_foreign_amount <= 0)) then
          v_currency_code  := null;
          v_foreign_amount := null;
          v_fx_rate        := null;
        else
          begin
            v_fx_rate := nullif(v_line->>'fxRate', '')::numeric;
            if v_fx_rate is not null and v_fx_rate <= 0 then v_fx_rate := null; end if;
          exception when others then v_fx_rate := null; end;

          if v_fx_rate is null then
            v_fx_rate := public.get_fx_rate(v_currency_code, v_base);
            if v_fx_rate is null or v_fx_rate <= 0 then
              raise exception 'no valid fx rate for %', v_currency_code;
            end if;
          end if;

          if v_foreign_amount is not null and v_foreign_amount > 0 then
            if v_debit > 0 then
              v_debit := public._money_round(v_foreign_amount * v_fx_rate);
            else
              v_credit := public._money_round(v_foreign_amount * v_fx_rate);
            end if;
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

  -- Auto-assign document number
  select document_id into v_doc_id
  from public.journal_entries where id = v_entry_id;

  if v_doc_id is not null then
    begin
      perform public.ensure_accounting_document_number(v_doc_id);
    exception when others then
      raise warning 'create_manual_voucher: could not assign document_number: %', sqlerrm;
    end;
  end if;

  -- Audit log
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
-- FIX #2: New RPC — update_manual_voucher_draft
-- Allows editing lines on an existing draft manual voucher
-- ──────────────────────────────────────────────────────────────────────────────
create or replace function public.update_manual_voucher_draft(
  p_entry_id   uuid,
  p_memo       text default null,
  p_lines      jsonb default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_entry        public.journal_entries%rowtype;
  v_line         jsonb;
  v_account_code text;
  v_account_id   uuid;
  v_debit        numeric;
  v_credit       numeric;
  v_cost_center_id uuid;
  v_party_id     uuid;
  v_currency_code text;
  v_fx_rate      numeric;
  v_foreign_amount numeric;
  v_base         text;
  v_memo         text;
begin
  if not public.has_admin_permission('accounting.manage') then
    raise exception 'not allowed';
  end if;

  select * into v_entry from public.journal_entries where id = p_entry_id for update;
  if not found then
    raise exception 'journal entry not found';
  end if;
  if v_entry.source_table <> 'manual' then
    raise exception 'can only edit manual vouchers';
  end if;
  if v_entry.status <> 'draft' then
    raise exception 'only draft vouchers can be edited — current status: %', v_entry.status;
  end if;
  -- Only creator or owner can edit
  if v_entry.created_by <> auth.uid() and not public.is_owner() then
    raise exception 'only the creator can edit this draft';
  end if;

  v_base := public.get_base_currency();

  perform set_config('app.accounting_bypass', '1', true);

  -- Update memo if provided
  if p_memo is not null then
    v_memo := nullif(trim(p_memo), '');
    update public.journal_entries
      set memo = v_memo
    where id = p_entry_id;
  end if;

  -- Replace lines if provided
  if p_lines is not null then
    if jsonb_typeof(p_lines) <> 'array' then
      raise exception 'p_lines must be a json array';
    end if;

    -- Delete existing lines (bypass immutability)
    delete from public.journal_lines where journal_entry_id = p_entry_id;

    -- Re-insert new lines
    for v_line in select value from jsonb_array_elements(p_lines)
    loop
      v_account_code   := nullif(trim(coalesce(v_line->>'accountCode', '')), '');
      v_debit          := coalesce(nullif(v_line->>'debit',  '')::numeric, 0);
      v_credit         := coalesce(nullif(v_line->>'credit', '')::numeric, 0);
      v_cost_center_id := nullif(v_line->>'costCenterId', '')::uuid;
      v_party_id       := nullif(v_line->>'partyId', '')::uuid;

      if v_account_code is null then
        raise exception 'account code is required for each line';
      end if;

      select id into v_account_id
      from public.chart_of_accounts
      where code = v_account_code and is_active = true;
      if v_account_id is null then
        raise exception 'account not found: %', v_account_code;
      end if;

      v_currency_code  := upper(nullif(trim(coalesce(v_line->>'currencyCode','')), ''));
      v_foreign_amount := coalesce(nullif(v_line->>'foreignAmount','')::numeric, null);
      v_fx_rate        := null;

      if v_currency_code is not null and v_currency_code <> v_base then
        begin
          v_fx_rate := nullif(v_line->>'fxRate','')::numeric;
        exception when others then v_fx_rate := null; end;
        if (v_fx_rate is null or v_fx_rate <= 0) then
          v_fx_rate := public.get_fx_rate(v_currency_code, v_base);
        end if;
        if v_foreign_amount > 0 and v_fx_rate > 0 then
          if v_debit > 0 then v_debit := public._money_round(v_foreign_amount * v_fx_rate);
          else v_credit := public._money_round(v_foreign_amount * v_fx_rate); end if;
        end if;
      else
        v_currency_code  := null;
        v_foreign_amount := null;
        v_fx_rate        := null;
      end if;

      insert into public.journal_lines(
        journal_entry_id, account_id, debit, credit, line_memo,
        cost_center_id, party_id, currency_code, fx_rate, foreign_amount
      ) values (
        p_entry_id, v_account_id, v_debit, v_credit,
        nullif(trim(coalesce(v_line->>'memo','')), ''),
        v_cost_center_id, v_party_id, v_currency_code, v_fx_rate, v_foreign_amount
      );
    end loop;

    perform public.verify_journal_entry_balance(p_entry_id);
  end if;

  perform set_config('app.accounting_bypass', '0', true);

  -- Audit
  begin
    insert into public.system_audit_logs(
      action, module, details, performed_by, performed_at, metadata, risk_level
    ) values (
      'journal_entries.update_draft', 'accounting', p_entry_id::text, auth.uid(), now(),
      jsonb_build_object('entryId', p_entry_id, 'memo', p_memo),
      'LOW'
    );
  exception when others then null; end;

  return p_entry_id;
end;
$$;

revoke all on function public.update_manual_voucher_draft(uuid, text, jsonb) from public;
grant execute on function public.update_manual_voucher_draft(uuid, text, jsonb) to authenticated;


-- ──────────────────────────────────────────────────────────────────────────────
-- FIX #3: recall_voucher — add missing permission check
-- ──────────────────────────────────────────────────────────────────────────────
create or replace function public.recall_voucher(
  p_entry_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_entry record;
begin
  -- Only the creator or owner can recall their own voucher
  select * into v_entry from public.journal_entries where id = p_entry_id;
  if not found then raise exception 'القيد غير موجود'; end if;

  if v_entry.source_table <> 'manual' then
    raise exception 'لا يمكن سحب قيود النظام';
  end if;

  if v_entry.status <> 'pending_approval' then
    raise exception 'لا يمكن سحب سند إلا وهو في انتظار الاعتماد. الحالة الحالية: %', v_entry.status;
  end if;

  -- Only the original creator can recall (not anyone with manage permission)
  if v_entry.created_by <> auth.uid() and not public.is_owner() then
    raise exception 'لا يمكنك سحب سند أنشأه شخص آخر';
  end if;

  perform set_config('app.accounting_bypass', '1', true);
  update public.journal_entries
    set status = 'draft'
  where id = p_entry_id;
  perform set_config('app.accounting_bypass', '0', true);

  insert into public.voucher_approval_log(
    entry_id, action, performed_by, reason, previous_status, new_status
  )
  values (p_entry_id, 'recalled', auth.uid(), null, 'pending_approval', 'draft');

  return jsonb_build_object('success', true, 'status', 'draft', 'entry_id', p_entry_id);
end;
$$;

revoke all on function public.recall_voucher(uuid) from public;
grant execute on function public.recall_voucher(uuid) to authenticated;


-- ──────────────────────────────────────────────────────────────────────────────
-- RLS: ensure storage bucket policies will work once bucket is created
-- Add RLS policy for authenticated users to read/write voucher-attachments
-- ──────────────────────────────────────────────────────────────────────────────

-- Storage bucket objects RLS (these get applied once bucket exists)
do $$
begin
  -- Check if policy exists before creating
  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects' and policyname = 'voucher_attachments_select'
  ) then
    execute $pol$
      create policy voucher_attachments_select on storage.objects
        for select to authenticated
        using (bucket_id = 'documents')
    $pol$;
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects' and policyname = 'voucher_attachments_insert'
  ) then
    execute $pol$
      create policy voucher_attachments_insert on storage.objects
        for insert to authenticated
        with check (bucket_id = 'documents')
    $pol$;
  end if;
exception when others then
  raise warning 'Storage RLS policy creation skipped: %', sqlerrm;
end;
$$;
