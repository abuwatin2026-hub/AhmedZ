create or replace function public.income_statement_series(
  p_start date,
  p_end date,
  p_cost_center_id uuid default null
)
returns table(
  period date,
  income numeric,
  expenses numeric,
  net_profit numeric
)
language sql
stable
security definer
set search_path = public
as $$
  with series as (
    select date_trunc('month', gs)::date as period
    from generate_series(
      coalesce(p_start, current_date),
      coalesce(p_end, current_date),
      interval '1 month'
    ) gs
  ),
  joined as (
    select
      s.period,
      coa.account_type,
      jl.debit,
      jl.credit
    from series s
    left join public.journal_entries je
      on je.entry_date::date >= s.period
     and je.entry_date::date < (s.period + interval '1 month')::date
    left join public.journal_lines jl
      on jl.journal_entry_id = je.id
    left join public.chart_of_accounts coa
      on coa.id = jl.account_id
    where public.can_view_reports()
      and (p_cost_center_id is null or jl.cost_center_id = p_cost_center_id)
  )
  select
    j.period,
    coalesce(sum(case when j.account_type = 'income' then (j.credit - j.debit) else 0 end), 0) as income,
    coalesce(sum(case when j.account_type = 'expense' then (j.debit - j.credit) else 0 end), 0) as expenses,
    coalesce(sum(case when j.account_type = 'income' then (j.credit - j.debit) else 0 end), 0)
      - coalesce(sum(case when j.account_type = 'expense' then (j.debit - j.credit) else 0 end), 0) as net_profit
  from joined j
  group by j.period
  order by j.period;
$$;
revoke all on function public.income_statement_series(date, date, uuid) from public;
revoke execute on function public.income_statement_series(date, date, uuid) from anon;
grant execute on function public.income_statement_series(date, date, uuid) to authenticated;
