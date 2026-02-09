set app.allow_ledger_ddl = '1';

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
declare
  v_base text := public.get_base_currency();
  v_old_base text;
  v_lock_date date;
begin
  if not public.can_view_accounting_reports() then
    raise exception 'not allowed';
  end if;

  select s.old_base_currency, s.locked_at::date
  into v_old_base, v_lock_date
  from public.base_currency_restatement_state s
  where s.id = 'sar_base_lock'
  limit 1;

  return query
  with filtered_lines as (
    select
      jl.account_id,
      case
        when coalesce(je.source_table,'') in ('base_currency_restatement','base_currency_migration') then 0
        when jl.currency_code is not null
          and upper(jl.currency_code) <> upper(v_base)
          and jl.foreign_amount is not null
          and coalesce(jl.fx_rate, public.get_fx_rate(jl.currency_code, je.entry_date::date, 'accounting')) is not null
          and jl.debit > 0
          then public._money_round(jl.foreign_amount * coalesce(jl.fx_rate, public.get_fx_rate(jl.currency_code, je.entry_date::date, 'accounting')))
        when jl.currency_code is null
          and v_old_base is not null
          and v_lock_date is not null
          and je.entry_date::date < v_lock_date
          and coalesce(
            public.get_fx_rate(v_old_base, je.entry_date::date, 'accounting'),
            public.get_fx_rate(v_old_base, je.entry_date::date, 'operational'),
            public.get_fx_rate(v_old_base, v_lock_date, 'accounting'),
            public.get_fx_rate(v_old_base, v_lock_date, 'operational')
          ) is not null
          and coalesce(
            public.get_fx_rate(v_old_base, je.entry_date::date, 'accounting'),
            public.get_fx_rate(v_old_base, je.entry_date::date, 'operational'),
            public.get_fx_rate(v_old_base, v_lock_date, 'accounting'),
            public.get_fx_rate(v_old_base, v_lock_date, 'operational')
          ) > 0
          and jl.debit > 0
          then public._money_round(jl.debit * coalesce(
            public.get_fx_rate(v_old_base, je.entry_date::date, 'accounting'),
            public.get_fx_rate(v_old_base, je.entry_date::date, 'operational'),
            public.get_fx_rate(v_old_base, v_lock_date, 'accounting'),
            public.get_fx_rate(v_old_base, v_lock_date, 'operational')
          ))
        else jl.debit
      end as debit,
      case
        when coalesce(je.source_table,'') in ('base_currency_restatement','base_currency_migration') then 0
        when jl.currency_code is not null
          and upper(jl.currency_code) <> upper(v_base)
          and jl.foreign_amount is not null
          and coalesce(jl.fx_rate, public.get_fx_rate(jl.currency_code, je.entry_date::date, 'accounting')) is not null
          and jl.credit > 0
          then public._money_round(jl.foreign_amount * coalesce(jl.fx_rate, public.get_fx_rate(jl.currency_code, je.entry_date::date, 'accounting')))
        when jl.currency_code is null
          and v_old_base is not null
          and v_lock_date is not null
          and je.entry_date::date < v_lock_date
          and coalesce(
            public.get_fx_rate(v_old_base, je.entry_date::date, 'accounting'),
            public.get_fx_rate(v_old_base, je.entry_date::date, 'operational'),
            public.get_fx_rate(v_old_base, v_lock_date, 'accounting'),
            public.get_fx_rate(v_old_base, v_lock_date, 'operational')
          ) is not null
          and coalesce(
            public.get_fx_rate(v_old_base, je.entry_date::date, 'accounting'),
            public.get_fx_rate(v_old_base, je.entry_date::date, 'operational'),
            public.get_fx_rate(v_old_base, v_lock_date, 'accounting'),
            public.get_fx_rate(v_old_base, v_lock_date, 'operational')
          ) > 0
          and jl.credit > 0
          then public._money_round(jl.credit * coalesce(
            public.get_fx_rate(v_old_base, je.entry_date::date, 'accounting'),
            public.get_fx_rate(v_old_base, je.entry_date::date, 'operational'),
            public.get_fx_rate(v_old_base, v_lock_date, 'accounting'),
            public.get_fx_rate(v_old_base, v_lock_date, 'operational')
          ))
        else jl.credit
      end as credit
    from public.journal_entries je
    join public.journal_lines jl
      on jl.journal_entry_id = je.id
    where (p_start is null or je.entry_date::date >= p_start)
      and (p_end is null or je.entry_date::date <= p_end)
      and (p_journal_id is null or je.journal_id = p_journal_id)
      and (p_cost_center_id is null or jl.cost_center_id = p_cost_center_id)
  )
  select
    coa.code as account_code,
    coa.name as account_name,
    coa.account_type,
    coa.normal_balance,
    coalesce(sum(fl.debit), 0) as debit,
    coalesce(sum(fl.credit), 0) as credit,
    coalesce(sum(fl.debit - fl.credit), 0) as balance
  from public.chart_of_accounts coa
  left join filtered_lines fl
    on fl.account_id = coa.id
  group by coa.code, coa.name, coa.account_type, coa.normal_balance
  order by coa.code;
