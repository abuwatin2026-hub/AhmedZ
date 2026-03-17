-- ════════════════════════════════════════════════════════════════════
-- MIGRATION: 20260318010100_fx_period_close_gate.sql
--
-- Implements:
-- 1. FX smoke check function: verifies all FX conditions are met
-- 2. Replaces close_accounting_period with gated version that
--    blocks close if FX revaluation hasn't been run for the period
-- ════════════════════════════════════════════════════════════════════

-- ─── 1. FX Pre-Close Smoke Check Function ─────────────────────────
create or replace function public.fx_pre_close_smoke_check(
  p_period_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_period record;
  v_base text;
  v_errors jsonb := '[]'::jsonb;
  v_warnings jsonb := '[]'::jsonb;
  v_checks jsonb := '[]'::jsonb;
  v_count int;
  v_rev_log record;
  v_missing_rate record;
  v_zero_rate_count int;
  v_null_rate_count int;
  v_unbalanced_count int;
begin
  select * into v_period from public.accounting_periods where id = p_period_id;
  if not found then
    raise exception 'Period not found: %', p_period_id;
  end if;
  v_base := public.get_base_currency();

  -- ── CHECK 1: FX revaluation was run for this period ──────────────
  select * into v_rev_log
  from public.fx_monthly_revaluation_log
  where period_year = extract(year from v_period.end_date)::int
    and period_month = extract(month from v_period.end_date)::int
    and status = 'completed';

  if not found then
    v_errors := v_errors || jsonb_build_object(
      'check', 'monthly_revaluation',
      'status', 'FAIL',
      'message', format(
        'لم يتم تنفيذ إعادة تقييم FX لشهر %s/%s. شغّل run_monthly_fx_revaluation(%s, %s) أولاً.',
        extract(year from v_period.end_date),
        lpad(extract(month from v_period.end_date)::text, 2, '0'),
        extract(year from v_period.end_date),
        extract(month from v_period.end_date)
      )
    );
  else
    v_checks := v_checks || jsonb_build_object(
      'check', 'monthly_revaluation',
      'status', 'PASS',
      'message', format('إعادة التقييم %s منفّذة — صافي: %s SAR', v_rev_log.ref_code, v_rev_log.net_fx_diff)
    );
  end if;

  -- ── CHECK 2: No posted journal lines with FX rate = 0 ────────────
  select count(*) into v_zero_rate_count
  from public.journal_lines jl
  join public.journal_entries je on je.id = jl.journal_entry_id
  where je.status = 'posted'
    and je.entry_date::date between v_period.start_date and v_period.end_date
    and jl.currency_code is not null
    and upper(jl.currency_code) <> upper(v_base)
    and (jl.fx_rate = 0 or jl.fx_rate is null);

  if v_zero_rate_count > 0 then
    v_errors := v_errors || jsonb_build_object(
      'check', 'zero_fx_rate',
      'status', 'FAIL',
      'message', format('%s سطر يحتوي fx_rate = 0 أو مفقود في الفترة', v_zero_rate_count)
    );
  else
    v_checks := v_checks || jsonb_build_object(
      'check', 'zero_fx_rate',
      'status', 'PASS',
      'message', 'كل أسطر العملات الأجنبية لها fx_rate صالح'
    );
  end if;

  -- ── CHECK 3: All foreign currencies have a closing rate ───────────
  select min(jl.currency_code) into v_missing_rate
  from public.journal_lines jl
  join public.journal_entries je on je.id = jl.journal_entry_id
  where je.status = 'posted'
    and je.entry_date::date between v_period.start_date and v_period.end_date
    and jl.currency_code is not null
    and upper(jl.currency_code) <> upper(v_base)
    and not exists (
      select 1 from public.fx_rates fr
      where upper(fr.currency_code) = upper(jl.currency_code)
        and fr.rate_date <= v_period.end_date
    )
  group by jl.currency_code
  limit 1;

  if v_missing_rate is not null then
    v_errors := v_errors || jsonb_build_object(
      'check', 'missing_closing_rate',
      'status', 'FAIL',
      'message', format('لا يوجد سعر صرف لعملة %s حتى تاريخ %s', v_missing_rate, v_period.end_date)
    );
  else
    v_checks := v_checks || jsonb_build_object(
      'check', 'missing_closing_rate',
      'status', 'PASS',
      'message', 'كل العملات الأجنبية لها سعر إقفال'
    );
  end if;

  -- ── CHECK 4: No unbalanced journal entries in period ─────────────
  select count(*) into v_unbalanced_count
  from (
    select je.id
    from public.journal_entries je
    join public.journal_lines jl on jl.journal_entry_id = je.id
    where je.status = 'posted'
      and je.entry_date::date between v_period.start_date and v_period.end_date
    group by je.id
    having abs(sum(jl.debit) - sum(jl.credit)) > 0.01
  ) sub;

  if v_unbalanced_count > 0 then
    v_errors := v_errors || jsonb_build_object(
      'check', 'unbalanced_entries',
      'status', 'FAIL',
      'message', format('%s قيد غير متوازن في الفترة', v_unbalanced_count)
    );
  else
    v_checks := v_checks || jsonb_build_object(
      'check', 'unbalanced_entries',
      'status', 'PASS',
      'message', 'كل القيود متوازنة'
    );
  end if;

  -- ── CHECK 5: Trial balance is balanced ───────────────────────────
  declare
    v_trial_diff numeric;
  begin
    select abs(sum(jl.debit) - sum(jl.credit)) into v_trial_diff
    from public.journal_lines jl
    join public.journal_entries je on je.id = jl.journal_entry_id
    where je.status = 'posted'
      and je.entry_date::date <= v_period.end_date;

    if coalesce(v_trial_diff, 0) > 0.05 then
      v_errors := v_errors || jsonb_build_object(
        'check', 'trial_balance',
        'status', 'FAIL',
        'message', format('ميزان المراجعة غير متوازن — الفرق: %s SAR', v_trial_diff)
      );
    else
      v_checks := v_checks || jsonb_build_object(
        'check', 'trial_balance',
        'status', 'PASS',
        'message', format('ميزان المراجعة متوازن (فرق: %s)', coalesce(v_trial_diff, 0))
      );
    end if;
  end;

  return jsonb_build_object(
    'period_name', v_period.name,
    'period_end', v_period.end_date,
    'can_close', jsonb_array_length(v_errors) = 0,
    'error_count', jsonb_array_length(v_errors),
    'errors', v_errors,
    'warnings', v_warnings,
    'passed_checks', v_checks
  );
end;
$$;

revoke all on function public.fx_pre_close_smoke_check(uuid) from public;
grant execute on function public.fx_pre_close_smoke_check(uuid) to authenticated;

-- ─── 2. Replace close_accounting_period with gated version ────────
create or replace function public.close_accounting_period(
  p_period_id uuid,
  p_force boolean default false  -- owner can force-close skipping FX check
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_period record;
  v_entry_id uuid;
  v_entry_date timestamptz;
  v_retained uuid;
  v_income_total numeric := 0;
  v_expense_total numeric := 0;
  v_profit numeric := 0;
  v_amount numeric := 0;
  v_has_lines boolean := false;
  v_row record;
  v_smoke_result jsonb;
  v_trial_diff numeric;
begin
  if not public.is_owner() then
    raise exception 'not allowed';
  end if;

  select * into v_period from public.accounting_periods ap where ap.id = p_period_id for update;
  if not found then raise exception 'period not found'; end if;
  if v_period.status = 'closed' then return; end if;

  -- ── FX Gate: Run smoke check before closing ──────────────────────
  if not p_force then
    v_smoke_result := public.fx_pre_close_smoke_check(p_period_id);
    if not (v_smoke_result->>'can_close')::boolean then
      raise exception E'فشل إقفال الفترة — اجتاز الفحوص الآتية أولاً:\n%',
        (select string_agg('  ❌ ' || (err->>'message'), E'\n')
         from jsonb_array_elements(v_smoke_result->'errors') err);
    end if;
  else
    raise warning 'تحذير: تجاوز فحوص FX بالقوة (p_force=true) — تأكد من المراجعة اليدوية';
  end if;

  -- ── Generate closing journal entry (income/expense → retained) ───
  v_entry_date := (v_period.end_date::timestamptz + interval '23 hours 59 minutes 59 seconds');
  v_retained := public.get_account_id_by_code('3000');
  if v_retained is null then raise exception 'Retained earnings account (3000) not found'; end if;

  insert into public.journal_entries(
    entry_date, memo, source_table, source_id, source_event, created_by
  ) values (
    v_entry_date, concat('Close period ', v_period.name),
    'accounting_periods', p_period_id::text, 'closing', auth.uid()
  )
  on conflict (source_table, source_id, source_event)
  do update set entry_date = excluded.entry_date, memo = excluded.memo
  returning id into v_entry_id;

  delete from public.journal_lines jl where jl.journal_entry_id = v_entry_id;

  for v_row in
    select coa.id as account_id, coa.account_type,
           coalesce(sum(jl.debit), 0) as debit,
           coalesce(sum(jl.credit), 0) as credit
    from public.chart_of_accounts coa
    join public.journal_lines jl on jl.account_id = coa.id
    join public.journal_entries je on je.id = jl.journal_entry_id
    where coa.account_type in ('income', 'expense')
      and je.entry_date::date >= v_period.start_date
      and je.entry_date::date <= v_period.end_date
    group by coa.id, coa.account_type
  loop
    if v_row.account_type = 'income' then
      v_amount := (v_row.credit - v_row.debit);
      v_income_total := v_income_total + v_amount;
      if abs(v_amount) > 1e-9 then
        insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo)
        values (v_entry_id, v_row.account_id, greatest(v_amount, 0), greatest(-v_amount, 0), 'Close income');
        v_has_lines := true;
      end if;
    else
      v_amount := (v_row.debit - v_row.credit);
      v_expense_total := v_expense_total + v_amount;
      if abs(v_amount) > 1e-9 then
        insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo)
        values (v_entry_id, v_row.account_id, greatest(-v_amount, 0), greatest(v_amount, 0), 'Close expense');
        v_has_lines := true;
      end if;
    end if;
  end loop;

  v_profit := coalesce(v_income_total, 0) - coalesce(v_expense_total, 0);
  if abs(v_profit) > 1e-9 or v_has_lines then
    insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo)
    values (v_entry_id, v_retained, greatest(-v_profit, 0), greatest(v_profit, 0), 'Retained earnings');
  end if;

  update public.accounting_periods
  set status = 'closed', closed_at = now(), closed_by = auth.uid()
  where id = p_period_id and status <> 'closed';
end;
$$;

revoke all on function public.close_accounting_period(uuid, boolean) from public;
grant execute on function public.close_accounting_period(uuid, boolean) to authenticated;

notify pgrst, 'reload schema';
