set app.allow_ledger_ddl = '1';

do $$
begin
  if to_regclass('public.journals') is null then
    create table public.journals (
      id uuid primary key,
      code text not null unique,
      name text not null,
      description text,
      is_default boolean not null default false,
      is_active boolean not null default true,
      created_at timestamptz not null default now(),
      created_by uuid references auth.users(id) on delete set null
    );
  end if;
exception when others then
  null;
end $$;

alter table public.journals enable row level security;

drop policy if exists journals_select on public.journals;
create policy journals_select
on public.journals
for select
using (public.has_admin_permission('accounting.view'));

drop policy if exists journals_write on public.journals;
create policy journals_write
on public.journals
for all
using (public.has_admin_permission('accounting.manage'))
with check (public.has_admin_permission('accounting.manage'));

drop policy if exists journals_delete_none on public.journals;
create policy journals_delete_none
on public.journals
for delete
using (false);

create unique index if not exists uq_journals_single_default
on public.journals((is_default))
where is_default = true;

do $$
declare
  v_default_id uuid := '00000000-0000-4000-8000-000000000001'::uuid;
begin
  insert into public.journals(id, code, name, is_default, is_active)
  values (v_default_id, 'GEN', 'دفتر اليومية العام', true, true)
  on conflict (code) do update
  set name = excluded.name,
      is_active = true;

  update public.journals
  set is_default = (id = v_default_id)
  where is_default = true or id = v_default_id;
exception when others then
  null;
end $$;

do $$
begin
  if to_regclass('public.journal_entries') is null then
    return;
  end if;
  begin
    alter table public.journal_entries
      add column if not exists journal_id uuid not null default '00000000-0000-4000-8000-000000000001'::uuid;
  exception when others then
    null;
  end;

  begin
    alter table public.journal_entries
      add constraint journal_entries_journal_id_fk
      foreign key (journal_id) references public.journals(id) on delete restrict;
  exception when duplicate_object then
    null;
  end;
end $$;

create index if not exists idx_journal_entries_journal_date
on public.journal_entries(journal_id, entry_date);

