set app.allow_ledger_ddl = '1';

do $$
begin
  if to_regclass('public.financial_report_snapshots') is null then
    create table public.financial_report_snapshots (
      id uuid primary key default gen_random_uuid(),
      report_type text not null,
      params jsonb not null default '{}'::jsonb,
      params_hash text not null,
      period_start date,
      period_end date,
      as_of date,
      company_id uuid references public.companies(id) on delete set null,
      branch_id uuid references public.branches(id) on delete set null,
      currency_view text,
      rollup text,
      generated_at timestamptz not null default now(),
      generated_by uuid references auth.users(id) on delete set null,
      data jsonb not null default '{}'::jsonb,
      unique(report_type, params_hash, period_start, period_end, as_of)
    );
    create index if not exists idx_financial_report_snapshots_lookup on public.financial_report_snapshots(report_type, as_of desc, generated_at desc);
  end if;
end $$;

alter table public.financial_report_snapshots enable row level security;
drop policy if exists financial_report_snapshots_select on public.financial_report_snapshots;
create policy financial_report_snapshots_select on public.financial_report_snapshots
for select using (public.can_view_enterprise_financial_reports());
drop policy if exists financial_report_snapshots_write on public.financial_report_snapshots;
create policy financial_report_snapshots_write on public.financial_report_snapshots
for all using (public.has_admin_permission('accounting.manage'))
with check (public.has_admin_permission('accounting.manage'));

create or replace function public.create_financial_report_snapshot(p_report_type text, p_params jsonb default '{}'::jsonb)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_type text := lower(nullif(btrim(coalesce(p_report_type,'')), ''));
  v_params jsonb := coalesce(p_params,'{}'::jsonb);
  v_hash text := md5(v_params::text);
  v_id uuid;
  v_start date;
  v_end date;
  v_as_of date;
  v_company uuid;
  v_branch uuid;
  v_currency_view text;
  v_rollup text;
  v_data jsonb := '{}'::jsonb;
begin
  if not public.has_admin_permission('accounting.manage') then
    raise exception 'not allowed';
  end if;
  if v_type is null then
    raise exception 'report_type required';
  end if;

  begin v_start := nullif(v_params->>'start','')::date; exception when others then v_start := null; end;
  begin v_end := nullif(v_params->>'end','')::date; exception when others then v_end := null; end;
  begin v_as_of := nullif(v_params->>'asOf','')::date; exception when others then v_as_of := null; end;
  begin v_company := nullif(v_params->>'companyId','')::uuid; exception when others then v_company := null; end;
  begin v_branch := nullif(v_params->>'branchId','')::uuid; exception when others then v_branch := null; end;
  v_currency_view := nullif(v_params->>'currencyView','');
  v_rollup := nullif(v_params->>'rollup','');

  if v_type = 'trial_balance' then
    select coalesce(jsonb_agg(to_jsonb(t) order by t.group_key), '[]'::jsonb)
    into v_data
    from public.enterprise_trial_balance(v_start, v_end, v_company, v_branch, null, null, null, coalesce(v_currency_view,'base'), coalesce(v_rollup,'account')) t;
  elsif v_type = 'balance_sheet' then
    if v_as_of is null then
      v_as_of := v_end;
    end if;
    select coalesce(jsonb_agg(to_jsonb(t) order by t.group_key), '[]'::jsonb)
    into v_data
    from public.enterprise_balance_sheet(v_as_of, v_company, v_branch, null, null, null, coalesce(v_currency_view,'base'), coalesce(v_rollup,'account')) t;
  elsif v_type = 'pl' then
    select coalesce(jsonb_agg(to_jsonb(t) order by abs(t.amount_base) desc), '[]'::jsonb)
    into v_data
    from public.enterprise_profit_and_loss(v_start, v_end, v_company, v_branch, null, null, null, coalesce(v_rollup,'ifrs_line')) t;
  elsif v_type = 'cash_flow_direct' then
    select to_jsonb(t) into v_data
    from public.enterprise_cash_flow_direct(v_start, v_end, v_company, v_branch, null) t;
  elsif v_type = 'cash_flow_indirect' then
    select to_jsonb(t) into v_data
    from public.enterprise_cash_flow_indirect(v_start, v_end, v_company, v_branch, null) t;
  else
    v_data := '{}'::jsonb;
  end if;

  insert into public.financial_report_snapshots(report_type, params, params_hash, period_start, period_end, as_of, company_id, branch_id, currency_view, rollup, generated_by, data)
  values (v_type, v_params, v_hash, v_start, v_end, v_as_of, v_company, v_branch, v_currency_view, v_rollup, auth.uid(), coalesce(v_data,'{}'::jsonb))
  on conflict (report_type, params_hash, period_start, period_end, as_of)
  do update set
    generated_at = now(),
    generated_by = excluded.generated_by,
    data = excluded.data
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.create_financial_report_snapshot(text, jsonb) from public;
grant execute on function public.create_financial_report_snapshot(text, jsonb) to authenticated;

