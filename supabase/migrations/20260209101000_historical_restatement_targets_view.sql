set app.allow_ledger_ddl = '1';

create or replace view public.historical_base_currency_restatement_targets as
with state as (
  select locked_at::date as lock_date
  from public.base_currency_migration_state
  where id = 'sar_base_lock'
  limit 1
),
rng as (
  select
    (select min(je.entry_date)::date from public.journal_entries je) as min_date,
    coalesce((select lock_date from state), current_date) as max_date
),
eligible as (
  select
    je.id as journal_entry_id,
    je.entry_date::date as entry_date,
    je.created_at,
    je.memo,
    coalesce(sum(coalesce(jl.debit,0)),0) as debit_total,
    coalesce(sum(coalesce(jl.credit,0)),0) as credit_total
  from public.journal_entries je
  join public.journal_lines jl on jl.journal_entry_id = je.id
  join rng on true
  where je.entry_date::date >= rng.min_date
    and je.entry_date::date <= rng.max_date
    and coalesce(je.source_table,'') not in ('fx_revaluation','settlements','base_currency_restatement','base_currency_migration')
    and coalesce(je.source_event,'') <> 'reversal'
    and not exists (
      select 1
      from public.journal_lines jl2
      where jl2.journal_entry_id = je.id
        and (
          jl2.currency_code is not null
          or jl2.fx_rate is not null
          or jl2.foreign_amount is not null
        )
    )
    and not exists (
      select 1
      from public.base_currency_migration_entry_map m
      where m.original_journal_entry_id = je.id
    )
  group by je.id, je.entry_date, je.created_at, je.memo
)
select
  e.journal_entry_id,
  e.entry_date,
  e.created_at,
  e.memo,
  e.debit_total,
  e.credit_total
from eligible e
where abs(coalesce(e.debit_total,0) - coalesce(e.credit_total,0)) <= 0.000001
order by e.entry_date asc, e.created_at asc, e.journal_entry_id asc;

notify pgrst, 'reload schema';
