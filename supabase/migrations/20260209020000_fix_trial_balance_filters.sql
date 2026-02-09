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
  select
    coa.code as account_code,
    coa.name as account_name,
    coa.account_type,
    coa.normal_balance,
    coalesce(sum(case when je.id is null then 0 else coalesce(jl.debit, 0) end), 0) as debit,
    coalesce(sum(case when je.id is null then 0 else coalesce(jl.credit, 0) end), 0) as credit,
    coalesce(sum(case when je.id is null then 0 else (coalesce(jl.debit, 0) - coalesce(jl.credit, 0)) end), 0) as balance
  from public.chart_of_accounts coa
  left join public.journal_lines jl
    on jl.account_id = coa.id
   and (p_cost_center_id is null or jl.cost_center_id = p_cost_center_id)
  left join public.journal_entries je
    on je.id = jl.journal_entry_id
   and (p_start is null or je.entry_date::date >= p_start)
   and (p_end is null or je.entry_date::date <= p_end)
   and (p_journal_id is null or je.journal_id = p_journal_id)
  group by coa.code, coa.name, coa.account_type, coa.normal_balance
  order by coa.code;
end;
$$;

revoke all on function public.trial_balance(date, date, uuid, uuid) from public;
revoke execute on function public.trial_balance(date, date, uuid, uuid) from anon;
grant execute on function public.trial_balance(date, date, uuid, uuid) to authenticated;

notify pgrst, 'reload schema';

