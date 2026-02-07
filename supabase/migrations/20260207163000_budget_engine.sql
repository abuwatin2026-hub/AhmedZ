set app.allow_ledger_ddl = '1';

do $$
begin
  if to_regclass('public.budget_headers') is null then
    create table public.budget_headers (
      id uuid primary key default gen_random_uuid(),
      name text not null,
      fiscal_year int not null,
      currency_code text not null,
      status text not null default 'draft' check (status in ('draft','active','closed')),
      company_id uuid references public.companies(id) on delete set null,
      branch_id uuid references public.branches(id) on delete set null,
      created_at timestamptz not null default now(),
      created_by uuid references auth.users(id) on delete set null
    );
    create index if not exists idx_budget_headers_year on public.budget_headers(fiscal_year, status);
  end if;
end $$;

do $$
begin
  if to_regclass('public.budget_lines') is null then
    create table public.budget_lines (
      id uuid primary key default gen_random_uuid(),
      budget_id uuid not null references public.budget_headers(id) on delete cascade,
      period_start date not null,
      account_id uuid references public.chart_of_accounts(id) on delete set null,
      cost_center_id uuid references public.cost_centers(id) on delete set null,
      party_id uuid references public.financial_parties(id) on delete set null,
      amount_base numeric not null,
      currency_code text not null,
      notes text,
      created_at timestamptz not null default now(),
      created_by uuid references auth.users(id) on delete set null,
      unique(budget_id, period_start, account_id, cost_center_id, party_id)
    );
    create index if not exists idx_budget_lines_budget_period on public.budget_lines(budget_id, period_start);
  end if;
end $$;

alter table public.budget_headers enable row level security;
alter table public.budget_lines enable row level security;

drop policy if exists budget_headers_select on public.budget_headers;
create policy budget_headers_select on public.budget_headers
for select using (public.has_admin_permission('accounting.view'));
drop policy if exists budget_headers_write on public.budget_headers;
create policy budget_headers_write on public.budget_headers
for all using (public.has_admin_permission('accounting.manage'))
with check (public.has_admin_permission('accounting.manage'));

drop policy if exists budget_lines_select on public.budget_lines;
create policy budget_lines_select on public.budget_lines
for select using (public.has_admin_permission('accounting.view'));
drop policy if exists budget_lines_write on public.budget_lines;
create policy budget_lines_write on public.budget_lines
for all using (public.has_admin_permission('accounting.manage'))
with check (public.has_admin_permission('accounting.manage'));

create or replace function public.create_budget(
  p_name text,
  p_fiscal_year int,
  p_currency_code text,
  p_company_id uuid default null,
  p_branch_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if not public.has_admin_permission('accounting.manage') then
    raise exception 'not allowed';
  end if;
  insert into public.budget_headers(name, fiscal_year, currency_code, status, company_id, branch_id, created_by)
  values (nullif(trim(coalesce(p_name,'')),''), p_fiscal_year, upper(coalesce(p_currency_code, public.get_base_currency())), 'draft', p_company_id, p_branch_id, auth.uid())
  returning id into v_id;
  return v_id;
end;
$$;

revoke all on function public.create_budget(text, int, text, uuid, uuid) from public;
grant execute on function public.create_budget(text, int, text, uuid, uuid) to authenticated;

create or replace function public.add_budget_line(
  p_budget_id uuid,
  p_period_start date,
  p_account_code text,
  p_cost_center_id uuid default null,
  p_party_id uuid default null,
  p_amount_base numeric default 0,
  p_notes text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_acc uuid;
  v_ccy text;
begin
  if not public.has_admin_permission('accounting.manage') then
    raise exception 'not allowed';
  end if;
  if p_budget_id is null then
    raise exception 'budget_id required';
  end if;
  if p_period_start is null then
    raise exception 'period_start required';
  end if;
  if p_account_code is null or btrim(p_account_code) = '' then
    raise exception 'account_code required';
  end if;
  v_acc := public.get_account_id_by_code(p_account_code);
  if v_acc is null then
    raise exception 'account not found %', p_account_code;
  end if;
  select currency_code into v_ccy from public.budget_headers where id = p_budget_id;
  if v_ccy is null then
    raise exception 'budget not found';
  end if;
  insert into public.budget_lines(budget_id, period_start, account_id, cost_center_id, party_id, amount_base, currency_code, notes, created_by)
  values (p_budget_id, p_period_start, v_acc, p_cost_center_id, p_party_id, coalesce(p_amount_base,0), v_ccy, nullif(trim(coalesce(p_notes,'')),''), auth.uid())
  on conflict (budget_id, period_start, account_id, cost_center_id, party_id) do update
  set amount_base = excluded.amount_base,
      notes = excluded.notes
  returning id into v_id;
  return v_id;
end;
$$;

revoke all on function public.add_budget_line(uuid, date, text, uuid, uuid, numeric, text) from public;
grant execute on function public.add_budget_line(uuid, date, text, uuid, uuid, numeric, text) to authenticated;

create or replace function public.budget_vs_actual_pnl(
  p_budget_id uuid,
  p_start date,
  p_end date,
  p_cost_center_id uuid default null
)
returns table(
  account_code text,
  account_name text,
  account_type text,
  actual_base numeric,
  budget_base numeric,
  variance numeric
)
language sql
stable
security definer
set search_path = public
as $$
  with actual as (
    select
      l.account_code,
      max(l.account_name) as account_name,
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
    group by l.account_code
  ),
  bud as (
    select
      coa.code as account_code,
      sum(bl.amount_base) as budget_base
    from public.budget_lines bl
    join public.budget_headers bh on bh.id = bl.budget_id
    join public.chart_of_accounts coa on coa.id = bl.account_id
    where public.has_admin_permission('accounting.view')
      and bl.budget_id = p_budget_id
      and bl.period_start between date_trunc('month', p_start)::date and date_trunc('month', p_end)::date
      and (p_cost_center_id is null or bl.cost_center_id = p_cost_center_id)
    group by coa.code
  )
  select
    coalesce(a.account_code, b.account_code) as account_code,
    coalesce(a.account_name, (select name from public.chart_of_accounts where code = b.account_code limit 1)) as account_name,
    coalesce(a.account_type, (select account_type from public.chart_of_accounts where code = b.account_code limit 1)) as account_type,
    coalesce(a.actual_base,0) as actual_base,
    coalesce(b.budget_base,0) as budget_base,
    coalesce(a.actual_base,0) - coalesce(b.budget_base,0) as variance
  from actual a
  full join bud b on b.account_code = a.account_code
  where abs(coalesce(a.actual_base,0)) > 1e-9 or abs(coalesce(b.budget_base,0)) > 1e-9
  order by abs(coalesce(a.actual_base,0) - coalesce(b.budget_base,0)) desc;
$$;

revoke all on function public.budget_vs_actual_pnl(uuid, date, date, uuid) from public;
grant execute on function public.budget_vs_actual_pnl(uuid, date, date, uuid) to authenticated;

notify pgrst, 'reload schema';
