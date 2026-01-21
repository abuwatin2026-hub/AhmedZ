do $$
begin
  if to_regclass('public.admin_users') is null then
    return;
  end if;
end $$;

create or replace function public.can_view_sales_reports()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.has_admin_permission('reports.view');
$$;

revoke all on function public.can_view_sales_reports() from public;
grant execute on function public.can_view_sales_reports() to anon, authenticated;

create or replace function public.can_view_accounting_reports()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.has_admin_permission('accounting.view');
$$;

revoke all on function public.can_view_accounting_reports() from public;
grant execute on function public.can_view_accounting_reports() to anon, authenticated;

create or replace function public.can_view_reports()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.can_view_sales_reports();
$$;

revoke all on function public.can_view_reports() from public;
grant execute on function public.can_view_reports() to anon, authenticated;

drop policy if exists "Enable read access for authenticated users" on public.cost_centers;
drop policy if exists "Enable write access for owners and managers" on public.cost_centers;
drop policy if exists cost_centers_select on public.cost_centers;
drop policy if exists cost_centers_write on public.cost_centers;

create policy cost_centers_select
on public.cost_centers
for select
using (public.can_manage_expenses() or public.can_view_accounting_reports());

create policy cost_centers_write
on public.cost_centers
for all
using (public.can_manage_expenses())
with check (public.can_manage_expenses());

drop policy if exists accounting_periods_owner_write on public.accounting_periods;
drop policy if exists accounting_periods_write_manage on public.accounting_periods;

create policy accounting_periods_write_manage
on public.accounting_periods
for all
using (public.has_admin_permission('accounting.manage'))
with check (public.has_admin_permission('accounting.manage'));

drop function if exists public.trial_balance(date, date);
drop function if exists public.income_statement(date, date);
drop function if exists public.balance_sheet(date);
drop function if exists public.general_ledger(text, date, date);

