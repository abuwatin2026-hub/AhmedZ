set app.allow_ledger_ddl = '1';

create or replace view public.enterprise_gl_lines as
select
  je.entry_date::date as entry_date,
  je.id as journal_entry_id,
  jl.id as journal_line_id,
  je.memo as entry_memo,
  je.source_table,
  je.source_id,
  je.source_event,
  je.company_id,
  je.branch_id,
  je.journal_id,
  je.document_id,
  jl.account_id,
  coa.code as account_code,
  coa.name as account_name,
  coa.account_type,
  coa.normal_balance,
  coa.ifrs_statement,
  coa.ifrs_category,
  coa.ifrs_line,
  case
    when jl.currency_code is not null
      and upper(jl.currency_code) <> upper(public.get_base_currency())
      and coalesce(jl.fx_rate, public.get_fx_rate(jl.currency_code, je.entry_date::date, 'accounting')) is not null
      and jl.foreign_amount is not null
      and jl.debit > 0
      then public._money_round(jl.foreign_amount * coalesce(jl.fx_rate, public.get_fx_rate(jl.currency_code, je.entry_date::date, 'accounting')))
    else jl.debit
  end as debit,
  case
    when jl.currency_code is not null
      and upper(jl.currency_code) <> upper(public.get_base_currency())
      and coalesce(jl.fx_rate, public.get_fx_rate(jl.currency_code, je.entry_date::date, 'accounting')) is not null
      and jl.foreign_amount is not null
      and jl.credit > 0
      then public._money_round(jl.foreign_amount * coalesce(jl.fx_rate, public.get_fx_rate(jl.currency_code, je.entry_date::date, 'accounting')))
    else jl.credit
  end as credit,
  case
    when coa.normal_balance = 'credit' then (
      (case
        when jl.currency_code is not null
          and upper(jl.currency_code) <> upper(public.get_base_currency())
          and coalesce(jl.fx_rate, public.get_fx_rate(jl.currency_code, je.entry_date::date, 'accounting')) is not null
          and jl.foreign_amount is not null
          and jl.credit > 0
          then public._money_round(jl.foreign_amount * coalesce(jl.fx_rate, public.get_fx_rate(jl.currency_code, je.entry_date::date, 'accounting')))
        else coalesce(jl.credit,0)
      end)
      -
      (case
        when jl.currency_code is not null
          and upper(jl.currency_code) <> upper(public.get_base_currency())
          and coalesce(jl.fx_rate, public.get_fx_rate(jl.currency_code, je.entry_date::date, 'accounting')) is not null
          and jl.foreign_amount is not null
          and jl.debit > 0
          then public._money_round(jl.foreign_amount * coalesce(jl.fx_rate, public.get_fx_rate(jl.currency_code, je.entry_date::date, 'accounting')))
        else coalesce(jl.debit,0)
      end)
    )
    else (
      (case
        when jl.currency_code is not null
          and upper(jl.currency_code) <> upper(public.get_base_currency())
          and coalesce(jl.fx_rate, public.get_fx_rate(jl.currency_code, je.entry_date::date, 'accounting')) is not null
          and jl.foreign_amount is not null
          and jl.debit > 0
          then public._money_round(jl.foreign_amount * coalesce(jl.fx_rate, public.get_fx_rate(jl.currency_code, je.entry_date::date, 'accounting')))
        else coalesce(jl.debit,0)
      end)
      -
      (case
        when jl.currency_code is not null
          and upper(jl.currency_code) <> upper(public.get_base_currency())
          and coalesce(jl.fx_rate, public.get_fx_rate(jl.currency_code, je.entry_date::date, 'accounting')) is not null
          and jl.foreign_amount is not null
          and jl.credit > 0
          then public._money_round(jl.foreign_amount * coalesce(jl.fx_rate, public.get_fx_rate(jl.currency_code, je.entry_date::date, 'accounting')))
        else coalesce(jl.credit,0)
      end)
    )
  end as signed_base_amount,
  upper(coalesce(jl.currency_code, public.get_base_currency())) as currency_code,
  coalesce(jl.fx_rate, public.get_fx_rate(jl.currency_code, je.entry_date::date, 'accounting')) as fx_rate,
  jl.foreign_amount,
  case
    when jl.currency_code is null or upper(jl.currency_code) = upper(public.get_base_currency()) or jl.foreign_amount is null
      then null
    else
      case when jl.debit > 0 then coalesce(jl.foreign_amount,0) else -coalesce(jl.foreign_amount,0) end
  end as signed_foreign_amount,
  jl.party_id,
  jl.cost_center_id,
  jl.dept_id,
  jl.project_id,
  jl.line_memo