end;
$$;

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
  with state as (
    select
      public.get_base_currency() as base,
      s.old_base_currency as old_base,
      s.locked_at::date as lock_date
    from public.base_currency_restatement_state s
    where s.id = 'sar_base_lock'
    limit 1
  ),
  acct as (
    select coa.id, coa.normal_balance
    from public.chart_of_accounts coa
    where coa.code = p_account_code
    limit 1
  ),
  opening as (
    select coalesce(sum(
      case
        when a.normal_balance = 'credit' then (x.credit - x.debit)
        else (x.debit - x.credit)
      end
    ), 0) as opening_balance
    from (
      select
        case
          when coalesce(je.source_table,'') in ('base_currency_restatement','base_currency_migration') then 0
          when jl.currency_code is not null
            and upper(jl.currency_code) <> upper(st.base)
            and jl.foreign_amount is not null
            and coalesce(jl.fx_rate, public.get_fx_rate(jl.currency_code, je.entry_date::date, 'accounting')) is not null
            and jl.debit > 0
            then public._money_round(jl.foreign_amount * coalesce(jl.fx_rate, public.get_fx_rate(jl.currency_code, je.entry_date::date, 'accounting')))
          when jl.currency_code is null
            and st.old_base is not null
            and st.lock_date is not null
            and je.entry_date::date < st.lock_date
            and coalesce(
              public.get_fx_rate(st.old_base, je.entry_date::date, 'accounting'),
              public.get_fx_rate(st.old_base, je.entry_date::date, 'operational'),
              public.get_fx_rate(st.old_base, st.lock_date, 'accounting'),
              public.get_fx_rate(st.old_base, st.lock_date, 'operational')
            ) is not null
            and coalesce(
              public.get_fx_rate(st.old_base, je.entry_date::date, 'accounting'),
              public.get_fx_rate(st.old_base, je.entry_date::date, 'operational'),
              public.get_fx_rate(st.old_base, st.lock_date, 'accounting'),
              public.get_fx_rate(st.old_base, st.lock_date, 'operational')
            ) > 0
            and jl.debit > 0
            then public._money_round(jl.debit * coalesce(
              public.get_fx_rate(st.old_base, je.entry_date::date, 'accounting'),
              public.get_fx_rate(st.old_base, je.entry_date::date, 'operational'),
              public.get_fx_rate(st.old_base, st.lock_date, 'accounting'),
              public.get_fx_rate(st.old_base, st.lock_date, 'operational')
            ))
          else jl.debit
        end as debit,
        case
          when coalesce(je.source_table,'') in ('base_currency_restatement','base_currency_migration') then 0
          when jl.currency_code is not null
            and upper(jl.currency_code) <> upper(st.base)
            and jl.foreign_amount is not null
            and coalesce(jl.fx_rate, public.get_fx_rate(jl.currency_code, je.entry_date::date, 'accounting')) is not null
            and jl.credit > 0
            then public._money_round(jl.foreign_amount * coalesce(jl.fx_rate, public.get_fx_rate(jl.currency_code, je.entry_date::date, 'accounting')))
          when jl.currency_code is null
            and st.old_base is not null
            and st.lock_date is not null
            and je.entry_date::date < st.lock_date
            and coalesce(
              public.get_fx_rate(st.old_base, je.entry_date::date, 'accounting'),
              public.get_fx_rate(st.old_base, je.entry_date::date, 'operational'),
              public.get_fx_rate(st.old_base, st.lock_date, 'accounting'),
              public.get_fx_rate(st.old_base, st.lock_date, 'operational')
            ) is not null
            and coalesce(
              public.get_fx_rate(st.old_base, je.entry_date::date, 'accounting'),
              public.get_fx_rate(st.old_base, je.entry_date::date, 'operational'),
              public.get_fx_rate(st.old_base, st.lock_date, 'accounting'),
              public.get_fx_rate(st.old_base, st.lock_date, 'operational')
            ) > 0
            and jl.credit > 0
            then public._money_round(jl.credit * coalesce(
              public.get_fx_rate(st.old_base, je.entry_date::date, 'accounting'),
              public.get_fx_rate(st.old_base, je.entry_date::date, 'operational'),
              public.get_fx_rate(st.old_base, st.lock_date, 'accounting'),
              public.get_fx_rate(st.old_base, st.lock_date, 'operational')
            ))
          else jl.credit
        end as credit
      from public.journal_lines jl
      join public.journal_entries je on je.id = jl.journal_entry_id
      join acct a on a.id = jl.account_id
      cross join state st
      where public.can_view_reports()
        and p_start is not null
        and je.entry_date::date < p_start
        and (p_cost_center_id is null or jl.cost_center_id = p_cost_center_id)
    ) x
    join acct a on true
  ),
  lines as (
    select
      je.entry_date::date as entry_date,
      je.id as journal_entry_id,
      je.memo,
      je.source_table,
      je.source_id,
      je.source_event,
      x.debit,
      x.credit,
      case
        when a.normal_balance = 'credit' then (x.credit - x.debit)
        else (x.debit - x.credit)
      end as amount,
      je.created_at as entry_created_at,
      jl.created_at as line_created_at
    from public.journal_lines jl
    join public.journal_entries je on je.id = jl.journal_entry_id
    join acct a on a.id = jl.account_id
    cross join state st
    left join lateral (
      select
        case
          when coalesce(je.source_table,'') in ('base_currency_restatement','base_currency_migration') then 0
          when jl.currency_code is not null
            and upper(jl.currency_code) <> upper(st.base)
            and jl.foreign_amount is not null
            and coalesce(jl.fx_rate, public.get_fx_rate(jl.currency_code, je.entry_date::date, 'accounting')) is not null
            and jl.debit > 0
            then public._money_round(jl.foreign_amount * coalesce(jl.fx_rate, public.get_fx_rate(jl.currency_code, je.entry_date::date, 'accounting')))
          when jl.currency_code is null
            and st.old_base is not null
            and st.lock_date is not null
            and je.entry_date::date < st.lock_date
            and coalesce(
              public.get_fx_rate(st.old_base, je.entry_date::date, 'accounting'),
              public.get_fx_rate(st.old_base, je.entry_date::date, 'operational'),
              public.get_fx_rate(st.old_base, st.lock_date, 'accounting'),
              public.get_fx_rate(st.old_base, st.lock_date, 'operational')
            ) is not null
            and coalesce(
              public.get_fx_rate(st.old_base, je.entry_date::date, 'accounting'),
              public.get_fx_rate(st.old_base, je.entry_date::date, 'operational'),
              public.get_fx_rate(st.old_base, st.lock_date, 'accounting'),
              public.get_fx_rate(st.old_base, st.lock_date, 'operational')
            ) > 0
            and jl.debit > 0
            then public._money_round(jl.debit * coalesce(
              public.get_fx_rate(st.old_base, je.entry_date::date, 'accounting'),
              public.get_fx_rate(st.old_base, je.entry_date::date, 'operational'),
              public.get_fx_rate(st.old_base, st.lock_date, 'accounting'),
              public.get_fx_rate(st.old_base, st.lock_date, 'operational')
            ))
          else jl.debit
        end as debit,
        case
          when coalesce(je.source_table,'') in ('base_currency_restatement','base_currency_migration') then 0
          when jl.currency_code is not null
            and upper(jl.currency_code) <> upper(st.base)
            and jl.foreign_amount is not null
            and coalesce(jl.fx_rate, public.get_fx_rate(jl.currency_code, je.entry_date::date, 'accounting')) is not null
            and jl.credit > 0
            then public._money_round(jl.foreign_amount * coalesce(jl.fx_rate, public.get_fx_rate(jl.currency_code, je.entry_date::date, 'accounting')))
          when jl.currency_code is null
            and st.old_base is not null
            and st.lock_date is not null
            and je.entry_date::date < st.lock_date
            and coalesce(
              public.get_fx_rate(st.old_base, je.entry_date::date, 'accounting'),
              public.get_fx_rate(st.old_base, je.entry_date::date, 'operational'),
              public.get_fx_rate(st.old_base, st.lock_date, 'accounting'),
              public.get_fx_rate(st.old_base, st.lock_date, 'operational')
            ) is not null
            and coalesce(
              public.get_fx_rate(st.old_base, je.entry_date::date, 'accounting'),
              public.get_fx_rate(st.old_base, je.entry_date::date, 'operational'),
              public.get_fx_rate(st.old_base, st.lock_date, 'accounting'),
              public.get_fx_rate(st.old_base, st.lock_date, 'operational')
            ) > 0
            and jl.credit > 0
            then public._money_round(jl.credit * coalesce(
              public.get_fx_rate(st.old_base, je.entry_date::date, 'accounting'),
              public.get_fx_rate(st.old_base, je.entry_date::date, 'operational'),
              public.get_fx_rate(st.old_base, st.lock_date, 'accounting'),
              public.get_fx_rate(st.old_base, st.lock_date, 'operational')
            ))
          else jl.credit
        end as credit
    ) x on true
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

notify pgrst, 'reload schema';