create or replace function public.set_default_journal(p_journal_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.has_admin_permission('accounting.manage') then
    raise exception 'not allowed';
  end if;
  if p_journal_id is null then
    raise exception 'p_journal_id is required';
  end if;
  if not exists (select 1 from public.journals j where j.id = p_journal_id and j.is_active = true) then
    raise exception 'journal not found';
  end if;
  update public.journals set is_default = false where is_default = true and id <> p_journal_id;
  update public.journals set is_default = true where id = p_journal_id;
end;
$$;

revoke all on function public.set_default_journal(uuid) from public;
grant execute on function public.set_default_journal(uuid) to authenticated;

create or replace function public.get_default_journal_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select j.id
  from public.journals j
  where j.is_default = true and j.is_active = true
  order by j.created_at asc
  limit 1
$$;

revoke all on function public.get_default_journal_id() from public;
grant execute on function public.get_default_journal_id() to authenticated;

create or replace function public.trg_set_journal_entry_journal_id()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_default uuid;
begin
  if new.journal_id is not null then
    return new;
  end if;
  v_default := public.get_default_journal_id();
  new.journal_id := coalesce(v_default, '00000000-0000-4000-8000-000000000001'::uuid);
  return new;
end;
$$;

drop trigger if exists trg_journal_entries_set_journal_id on public.journal_entries;
create trigger trg_journal_entries_set_journal_id
before insert on public.journal_entries
for each row execute function public.trg_set_journal_entry_journal_id();

create or replace function public.create_manual_journal_entry(
  p_entry_date timestamptz,
  p_memo text,
  p_lines jsonb,
  p_journal_id uuid default null
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
  v_journal_id uuid;
begin
  if not public.is_owner_or_manager() then
    raise exception 'not allowed';
  end if;

  if p_lines is null or jsonb_typeof(p_lines) <> 'array' then
    raise exception 'p_lines must be a json array';
  end if;

  v_memo := nullif(trim(coalesce(p_memo, '')), '');
  v_journal_id := coalesce(p_journal_id, public.get_default_journal_id(), '00000000-0000-4000-8000-000000000001'::uuid);

  insert into public.journal_entries(entry_date, memo, source_table, source_id, source_event, created_by, journal_id)
  values (
    coalesce(p_entry_date, now()),
    v_memo,
    'manual',
    null,
    null,
    auth.uid(),
    v_journal_id
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

    select id into v_account_id
    from public.chart_of_accounts
    where code = v_account_code
      and is_active = true
    limit 1;
    if v_account_id is null then
      raise exception 'account not found: %', v_account_code;
    end if;

    if (v_debit > 0 and v_credit > 0) or (v_debit = 0 and v_credit = 0) then
      raise exception 'either debit or credit must be > 0';
    end if;

    v_memo := nullif(trim(coalesce(v_line->>'memo', '')), '');

    insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo, cost_center_id)
    values (v_entry_id, v_account_id, v_debit, v_credit, v_memo, v_cost_center_id);
  end loop;

  perform public.check_journal_entry_balance(v_entry_id);
  return v_entry_id;
end;
$$;

revoke all on function public.create_manual_journal_entry(timestamptz, text, jsonb, uuid) from public;
grant execute on function public.create_manual_journal_entry(timestamptz, text, jsonb, uuid) to authenticated;

create or replace function public.trial_balance(
  p_start date,
  p_end date,
  p_cost_center_id uuid default null,
  p_journal_id uuid default null
)
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
   and (p_journal_id is null or je.journal_id = p_journal_id)
  where (p_cost_center_id is null or jl.cost_center_id = p_cost_center_id)
  group by coa.code, coa.name, coa.account_type, coa.normal_balance
  order by coa.code;
end;
$$;

revoke all on function public.trial_balance(date, date, uuid, uuid) from public;
revoke execute on function public.trial_balance(date, date, uuid, uuid) from anon;
grant execute on function public.trial_balance(date, date, uuid, uuid) to authenticated;

create or replace function public.general_ledger(
  p_account_code text,
  p_start date,
  p_end date,
  p_cost_center_id uuid default null,
  p_journal_id uuid default null
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
      and (p_journal_id is null or je.journal_id = p_journal_id)
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
      and (p_journal_id is null or je.journal_id = p_journal_id)
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

revoke all on function public.general_ledger(text, date, date, uuid, uuid) from public;
revoke execute on function public.general_ledger(text, date, date, uuid, uuid) from anon;
grant execute on function public.general_ledger(text, date, date, uuid, uuid) to authenticated;

create or replace function public.cash_flow_statement(
  p_start date,
  p_end date,
  p_cost_center_id uuid default null,
  p_journal_id uuid default null
)
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
      and (p_journal_id is null or je.journal_id = p_journal_id)
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
      and (p_journal_id is null or je.journal_id = p_journal_id)
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
      and (p_journal_id is null or je.journal_id = p_journal_id)
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

revoke all on function public.cash_flow_statement(date, date, uuid, uuid) from public;
revoke execute on function public.cash_flow_statement(date, date, uuid, uuid) from anon;
grant execute on function public.cash_flow_statement(date, date, uuid, uuid) to authenticated;

create or replace function public.income_statement(p_start date, p_end date, p_cost_center_id uuid default null, p_journal_id uuid default null)
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
    from public.trial_balance(p_start, p_end, p_cost_center_id, p_journal_id)
  )
  select
    coalesce(sum(case when tb.account_type = 'income' then (tb.credit - tb.debit) else 0 end), 0) as income,
    coalesce(sum(case when tb.account_type = 'expense' then (tb.debit - tb.credit) else 0 end), 0) as expenses,
    coalesce(sum(case when tb.account_type = 'income' then (tb.credit - tb.debit) else 0 end), 0)
      - coalesce(sum(case when tb.account_type = 'expense' then (tb.debit - tb.credit) else 0 end), 0) as net_profit
  from tb;
$$;

revoke all on function public.income_statement(date, date, uuid, uuid) from public;
revoke execute on function public.income_statement(date, date, uuid, uuid) from anon;
grant execute on function public.income_statement(date, date, uuid, uuid) to authenticated;

create or replace function public.balance_sheet(p_as_of date, p_cost_center_id uuid default null, p_journal_id uuid default null)
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
    from public.trial_balance(null, p_as_of, p_cost_center_id, p_journal_id)
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

revoke all on function public.balance_sheet(date, uuid, uuid) from public;
revoke execute on function public.balance_sheet(date, uuid, uuid) from anon;
grant execute on function public.balance_sheet(date, uuid, uuid) to authenticated;

create or replace function public.income_statement_series(
  p_start date,
  p_end date,
  p_cost_center_id uuid default null,
  p_journal_id uuid default null
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
     and (p_journal_id is null or je.journal_id = p_journal_id)
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

revoke all on function public.income_statement_series(date, date, uuid, uuid) from public;
revoke execute on function public.income_statement_series(date, date, uuid, uuid) from anon;
grant execute on function public.income_statement_series(date, date, uuid, uuid) to authenticated;

notify pgrst, 'reload schema';

