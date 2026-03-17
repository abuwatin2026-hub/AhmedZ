-- ════════════════════════════════════════════════════════════════
-- FIX 1: Correct inflated sales return journal entries
-- The return entries credit AR with amounts far exceeding the
-- original order totals (e.g., 287K credit for a 696 order).
-- We reverse the wrong entries and create corrected ones.
--
-- FIX 2: Reclassify batch revaluation entries from 5020 to 5030
-- 6 manual entries on 2026-02-26 were posted as "inventory
-- shrinkage" (5020) but they are actually batch cost revaluations
-- which should be "Purchase Price Variance" (5030).
-- ════════════════════════════════════════════════════════════════

set app.allow_ledger_ddl = '1';

alter table public.journal_lines disable trigger user;
alter table public.journal_entries disable trigger user;

-- ═══════════════════════════════════════
-- FIX 1: Reverse inflated AR return entries
-- and create corrected ones using order base_total
-- ═══════════════════════════════════════
do $$
declare
  v_wrong record;
  v_reversal_id uuid;
  v_corrected_id uuid;
  v_line record;
  v_correct_amount numeric;
  v_reversed int := 0;
  v_ar_account uuid;
  v_returns_account uuid;
begin
  perform set_config('app.allow_ledger_ddl', '1', true);

  v_ar_account := public.get_account_id_by_code('1200');
  v_returns_account := public.get_account_id_by_code('4026');

  for v_wrong in
    select je.id as entry_id, je.entry_date, je.memo, je.source_id,
           je.source_event, je.currency_code, je.fx_rate, je.foreign_amount,
           je.created_by,
           jl.credit as wrong_amount,
           sr.order_id,
           o.base_total as correct_amount
    from journal_entries je
    join journal_lines jl on jl.journal_entry_id = je.id
    join chart_of_accounts coa on coa.id = jl.account_id
    join sales_returns sr on sr.id::text = je.source_id
    join orders o on o.id = sr.order_id
    where je.source_table = 'sales_returns'
      and je.status = 'posted'
      and coa.code = '1200'
      and jl.credit > 0
      -- Only fix entries where the credit exceeds the order total
      and jl.credit > o.base_total * 1.05
  loop
    -- Step 1: Reverse the wrong entry
    insert into journal_entries(
      entry_date, memo, source_table, source_id, source_event,
      created_by, status, currency_code, fx_rate, foreign_amount
    ) values (
      now(),
      'عكس قيد مرتجع مضخّم: كان ' || v_wrong.wrong_amount::numeric(20,2)::text || ' والصحيح ' || v_wrong.correct_amount::numeric(20,2)::text || ' — ' || coalesce(v_wrong.memo, ''),
      'sales_returns',
      v_wrong.source_id,
      'reversal:' || coalesce(v_wrong.source_event, ''),
      v_wrong.created_by,
      'posted',
      v_wrong.currency_code,
      v_wrong.fx_rate,
      v_wrong.foreign_amount
    ) returning id into v_reversal_id;

    -- Reverse each line
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
        v_line.credit,  -- swap
        v_line.debit,    -- swap
        'عكس: ' || coalesce(v_line.line_memo, ''),
        v_line.currency_code,
        v_line.fx_rate,
        v_line.foreign_amount,
        v_line.related_party_id
      );
    end loop;

    -- Step 2: Create corrected entry with proper amount
    v_correct_amount := v_wrong.correct_amount;

    insert into journal_entries(
      entry_date, memo, source_table, source_id, source_event,
      created_by, status, currency_code, fx_rate, foreign_amount
    ) values (
      v_wrong.entry_date,
      'تصحيح مرتجع: ' || coalesce(v_wrong.memo, ''),
      'sales_returns',
      v_wrong.source_id,
      'corrected:' || coalesce(v_wrong.source_event, ''),
      v_wrong.created_by,
      'posted',
      v_wrong.currency_code,
      v_wrong.fx_rate,
      null
    ) returning id into v_corrected_id;

    insert into journal_lines(journal_entry_id, account_id, debit, credit, line_memo)
    values
      (v_corrected_id, v_returns_account, v_correct_amount, 0, 'مرتجعات مبيعات (مصحح)'),
      (v_corrected_id, v_ar_account, 0, v_correct_amount, 'تسوية ذمم مدينة (مصحح)');

    v_reversed := v_reversed + 1;
    raise notice 'Fixed return %. Was: %, Correct: %', v_wrong.source_id, v_wrong.wrong_amount, v_correct_amount;
  end loop;

  raise notice '=== Fixed % inflated return entries ===', v_reversed;
end $$;

-- ═══════════════════════════════════════
-- FIX 2: Reclassify batch revaluation from 5020 to 5030
-- ═══════════════════════════════════════
do $$
declare
  v_5020_id uuid;
  v_5030_id uuid;
  v_updated int;
begin
  perform set_config('app.allow_ledger_ddl', '1', true);

  v_5020_id := public.get_account_id_by_code('5020');
  v_5030_id := public.get_account_id_by_code('5030');

  if v_5020_id is null or v_5030_id is null then
    raise exception '5020 or 5030 account not found';
  end if;

  -- Move the 6 manual batch revaluation entries from 5020 to 5030
  update journal_lines
  set account_id = v_5030_id
  where account_id = v_5020_id
    and journal_entry_id in (
      select je.id from journal_entries je
      where je.source_table = 'manual'
        and je.memo LIKE 'Batch cost revaluation%'
        and je.status = 'posted'
    );

  get diagnostics v_updated = row_count;
  raise notice '=== Reclassified % lines from 5020 to 5030 ===', v_updated;
end $$;

alter table public.journal_lines enable trigger user;
alter table public.journal_entries enable trigger user;

notify pgrst, 'reload schema';
