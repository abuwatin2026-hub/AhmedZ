-- ═══════════════════════════════════════════════════════════════
-- Migration: Batch purge all falsely-paid credit orders
-- 
-- Problem: Credit (آجل) orders were auto-assigned AR payments for
--   the full order amount at sale time. This caused loadPaidSums()
--   to sum paid = total → order appears "fully paid" even though
--   no real money was received.
--
-- This migration:
--   1. Identifies all delivered credit orders that have ONLY AR
--      payments (method='ar') with no real payments (cash/kuraimi/network)
--      AND have paidAt set in their data column.
--   2. For each affected order, calls the same cleanup logic as
--      purge_order_payment() (bypassing is_owner() since migrations
--      run as superuser).
--   3. Clears paidAt from each affected order's data.
--   4. Reports how many orders were fixed.
-- ═══════════════════════════════════════════════════════════════

set app.allow_ledger_ddl = '1';

do $$
declare
  v_order_ids uuid[];
  v_order_id uuid;
  v_payment_ids uuid[];
  v_je_ids uuid[];
  v_jl_ids uuid[];
  v_doc_ids uuid[];
  v_fixed_count int := 0;
  v_total_payments_deleted int := 0;
  v_total_journals_deleted int := 0;
  v_error_count int := 0;
  v_dry_run boolean := false; -- Set to true for a safe preview
