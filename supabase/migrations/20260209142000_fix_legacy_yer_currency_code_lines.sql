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
        when jl.currency_code is not null
          and upper(jl.currency_code) <> upper(v_base)
          and jl.foreign_amount is not null
          and coalesce(jl.fx_rate, public.get_fx_rate(jl.currency_code, je.entry_date::date, 'accounting')) is not null
          and jl.debit > 0
          then public._money_round(jl.foreign_amount * coalesce(jl.fx_rate, public.get_fx_rate(jl.currency_code, je.entry_date::date, 'accounting')))
        when v_old_base is not null
          and v_lock_date is not null
          and je.entry_date::date < v_lock_date
          and (
            jl.currency_code is null
            or (upper(jl.currency_code) = upper(v_old_base) and (jl.foreign_amount is null or jl.fx_rate is null))
          )
          and not exists (
            select 1
            from public.base_currency_restatement_entry_map m
            where m.original_journal_entry_id = je.id
              and m.status = 'restated'
              and m.restated_journal_entry_id is not null
          )
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
        when jl.currency_code is not null
          and upper(jl.currency_code) <> upper(v_base)
          and jl.foreign_amount is not null
          and coalesce(jl.fx_rate, public.get_fx_rate(jl.currency_code, je.entry_date::date, 'accounting')) is not null
          and jl.credit > 0
          then public._money_round(jl.foreign_amount * coalesce(jl.fx_rate, public.get_fx_rate(jl.currency_code, je.entry_date::date, 'accounting')))
        when v_old_base is not null
          and v_lock_date is not null
          and je.entry_date::date < v_lock_date
          and (
            jl.currency_code is null
            or (upper(jl.currency_code) = upper(v_old_base) and (jl.foreign_amount is null or jl.fx_rate is null))
          )
          and not exists (
            select 1
            from public.base_currency_restatement_entry_map m
            where m.original_journal_entry_id = je.id
              and m.status = 'restated'
              and m.restated_journal_entry_id is not null
          )
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

notify pgrst, 'reload schema';