create or replace function public.enterprise_segment_trial_balance(
  p_start date default null,
  p_end date default null,
  p_segment_by text default 'company',
  p_company_id uuid default null,
  p_branch_id uuid default null,
  p_cost_center_id uuid default null,
  p_dept_id uuid default null,
  p_project_id uuid default null,
  p_party_id uuid default null,
  p_currency_view text default 'base',
  p_rollup text default 'account'
)
returns table(
  segment_key text,
  segment_name text,
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
  v_seg text := lower(coalesce(p_segment_by,'company'));
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
      and (p_party_id is null or l.party_id = p_party_id)
  ),
  joined as (
    select
      l.*,
      c.name as company_name,
      b.name as branch_name,
      cc.name as cost_center_name,
      d.name as dept_name,
      pr.name as project_name,
      fp.display_name as party_name
    from filtered l
    left join public.companies c on c.id = l.company_id
    left join public.branches b on b.id = l.branch_id
    left join public.cost_centers cc on cc.id = l.cost_center_id
    left join public.departments d on d.id = l.dept_id
    left join public.projects pr on pr.id = l.project_id
    left join public.financial_parties fp on fp.id = l.party_id
  ),
  grouped as (
    select
      case
        when v_seg = 'branch' then coalesce(l.branch_id::text, '-')
        when v_seg = 'cost_center' then coalesce(l.cost_center_id::text, '-')
        when v_seg = 'department' then coalesce(l.dept_id::text, '-')
        when v_seg = 'project' then coalesce(l.project_id::text, '-')
        when v_seg = 'party' then coalesce(l.party_id::text, '-')
        else coalesce(l.company_id::text, '-')
      end as segment_key,
      case
        when v_seg = 'branch' then coalesce(l.branch_name, '-')
        when v_seg = 'cost_center' then coalesce(l.cost_center_name, '-')
        when v_seg = 'department' then coalesce(l.dept_name, '-')
        when v_seg = 'project' then coalesce(l.project_name, '-')
        when v_seg = 'party' then coalesce(l.party_name, '-')
        else coalesce(l.company_name, '-')
      end as segment_name,
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
    from joined l
    group by 1,2,3,7
  )
  select
    g.segment_key,
    g.segment_name,
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
  order by g.segment_name, g.group_key;
end;
$$;

revoke all on function public.enterprise_segment_trial_balance(date, date, text, uuid, uuid, uuid, uuid, uuid, uuid, text, text) from public;
grant execute on function public.enterprise_segment_trial_balance(date, date, text, uuid, uuid, uuid, uuid, uuid, uuid, text, text) to authenticated;