begin

  perform set_config('app.allow_ledger_ddl', '1', true);

  -- ── Step 1: Find all affected orders ──────────────────────────
  -- A "falsely paid" credit order is one where:
  --   a) status = 'delivered'
  --   b) data->>'paidAt' is NOT null (marked as fully paid)
  --   c) invoiceTerms = 'credit' OR paymentMethod = 'ar' (is a credit sale)
  --   d) ALL payments are method='ar' (no cash/network/kuraimi received)
  --   e) Has at least one AR payment (to confirm it's the bug)

  select coalesce(array_agg(o.id), '{}')
  into v_order_ids
  from public.orders o
  where o.status = 'delivered'
    and (o.data->>'paidAt') is not null
    and nullif(o.data->>'paidAt', '') is not null
    and (
      lower(coalesce(o.data->>'invoiceTerms', '')) = 'credit'
      or lower(coalesce(o.data->>'paymentMethod', '')) = 'ar'
      or (o.data->>'isCreditSale')::boolean = true
    )
    and exists (
      -- Has at least one AR payment
      select 1 from public.payments p
      where p.reference_table = 'orders'
        and p.reference_id = o.id::text
        and p.direction = 'in'
        and lower(coalesce(p.method, '')) = 'ar'
    )
    and not exists (
      -- Has NO real payments (non-AR)
      select 1 from public.payments p
      where p.reference_table = 'orders'
        and p.reference_id = o.id::text
        and p.direction = 'in'
        and lower(coalesce(p.method, '')) <> 'ar'
    );

  raise notice 'Found % falsely-paid credit orders to fix.', array_length(v_order_ids, 1);

  if v_dry_run then
    raise notice 'DRY RUN MODE - no changes made. Set v_dry_run = false to apply.';
    -- Print which orders would be affected
    for v_order_id in select unnest(v_order_ids)
    loop
      raise notice 'Would fix order: %', v_order_id;
    end loop;
    return;
  end if;

  -- ── Step 2: Process each affected order ────────────────────────
  foreach v_order_id in array v_order_ids
  loop
    begin

      -- Disable triggers on all affected tables for this operation
      alter table public.journal_lines           disable trigger user;
      alter table public.journal_entries         disable trigger user;
      alter table public.payments                disable trigger user;
      alter table public.party_ledger_entries    disable trigger user;
      alter table public.party_open_items        disable trigger user;
      alter table public.orders                  disable trigger user;
      begin alter table public.accounting_documents      disable trigger user; exception when others then null; end;
      begin alter table public.settlement_lines          disable trigger user; exception when others then null; end;
      begin alter table public.settlement_headers        disable trigger user; exception when others then null; end;
      begin alter table public.ar_open_items             disable trigger user; exception when others then null; end;
      begin alter table public.ar_allocations            disable trigger user; exception when others then null; end;
      begin alter table public.ar_payment_status         disable trigger user; exception when others then null; end;
      begin alter table public.bank_reconciliation_matches disable trigger user; exception when others then null; end;

      -- Phase 0: Collect IDs for this order
      select coalesce(array_agg(p.id), '{}')
      into v_payment_ids
      from public.payments p
      where p.reference_table = 'orders'
        and p.reference_id = v_order_id::text;

      if array_length(v_payment_ids, 1) is null or array_length(v_payment_ids, 1) = 0 then
        -- No payments at all (maybe paidAt was set by old trigger) - just clear paidAt
        update public.orders
        set data = (coalesce(data, '{}'::jsonb) - 'paidAt')
            || jsonb_build_object(
              'paymentPurgedAt', now()::text,
              'paymentPurgeReason', 'batch_fix_false_credit_payment_no_payments'
            ),
        updated_at = now()
        where id = v_order_id;

        v_fixed_count := v_fixed_count + 1;

        -- Re-enable triggers
        alter table public.journal_lines           enable trigger user;
        alter table public.journal_entries         enable trigger user;
        alter table public.payments                enable trigger user;
        alter table public.party_ledger_entries    enable trigger user;
        alter table public.party_open_items        enable trigger user;
        alter table public.orders                  enable trigger user;
        begin alter table public.accounting_documents      enable trigger user; exception when others then null; end;
        begin alter table public.settlement_lines          enable trigger user; exception when others then null; end;
        begin alter table public.settlement_headers        enable trigger user; exception when others then null; end;
        begin alter table public.ar_open_items             enable trigger user; exception when others then null; end;
        begin alter table public.ar_allocations            enable trigger user; exception when others then null; end;
        begin alter table public.ar_payment_status         enable trigger user; exception when others then null; end;
        begin alter table public.bank_reconciliation_matches enable trigger user; exception when others then null; end;

        continue;
      end if;

      -- Collect journal entries from these payments
      select coalesce(array_agg(je.id), '{}')
      into v_je_ids
      from public.journal_entries je
      where je.source_table = 'payments'
        and je.source_id = any(select pid::text from unnest(v_payment_ids) pid);

      -- Collect journal lines
      select coalesce(array_agg(jl.id), '{}')
      into v_jl_ids
      from public.journal_lines jl
      where jl.journal_entry_id = any(v_je_ids);

      -- Collect accounting document IDs
      select coalesce(array_agg(distinct je.document_id), '{}')
      into v_doc_ids
      from public.journal_entries je
      where je.id = any(v_je_ids) and je.document_id is not null;

      -- Phase 1: Delete settlement chain
      if array_length(v_jl_ids, 1) > 0 then
        begin
          delete from public.settlement_lines
          where from_open_item_id in (
            select poi.id from public.party_open_items poi where poi.journal_line_id = any(v_jl_ids)
          ) or to_open_item_id in (
            select poi.id from public.party_open_items poi where poi.journal_line_id = any(v_jl_ids)
          );
        exception when others then null; end;

        begin
          delete from public.settlement_headers sh
          where not exists (select 1 from public.settlement_lines sl where sl.settlement_id = sh.id);
        exception when others then null; end;
      end if;

      -- Phase 2: Delete tables referencing payments
      if array_length(v_payment_ids, 1) > 0 then
        begin delete from public.ar_allocations where payment_id = any(v_payment_ids); exception when others then null; end;
        begin delete from public.ar_payment_status where payment_id = any(v_payment_ids); exception when others then null; end;
        begin delete from public.bank_reconciliation_matches where payment_id = any(v_payment_ids); exception when others then null; end;
      end if;

      -- Phase 3: Delete tables referencing journal_lines
      if array_length(v_jl_ids, 1) > 0 then
        begin delete from public.party_open_items where journal_line_id = any(v_jl_ids); exception when others then null; end;
        begin delete from public.party_ledger_entries where journal_line_id = any(v_jl_ids); exception when others then null; end;
        delete from public.journal_lines where id = any(v_jl_ids);
      end if;

      -- Phase 4: Delete tables referencing journal_entries, then entries
      if array_length(v_je_ids, 1) > 0 then
        begin delete from public.ar_open_items where journal_entry_id = any(v_je_ids); exception when others then null; end;
        delete from public.journal_entries where id = any(v_je_ids);
        v_total_journals_deleted := v_total_journals_deleted + coalesce(array_length(v_je_ids, 1), 0);
      end if;

      -- Phase 5: Delete payments
      if array_length(v_payment_ids, 1) > 0 then
        delete from public.payments where id = any(v_payment_ids);
        v_total_payments_deleted := v_total_payments_deleted + coalesce(array_length(v_payment_ids, 1), 0);
      end if;

      -- Phase 6: Delete accounting_documents
      if array_length(v_doc_ids, 1) > 0 then
        begin delete from public.accounting_documents where id = any(v_doc_ids); exception when others then null; end;
      end if;

      -- Phase 7: Reopen AR open items (if any)
      begin
        update public.ar_open_items
        set status = 'open', closed_at = null, open_balance = original_amount
        where invoice_id = v_order_id and status = 'closed';
      exception when others then null; end;

      -- Phase 8: Clear paidAt from order
      update public.orders
      set data = (coalesce(data, '{}'::jsonb) - 'paidAt')
          || jsonb_build_object(
            'paymentPurgedAt', now()::text,
            'paymentPurgeReason', 'batch_fix_false_credit_payment_2026_03_22'
          ),
      updated_at = now()
      where id = v_order_id;

      -- Re-enable triggers
      alter table public.journal_lines           enable trigger user;
      alter table public.journal_entries         enable trigger user;
      alter table public.payments                enable trigger user;
      alter table public.party_ledger_entries    enable trigger user;
      alter table public.party_open_items        enable trigger user;
      alter table public.orders                  enable trigger user;
      begin alter table public.accounting_documents      enable trigger user; exception when others then null; end;
      begin alter table public.settlement_lines          enable trigger user; exception when others then null; end;
      begin alter table public.settlement_headers        enable trigger user; exception when others then null; end;
      begin alter table public.ar_open_items             enable trigger user; exception when others then null; end;
      begin alter table public.ar_allocations            enable trigger user; exception when others then null; end;
      begin alter table public.ar_payment_status         enable trigger user; exception when others then null; end;
      begin alter table public.bank_reconciliation_matches enable trigger user; exception when others then null; end;

      v_fixed_count := v_fixed_count + 1;
      raise notice 'Fixed order %', v_order_id;

    exception when others then
      -- Re-enable triggers even on error
      begin alter table public.journal_lines           enable trigger user; exception when others then null; end;
      begin alter table public.journal_entries         enable trigger user; exception when others then null; end;
      begin alter table public.payments                enable trigger user; exception when others then null; end;
      begin alter table public.party_ledger_entries    enable trigger user; exception when others then null; end;
      begin alter table public.party_open_items        enable trigger user; exception when others then null; end;
      begin alter table public.orders                  enable trigger user; exception when others then null; end;
      begin alter table public.accounting_documents    enable trigger user; exception when others then null; end;
      begin alter table public.ar_open_items           enable trigger user; exception when others then null; end;
      begin alter table public.ar_allocations          enable trigger user; exception when others then null; end;
      begin alter table public.ar_payment_status       enable trigger user; exception when others then null; end;
      v_error_count := v_error_count + 1;
      raise notice 'ERROR fixing order %: %', v_order_id, sqlerrm;
    end;
  end loop;

  -- ── Summary audit log ──────────────────────────────────────────
  if v_fixed_count > 0 then
    insert into public.system_audit_logs(
      action, module, details, performed_at, risk_level, reason_code, metadata
    ) values (
      'payment.batch_purge_false_credit',
      'payments',
      concat('Batch purge of falsely-paid credit orders: fixed ', v_fixed_count, ', errors ', v_error_count),
      now(),
      'CRITICAL',
      'BATCH_FIX_FALSE_CREDIT_PAYMENT',
      jsonb_build_object(
        'fixedCount', v_fixed_count,
        'errorCount', v_error_count,
        'totalPaymentsDeleted', v_total_payments_deleted,
        'totalJournalsDeleted', v_total_journals_deleted,
        'runAt', now()::text,
        'migration', '20260322002800_batch_purge_false_credit_payments'
      )
    );
  end if;

  raise notice '═══ Batch Fix Complete ═══';
  raise notice 'Fixed: % orders', v_fixed_count;
  raise notice 'Errors: % orders', v_error_count;
  raise notice 'Total payments deleted: %', v_total_payments_deleted;
  raise notice 'Total journal entries deleted: %', v_total_journals_deleted;

end;
$$;

notify pgrst, 'reload schema';
