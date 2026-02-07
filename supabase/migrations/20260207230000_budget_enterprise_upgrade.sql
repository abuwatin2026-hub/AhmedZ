set app.allow_ledger_ddl = '1';

do $$
begin
  if to_regclass('public.budget_scenarios') is null then
    create table public.budget_scenarios (
      id uuid primary key default gen_random_uuid(),
      base_budget_id uuid not null references public.budget_headers(id) on delete cascade,
      name text not null,
      is_active boolean not null default true,
      created_at timestamptz not null default now(),
      created_by uuid references auth.users(id) on delete set null,
      unique(base_budget_id, name)
    );
    create index if not exists idx_budget_scenarios_base on public.budget_scenarios(base_budget_id, is_active);
  end if;
end $$;

do $$
begin
  if to_regclass('public.budget_headers') is not null then
    begin
      alter table public.budget_headers
        add column scenario_id uuid references public.budget_scenarios(id) on delete set null;
    exception when duplicate_column then null;
    end;
  end if;
end $$;

alter table public.budget_scenarios enable row level security;
drop policy if exists budget_scenarios_select on public.budget_scenarios;
create policy budget_scenarios_select on public.budget_scenarios
for select using (public.has_admin_permission('accounting.view'));
drop policy if exists budget_scenarios_write on public.budget_scenarios;
create policy budget_scenarios_write on public.budget_scenarios
for all using (public.has_admin_permission('accounting.manage'))
with check (public.has_admin_permission('accounting.manage'));

