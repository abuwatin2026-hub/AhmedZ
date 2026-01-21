-- Ensure helper function exists
create or replace function public.is_owner_or_manager()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.admin_users au
    where au.auth_user_id = auth.uid()
      and au.is_active = true
      and au.role in ('owner','manager')
  );
$$;
-- Create cost_centers table
create table if not exists public.cost_centers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  code text,
  description text,
  is_active boolean default true,
  created_at timestamptz default now()
);
-- RLS for cost_centers
alter table public.cost_centers enable row level security;
drop policy if exists "Enable read access for authenticated users" on public.cost_centers;
create policy "Enable read access for authenticated users" on public.cost_centers
  for select using (auth.role() = 'authenticated');
drop policy if exists "Enable write access for owners and managers" on public.cost_centers;
create policy "Enable write access for owners and managers" on public.cost_centers
  for all using (public.is_owner_or_manager())
  with check (public.is_owner_or_manager());
-- Add cost_center_id to expenses
alter table public.expenses 
add column if not exists cost_center_id uuid references public.cost_centers(id);
-- Add cost_center_id to journal_lines
alter table public.journal_lines
add column if not exists cost_center_id uuid references public.cost_centers(id);
-- Update create_manual_journal_entry to support cost_center_id
create or replace function public.create_manual_journal_entry(
  p_entry_date timestamptz,
  p_memo text,
  p_lines jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_entry_id uuid;
  v_line jsonb;
  v_account_code text;
  v_account_id uuid;
  v_debit numeric;
  v_credit numeric;
  v_memo text;
  v_cost_center_id uuid;
begin
  if not public.is_owner_or_manager() then
    raise exception 'not allowed';
  end if;

  if p_lines is null or jsonb_typeof(p_lines) <> 'array' then
    raise exception 'p_lines must be a json array';
  end if;

  v_memo := nullif(trim(coalesce(p_memo, '')), '');

  insert into public.journal_entries(entry_date, memo, source_table, source_id, source_event, created_by)
  values (
    coalesce(p_entry_date, now()),
    v_memo,
    'manual',
    null,
    null,
    auth.uid()
  )
  returning id into v_entry_id;

  for v_line in select value from jsonb_array_elements(p_lines)
  loop
    v_account_code := nullif(trim(coalesce(v_line->>'accountCode', '')), '');
    v_debit := coalesce(nullif(v_line->>'debit', '')::numeric, 0);
    v_credit := coalesce(nullif(v_line->>'credit', '')::numeric, 0);
    v_cost_center_id := nullif(v_line->>'costCenterId', '')::uuid;

    if v_account_code is null then
      raise exception 'accountCode is required';
    end if;

    if v_debit < 0 or v_credit < 0 then
      raise exception 'invalid debit/credit';
    end if;

    if (v_debit > 0 and v_credit > 0) or (v_debit = 0 and v_credit = 0) then
      raise exception 'invalid line amounts';
    end if;

    v_account_id := public.get_account_id_by_code(v_account_code);
    if v_account_id is null then
      raise exception 'account not found %', v_account_code;
    end if;

    insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo, cost_center_id)
    values (
      v_entry_id,
      v_account_id,
      v_debit,
      v_credit,
      nullif(trim(coalesce(v_line->>'memo', '')), ''),
      v_cost_center_id
    );
  end loop;

  return v_entry_id;
end;
$$;
-- Update trial_balance to filter by cost_center
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
language sql
stable
security definer
set search_path = public
as $$
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
  where public.can_view_reports()
    and (p_cost_center_id is null or jl.cost_center_id = p_cost_center_id)
  group by coa.code, coa.name, coa.account_type, coa.normal_balance
  order by coa.code;
$$;
-- Update income_statement to filter by cost_center
create or replace function public.income_statement(p_start date, p_end date, p_cost_center_id uuid default null)
returns table(
  income numeric,
  expenses numeric,
  net_profit numeric
)
language sql
stable
security definer
set search_path = public
as $$
  with tb as (
    select *
    from public.trial_balance(p_start, p_end, p_cost_center_id)
  )
  select
    coalesce(sum(case when tb.account_type = 'income' then (tb.credit - tb.debit) else 0 end), 0) as income,
    coalesce(sum(case when tb.account_type = 'expense' then (tb.debit - tb.credit) else 0 end), 0) as expenses,
    coalesce(sum(case when tb.account_type = 'income' then (tb.credit - tb.debit) else 0 end), 0)
      - coalesce(sum(case when tb.account_type = 'expense' then (tb.debit - tb.credit) else 0 end), 0) as net_profit
  from tb;
