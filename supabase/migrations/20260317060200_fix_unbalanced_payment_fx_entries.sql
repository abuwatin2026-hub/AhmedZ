-- ════════════════════════════════════════════════════════════════════
-- Fix 24 unbalanced payment journal entries (v2)
-- Root cause: FX Gain/Loss lines (6200/6201) incorrectly carry the
-- full payment base_amount instead of just the FX difference.
-- Strategy: Adjust FX line to balance the entry. If the corrected
-- amount rounds to 0, delete the FX line entirely.
-- ════════════════════════════════════════════════════════════════════

set app.allow_ledger_ddl = '1';

alter table public.journal_lines disable trigger user;

do $$
declare
  v_entry record;
  v_line record;
  v_fx_id uuid;
  v_fx_debit numeric;
  v_fx_credit numeric;
  v_diff numeric;
  v_new_debit numeric;
  v_new_credit numeric;
  v_fixed int := 0;
begin
  perform set_config('app.allow_ledger_ddl', '1', true);

  for v_entry in
    select je.id as entry_id,
           (sum(jl.debit) - sum(jl.credit)) as diff,
           count(jl.*) as line_count
    from journal_entries je
    join journal_lines jl on jl.journal_entry_id = je.id
    where je.status = 'posted'
    group by je.id
    having abs(sum(jl.debit) - sum(jl.credit)) > 0.01
           and count(jl.*) = 3
  loop
    v_fx_id := null;
    v_fx_debit := 0;
    v_fx_credit := 0;

    -- Find the FX gain/loss line
    for v_line in
      select jl.id, coa.code as acct_code, jl.debit, jl.credit
      from journal_lines jl
      join chart_of_accounts coa on coa.id = jl.account_id
      where jl.journal_entry_id = v_entry.entry_id
    loop
      if v_line.acct_code in ('6200', '6201', '6250', '6251') then
        v_fx_id := v_line.id;
        v_fx_debit := coalesce(v_line.debit, 0);
        v_fx_credit := coalesce(v_line.credit, 0);
      end if;
    end loop;

    if v_fx_id is null then
      raise notice 'Entry %: no FX line, skipping', v_entry.entry_id;
      continue;
    end if;

    v_diff := v_entry.diff;

    -- Calculate new values for the FX line
    if v_diff > 0 then
      -- Too much debit: reduce debit or add credit
      v_new_debit := greatest(v_fx_debit - v_diff, 0);
      v_new_credit := v_fx_credit + greatest(v_diff - v_fx_debit, 0);
    else
      -- Too much credit: reduce credit or add debit
      v_new_credit := greatest(v_fx_credit - abs(v_diff), 0);
      v_new_debit := v_fx_debit + greatest(abs(v_diff) - v_fx_credit, 0);
    end if;

    -- Round to 4 decimal places
    v_new_debit := round(v_new_debit, 4);
    v_new_credit := round(v_new_credit, 4);

    -- If both are effectively zero, delete the FX line
    if v_new_debit < 0.0001 and v_new_credit < 0.0001 then
      delete from journal_lines where id = v_fx_id;
      raise notice 'Entry %: deleted zero-value FX line', v_entry.entry_id;
    else
      -- Ensure one_side_nonzero: at least one must be > 0
      if v_new_debit > 0 then
        v_new_credit := 0;
      end if;
      update journal_lines
      set debit = v_new_debit, credit = v_new_credit
      where id = v_fx_id;
      raise notice 'Entry %: adjusted FX line debit=% credit=%', v_entry.entry_id, v_new_debit, v_new_credit;
    end if;

    v_fixed := v_fixed + 1;
  end loop;

  raise notice '=== Fixed % entries ===', v_fixed;

  -- Verify remaining
  declare v_remaining int;
  begin
    select count(*) into v_remaining
    from (
      select je.id
      from journal_entries je
      join journal_lines jl on jl.journal_entry_id = je.id
      where je.status = 'posted'
      group by je.id
      having abs(sum(jl.debit) - sum(jl.credit)) > 0.01
    ) sub;
    raise notice 'Remaining unbalanced after fix: %', v_remaining;
  end;

  declare v_td numeric; v_tc numeric;
  begin
    select sum(jl.debit), sum(jl.credit) into v_td, v_tc
    from journal_lines jl
    join journal_entries je on je.id = jl.journal_entry_id
    where je.status = 'posted';
    raise notice 'Final: debit=%, credit=%, diff=%',
      round(v_td, 2), round(v_tc, 2), round(v_td - v_tc, 2);
  end;
end $$;

alter table public.journal_lines enable trigger user;

notify pgrst, 'reload schema';