create or replace function public.trial_balance(p_start date, p_end date, p_cost_center_id uuid default null)
returns table(
  account_code text,
  account_name text,
  account_type text,
  normal_balance text,
  debit numeric,
  credit numeric,
  balance numeric
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.can_view_accounting_reports() then
    raise exception 'not allowed';
  end if;

  return query
  select
    coa.code as account_code,
    coa.name as account_name,
    coa.account_type,
    coa.normal_balance,
    coalesce(sum(jl.debit), 0) as debit,
    coalesce(sum(jl.credit), 0) as credit,
    coalesce(sum(jl.debit - jl.credit), 0) as balance
  from public.chart_of_accounts coa
  left join public.journal_lines jl on jl.account_id = coa.id
  left join public.journal_entries je
    on je.id = jl.journal_entry_id
   and (p_start is null or je.entry_date::date >= p_start)
   and (p_end is null or je.entry_date::date <= p_end)
  where (p_cost_center_id is null or jl.cost_center_id = p_cost_center_id)
  group by coa.code, coa.name, coa.account_type, coa.normal_balance
  order by coa.code;
end;
$$;

revoke all on function public.trial_balance(date, date, uuid) from public;
revoke execute on function public.trial_balance(date, date, uuid) from anon;
grant execute on function public.trial_balance(date, date, uuid) to authenticated;

create or replace function public.general_ledger(
  p_account_code text,
  p_start date,
  p_end date,
  p_cost_center_id uuid default null
)
returns table(
  entry_date date,
  journal_entry_id uuid,
  memo text,
  source_table text,
  source_id text,
  source_event text,
  debit numeric,
  credit numeric,
  amount numeric,
  running_balance numeric
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.can_view_accounting_reports() then
    raise exception 'not allowed';
  end if;

  return query
  with acct as (
    select coa.id, coa.normal_balance
    from public.chart_of_accounts coa
    where coa.code = p_account_code
    limit 1
  ),
  opening as (
    select coalesce(sum(
      case
        when a.normal_balance = 'credit' then (jl.credit - jl.debit)
        else (jl.debit - jl.credit)
      end
    ), 0) as opening_balance
    from public.journal_lines jl
    join public.journal_entries je on je.id = jl.journal_entry_id
    join acct a on a.id = jl.account_id
    where p_start is not null
      and je.entry_date::date < p_start
      and (p_cost_center_id is null or jl.cost_center_id = p_cost_center_id)
  ),
  lines as (
    select
      je.entry_date::date as entry_date,
      je.id as journal_entry_id,
      je.memo,
      je.source_table,
      je.source_id,
      je.source_event,
      jl.debit,
      jl.credit,
      case
        when a.normal_balance = 'credit' then (jl.credit - jl.debit)
        else (jl.debit - jl.credit)
      end as amount,
      je.created_at as entry_created_at,
      jl.created_at as line_created_at
    from public.journal_lines jl
    join public.journal_entries je on je.id = jl.journal_entry_id
    join acct a on a.id = jl.account_id
    where (p_start is null or je.entry_date::date >= p_start)
      and (p_end is null or je.entry_date::date <= p_end)
      and (p_cost_center_id is null or jl.cost_center_id = p_cost_center_id)
  )
  select
    l.entry_date,
    l.journal_entry_id,
    l.memo,
    l.source_table,
    l.source_id,
    l.source_event,
    l.debit,
    l.credit,
    l.amount,
    (select opening_balance from opening)
      + sum(l.amount) over (order by l.entry_date, l.entry_created_at, l.line_created_at, l.journal_entry_id) as running_balance
  from lines l
  order by l.entry_date, l.entry_created_at, l.line_created_at, l.journal_entry_id;
end;
$$;

revoke all on function public.general_ledger(text, date, date, uuid) from public;
revoke execute on function public.general_ledger(text, date, date, uuid) from anon;
grant execute on function public.general_ledger(text, date, date, uuid) to authenticated;

create or replace function public.cash_flow_statement(p_start date, p_end date, p_cost_center_id uuid default null)
returns table(
  operating_activities numeric,
  investing_activities numeric,
  financing_activities numeric,
  net_cash_flow numeric,
  opening_cash numeric,
  closing_cash numeric
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.can_view_accounting_reports() then
    raise exception 'not allowed';
  end if;

  return query
  with cash_accounts as (
    select id from public.chart_of_accounts
    where code in ('1010', '1020') and is_active = true
  ),
  opening as (
    select coalesce(sum(jl.debit - jl.credit), 0) as opening_balance
    from public.journal_lines jl
    join public.journal_entries je on je.id = jl.journal_entry_id
    where jl.account_id in (select id from cash_accounts)
      and p_start is not null
      and je.entry_date::date < p_start
      and (p_cost_center_id is null or jl.cost_center_id = p_cost_center_id)
  ),
  operating as (
    select coalesce(sum(
      case
        when coa.code in ('1010', '1020') then (jl.debit - jl.credit)
        else 0
      end
    ), 0) as operating_cash
    from public.journal_lines jl
    join public.journal_entries je on je.id = jl.journal_entry_id
    join public.chart_of_accounts coa on coa.id = jl.account_id
    where (p_start is null or je.entry_date::date >= p_start)
      and (p_end is null or je.entry_date::date <= p_end)
      and je.source_table in ('orders', 'payments', 'expenses', 'sales_returns', 'cash_shifts')
      and (p_cost_center_id is null or jl.cost_center_id = p_cost_center_id)
  ),
  investing as (
    select 0::numeric as investing_cash
  ),
  financing as (
    select 0::numeric as financing_cash
  ),
  closing as (
    select coalesce(sum(jl.debit - jl.credit), 0) as closing_balance
    from public.journal_lines jl
    join public.journal_entries je on je.id = jl.journal_entry_id
    where jl.account_id in (select id from cash_accounts)
      and (p_end is null or je.entry_date::date <= p_end)
      and (p_cost_center_id is null or jl.cost_center_id = p_cost_center_id)
  )
  select
    (select operating_cash from operating) as operating_activities,
    (select investing_cash from investing) as investing_activities,
    (select financing_cash from financing) as financing_activities,
    (select operating_cash from operating)
      + (select investing_cash from investing)
      + (select financing_cash from financing) as net_cash_flow,
    (select opening_balance from opening) as opening_cash,
    (select closing_balance from closing) as closing_cash;
end;
$$;

revoke all on function public.cash_flow_statement(date, date, uuid) from public;
revoke execute on function public.cash_flow_statement(date, date, uuid) from anon;
grant execute on function public.cash_flow_statement(date, date, uuid) to authenticated;

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
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.can_view_accounting_reports() then
    raise exception 'not allowed';
  end if;

  return query
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
    where (p_cost_center_id is null or jl.cost_center_id = p_cost_center_id)
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
end;
$$;

revoke all on function public.income_statement_series(date, date, uuid) from public;
revoke execute on function public.income_statement_series(date, date, uuid) from anon;
grant execute on function public.income_statement_series(date, date, uuid) to authenticated;

