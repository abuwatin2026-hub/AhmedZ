set app.allow_ledger_ddl = '1';

do $$
begin
  if to_regclass('public.consolidation_groups') is null then
    create table public.consolidation_groups (
      id uuid primary key default gen_random_uuid(),
      name text not null,
      parent_company_id uuid not null references public.companies(id) on delete restrict,
      reporting_currency text not null,
      created_at timestamptz not null default now(),
      created_by uuid references auth.users(id) on delete set null
    );
    create index if not exists idx_consolidation_groups_parent on public.consolidation_groups(parent_company_id);
  end if;
end $$;

do $$
begin
  if to_regclass('public.consolidation_group_members') is null then
    create table public.consolidation_group_members (
      id uuid primary key default gen_random_uuid(),
      group_id uuid not null references public.consolidation_groups(id) on delete cascade,
      company_id uuid not null references public.companies(id) on delete restrict,
      ownership_pct numeric not null default 1 check (ownership_pct >= 0 and ownership_pct <= 1),
      consolidation_method text not null default 'full' check (consolidation_method in ('full','equity')),
      created_at timestamptz not null default now(),
      created_by uuid references auth.users(id) on delete set null,
      unique (group_id, company_id)
    );
    create index if not exists idx_consolidation_group_members_group on public.consolidation_group_members(group_id);
  end if;
end $$;

do $$
begin
  if to_regclass('public.intercompany_elimination_rules') is null then
    create table public.intercompany_elimination_rules (
      id uuid primary key default gen_random_uuid(),
      group_id uuid not null references public.consolidation_groups(id) on delete cascade,
      account_code text not null,
      rule_type text not null default 'exclude' check (rule_type in ('exclude')),
      created_at timestamptz not null default now(),
      created_by uuid references auth.users(id) on delete set null,
      unique (group_id, account_code)
    );
  end if;
end $$;

alter table public.consolidation_groups enable row level security;
alter table public.consolidation_group_members enable row level security;
alter table public.intercompany_elimination_rules enable row level security;

drop policy if exists consolidation_groups_select on public.consolidation_groups;
create policy consolidation_groups_select on public.consolidation_groups
for select using (public.has_admin_permission('accounting.view'));
drop policy if exists consolidation_groups_write on public.consolidation_groups;
create policy consolidation_groups_write on public.consolidation_groups
for all using (public.has_admin_permission('accounting.manage'))
with check (public.has_admin_permission('accounting.manage'));

drop policy if exists consolidation_group_members_select on public.consolidation_group_members;
create policy consolidation_group_members_select on public.consolidation_group_members
for select using (public.has_admin_permission('accounting.view'));
drop policy if exists consolidation_group_members_write on public.consolidation_group_members;
create policy consolidation_group_members_write on public.consolidation_group_members
for all using (public.has_admin_permission('accounting.manage'))
with check (public.has_admin_permission('accounting.manage'));

drop policy if exists intercompany_elimination_rules_select on public.intercompany_elimination_rules;
create policy intercompany_elimination_rules_select on public.intercompany_elimination_rules
for select using (public.has_admin_permission('accounting.view'));
drop policy if exists intercompany_elimination_rules_write on public.intercompany_elimination_rules;
create policy intercompany_elimination_rules_write on public.intercompany_elimination_rules
for all using (public.has_admin_permission('accounting.manage'))
with check (public.has_admin_permission('accounting.manage'));

create or replace function public.create_consolidation_group(p_name text, p_parent_company_id uuid, p_reporting_currency text)
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
  insert into public.consolidation_groups(name, parent_company_id, reporting_currency, created_by)
  values (nullif(trim(coalesce(p_name,'')),''), p_parent_company_id, upper(coalesce(p_reporting_currency, public.get_base_currency())), auth.uid())
  returning id into v_id;
  return v_id;
end;
$$;

