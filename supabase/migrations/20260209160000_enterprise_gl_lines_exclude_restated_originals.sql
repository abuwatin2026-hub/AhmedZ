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
join public.chart_of_accounts coa on coa.id = jl.account_id
where not exists (
  select 1
  from public.base_currency_restatement_entry_map m
  where m.original_journal_entry_id = je.id
    and m.status = 'restated'
    and m.restated_journal_entry_id is not null
);

alter view public.enterprise_gl_lines set (security_invoker = true);
grant select on public.enterprise_gl_lines to authenticated;

notify pgrst, 'reload schema';

