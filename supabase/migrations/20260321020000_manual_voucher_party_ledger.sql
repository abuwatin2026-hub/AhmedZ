-- =============================================================================
-- Migration: Fix Manual Voucher → Party Ledger Integration
-- Date: 2026-03-21
-- Problem: Manual vouchers with party_id on journal_lines are NOT inserted
--          into party_ledger_entries because:
--          1. insert_party_ledger_for_entry requires account to be in
--             party_subledger_accounts. Manual vouchers may use any account.
--          2. Existing posted manual vouchers were never backfilled.
-- Solution:
--          1. Create a dedicated function to insert party ledger entries
--             for manual vouchers using party_id directly from journal_lines
--          2. Backfill all existing posted manual vouchers that have party_id
--          3. Fire the function when manual voucher is approved (draft→posted)
-- =============================================================================

-- ──────────────────────────────────────────────────────────────────────────────
-- STEP 1: Function to insert party ledger for manual vouchers
-- This supplements insert_party_ledger_for_entry for source_table='manual'
-- ──────────────────────────────────────────────────────────────────────────────
create or replace function public.insert_party_ledger_for_manual_voucher(
  p_entry_id uuid
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_entry  record;
  v_line   record;
  v_dir    text;
  v_base_amt numeric;
  v_foreign_amt numeric;
  v_curr   text;
  v_fx     numeric;
  v_prev   numeric;
  v_delta  numeric;
  v_inserted integer := 0;
begin
  -- Load the entry
  select id, entry_date, source_table, source_id, source_event, status
  into v_entry
  from public.journal_entries
  where id = p_entry_id;

  if not found then return 0; end if;
  if v_entry.source_table <> 'manual' then return 0; end if;
  if coalesce(v_entry.status, '') <> 'posted' then return 0; end if;

  -- Process each journal_line that has party_id set
  for v_line in
    select
      jl.id as line_id,
      jl.account_id,
      jl.debit,
      jl.credit,
      jl.party_id,
      jl.currency_code,
      jl.fx_rate,
      jl.foreign_amount
    from public.journal_lines jl
    where jl.journal_entry_id = p_entry_id
      and jl.party_id is not null
  loop

    -- Skip if already in party_ledger_entries
    if exists (
      select 1 from public.party_ledger_entries ple
      where ple.journal_line_id = v_line.line_id
    ) then
      continue;
    end if;

    -- Determine direction
    if coalesce(v_line.debit, 0) > 0 then
      v_dir := 'debit';
      v_base_amt := v_line.debit;
    else
      v_dir := 'credit';
      v_base_amt := v_line.credit;
    end if;

    -- FX fields
    v_curr       := upper(nullif(trim(coalesce(v_line.currency_code, '')), ''));
    v_fx         := v_line.fx_rate;
    v_foreign_amt := v_line.foreign_amount;

    -- Get previous running balance for this party/account combination
    select coalesce(max(ple.running_balance), 0)
    into v_prev
    from public.party_ledger_entries ple
    where ple.party_id = v_line.party_id
      and ple.account_id = v_line.account_id;

    -- Calculate delta (using base_amount for running balance)
    v_delta := case
      when v_dir = 'debit'  then  v_base_amt
      when v_dir = 'credit' then -v_base_amt
      else 0
    end;

    -- Insert into party_ledger_entries
    insert into public.party_ledger_entries(
      party_id,
      account_id,
      journal_entry_id,
      journal_line_id,
      occurred_at,
      direction,
      base_amount,
      foreign_amount,
      currency_code,
      fx_rate,
      running_balance
    ) values (
      v_line.party_id,
      v_line.account_id,
      p_entry_id,
      v_line.line_id,
      v_entry.entry_date,
      v_dir,
      v_base_amt,
      v_foreign_amt,
      nullif(v_curr, ''),
      v_fx,
      v_prev + v_delta
    );

    v_inserted := v_inserted + 1;
  end loop;

  return v_inserted;
end;
$$;

revoke all on function public.insert_party_ledger_for_manual_voucher(uuid) from public;
grant execute on function public.insert_party_ledger_for_manual_voucher(uuid) to authenticated;


-- ──────────────────────────────────────────────────────────────────────────────
-- STEP 2: Update trigger to also call manual voucher party ledger function
-- ──────────────────────────────────────────────────────────────────────────────
create or replace function public.trg_journal_entries_party_ledger_on_approve()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'UPDATE'
     and old.status is distinct from new.status
     and coalesce(new.status,'') = 'posted' then
    -- Original: handles system entries via party_subledger_accounts
    perform public.insert_party_ledger_for_entry(new.id);
    -- New: handles manual vouchers via party_id on journal_lines
    if coalesce(new.source_table, '') = 'manual' then
      perform public.insert_party_ledger_for_manual_voucher(new.id);
    end if;
  end if;
  return new;
end;
$$;


-- ──────────────────────────────────────────────────────────────────────────────
-- STEP 3: Backfill all existing posted manual vouchers with party_id
-- ──────────────────────────────────────────────────────────────────────────────
do $$
declare
  v_entry_id uuid;
  v_total    integer := 0;
  v_n        integer;
begin
  raise notice 'Backfilling party_ledger_entries for manual vouchers...';

  for v_entry_id in
    select je_id from (
      select distinct je.id as je_id, min(je.entry_date) as edate
      from public.journal_entries je
      join public.journal_lines jl on jl.journal_entry_id = je.id
      where je.source_table = 'manual'
        and je.status = 'posted'
        and jl.party_id is not null
        and not exists (
          select 1 from public.party_ledger_entries ple
          where ple.journal_entry_id = je.id
        )
      group by je.id
    ) sub
    order by edate asc
  loop
    begin
      v_n := public.insert_party_ledger_for_manual_voucher(v_entry_id);
      v_total := v_total + coalesce(v_n, 0);
    exception when others then
      raise warning 'Failed to backfill entry %: %', v_entry_id, sqlerrm;
    end;
  end loop;

  raise notice 'Backfill complete: % rows inserted for manual vouchers', v_total;
end;
$$;


-- ────────────────────────────────────────────────────────────────────────────── 
-- ──────────────────────────────────────────────────────────────────────────────
-- STEP 4: Also update approve_voucher to call manual party ledger
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
  if not public.has_admin_permission('accounting.approve') then
    raise exception 'يلزم إذن accounting.approve';
  end if;

  select * into v_entry from public.journal_entries where id = p_entry_id for update;
  if not found then raise exception 'القيد غير موجود'; end if;

  if v_entry.source_table <> 'manual' then
    raise exception 'يمكن اعتماد السندات اليدوية فقط';
  end if;

  if v_entry.status <> 'pending_approval' then
    raise exception 'السند ليس في انتظار اعتماد. الحالة: %', v_entry.status;
  end if;

  -- Maker ≠ Checker
  if v_entry.created_by = auth.uid() and not public.is_owner() then
    raise exception 'لا يمكنك اعتماد سند قمت بإنشائه (مبدأ الفصل بين المهام)';
  end if;

  perform set_config('app.accounting_bypass', '1', true);
  update public.journal_entries
    set status = 'posted'
  where id = p_entry_id;
  perform set_config('app.accounting_bypass', '0', true);

  -- Populate party ledger for manual voucher (was missing before)
  begin
    perform public.insert_party_ledger_for_manual_voucher(p_entry_id);
  exception when others then
    raise warning 'approve_voucher: party ledger insert failed: %', sqlerrm;
  end;

  insert into public.voucher_approval_log(
    entry_id, action, performed_by, notes, previous_status, new_status
  )
  values (p_entry_id, 'approved', auth.uid(), p_notes, 'pending_approval', 'posted');

  begin
    insert into public.system_audit_logs(
      action, module, details, performed_by, performed_at, metadata, risk_level
    ) values (
      'voucher.approved', 'accounting', p_entry_id::text, auth.uid(), now(),
      jsonb_build_object('entryId', p_entry_id, 'notes', p_notes),
      'HIGH'
    );
  exception when others then null; end;

  return jsonb_build_object('success', true, 'status', 'posted', 'entry_id', p_entry_id);
end;
$$;

revoke all on function public.approve_voucher(uuid, text) from public;
grant execute on function public.approve_voucher(uuid, text) to authenticated;


-- ──────────────────────────────────────────────────────────────────────────────
-- STEP 5: New backfill RPC accessible from UI
-- ──────────────────────────────────────────────────────────────────────────────
create or replace function public.backfill_manual_voucher_party_ledger()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_entry_id uuid;
  v_total    integer := 0;
  v_n        integer;
begin
  if not public.has_admin_permission('accounting.manage') then
    raise exception 'not allowed';
  end if;

  for v_entry_id in
    select je_id from (
      select distinct je.id as je_id, min(je.entry_date) as edate
      from public.journal_entries je
      join public.journal_lines jl on jl.journal_entry_id = je.id
      where je.source_table = 'manual'
        and je.status = 'posted'
        and jl.party_id is not null
        and not exists (
          select 1 from public.party_ledger_entries ple
          where ple.journal_entry_id = je.id
        )
      group by je.id
    ) sub
    order by edate asc
  loop
    begin
      v_n := public.insert_party_ledger_for_manual_voucher(v_entry_id);
      v_total := v_total + coalesce(v_n, 0);
    exception when others then
      raise warning 'Failed for entry %: %', v_entry_id, sqlerrm;
    end;
  end loop;

  return v_total;
end;
$$;

revoke all on function public.backfill_manual_voucher_party_ledger() from public;
grant execute on function public.backfill_manual_voucher_party_ledger() to authenticated;

comment on function public.insert_party_ledger_for_manual_voucher(uuid) is
  'Inserts party_ledger_entries rows for manual voucher journal_lines that have party_id set. Called on approve and as backfill.';