revoke all on function public.create_consolidation_group(text, uuid, text) from public;
grant execute on function public.create_consolidation_group(text, uuid, text) to authenticated;

create or replace function public.add_consolidation_member(p_group_id uuid, p_company_id uuid, p_ownership_pct numeric default 1)
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
  insert into public.consolidation_group_members(group_id, company_id, ownership_pct, created_by)
  values (p_group_id, p_company_id, coalesce(p_ownership_pct,1), auth.uid())
  on conflict (group_id, company_id) do update
  set ownership_pct = excluded.ownership_pct
  returning id into v_id;
  return v_id;
end;
$$;

revoke all on function public.add_consolidation_member(uuid, uuid, numeric) from public;
grant execute on function public.add_consolidation_member(uuid, uuid, numeric) to authenticated;

create or replace function public.consolidated_trial_balance(
  p_group_id uuid,
  p_as_of date,
  p_rollup text default 'account',
  p_currency_view text default 'base'
)
returns table(
  group_key text,
  group_name text,
  account_type text,
  ifrs_statement text,
  ifrs_category text,
  currency_code text,
  balance_base numeric,
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
  if p_group_id is null then
    raise exception 'group_id required';
  end if;
  if p_as_of is null then
    raise exception 'as_of required';
  end if;

  return query
  with members as (
    select m.company_id, m.ownership_pct
    from public.consolidation_group_members m
    where m.group_id = p_group_id
  ),
  excluded as (
    select r.account_code
    from public.intercompany_elimination_rules r
    where r.group_id = p_group_id
      and r.rule_type = 'exclude'
  ),
  lines as (
    select
      l.*,
      m.ownership_pct
    from public.enterprise_gl_lines l
    join members m on m.company_id = l.company_id
    where l.entry_date <= p_as_of
      and not exists (select 1 from excluded e where e.account_code = l.account_code)
  ),
  grouped as (
    select
      case
        when lower(coalesce(p_rollup,'')) = 'ifrs_line' then coalesce(l.ifrs_line, l.account_name, l.account_code)
        when lower(coalesce(p_rollup,'')) = 'ifrs_category' then coalesce(l.ifrs_category, l.account_type, l.account_code)
        else l.account_code
      end as group_key,
      case
        when lower(coalesce(p_rollup,'')) = 'ifrs_line' then coalesce(l.ifrs_line, l.account_name, l.account_code)
        when lower(coalesce(p_rollup,'')) = 'ifrs_category' then coalesce(l.ifrs_category, l.account_type, l.account_code)
        else max(l.account_name)
      end as group_name,
      max(l.account_type) as account_type,
      max(l.ifrs_statement) as ifrs_statement,
      max(l.ifrs_category) as ifrs_category,
      upper(case when lower(coalesce(p_currency_view,'')) = 'revalued' then coalesce(nullif(l.currency_code,''), v_base) else v_base end) as currency_code,
      sum(l.signed_base_amount * l.ownership_pct) as balance_base,
      sum(l.signed_foreign_amount * l.ownership_pct) as balance_foreign
    from lines l
    group by 1
  )
  select
    g.group_key,
    g.group_name,
    g.account_type,
    g.ifrs_statement,
    g.ifrs_category,
    g.currency_code,
    coalesce(g.balance_base,0) as balance_base,
    case
      when lower(coalesce(p_currency_view,'')) <> 'revalued' then coalesce(g.balance_base,0)
      when upper(g.currency_code) = upper(v_base) or g.balance_foreign is null then coalesce(g.balance_base,0)
      else coalesce(g.balance_foreign,0) * public.get_fx_rate(g.currency_code, p_as_of, 'accounting')
    end as revalued_balance_base
  from grouped g
  order by g.group_key;
end;
$$;

revoke all on function public.consolidated_trial_balance(uuid, date, text, text) from public;
grant execute on function public.consolidated_trial_balance(uuid, date, text, text) to authenticated;

notify pgrst, 'reload schema';