from public.journal_entries je
join public.journal_lines jl on jl.journal_entry_id = je.id
join public.chart_of_accounts coa on coa.id = jl.account_id;

alter view public.enterprise_gl_lines set (security_invoker = true);
grant select on public.enterprise_gl_lines to authenticated;

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
begin
  if not public.can_view_accounting_reports() then
    raise exception 'not allowed';
  end if;

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
        else jl.debit
      end as debit,
      case
        when jl.currency_code is not null
          and upper(jl.currency_code) <> upper(v_base)
          and jl.foreign_amount is not null
          and coalesce(jl.fx_rate, public.get_fx_rate(jl.currency_code, je.entry_date::date, 'accounting')) is not null
          and jl.credit > 0
          then public._money_round(jl.foreign_amount * coalesce(jl.fx_rate, public.get_fx_rate(jl.currency_code, je.entry_date::date, 'accounting')))
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
declare
  v_base text := public.get_base_currency();
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
    select coalesce(sum(
      (
        case
          when jl.currency_code is not null
            and upper(jl.currency_code) <> upper(v_base)
            and jl.foreign_amount is not null
            and coalesce(jl.fx_rate, public.get_fx_rate(jl.currency_code, je.entry_date::date, 'accounting')) is not null
            and jl.debit > 0
            then public._money_round(jl.foreign_amount * coalesce(jl.fx_rate, public.get_fx_rate(jl.currency_code, je.entry_date::date, 'accounting')))
          else coalesce(jl.debit,0)
        end
      )
      -
      (
        case
          when jl.currency_code is not null
            and upper(jl.currency_code) <> upper(v_base)
            and jl.foreign_amount is not null
            and coalesce(jl.fx_rate, public.get_fx_rate(jl.currency_code, je.entry_date::date, 'accounting')) is not null
            and jl.credit > 0
            then public._money_round(jl.foreign_amount * coalesce(jl.fx_rate, public.get_fx_rate(jl.currency_code, je.entry_date::date, 'accounting')))
          else coalesce(jl.credit,0)
        end
      )
    ), 0) as opening_balance
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
        when coa.code in ('1010', '1020') then (
          (
            case
              when jl.currency_code is not null
                and upper(jl.currency_code) <> upper(v_base)
                and jl.foreign_amount is not null
                and coalesce(jl.fx_rate, public.get_fx_rate(jl.currency_code, je.entry_date::date, 'accounting')) is not null
                and jl.debit > 0
                then public._money_round(jl.foreign_amount * coalesce(jl.fx_rate, public.get_fx_rate(jl.currency_code, je.entry_date::date, 'accounting')))
              else coalesce(jl.debit,0)
            end
          )
          -
          (
            case
              when jl.currency_code is not null
                and upper(jl.currency_code) <> upper(v_base)
                and jl.foreign_amount is not null
                and coalesce(jl.fx_rate, public.get_fx_rate(jl.currency_code, je.entry_date::date, 'accounting')) is not null
                and jl.credit > 0
                then public._money_round(jl.foreign_amount * coalesce(jl.fx_rate, public.get_fx_rate(jl.currency_code, je.entry_date::date, 'accounting')))
              else coalesce(jl.credit,0)
            end
          )
        )
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
    select coalesce(sum(
      (
        case
          when jl.currency_code is not null
            and upper(jl.currency_code) <> upper(v_base)
            and jl.foreign_amount is not null
            and coalesce(jl.fx_rate, public.get_fx_rate(jl.currency_code, je.entry_date::date, 'accounting')) is not null
            and jl.debit > 0
            then public._money_round(jl.foreign_amount * coalesce(jl.fx_rate, public.get_fx_rate(jl.currency_code, je.entry_date::date, 'accounting')))
          else coalesce(jl.debit,0)
        end
      )
      -
      (
        case
          when jl.currency_code is not null
            and upper(jl.currency_code) <> upper(v_base)
            and jl.foreign_amount is not null
            and coalesce(jl.fx_rate, public.get_fx_rate(jl.currency_code, je.entry_date::date, 'accounting')) is not null
            and jl.credit > 0
            then public._money_round(jl.foreign_amount * coalesce(jl.fx_rate, public.get_fx_rate(jl.currency_code, je.entry_date::date, 'accounting')))
          else coalesce(jl.credit,0)
        end
      )
    ), 0) as closing_balance
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

notify pgrst, 'reload schema';

