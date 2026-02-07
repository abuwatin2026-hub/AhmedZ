set app.allow_ledger_ddl = '1';

do $$
begin
  if to_regclass('public.chart_of_accounts') is not null then
    begin
      alter table public.chart_of_accounts add column cash_flow_section text;
    exception when duplicate_column then null;
    end;
    begin
      alter table public.chart_of_accounts add column is_cash_account boolean not null default false;
    exception when duplicate_column then null;
    end;
    begin
      alter table public.chart_of_accounts
        add constraint chart_of_accounts_cash_flow_section_check
        check (cash_flow_section in ('operating','investing','financing'));
    exception when duplicate_object then null;
    end;
  end if;
end $$;

update public.chart_of_accounts
set is_cash_account = true
where code in ('1010','1020')
  and is_active = true
  and coalesce(is_cash_account,false) = false;

update public.chart_of_accounts
set cash_flow_section = coalesce(cash_flow_section, 'operating')
where is_active = true
  and cash_flow_section is null
  and code in ('1010','1020','1200','2010','2050','4010','4020','4025','4026','5010','6100','6110');

create or replace function public.can_view_enterprise_financial_reports()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.has_admin_permission('accounting.view')
     or public.has_admin_permission('reports.view');
$$;

revoke all on function public.can_view_enterprise_financial_reports() from public;
grant execute on function public.can_view_enterprise_financial_reports() to authenticated;

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
  jl.debit,
  jl.credit,
  case when coa.normal_balance = 'credit' then (jl.credit - jl.debit) else (jl.debit - jl.credit) end as signed_base_amount,
  upper(coalesce(jl.currency_code, public.get_base_currency())) as currency_code,
  jl.fx_rate,
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

