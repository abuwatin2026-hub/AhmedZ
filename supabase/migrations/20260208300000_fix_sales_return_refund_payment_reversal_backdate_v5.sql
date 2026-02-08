do $$
declare
  r record;
  v_undo_source_id uuid;
  v_fix_source_id uuid;
  v_undo_id uuid;
  v_fix_id uuid;
  v_src_entry_date timestamptz;
begin
  for r in
    select
      je_bad.id as bad_entry_id,
      je_bad.entry_date as bad_entry_date,
      (regexp_match(je_bad.memo, '^REVERSAL of legacy refund payment entry ([0-9a-fA-F-]{36})$'))[1]::uuid as src_entry_id
    from public.journal_entries je_bad
    where je_bad.source_table = 'ledger_repairs'
      and je_bad.source_event = 'reversal'
      and je_bad.memo ~ '^REVERSAL of legacy refund payment entry [0-9a-fA-F-]{36}$'
  loop
    select je_src.entry_date
    into v_src_entry_date
    from public.journal_entries je_src
    where je_src.id = r.src_entry_id;
    if v_src_entry_date is null then
      continue;
    end if;
    v_undo_source_id := public.uuid_from_text(concat('sales_return:refund_payment:', r.src_entry_id::text, ':undo_now_reversal:v5'));
    if not exists (
      select 1
      from public.journal_entries je_u
      where je_u.source_table = 'ledger_repairs'
        and je_u.source_id = v_undo_source_id::text
        and je_u.source_event = 'undo_reversal_now_v5'
    ) then
      insert into public.journal_entries(entry_date, memo, source_table, source_id, source_event, created_by, status)
      values (
        r.bad_entry_date,
        concat('UNDO (v5) bad refund payment reversal posted at now() for ', r.src_entry_id::text),
        'ledger_repairs',
        v_undo_source_id::text,
        'undo_reversal_now_v5',
        null,
        'posted'
      )
      returning id into v_undo_id;
      insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo, currency_code, fx_rate, foreign_amount)
      select
        v_undo_id,
        jl.account_id,
        jl.credit,
        jl.debit,
        concat('Undo v5: ', coalesce(jl.line_memo, '')),
        jl.currency_code,
        jl.fx_rate,
        jl.foreign_amount
      from public.journal_lines jl
      where jl.journal_entry_id = r.bad_entry_id;
      perform public.check_journal_entry_balance(v_undo_id);
    end if;
    v_fix_source_id := public.uuid_from_text(concat('sales_return:refund_payment:', r.src_entry_id::text, ':reversal_backdated:v5'));
    if not exists (
      select 1
      from public.journal_entries je_f
      where je_f.source_table = 'ledger_repairs'
        and je_f.source_id = v_fix_source_id::text
        and je_f.source_event = 'reversal_backdated_v5'
    ) then
      insert into public.journal_entries(entry_date, memo, source_table, source_id, source_event, created_by, status)
      values (
        v_src_entry_date,
        concat('REVERSAL (v5 backdated) of legacy refund payment entry ', r.src_entry_id::text),
        'ledger_repairs',
        v_fix_source_id::text,
        'reversal_backdated_v5',
        null,
        'posted'
      )
      returning id into v_fix_id;
      insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo, currency_code, fx_rate, foreign_amount)
      select
        v_fix_id,
        jl.account_id,
        jl.credit,
        jl.debit,
        concat('Reversal v5: ', coalesce(jl.line_memo, '')),
        jl.currency_code,
        jl.fx_rate,
        jl.foreign_amount
      from public.journal_lines jl
      where jl.journal_entry_id = r.src_entry_id;
      perform public.check_journal_entry_balance(v_fix_id);
    end if;
  end loop;
end $$;
notify pgrst, 'reload schema';