create or replace function public.enterprise_report_comparative(
  p_report_type text,
  p_periods jsonb,
  p_filters jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_type text := lower(nullif(btrim(coalesce(p_report_type,'')), ''));
  v_filters jsonb := coalesce(p_filters,'{}'::jsonb);
  v_company uuid;
  v_branch uuid;
  v_currency_view text;
  v_rollup text;
  v_out jsonb := '[]'::jsonb;
  v_item jsonb;
  v_label text;
  v_start date;
  v_end date;
  v_as_of date;
  v_data jsonb;
begin
  if not public.can_view_enterprise_financial_reports() then
    raise exception 'not allowed';
  end if;
  if v_type is null then
    raise exception 'report_type required';
  end if;

  begin v_company := nullif(v_filters->>'companyId','')::uuid; exception when others then v_company := null; end;
  begin v_branch := nullif(v_filters->>'branchId','')::uuid; exception when others then v_branch := null; end;
  v_currency_view := nullif(v_filters->>'currencyView','');
  v_rollup := nullif(v_filters->>'rollup','');

  for v_item in select value from jsonb_array_elements(coalesce(p_periods,'[]'::jsonb)) value loop
    v_label := nullif(v_item->>'label','');
    begin v_start := nullif(v_item->>'start','')::date; exception when others then v_start := null; end;
    begin v_end := nullif(v_item->>'end','')::date; exception when others then v_end := null; end;
    begin v_as_of := nullif(v_item->>'asOf','')::date; exception when others then v_as_of := null; end;

    if v_type = 'trial_balance' then
      select coalesce(jsonb_agg(to_jsonb(t) order by t.group_key), '[]'::jsonb)
      into v_data
      from public.enterprise_trial_balance(v_start, v_end, v_company, v_branch, null, null, null, coalesce(v_currency_view,'base'), coalesce(v_rollup,'account')) t;
    elsif v_type = 'balance_sheet' then
      if v_as_of is null then
        v_as_of := v_end;
      end if;
      select coalesce(jsonb_agg(to_jsonb(t) order by t.group_key), '[]'::jsonb)
      into v_data
      from public.enterprise_balance_sheet(v_as_of, v_company, v_branch, null, null, null, coalesce(v_currency_view,'base'), coalesce(v_rollup,'account')) t;
    elsif v_type = 'pl' then
      select coalesce(jsonb_agg(to_jsonb(t) order by abs(t.amount_base) desc), '[]'::jsonb)
      into v_data
      from public.enterprise_profit_and_loss(v_start, v_end, v_company, v_branch, null, null, null, coalesce(v_rollup,'ifrs_line')) t;
    elsif v_type = 'cash_flow_direct' then
      select to_jsonb(t) into v_data
      from public.enterprise_cash_flow_direct(v_start, v_end, v_company, v_branch, null) t;
    elsif v_type = 'cash_flow_indirect' then
      select to_jsonb(t) into v_data
      from public.enterprise_cash_flow_indirect(v_start, v_end, v_company, v_branch, null) t;
    else
      v_data := '{}'::jsonb;
    end if;

    v_out := v_out || jsonb_build_array(
      jsonb_build_object(
        'label', coalesce(v_label, ''),
        'start', case when v_start is null then null else v_start::text end,
        'end', case when v_end is null then null else v_end::text end,
        'asOf', case when v_as_of is null then null else v_as_of::text end,
        'data', coalesce(v_data,'{}'::jsonb)
      )
    );
  end loop;

  return v_out;
end;
$$;

revoke all on function public.enterprise_report_comparative(text, jsonb, jsonb) from public;
grant execute on function public.enterprise_report_comparative(text, jsonb, jsonb) to authenticated;

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
  v_open_cash numeric := 0;
  v_close_cash numeric := 0;
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

  with open_bal as (
    select
      l.ifrs_category,
      max(l.account_type) as account_type,
      sum(l.signed_base_amount) as bal
    from public.enterprise_gl_lines l
    where (p_company_id is null or l.company_id = p_company_id)
      and (p_branch_id is null or l.branch_id = p_branch_id)
      and (p_cost_center_id is null or l.cost_center_id = p_cost_center_id)
      and p_start is not null
      and l.entry_date < p_start
      and l.ifrs_category in ('AccountsReceivable','AccountsPayable','Inventory','VATReceivable','VATPayable')
    group by 1
  ),
  close_bal as (
    select
      l.ifrs_category,
      max(l.account_type) as account_type,
      sum(l.signed_base_amount) as bal
    from public.enterprise_gl_lines l
    where (p_company_id is null or l.company_id = p_company_id)
      and (p_branch_id is null or l.branch_id = p_branch_id)
      and (p_cost_center_id is null or l.cost_center_id = p_cost_center_id)
      and (p_end is null or l.entry_date <= p_end)
      and l.ifrs_category in ('AccountsReceivable','AccountsPayable','Inventory','VATReceivable','VATPayable')
    group by 1
  ),
  deltas as (
    select
      coalesce(c.ifrs_category, o.ifrs_category) as ifrs_category,
      coalesce(c.account_type, o.account_type) as account_type,
      coalesce(c.bal,0) - coalesce(o.bal,0) as delta
    from close_bal c
    full join open_bal o using (ifrs_category)
  )
  select coalesce(sum(
    case
      when ifrs_category in ('AccountsReceivable','Inventory','VATReceivable') then -delta
      when ifrs_category in ('AccountsPayable','VATPayable') then delta
      else 0
    end
  ),0)
  into v_wc
  from deltas;

  with open_bs as (
    select
      coa.cash_flow_section,
      coa.account_type,
      sum(case when coa.normal_balance = 'credit' then (jl.credit - jl.debit) else (jl.debit - jl.credit) end) as bal
    from public.journal_entries je
    join public.journal_lines jl on jl.journal_entry_id = je.id
    join public.chart_of_accounts coa on coa.id = jl.account_id
    where (p_company_id is null or je.company_id = p_company_id)
      and (p_branch_id is null or je.branch_id = p_branch_id)
      and (p_cost_center_id is null or jl.cost_center_id = p_cost_center_id)
      and p_start is not null
      and je.entry_date::date < p_start
      and coa.account_type in ('asset','liability','equity')
      and coalesce(coa.is_cash_account,false) = false
      and coa.cash_flow_section in ('investing','financing')
    group by 1,2
  ),
  close_bs as (
    select
      coa.cash_flow_section,
      coa.account_type,
      sum(case when coa.normal_balance = 'credit' then (jl.credit - jl.debit) else (jl.debit - jl.credit) end) as bal
    from public.journal_entries je
    join public.journal_lines jl on jl.journal_entry_id = je.id
    join public.chart_of_accounts coa on coa.id = jl.account_id
    where (p_company_id is null or je.company_id = p_company_id)
      and (p_branch_id is null or je.branch_id = p_branch_id)
      and (p_cost_center_id is null or jl.cost_center_id = p_cost_center_id)
      and (p_end is null or je.entry_date::date <= p_end)
      and coa.account_type in ('asset','liability','equity')
      and coalesce(coa.is_cash_account,false) = false
      and coa.cash_flow_section in ('investing','financing')
    group by 1,2
  ),
  deltas as (
    select
      coalesce(c.cash_flow_section, o.cash_flow_section) as section,
      coalesce(c.account_type, o.account_type) as account_type,
      coalesce(c.bal,0) - coalesce(o.bal,0) as delta
    from close_bs c
    full join open_bs o using (cash_flow_section, account_type)
  )
  select
    coalesce(sum(case when section = 'investing' and account_type = 'asset' then -delta else 0 end),0),
    coalesce(sum(case when section = 'financing' and account_type in ('liability','equity') then delta else 0 end),0)
  into v_inv, v_fin
  from deltas;

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

create or replace function public.enterprise_cash_flow_indirect_reconciliation(
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
  net_cash_flow numeric,
  opening_cash numeric,
  closing_cash numeric,
  reconciliation_diff numeric
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_row record;
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

  select * into v_row
  from public.enterprise_cash_flow_indirect(p_start, p_end, p_company_id, p_branch_id, p_cost_center_id);

  net_profit := coalesce(v_row.net_profit,0);
  working_capital_change := coalesce(v_row.working_capital_change,0);
  investing_activities := coalesce(v_row.investing_activities,0);
  financing_activities := coalesce(v_row.financing_activities,0);
  net_cash_flow := coalesce(v_row.net_cash_flow,0);
  opening_cash := v_open;
  closing_cash := v_close;
  reconciliation_diff := (v_close - v_open) - net_cash_flow;
  return next;
end;
$$;

revoke all on function public.enterprise_cash_flow_indirect_reconciliation(date, date, uuid, uuid, uuid) from public;
grant execute on function public.enterprise_cash_flow_indirect_reconciliation(date, date, uuid, uuid, uuid) to authenticated;

notify pgrst, 'reload schema';

