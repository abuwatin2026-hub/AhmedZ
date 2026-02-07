set app.allow_ledger_ddl = '1';

create or replace function public.close_accounting_period(p_period_id uuid)
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
  v_has_activity boolean := false;
  v_row record;
begin
  if not public.has_admin_permission('accounting.periods.close') then
    raise exception 'not allowed';
  end if;
  if not public.has_admin_permission('accounting.manage') then
    raise exception 'not allowed';
  end if;

  select *
  into v_period
  from public.accounting_periods ap
  where ap.id = p_period_id
  for update;

  if not found then
    raise exception 'period not found';
  end if;

  if v_period.status = 'closed' then
    raise exception 'period already closed';
  end if;

  select
    coalesce(sum(case when coa.account_type = 'income' then (jl.credit - jl.debit) else 0 end), 0),
    coalesce(sum(case when coa.account_type = 'expense' then (jl.debit - jl.credit) else 0 end), 0)
  into v_income_total, v_expense_total
  from public.chart_of_accounts coa
  join public.journal_lines jl on jl.account_id = coa.id
  join public.journal_entries je on je.id = jl.journal_entry_id
  where coa.account_type in ('income', 'expense')
    and je.entry_date::date >= v_period.start_date
    and je.entry_date::date <= v_period.end_date;

  v_profit := coalesce(v_income_total, 0) - coalesce(v_expense_total, 0);

  select exists (
    select 1
    from public.chart_of_accounts coa
    join public.journal_lines jl on jl.account_id = coa.id
    join public.journal_entries je on je.id = jl.journal_entry_id
    where coa.account_type in ('income', 'expense')
      and je.entry_date::date >= v_period.start_date
      and je.entry_date::date <= v_period.end_date
    group by coa.id, coa.account_type
    having abs(
      sum(
        case when coa.account_type = 'income' then (jl.credit - jl.debit)
             else (jl.debit - jl.credit)
        end
      )
    ) > 1e-9
    limit 1
  ) into v_has_activity;

  if abs(v_profit) <= 1e-9 and v_has_activity is not true then
    update public.accounting_periods
    set status = 'closed',
        closed_at = now(),
        closed_by = auth.uid()
    where id = p_period_id
      and status <> 'closed';
    return;
  end if;

  v_entry_date := (v_period.end_date::timestamptz + interval '23 hours 59 minutes 59 seconds');
  v_retained := public.get_account_id_by_code('3000');
  if v_retained is null then
    raise exception 'Retained earnings account (3000) not found';
  end if;

  begin
    insert into public.journal_entries(entry_date, memo, source_table, source_id, source_event, created_by)
    values (
      v_entry_date,
      concat('Close period ', v_period.name),
      'accounting_periods',
      p_period_id::text,
      'closing',
      auth.uid()
    )
    returning id into v_entry_id;
  exception
    when unique_violation then
      raise exception 'closing entry already exists';
  end;

  for v_row in
    select
      coa.id as account_id,
      coa.account_type,
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
      if abs(v_amount) > 1e-9 then
        insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo)
        values (
          v_entry_id,
          v_row.account_id,
          greatest(v_amount, 0),
          greatest(-v_amount, 0),
          'Close income'
        );
      end if;
    else
      v_amount := (v_row.debit - v_row.credit);
      if abs(v_amount) > 1e-9 then
        insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo)
        values (
          v_entry_id,
          v_row.account_id,
          greatest(-v_amount, 0),
          greatest(v_amount, 0),
          'Close expense'
        );
      end if;
    end if;
  end loop;

  if abs(v_profit) > 1e-9 then
    insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo)
    values (
      v_entry_id,
      v_retained,
      greatest(-v_profit, 0),
      greatest(v_profit, 0),
      'Retained earnings'
    );
  end if;

  perform public.check_journal_entry_balance(v_entry_id);

  update public.accounting_periods
  set status = 'closed',
      closed_at = now(),
      closed_by = auth.uid()
  where id = p_period_id
    and status <> 'closed';
end;
$$;

revoke all on function public.close_accounting_period(uuid) from public;
revoke execute on function public.close_accounting_period(uuid) from anon;
grant execute on function public.close_accounting_period(uuid) to authenticated;

