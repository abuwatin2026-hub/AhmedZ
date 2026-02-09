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
begin
  if not public.can_view_accounting_reports() then
    raise exception 'not allowed';
  end if;

  return query
  with filtered_lines as (
    select
      jl.account_id,
      jl.debit,
      jl.credit
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
  select *
  from public.trial_balance(p_start, p_end, p_cost_center_id, null);
$$;

create or replace function public.trial_balance(p_start date, p_end date)
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
  select *
  from public.trial_balance(p_start, p_end, null, null);
$$;

create or replace function public.trial_balance_by_range(p_start date, p_end date)
returns table(
  account_code text,
  account_name text,
  account_type text,
  normal_balance text,
  opening_balance numeric,
  total_debits numeric,
  total_credits numeric,
  closing_balance numeric
)
language sql
stable
security definer
set search_path = public
as $$
  with opening_lines as (
    select
      jl.account_id,
      jl.debit,
      jl.credit,
      coa.normal_balance
    from public.journal_entries je
    join public.journal_lines jl
      on jl.journal_entry_id = je.id
    join public.chart_of_accounts coa
      on coa.id = jl.account_id
    where p_start is not null
      and je.entry_date::date < p_start
  ),
  period_lines as (
    select
      jl.account_id,
      jl.debit,
      jl.credit,
      coa.normal_balance
    from public.journal_entries je
    join public.journal_lines jl
      on jl.journal_entry_id = je.id
    join public.chart_of_accounts coa
      on coa.id = jl.account_id
    where (p_start is null or je.entry_date::date >= p_start)
      and (p_end is null or je.entry_date::date <= p_end)
  ),
  opening as (
    select
      coa.id as account_id,
      coalesce(sum(
        case
          when ol.normal_balance = 'debit' then (ol.debit - ol.credit)
          else (ol.credit - ol.debit)
        end
      ), 0) as opening_balance
    from public.chart_of_accounts coa
    left join opening_lines ol
      on ol.account_id = coa.id
    where coa.is_active = true
    group by coa.id
  ),
  period as (
    select
      coa.id as account_id,
      coalesce(sum(pl.debit), 0) as total_debits,
      coalesce(sum(pl.credit), 0) as total_credits,
      coalesce(sum(
        case
          when pl.normal_balance = 'debit' then (pl.debit - pl.credit)
          else (pl.credit - pl.debit)
        end
      ), 0) as period_delta
    from public.chart_of_accounts coa
    left join period_lines pl
      on pl.account_id = coa.id
    where coa.is_active = true
    group by coa.id
  )
  select
    coa.code as account_code,
    coa.name as account_name,
    coa.account_type,
    coa.normal_balance,
    o.opening_balance,
    p.total_debits,
    p.total_credits,
    (o.opening_balance + p.period_delta) as closing_balance
  from public.chart_of_accounts coa
  join opening o on o.account_id = coa.id
  join period p on p.account_id = coa.id
  where public.has_admin_permission('accounting.view')
  order by coa.code;
$$;

revoke all on function public.trial_balance(date, date, uuid, uuid) from public;
revoke execute on function public.trial_balance(date, date, uuid, uuid) from anon;
grant execute on function public.trial_balance(date, date, uuid, uuid) to authenticated;

revoke all on function public.trial_balance(date, date, uuid) from public;
revoke execute on function public.trial_balance(date, date, uuid) from anon;
grant execute on function public.trial_balance(date, date, uuid) to authenticated;

revoke all on function public.trial_balance(date, date) from public;
revoke execute on function public.trial_balance(date, date) from anon;
grant execute on function public.trial_balance(date, date) to authenticated;

revoke all on function public.trial_balance_by_range(date, date) from public;
revoke execute on function public.trial_balance_by_range(date, date) from anon;
grant execute on function public.trial_balance_by_range(date, date) to authenticated;

notify pgrst, 'reload schema';