$$;
-- Update balance_sheet to filter by cost_center
create or replace function public.balance_sheet(p_as_of date, p_cost_center_id uuid default null)
returns table(
  assets numeric,
  liabilities numeric,
  equity numeric
)
language sql
stable
security definer
set search_path = public
as $$
  with tb as (
    select *
    from public.trial_balance(null, p_as_of, p_cost_center_id)
  ),
  sums as (
    select
      coalesce(sum(case when tb.account_type = 'asset' then (tb.debit - tb.credit) else 0 end), 0) as assets,
      coalesce(sum(case when tb.account_type = 'liability' then (tb.credit - tb.debit) else 0 end), 0) as liabilities,
      coalesce(sum(case when tb.account_type = 'equity' then (tb.credit - tb.debit) else 0 end), 0) as equity_base,
      coalesce(sum(case when tb.account_type = 'income' then (tb.credit - tb.debit) else 0 end), 0) as income_sum,
      coalesce(sum(case when tb.account_type = 'expense' then (tb.debit - tb.credit) else 0 end), 0) as expense_sum
    from tb
  )
  select
    s.assets,
    s.liabilities,
    (s.equity_base + (s.income_sum - s.expense_sum)) as equity
  from sums s;
$$;
-- Update general_ledger to filter by cost_center
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
language sql
stable
security definer
set search_path = public
as $$
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
    where public.can_view_reports()
      and p_start is not null
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
    where public.can_view_reports()
      and (p_start is null or je.entry_date::date >= p_start)
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
$$;
-- Update cash_flow_statement to filter by cost_center
create or replace function public.cash_flow_statement(p_start date, p_end date, p_cost_center_id uuid default null)
returns table(
  operating_activities numeric,
  investing_activities numeric,
  financing_activities numeric,
  net_cash_flow numeric,
  opening_cash numeric,
  closing_cash numeric
)
language sql
stable
security definer
set search_path = public
as $$
  with cash_accounts as (
    -- Cash and Bank accounts
    select id from public.chart_of_accounts 
    where code in ('1010', '1020') and is_active = true
  ),
  opening as (
    -- Opening cash balance (before start date)
    select coalesce(sum(jl.debit - jl.credit), 0) as opening_balance
    from public.journal_lines jl
    join public.journal_entries je on je.id = jl.journal_entry_id
    where jl.account_id in (select id from cash_accounts)
      and p_start is not null
      and je.entry_date::date < p_start
      and public.can_view_reports()
      and (p_cost_center_id is null or jl.cost_center_id = p_cost_center_id)
  ),
  operating as (
    -- Operating activities: Cash from sales, payments, expenses
    select coalesce(sum(
      case 
        when coa.code in ('1010', '1020') then (jl.debit - jl.credit)
        else 0 
      end
    ), 0) as operating_cash
    from public.journal_lines jl
    join public.journal_entries je on je.id = jl.journal_entry_id
    join public.chart_of_accounts coa on coa.id = jl.account_id
    where public.can_view_reports()
      and (p_start is null or je.entry_date::date >= p_start)
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
    -- Closing cash balance (up to end date)
    select coalesce(sum(jl.debit - jl.credit), 0) as closing_balance
    from public.journal_lines jl
    join public.journal_entries je on je.id = jl.journal_entry_id
    where jl.account_id in (select id from cash_accounts)
      and (p_end is null or je.entry_date::date <= p_end)
      and public.can_view_reports()
      and (p_cost_center_id is null or jl.cost_center_id = p_cost_center_id)
  )
  select
    (select operating_cash from operating) as operating_activities,
    (select investing_cash from investing) as investing_activities,
    (select financing_cash from financing) as financing_activities,
    (select operating_cash from operating) + 
    (select investing_cash from investing) + 
    (select financing_cash from financing) as net_cash_flow,
    (select opening_balance from opening) as opening_cash,
    (select closing_balance from closing) as closing_cash;
$$;
-- Trigger to propagate cost_center_id from expenses to journal_lines (ALL lines)
create or replace function public.sync_expense_cost_center()
returns trigger
language plpgsql
security definer
as $$
declare
  v_entry_id uuid;
begin
  -- Find the journal entry associated with this expense
  select id into v_entry_id
  from public.journal_entries
  where source_table = 'expenses' and source_id = new.id::text;

  if v_entry_id is not null then
    -- Update ALL lines (debit and credit) to match the expense cost center
    -- This ensures the cash side is also tagged, allowing for balanced reporting per cost center for expenses
    update public.journal_lines
    set cost_center_id = new.cost_center_id
    where journal_entry_id = v_entry_id;
  end if;
  
  return new;
end;
$$;
drop trigger if exists trg_sync_expense_cost_center on public.expenses;
create trigger trg_sync_expense_cost_center
after insert or update of cost_center_id on public.expenses
for each row
execute function public.sync_expense_cost_center();
