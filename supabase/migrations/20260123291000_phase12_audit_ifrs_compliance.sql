alter table public.chart_of_accounts
  add column if not exists ifrs_statement text,
  add column if not exists ifrs_category text,
  add column if not exists ifrs_line text;

do $$
begin
  begin
    alter table public.chart_of_accounts
      add constraint chart_of_accounts_ifrs_statement_check
      check (ifrs_statement in ('BS','PL','EQ'));
  exception
    when duplicate_object then null;
  end;
end $$;

update public.chart_of_accounts coa
set
  ifrs_statement = coalesce(
    coa.ifrs_statement,
    case
      when coa.account_type in ('asset','liability','equity') then 'BS'
      when coa.account_type in ('income','expense') then 'PL'
      else null
    end
  ),
  ifrs_category = coalesce(
    coa.ifrs_category,
    case
      when coa.code = '1410' then 'Inventory'
      when coa.code = '1200' then 'AccountsReceivable'
      when coa.code = '2010' then 'AccountsPayable'
      when coa.code = '1420' then 'VATReceivable'
      when coa.code = '2020' then 'VATPayable'
      when coa.code = '3000' then 'RetainedEarnings'
      when coa.code = '4010' then 'Revenue'
      when coa.code = '5010' then 'COGS'
      when coa.account_type = 'asset' then 'AssetsOther'
      when coa.account_type = 'liability' then 'LiabilitiesOther'
      when coa.account_type = 'equity' then 'EquityOther'
      when coa.account_type = 'income' then 'RevenueOther'
      when coa.account_type = 'expense' then 'ExpenseOther'
      else null
    end
  ),
  ifrs_line = coalesce(coa.ifrs_line, coa.name)
where coa.is_active = true;

create or replace function public.trg_coa_require_ifrs_mapping()
returns trigger
language plpgsql
as $$
begin
  if public._is_migration_actor() then
    return new;
  end if;

  if new.is_active = true then
    if new.ifrs_statement is null or new.ifrs_category is null or btrim(new.ifrs_category) = '' then
      raise exception 'IFRS mapping required for active account';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_coa_require_ifrs_mapping on public.chart_of_accounts;
create trigger trg_coa_require_ifrs_mapping
before insert or update on public.chart_of_accounts
for each row execute function public.trg_coa_require_ifrs_mapping();

comment on column public.chart_of_accounts.ifrs_statement is 'Purpose: statement placement for IFRS export. Values: BS/PL/EQ. Source of truth: maintained on chart_of_accounts.';
comment on column public.chart_of_accounts.ifrs_category is 'Purpose: IFRS category/grouping for disclosures and exports. Source of truth: maintained on chart_of_accounts.';
comment on column public.chart_of_accounts.ifrs_line is 'Purpose: human-readable IFRS line label used by notes/exports. Source of truth: maintained on chart_of_accounts.';
comment on function public.trg_coa_require_ifrs_mapping() is 'Purpose: prevent active accounts without IFRS classification. Source of truth: chart_of_accounts columns; migration actors bypass via _is_migration_actor().';

create or replace view public.audit_general_ledger as
select
  je.entry_date,
  je.id as journal_entry_id,
  je.source_table,
  je.source_id,
  je.source_event,
  coa.code as account_code,
  coa.name as account_name,
  coa.account_type,
  coa.normal_balance,
  coa.ifrs_statement,
  coa.ifrs_category,
  coa.ifrs_line,
  jl.debit,
  jl.credit,
  jl.line_memo,
  je.memo as entry_memo,
  je.created_by,
  je.created_at
from public.journal_entries je
join public.journal_lines jl on jl.journal_entry_id = je.id
join public.chart_of_accounts coa on coa.id = jl.account_id
order by je.entry_date, je.id, coa.code, jl.id;

alter view public.audit_general_ledger set (security_invoker = true);
grant select on public.audit_general_ledger to authenticated;
comment on view public.audit_general_ledger is 'Purpose: export-ready General Ledger (flat). Source of truth: journal_entries + journal_lines + chart_of_accounts. Output: deterministic ordering by entry_date/entry_id/account_code/line_id.';

create or replace view public.audit_journal_entries_with_source as
with totals as (
  select
    je.id as journal_entry_id,
    coalesce(sum(jl.debit), 0) as total_debits,
    coalesce(sum(jl.credit), 0) as total_credits
  from public.journal_entries je
  left join public.journal_lines jl on jl.journal_entry_id = je.id
  group by je.id
)
select
  je.entry_date,
  je.id as journal_entry_id,
  je.source_table,
  je.source_id,
  je.source_event,
  je.memo,
  je.created_by,
  je.created_at,
  t.total_debits,
  t.total_credits,
  (t.total_debits - t.total_credits) as discrepancy
from public.journal_entries je
join totals t on t.journal_entry_id = je.id
order by je.entry_date, je.id;

alter view public.audit_journal_entries_with_source set (security_invoker = true);
grant select on public.audit_journal_entries_with_source to authenticated;
comment on view public.audit_journal_entries_with_source is 'Purpose: export-ready Journal Entries with source and control totals. Source of truth: journal_entries + journal_lines. Output: per-entry totals and discrepancy.';

create or replace view public.audit_trial_balance_all_time as
with b as (
  select *
  from public.balances_as_of(now())
)
select
  coa.code as account_code,
  coa.name as account_name,
  coa.account_type,
  coa.normal_balance,
  coa.ifrs_statement,
  coa.ifrs_category,
  coa.ifrs_line,
  b.balance as closing_balance
