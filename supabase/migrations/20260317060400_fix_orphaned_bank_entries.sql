-- ════════════════════════════════════════════════════════════════
-- Fix remaining 10 bank entries from purged AR payments
-- These payments were purged from the payments table, so the
-- previous reversal query (joining to payments) missed them.
-- ════════════════════════════════════════════════════════════════

set app.allow_ledger_ddl = '1';

alter table public.journal_lines disable trigger user;
alter table public.journal_entries disable trigger user;

do $$
declare
  v_wrong record;
  v_reversal_id uuid;
  v_line record;
  v_reversed int := 0;
begin
  perform set_config('app.allow_ledger_ddl', '1', true);

  -- Find bank debit entries that don't have corresponding reversals
  for v_wrong in
    select je.id as entry_id, je.entry_date, je.memo, je.source_id,
           je.source_event, je.currency_code, je.fx_rate, je.foreign_amount
    from journal_entries je
    join journal_lines jl on jl.journal_entry_id = je.id
    join chart_of_accounts coa on coa.id = jl.account_id
    where je.status = 'posted'
      and je.source_table = 'payments'
      and coa.code = '1020'
      and jl.debit > 0
      and je.source_event NOT LIKE 'reversal:%'
      -- No corresponding payment exists (purged)
      and not exists (
        select 1 from payments p where p.id::text = je.source_id
      )
      -- No reversal already created
      and not exists (
        select 1 from journal_entries rev
        where rev.source_event = 'reversal:' || je.source_event
          and rev.source_id = je.source_id
      )
  loop
    -- Create reversal using original entry's created_by
    insert into journal_entries(
      entry_date, memo, source_table, source_id, source_event,
      created_by, status, currency_code, fx_rate, foreign_amount
    )
    select
      now(),
      'عكس قيد خاطئ: دفعة محذوفة سُجلت كبنك — ' || coalesce(v_wrong.memo, ''),
      'payments',
      v_wrong.source_id,
      'reversal:' || coalesce(v_wrong.source_event, ''),
      je_orig.created_by,
      'posted',
      v_wrong.currency_code,
      v_wrong.fx_rate,
      v_wrong.foreign_amount
    from journal_entries je_orig
    where je_orig.id = v_wrong.entry_id
    returning id into v_reversal_id;

    -- Reverse each line (swap debit/credit)
    for v_line in
      select account_id, debit, credit, line_memo,
             currency_code, fx_rate, foreign_amount, related_party_id
      from journal_lines
      where journal_entry_id = v_wrong.entry_id
    loop
      insert into journal_lines(
        journal_entry_id, account_id, debit, credit, line_memo,
        currency_code, fx_rate, foreign_amount, related_party_id
      ) values (
        v_reversal_id,
        v_line.account_id,
        v_line.credit,
        v_line.debit,
        'عكس: ' || coalesce(v_line.line_memo, ''),
        v_line.currency_code,
        v_line.fx_rate,
        v_line.foreign_amount,
        v_line.related_party_id
      );
    end loop;

    v_reversed := v_reversed + 1;
    raise notice 'Reversed orphaned entry % (source_id %)', v_wrong.entry_id, v_wrong.source_id;
  end loop;

  raise notice '=== Reversed % orphaned entries ===', v_reversed;
end $$;

alter table public.journal_lines enable trigger user;
alter table public.journal_entries enable trigger user;

notify pgrst, 'reload schema';