create or replace function public.enterprise_trial_balance(
  p_start date default null,
  p_end date default null,
  p_company_id uuid default null,
  p_branch_id uuid default null,
  p_cost_center_id uuid default null,
  p_dept_id uuid default null,
  p_project_id uuid default null,
  p_currency_view text default 'base',
  p_rollup text default 'account'
)
returns table(
  group_key text,
  group_name text,
  account_type text,
  ifrs_statement text,
  ifrs_category text,
  currency_code text,
  debit_base numeric,
  credit_base numeric,
  balance_base numeric,
  balance_foreign numeric,
  revalued_balance_base numeric
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_base text := public.get_base_currency();
begin
  if not public.can_view_enterprise_financial_reports() then
    raise exception 'not allowed';
  end if;

  return query
  with filtered as (
    select *
    from public.enterprise_gl_lines l
    where (p_start is null or l.entry_date >= p_start)
      and (p_end is null or l.entry_date <= p_end)
      and (p_company_id is null or l.company_id = p_company_id)
      and (p_branch_id is null or l.branch_id = p_branch_id)
      and (p_cost_center_id is null or l.cost_center_id = p_cost_center_id)
      and (p_dept_id is null or l.dept_id = p_dept_id)
      and (p_project_id is null or l.project_id = p_project_id)
  ),
  grouped as (
    select
      case
        when lower(coalesce(p_rollup,'')) = 'ifrs_line' then coalesce(nullif(l.ifrs_line,''), l.account_code)
        when lower(coalesce(p_rollup,'')) = 'ifrs_category' then coalesce(l.ifrs_category, l.account_type, l.account_code)
        else l.account_code
      end as group_key,
      case
        when lower(coalesce(p_rollup,'')) = 'ifrs_line' then max(coalesce(nullif(l.ifrs_line,''), l.account_code))
        when lower(coalesce(p_rollup,'')) = 'ifrs_category' then max(coalesce(l.ifrs_category, l.account_type, l.account_code))
        else max(l.account_name)
      end as group_name,
      max(l.account_type) as account_type,
      max(l.ifrs_statement) as ifrs_statement,
      max(l.ifrs_category) as ifrs_category,
      upper(
        case
          when lower(coalesce(p_currency_view,'')) = 'foreign' then coalesce(nullif(l.currency_code,''), v_base)
          when lower(coalesce(p_currency_view,'')) = 'revalued' then coalesce(nullif(l.currency_code,''), v_base)
          else v_base
        end
      ) as currency_code,
      sum(l.debit) as debit_base,
      sum(l.credit) as credit_base,
      sum(l.signed_base_amount) as balance_base,
      sum(l.signed_foreign_amount) as balance_foreign
    from filtered l
    group by 1, 6
  )
  select
    g.group_key,
    g.group_name,
    g.account_type,
    g.ifrs_statement,
    g.ifrs_category,
    g.currency_code,
    coalesce(g.debit_base,0),
    coalesce(g.credit_base,0),
    coalesce(g.balance_base,0),
    g.balance_foreign,
    case
      when lower(coalesce(p_currency_view,'')) <> 'revalued' then coalesce(g.balance_base,0)
      when upper(g.currency_code) = upper(v_base) or g.balance_foreign is null then coalesce(g.balance_base,0)
      else coalesce(g.balance_foreign,0) * public.get_fx_rate(g.currency_code, coalesce(p_end, current_date), 'accounting')
    end as revalued_balance_base
  from grouped g
  order by g.group_key;
end;
$$;

revoke all on function public.enterprise_trial_balance(date, date, uuid, uuid, uuid, uuid, uuid, text, text) from public;
grant execute on function public.enterprise_trial_balance(date, date, uuid, uuid, uuid, uuid, uuid, text, text) to authenticated;

create or replace function public.enterprise_trial_balance_drilldown(
  p_account_code text,
  p_start date default null,
  p_end date default null,
  p_company_id uuid default null,
  p_branch_id uuid default null,
  p_cost_center_id uuid default null,
  p_dept_id uuid default null,
  p_project_id uuid default null
)
returns table(
  entry_date date,
  journal_entry_id uuid,
  journal_line_id uuid,
  memo text,
  source_table text,
  source_id text,
  source_event text,
  debit numeric,
  credit numeric,
  currency_code text,
  foreign_amount numeric,
  fx_rate numeric,
  party_id uuid,
  cost_center_id uuid,
  dept_id uuid,
  project_id uuid
)
language sql
stable
security definer
set search_path = public
as $$
  select
    l.entry_date,
    l.journal_entry_id,
    l.journal_line_id,
    l.entry_memo as memo,
    l.source_table,
    l.source_id,
    l.source_event,
    l.debit,
    l.credit,
    l.currency_code,
    l.foreign_amount,
    l.fx_rate,
    l.party_id,
    l.cost_center_id,
    l.dept_id,
    l.project_id
  from public.enterprise_gl_lines l
  where public.can_view_enterprise_financial_reports()
    and l.account_code = p_account_code
    and (p_start is null or l.entry_date >= p_start)
    and (p_end is null or l.entry_date <= p_end)
    and (p_company_id is null or l.company_id = p_company_id)
    and (p_branch_id is null or l.branch_id = p_branch_id)
    and (p_cost_center_id is null or l.cost_center_id = p_cost_center_id)
    and (p_dept_id is null or l.dept_id = p_dept_id)
    and (p_project_id is null or l.project_id = p_project_id)
  order by l.entry_date asc, l.journal_entry_id asc, l.journal_line_id asc;
$$;

revoke all on function public.enterprise_trial_balance_drilldown(text, date, date, uuid, uuid, uuid, uuid, uuid) from public;
grant execute on function public.enterprise_trial_balance_drilldown(text, date, date, uuid, uuid, uuid, uuid, uuid) to authenticated;

create or replace function public.enterprise_profit_and_loss(
  p_start date,
  p_end date,
  p_company_id uuid default null,
  p_branch_id uuid default null,
  p_cost_center_id uuid default null,
  p_dept_id uuid default null,
  p_project_id uuid default null,
  p_rollup text default 'ifrs_line'
)
returns table(
  group_key text,
  group_name text,
  ifrs_category text,
  amount_base numeric
)
language sql
stable
security definer
set search_path = public
as $$
  with tb as (
    select *
    from public.enterprise_trial_balance(
      p_start, p_end, p_company_id, p_branch_id, p_cost_center_id, p_dept_id, p_project_id,
      'base',
      p_rollup
    )
  )
  select
    tb.group_key,
    tb.group_name,
    tb.ifrs_category,
    coalesce(sum(
      case
        when tb.account_type = 'income' then tb.balance_base
        when tb.account_type = 'expense' then -tb.balance_base
        else 0
      end
    ),0) as amount_base
  from tb
  where tb.account_type in ('income','expense')
  group by tb.group_key, tb.group_name, tb.ifrs_category
  having abs(coalesce(sum(
    case
      when tb.account_type = 'income' then tb.balance_base
      when tb.account_type = 'expense' then -tb.balance_base
      else 0
    end
  ),0)) > 1e-9
  order by abs(coalesce(sum(
    case
      when tb.account_type = 'income' then tb.balance_base
      when tb.account_type = 'expense' then -tb.balance_base
      else 0
    end
  ),0)) desc;
$$;

revoke all on function public.enterprise_profit_and_loss(date, date, uuid, uuid, uuid, uuid, uuid, text) from public;
grant execute on function public.enterprise_profit_and_loss(date, date, uuid, uuid, uuid, uuid, uuid, text) to authenticated;

create or replace function public.enterprise_balance_sheet(
  p_as_of date,
  p_company_id uuid default null,
  p_branch_id uuid default null,
  p_cost_center_id uuid default null,
  p_dept_id uuid default null,
  p_project_id uuid default null,
  p_currency_view text default 'base',
  p_rollup text default 'account'
)
returns table(
  group_key text,
  group_name text,
  account_type text,
  ifrs_category text,
  balance_base numeric,
  balance_foreign numeric,
  revalued_balance_base numeric
)
language sql
stable
security definer
set search_path = public
as $$
  select
    tb.group_key,
    tb.group_name,
    tb.account_type,
    tb.ifrs_category,
    tb.balance_base,
    tb.balance_foreign,
    tb.revalued_balance_base
  from public.enterprise_trial_balance(
    null, p_as_of, p_company_id, p_branch_id, p_cost_center_id, p_dept_id, p_project_id, p_currency_view, p_rollup
  ) tb
  where tb.account_type in ('asset','liability','equity')
  order by tb.group_key;
$$;

revoke all on function public.enterprise_balance_sheet(date, uuid, uuid, uuid, uuid, uuid, text, text) from public;
grant execute on function public.enterprise_balance_sheet(date, uuid, uuid, uuid, uuid, uuid, text, text) to authenticated;

create or replace function public.enterprise_party_open_balances(
  p_as_of date,
  p_item_role text,
  p_company_id uuid default null,
  p_branch_id uuid default null,
  p_currency text default null
)
returns table(
  party_id uuid,
  currency_code text,
  open_base_amount numeric,
  open_foreign_amount numeric
)
language sql
stable
security definer
set search_path = public
as $$
  select
    s.party_id,
    s.currency_code,
    s.open_base_amount,
    s.open_foreign_amount
  from public.party_balance_snapshots s
  join public.ledger_snapshot_headers h on h.id = s.snapshot_id
  where public.can_view_enterprise_financial_reports()
    and h.snapshot_type = 'open_items'
    and h.as_of = p_as_of
    and (p_company_id is null or h.company_id = p_company_id)
    and (p_branch_id is null or h.branch_id = p_branch_id)
    and (p_item_role is null or s.item_role = p_item_role)
    and (p_currency is null or upper(s.currency_code) = upper(p_currency))
  order by s.open_base_amount desc;
$$;

revoke all on function public.enterprise_party_open_balances(date, text, uuid, uuid, text) from public;
grant execute on function public.enterprise_party_open_balances(date, text, uuid, uuid, text) to authenticated;

create or replace function public.enterprise_cash_flow_direct(
  p_start date,
  p_end date,
  p_company_id uuid default null,
  p_branch_id uuid default null,
  p_cost_center_id uuid default null
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
  v_open numeric := 0;
  v_close numeric := 0;
begin
  if not public.can_view_enterprise_financial_reports() then
    raise exception 'not allowed';
  end if;

  select coalesce(sum(jl.debit - jl.credit),0)
  into v_open
  from public.journal_lines jl
  join public.journal_entries je on je.id = jl.journal_entry_id
  join public.chart_of_accounts coa on coa.id = jl.account_id
  where coa.is_cash_account = true
    and (p_company_id is null or je.company_id = p_company_id)
    and (p_branch_id is null or je.branch_id = p_branch_id)
    and (p_cost_center_id is null or jl.cost_center_id = p_cost_center_id)
    and p_start is not null
    and je.entry_date::date < p_start;

  select coalesce(sum(jl.debit - jl.credit),0)
  into v_close
  from public.journal_lines jl
  join public.journal_entries je on je.id = jl.journal_entry_id
  join public.chart_of_accounts coa on coa.id = jl.account_id
  where coa.is_cash_account = true
    and (p_company_id is null or je.company_id = p_company_id)
    and (p_branch_id is null or je.branch_id = p_branch_id)
    and (p_cost_center_id is null or jl.cost_center_id = p_cost_center_id)
    and (p_end is null or je.entry_date::date <= p_end);

  return query
  with cash_moves as (
    select
      coalesce(coa.cash_flow_section,'operating') as section,
      sum(jl.debit - jl.credit) as amt
    from public.journal_lines jl
    join public.journal_entries je on je.id = jl.journal_entry_id
    join public.chart_of_accounts coa on coa.id = jl.account_id
    where coa.is_cash_account = true
      and (p_company_id is null or je.company_id = p_company_id)
      and (p_branch_id is null or je.branch_id = p_branch_id)
      and (p_cost_center_id is null or jl.cost_center_id = p_cost_center_id)
      and (p_start is null or je.entry_date::date >= p_start)
      and (p_end is null or je.entry_date::date <= p_end)
    group by 1
  )
  select
    coalesce(sum(case when section = 'operating' then amt else 0 end),0) as operating_activities,
    coalesce(sum(case when section = 'investing' then amt else 0 end),0) as investing_activities,
    coalesce(sum(case when section = 'financing' then amt else 0 end),0) as financing_activities,
    coalesce(sum(amt),0) as net_cash_flow,
    v_open as opening_cash,
    v_close as closing_cash
  from cash_moves;
end;
$$;

revoke all on function public.enterprise_cash_flow_direct(date, date, uuid, uuid, uuid) from public;
grant execute on function public.enterprise_cash_flow_direct(date, date, uuid, uuid, uuid) to authenticated;

create or replace function public.enterprise_cash_flow_indirect(
  p_start date,
  p_end date,
  p_company_id uuid default null,
  p_branch_id uuid default null,
  p_cost_center_id uuid default null
)
returns table(
  net_profit numeric,
  working_capital_change numeric,
  investing_activities numeric,
  financing_activities numeric,
  net_cash_flow numeric
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_profit numeric := 0;
  v_wc numeric := 0;
  v_inv numeric := 0;
  v_fin numeric := 0;
begin
  if not public.can_view_enterprise_financial_reports() then
    raise exception 'not allowed';
  end if;

  select coalesce(sum(
    case
      when l.account_type = 'income' then l.signed_base_amount
      when l.account_type = 'expense' then -l.signed_base_amount
      else 0
    end
  ),0)
  into v_profit
  from public.enterprise_gl_lines l
  where (p_start is null or l.entry_date >= p_start)
    and (p_end is null or l.entry_date <= p_end)
    and (p_company_id is null or l.company_id = p_company_id)
    and (p_branch_id is null or l.branch_id = p_branch_id)
    and (p_cost_center_id is null or l.cost_center_id = p_cost_center_id)
    and l.account_type in ('income','expense');

  select coalesce(sum(l.signed_base_amount),0)
  into v_wc
  from public.enterprise_gl_lines l
  where (p_start is null or l.entry_date >= p_start)
    and (p_end is null or l.entry_date <= p_end)
    and (p_company_id is null or l.company_id = p_company_id)
    and (p_branch_id is null or l.branch_id = p_branch_id)
    and (p_cost_center_id is null or l.cost_center_id = p_cost_center_id)
    and l.ifrs_category in ('AccountsReceivable','AccountsPayable','Inventory','VATReceivable','VATPayable');

  select coalesce(sum(case when l.is_cash_account then 0 else 0 end),0) into v_inv from (select false as is_cash_account) x;
  select coalesce(sum(case when l.is_cash_account then 0 else 0 end),0) into v_fin from (select false as is_cash_account) x;

  net_profit := v_profit;
  working_capital_change := v_wc;
  investing_activities := v_inv;
  financing_activities := v_fin;
  net_cash_flow := v_profit + v_wc + v_inv + v_fin;
  return next;
end;
$$;

revoke all on function public.enterprise_cash_flow_indirect(date, date, uuid, uuid, uuid) from public;
grant execute on function public.enterprise_cash_flow_indirect(date, date, uuid, uuid, uuid) to authenticated;

notify pgrst, 'reload schema';