from public.chart_of_accounts coa
join b on b.account_id = coa.id
where coa.is_active = true
order by coa.code;

alter view public.audit_trial_balance_all_time set (security_invoker = true);
grant select on public.audit_trial_balance_all_time to authenticated;
comment on view public.audit_trial_balance_all_time is 'Purpose: export-ready Trial Balance (closing balances as-of now). Source of truth: balances_as_of(now()) + chart_of_accounts mapping.';

create or replace view public.audit_period_snapshots as
select
  ap.id as period_id,
  ap.name as period_name,
  ap.start_date,
  ap.end_date,
  ap.status,
  aps.account_id,
  coa.code as account_code,
  coa.name as account_name,
  coa.account_type,
  coa.normal_balance,
  coa.ifrs_statement,
  coa.ifrs_category,
  coa.ifrs_line,
  aps.closing_balance,
  aps.created_at,
  aps.created_by
from public.accounting_period_snapshots aps
join public.accounting_periods ap on ap.id = aps.period_id
join public.chart_of_accounts coa on coa.id = aps.account_id
order by ap.end_date, ap.id, coa.code;

alter view public.audit_period_snapshots set (security_invoker = true);
grant select on public.audit_period_snapshots to authenticated;
comment on view public.audit_period_snapshots is 'Purpose: export-ready period snapshot balances. Source of truth: accounting_period_snapshots created at period close. Output: flat deterministic dataset per period/account.';

create or replace view public.v_note_inventory as
with inv as (
  select coa.id
  from public.chart_of_accounts coa
  where coa.code = '1410'
  limit 1
),
lines as (
  select
    ap.id as period_id,
    ap.name as period_name,
    je.source_event,
    coalesce(sum(jl.debit), 0) as total_debit,
    coalesce(sum(jl.credit), 0) as total_credit
  from public.journal_entries je
  join public.journal_lines jl on jl.journal_entry_id = je.id
  join inv on inv.id = jl.account_id
  join public.accounting_periods ap
    on je.entry_date::date between ap.start_date and ap.end_date
  group by ap.id, ap.name, je.source_event
)
select *
from lines
order by period_name, source_event;

alter view public.v_note_inventory set (security_invoker = true);
grant select on public.v_note_inventory to authenticated;
comment on view public.v_note_inventory is 'Purpose: Inventory note by period and source_event. Source of truth: journal_entries/journal_lines for Inventory account 1410 grouped by accounting_periods.';

create or replace view public.v_note_revenue as
select
  ap.id as period_id,
  ap.name as period_name,
  coa.code as account_code,
  coa.name as account_name,
  coalesce(sum(jl.credit - jl.debit), 0) as revenue_amount
from public.journal_entries je
join public.journal_lines jl on jl.journal_entry_id = je.id
join public.chart_of_accounts coa on coa.id = jl.account_id
join public.accounting_periods ap
  on je.entry_date::date between ap.start_date and ap.end_date
where coa.account_type = 'income'
group by ap.id, ap.name, coa.code, coa.name
having abs(coalesce(sum(jl.credit - jl.debit), 0)) > 1e-9
order by ap.name, coa.code;

alter view public.v_note_revenue set (security_invoker = true);
grant select on public.v_note_revenue to authenticated;
comment on view public.v_note_revenue is 'Purpose: Revenue note (breakdown by income accounts) per period. Source of truth: journal_entries/journal_lines grouped by accounting_periods.';

create or replace view public.v_note_expenses as
select
  ap.id as period_id,
  ap.name as period_name,
  coa.code as account_code,
  coa.name as account_name,
  coalesce(sum(jl.debit - jl.credit), 0) as expense_amount
from public.journal_entries je
join public.journal_lines jl on jl.journal_entry_id = je.id
join public.chart_of_accounts coa on coa.id = jl.account_id
join public.accounting_periods ap
  on je.entry_date::date between ap.start_date and ap.end_date
where coa.account_type = 'expense'
group by ap.id, ap.name, coa.code, coa.name
having abs(coalesce(sum(jl.debit - jl.credit), 0)) > 1e-9
order by ap.name, coa.code;

alter view public.v_note_expenses set (security_invoker = true);
grant select on public.v_note_expenses to authenticated;
comment on view public.v_note_expenses is 'Purpose: Expense note (breakdown by expense accounts) per period. Source of truth: journal_entries/journal_lines grouped by accounting_periods.';

create or replace view public.v_note_vat as
select
  ap.id as period_id,
  ap.name as period_name,
  coa.code as vat_account_code,
  coa.name as vat_account_name,
  coalesce(sum(jl.debit), 0) as total_debit,
  coalesce(sum(jl.credit), 0) as total_credit,
  coalesce(sum(
    case when coa.normal_balance = 'debit' then jl.debit - jl.credit else jl.credit - jl.debit end
  ), 0) as net_balance
from public.journal_entries je
join public.journal_lines jl on jl.journal_entry_id = je.id
join public.chart_of_accounts coa on coa.id = jl.account_id
join public.accounting_periods ap
  on je.entry_date::date between ap.start_date and ap.end_date
where coa.code in ('1420','2020')
group by ap.id, ap.name, coa.code, coa.name, coa.normal_balance
order by ap.name, vat_account_code;

alter view public.v_note_vat set (security_invoker = true);
grant select on public.v_note_vat to authenticated;
comment on view public.v_note_vat is 'Purpose: VAT disclosure by period for VAT receivable (1420) and VAT payable (2020). Source of truth: journal_entries/journal_lines grouped by accounting_periods.';
