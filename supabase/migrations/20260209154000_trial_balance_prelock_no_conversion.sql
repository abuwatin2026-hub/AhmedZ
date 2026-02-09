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
  v_lock_date date;
begin
  if not public.can_view_accounting_reports() then
    raise exception 'not allowed';
  end if;

  select s.locked_at::date
  into v_lock_date
  from public.base_currency_restatement_state s
  where s.id = 'sar_base_lock'
  limit 1;

  return query
  with eligible_entries as (
    select je.*
    from public.journal_entries je
    where (p_start is null or je.entry_date::date >= p_start)
      and (p_end is null or je.entry_date::date <= p_end)
      and (p_journal_id is null or je.journal_id = p_journal_id)
      and coalesce(je.source_table,'') <> 'base_currency_migration'
  ),
  filtered_lines as (
    select
      jl.account_id,
      case
        when v_lock_date is not null and e.entry_date::date < v_lock_date then coalesce(jl.debit,0)
        when jl.currency_code is not null
          and upper(jl.currency_code) <> upper(v_base)
          and jl.foreign_amount is not null
          and coalesce(jl.fx_rate, public.get_fx_rate(jl.currency_code, e.entry_date::date, 'accounting')) is not null
          and jl.debit > 0
          then public._money_round(jl.foreign_amount * coalesce(jl.fx_rate, public.get_fx_rate(jl.currency_code, e.entry_date::date, 'accounting')))
        else coalesce(jl.debit,0)
      end as debit,
      case
        when v_lock_date is not null and e.entry_date::date < v_lock_date then coalesce(jl.credit,0)
        when jl.currency_code is not null
          and upper(jl.currency_code) <> upper(v_base)
          and jl.foreign_amount is not null
          and coalesce(jl.fx_rate, public.get_fx_rate(jl.currency_code, e.entry_date::date, 'accounting')) is not null
          and jl.credit > 0
          then public._money_round(jl.foreign_amount * coalesce(jl.fx_rate, public.get_fx_rate(jl.currency_code, e.entry_date::date, 'accounting')))
        else coalesce(jl.credit,0)
      end as credit
    from eligible_entries e
    join public.journal_lines jl
      on jl.journal_entry_id = e.id
    where (p_cost_center_id is null or jl.cost_center_id = p_cost_center_id)
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

notify pgrst, 'reload schema';