create or replace function public.create_budget_scenario(p_base_budget_id uuid, p_name text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_base public.budget_headers%rowtype;
  v_scenario uuid;
  v_budget uuid;
begin
  if not public.has_admin_permission('accounting.manage') then
    raise exception 'not allowed';
  end if;
  if p_base_budget_id is null then
    raise exception 'base_budget_id required';
  end if;

  select * into v_base from public.budget_headers where id = p_base_budget_id;
  if v_base.id is null then
    raise exception 'base budget not found';
  end if;

  insert into public.budget_scenarios(base_budget_id, name, created_by)
  values (p_base_budget_id, nullif(trim(coalesce(p_name,'')),''), auth.uid())
  returning id into v_scenario;

  insert into public.budget_headers(name, fiscal_year, currency_code, status, company_id, branch_id, created_by, scenario_id)
  values (concat(v_base.name, ' - ', (select name from public.budget_scenarios where id = v_scenario)), v_base.fiscal_year, v_base.currency_code, 'draft', v_base.company_id, v_base.branch_id, auth.uid(), v_scenario)
  returning id into v_budget;

  insert into public.budget_lines(budget_id, period_start, account_id, cost_center_id, party_id, amount_base, currency_code, notes, created_by)
  select
    v_budget,
    bl.period_start,
    bl.account_id,
    bl.cost_center_id,
    bl.party_id,
    bl.amount_base,
    bl.currency_code,
    bl.notes,
    auth.uid()
  from public.budget_lines bl
  where bl.budget_id = p_base_budget_id;

  return v_budget;
end;
$$;

revoke all on function public.create_budget_scenario(uuid, text) from public;
grant execute on function public.create_budget_scenario(uuid, text) to authenticated;

create or replace function public.roll_budget_forward(p_budget_id uuid, p_months int default 1)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_last date;
  v_n int := 0;
begin
  if not public.has_admin_permission('accounting.manage') then
    raise exception 'not allowed';
  end if;
  if p_budget_id is null then
    raise exception 'budget_id required';
  end if;
  select max(period_start) into v_last from public.budget_lines where budget_id = p_budget_id;
  if v_last is null then
    return 0;
  end if;

  with src as (
    select * from public.budget_lines where budget_id = p_budget_id and period_start = v_last
  ),
  months as (
    select (date_trunc('month', v_last) + make_interval(months => gs))::date as period_start
    from generate_series(1, greatest(coalesce(p_months,1),1)) gs
  ),
  ins as (
    insert into public.budget_lines(budget_id, period_start, account_id, cost_center_id, party_id, amount_base, currency_code, notes, created_by)
    select
      p_budget_id,
      m.period_start,
      s.account_id,
      s.cost_center_id,
      s.party_id,
      s.amount_base,
      s.currency_code,
      s.notes,
      auth.uid()
    from src s
    cross join months m
    on conflict (budget_id, period_start, account_id, cost_center_id, party_id) do nothing
    returning 1
  )
  select count(*) into v_n from ins;

  return v_n;
end;
$$;

revoke all on function public.roll_budget_forward(uuid, int) from public;
grant execute on function public.roll_budget_forward(uuid, int) to authenticated;

create or replace function public.create_forecast_budget_from_actuals(
  p_name text,
  p_start_month date,
  p_months int default 3,
  p_lookback_months int default 3,
  p_company_id uuid default null,
  p_branch_id uuid default null,
  p_method text default 'avg'
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_budget uuid;
  v_year int;
  v_base text := public.get_base_currency();
  v_start date := date_trunc('month', p_start_month)::date;
begin
  if not public.has_admin_permission('accounting.manage') then
    raise exception 'not allowed';
  end if;
  if v_start is null then
    raise exception 'start_month required';
  end if;

  v_year := extract(year from v_start)::int;
  v_budget := public.create_budget(nullif(trim(coalesce(p_name,'')),''), v_year, v_base, p_company_id, p_branch_id);

  with lookback as (
    select
      l.account_code,
      max(l.account_name) as account_name,
      max(l.account_type) as account_type,
      date_trunc('month', l.entry_date)::date as period_start,
      sum(
        case
          when l.account_type = 'income' then l.signed_base_amount
          when l.account_type = 'expense' then -l.signed_base_amount
          else 0
        end
      ) as amt
    from public.enterprise_gl_lines l
    where public.can_view_enterprise_financial_reports()
      and l.entry_date >= (v_start - make_interval(months => greatest(coalesce(p_lookback_months,3),1)))
      and l.entry_date < v_start
      and (p_company_id is null or l.company_id = p_company_id)
      and (p_branch_id is null or l.branch_id = p_branch_id)
      and l.account_type in ('income','expense')
    group by l.account_code, date_trunc('month', l.entry_date)::date
  ),
  agg as (
    select
      account_code,
      avg(amt) as avg_amt
    from lookback
    group by account_code
  ),
  months as (
    select (v_start + make_interval(months => gs))::date as period_start
    from generate_series(0, greatest(coalesce(p_months,3),1) - 1) gs
  )
  insert into public.budget_lines(budget_id, period_start, account_id, cost_center_id, party_id, amount_base, currency_code, notes, created_by)
  select
    v_budget,
    m.period_start,
    public.get_account_id_by_code(a.account_code),
    null,
    null,
    round(coalesce(a.avg_amt,0), 2),
    v_base,
    'forecast',
    auth.uid()
  from agg a
  cross join months m
  where public.get_account_id_by_code(a.account_code) is not null
  on conflict (budget_id, period_start, account_id, cost_center_id, party_id) do update
  set amount_base = excluded.amount_base,
      notes = excluded.notes;

  return v_budget;
end;
$$;

revoke all on function public.create_forecast_budget_from_actuals(text, date, int, int, uuid, uuid, text) from public;
grant execute on function public.create_forecast_budget_from_actuals(text, date, int, int, uuid, uuid, text) to authenticated;

create or replace function public.budget_variance_analysis(
  p_budget_id uuid,
  p_start date,
  p_end date,
  p_rollup text default 'ifrs_line',
  p_cost_center_id uuid default null
)
returns table(
  group_key text,
  group_name text,
  account_type text,
  actual_base numeric,
  budget_base numeric,
  variance numeric,
  variance_pct numeric
)
language sql
stable
security definer
set search_path = public
as $$
  with actual as (
    select
      case
        when lower(coalesce(p_rollup,'')) = 'ifrs_line' then coalesce(nullif(l.ifrs_line,''), l.account_code)
        when lower(coalesce(p_rollup,'')) = 'ifrs_category' then coalesce(l.ifrs_category, l.account_type, l.account_code)
        else l.account_code
      end as group_key,
      max(
        case
          when lower(coalesce(p_rollup,'')) = 'ifrs_line' then coalesce(nullif(l.ifrs_line,''), l.account_code)
          when lower(coalesce(p_rollup,'')) = 'ifrs_category' then coalesce(l.ifrs_category, l.account_type, l.account_code)
          else l.account_name
        end
      ) as group_name,
      max(l.account_type) as account_type,
      sum(
        case
          when l.account_type = 'income' then l.signed_base_amount
          when l.account_type = 'expense' then -l.signed_base_amount
          else 0
        end
      ) as actual_base
    from public.enterprise_gl_lines l
    where public.can_view_enterprise_financial_reports()
      and l.entry_date between p_start and p_end
      and (p_cost_center_id is null or l.cost_center_id = p_cost_center_id)
      and l.account_type in ('income','expense')
    group by 1
  ),
  bud as (
    select
      case
        when lower(coalesce(p_rollup,'')) = 'ifrs_line' then coalesce(nullif(coa.ifrs_line,''), coa.code)
        when lower(coalesce(p_rollup,'')) = 'ifrs_category' then coalesce(coa.ifrs_category, coa.account_type, coa.code)
        else coa.code
      end as group_key,
      max(
        case
          when lower(coalesce(p_rollup,'')) = 'ifrs_line' then coalesce(nullif(coa.ifrs_line,''), coa.code)
          when lower(coalesce(p_rollup,'')) = 'ifrs_category' then coalesce(coa.ifrs_category, coa.account_type, coa.code)
          else coa.name
        end
      ) as group_name,
      max(coa.account_type) as account_type,
      sum(bl.amount_base) as budget_base
    from public.budget_lines bl
    join public.chart_of_accounts coa on coa.id = bl.account_id
    where public.has_admin_permission('accounting.view')
      and bl.budget_id = p_budget_id
      and bl.period_start between date_trunc('month', p_start)::date and date_trunc('month', p_end)::date
      and (p_cost_center_id is null or bl.cost_center_id = p_cost_center_id)
      and coa.account_type in ('income','expense')
    group by 1
  )
  select
    coalesce(a.group_key, b.group_key) as group_key,
    coalesce(a.group_name, b.group_name) as group_name,
    coalesce(a.account_type, b.account_type) as account_type,
    coalesce(a.actual_base,0) as actual_base,
    coalesce(b.budget_base,0) as budget_base,
    coalesce(a.actual_base,0) - coalesce(b.budget_base,0) as variance,
    case
      when abs(coalesce(b.budget_base,0)) < 1e-9 then null
      else (coalesce(a.actual_base,0) - coalesce(b.budget_base,0)) / nullif(b.budget_base,0)
    end as variance_pct
  from actual a
  full join bud b on b.group_key = a.group_key
  where abs(coalesce(a.actual_base,0)) > 1e-9 or abs(coalesce(b.budget_base,0)) > 1e-9
  order by abs(coalesce(a.actual_base,0) - coalesce(b.budget_base,0)) desc;
$$;

revoke all on function public.budget_variance_analysis(uuid, date, date, text, uuid) from public;
grant execute on function public.budget_variance_analysis(uuid, date, date, text, uuid) to authenticated;

notify pgrst, 'reload schema';

