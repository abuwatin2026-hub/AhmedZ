with base as (
  select upper(public.get_base_currency()) as base_cur,
         coalesce((select is_high_inflation from public.currencies where upper(code) = upper(public.get_base_currency()) limit 1), false) as base_hi
)
select 'JL_BASE_FOREIGN_MISMATCH' as check,
       jl.id as journal_line_id,
       jl.journal_entry_id,
       upper(jl.currency_code) as currency_code,
       jl.foreign_amount,
       jl.debit,
       jl.credit
from public.journal_lines jl, base b
where jl.currency_code is not null
  and upper(jl.currency_code) = b.base_cur
  and coalesce(jl.foreign_amount, 0) <> 0
limit 200;

with base as (
  select upper(public.get_base_currency()) as base_cur,
         coalesce((select is_high_inflation from public.currencies where upper(code) = upper(public.get_base_currency()) limit 1), false) as base_hi
)
select 'FX_RATE_HIGH_INFLATION_BAD' as check,
       fr.currency_code,
       fr.rate_type,
       fr.rate_date,
       fr.rate
from public.fx_rates fr
join public.currencies c on upper(c.code) = upper(fr.currency_code),
     base b
where coalesce(c.is_high_inflation, false) = true
  and b.base_hi = false
  and coalesce(fr.rate, 0) > 10
order by fr.rate_date desc
limit 200;

with base as (
  select upper(public.get_base_currency()) as base_cur,
         coalesce((select is_high_inflation from public.currencies where upper(code) = upper(public.get_base_currency()) limit 1), false) as base_hi
)
select 'FX_RATE_NON_HIGH_WHEN_BASE_HIGH_LT1' as check,
       fr.currency_code,
       fr.rate_type,
       fr.rate_date,
       fr.rate
from public.fx_rates fr
join public.currencies c on upper(c.code) = upper(fr.currency_code),
     base b
where coalesce(c.is_high_inflation, false) = false
  and b.base_hi = true
  and coalesce(fr.rate, 0) > 0
  and coalesce(fr.rate, 0) < 1
order by fr.rate_date desc
limit 200;

with v as (
  select
    je.entry_date::date as entry_date,
    jl.id as journal_line_id,
    jl.journal_entry_id,
    upper(jl.currency_code) as currency_code,
    jl.foreign_amount,
    coalesce(jl.fx_rate, public.get_fx_rate(jl.currency_code, je.entry_date::date, 'accounting')) as fx_rate,
    jl.debit,
    jl.credit
  from public.journal_entries je
  join public.journal_lines jl on jl.journal_entry_id = je.id
  where jl.currency_code is not null
    and upper(jl.currency_code) <> upper(public.get_base_currency())
    and jl.foreign_amount is not null
)
select 'FX_BASE_CALC_MISMATCH' as check,
       v.journal_line_id,
       v.journal_entry_id,
       v.currency_code,
       v.foreign_amount,
       v.fx_rate,
       v.debit,
       v.credit,
       case when v.debit > 0 then (v.foreign_amount * v.fx_rate) - v.debit else (v.foreign_amount * v.fx_rate) - v.credit end as diff
from v
where v.fx_rate is not null
  and coalesce(v.foreign_amount, 0) > 0
  and abs(case when v.debit > 0 then (v.foreign_amount * v.fx_rate) - v.debit else (v.foreign_amount * v.fx_rate) - v.credit end) > 1e-6
limit 200;

with v as (
  select
    jl.journal_entry_id,
    sum(coalesce(jl.debit,0) - coalesce(jl.credit,0)) as base_balance,
    sum(
      case
        when jl.currency_code is not null
             and upper(jl.currency_code) <> upper(public.get_base_currency())
             and jl.foreign_amount is not null
             and coalesce(jl.fx_rate, public.get_fx_rate(jl.currency_code, je.entry_date::date, 'accounting')) is not null
             and jl.debit > 0
          then coalesce(jl.foreign_amount,0) * coalesce(jl.fx_rate, public.get_fx_rate(jl.currency_code, je.entry_date::date, 'accounting'))
        when jl.currency_code is not null
             and upper(jl.currency_code) <> upper(public.get_base_currency())
             and jl.foreign_amount is not null
             and coalesce(jl.fx_rate, public.get_fx_rate(jl.currency_code, je.entry_date::date, 'accounting')) is not null
             and jl.credit > 0
          then -coalesce(jl.foreign_amount,0) * coalesce(jl.fx_rate, public.get_fx_rate(jl.currency_code, je.entry_date::date, 'accounting'))
        else 0
      end
    ) as foreign_converted_balance
  from public.journal_entries je
  join public.journal_lines jl on jl.journal_entry_id = je.id
  group by jl.journal_entry_id
)
select 'JE_FOREIGN_BASE_MISMATCH' as check,
       v.journal_entry_id,
       v.base_balance,
       v.foreign_converted_balance,
       (v.foreign_converted_balance - v.base_balance) as diff
from v
where abs(coalesce(v.foreign_converted_balance, 0) - coalesce(v.base_balance, 0)) > 1e-6
limit 200;
