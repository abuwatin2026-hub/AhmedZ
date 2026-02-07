set app.allow_ledger_ddl = '1';

do $$
begin
  if to_regclass('public.chart_of_accounts') is not null then
    insert into public.chart_of_accounts(code, name, account_type, normal_balance, is_active, ifrs_statement, ifrs_category, ifrs_line)
    values
      ('3055', 'Cumulative Translation Adjustment', 'equity', 'credit', true, 'EQ', 'EquityOther', 'CTA'),
      ('3060', 'Non-controlling Interest', 'equity', 'credit', true, 'EQ', 'EquityOther', 'NCI')
    on conflict (code) do update
    set name = excluded.name,
        account_type = excluded.account_type,
        normal_balance = excluded.normal_balance,
        is_active = true,
        ifrs_statement = excluded.ifrs_statement,
        ifrs_category = excluded.ifrs_category,
        ifrs_line = excluded.ifrs_line;
  end if;
exception when others then
  null;
end $$;

do $$
begin
  if to_regclass('public.companies') is not null then
    begin
      alter table public.companies
        add column if not exists functional_currency text;
    exception when others then
      null;
    end;
    begin
      alter table public.companies
        add constraint companies_functional_currency_fk
        foreign key (functional_currency) references public.currencies(code)
        on update cascade on delete set null;
    exception when duplicate_object then
      null;
    end;
    update public.companies
    set functional_currency = coalesce(nullif(functional_currency,''), public.get_base_currency())
    where functional_currency is null or btrim(functional_currency) = '';
  end if;
end $$;

do $$
begin
  if to_regclass('public.consolidation_intercompany_parties') is null then
    create table public.consolidation_intercompany_parties (
      id uuid primary key default gen_random_uuid(),
      group_id uuid not null references public.consolidation_groups(id) on delete cascade,
      company_id uuid not null references public.companies(id) on delete restrict,
      counterparty_company_id uuid not null references public.companies(id) on delete restrict,
      party_id uuid not null references public.financial_parties(id) on delete restrict,
      created_at timestamptz not null default now(),
      created_by uuid references auth.users(id) on delete set null,
      unique (group_id, company_id, counterparty_company_id, party_id)
    );
    create index if not exists idx_consol_icp_group_company on public.consolidation_intercompany_parties(group_id, company_id);
    create index if not exists idx_consol_icp_group_party on public.consolidation_intercompany_parties(group_id, party_id);
  end if;
end $$;

do $$
begin
  if to_regclass('public.consolidation_elimination_accounts') is null then
    create table public.consolidation_elimination_accounts (
      id uuid primary key default gen_random_uuid(),
      group_id uuid not null references public.consolidation_groups(id) on delete cascade,
      elimination_type text not null check (elimination_type in ('ar_ap','revenue_expense','fx')),
      account_code text not null,
      created_at timestamptz not null default now(),
      created_by uuid references auth.users(id) on delete set null,
      unique (group_id, elimination_type, account_code)
    );
    create index if not exists idx_consol_elim_accounts_group_type on public.consolidation_elimination_accounts(group_id, elimination_type);
  end if;
end $$;

do $$
begin
  if to_regclass('public.consolidation_unrealized_profit_rules') is null then
    create table public.consolidation_unrealized_profit_rules (
      id uuid primary key default gen_random_uuid(),
      group_id uuid not null references public.consolidation_groups(id) on delete cascade,
      inventory_account_code text not null default '1410',
      cogs_account_code text not null default '5010',
      percent_remaining numeric not null default 0 check (percent_remaining >= 0 and percent_remaining <= 1),
      is_active boolean not null default false,
      created_at timestamptz not null default now(),
      created_by uuid references auth.users(id) on delete set null,
      unique (group_id)
    );
  end if;
end $$;

alter table public.consolidation_intercompany_parties enable row level security;
alter table public.consolidation_elimination_accounts enable row level security;
alter table public.consolidation_unrealized_profit_rules enable row level security;

drop policy if exists consolidation_intercompany_parties_select on public.consolidation_intercompany_parties;
create policy consolidation_intercompany_parties_select on public.consolidation_intercompany_parties
for select using (public.has_admin_permission('accounting.view'));
drop policy if exists consolidation_intercompany_parties_write on public.consolidation_intercompany_parties;
create policy consolidation_intercompany_parties_write on public.consolidation_intercompany_parties
for all using (public.has_admin_permission('accounting.manage'))
with check (public.has_admin_permission('accounting.manage'));

drop policy if exists consolidation_elimination_accounts_select on public.consolidation_elimination_accounts;
create policy consolidation_elimination_accounts_select on public.consolidation_elimination_accounts
for select using (public.has_admin_permission('accounting.view'));
drop policy if exists consolidation_elimination_accounts_write on public.consolidation_elimination_accounts;
create policy consolidation_elimination_accounts_write on public.consolidation_elimination_accounts
for all using (public.has_admin_permission('accounting.manage'))
with check (public.has_admin_permission('accounting.manage'));

drop policy if exists consolidation_unrealized_profit_rules_select on public.consolidation_unrealized_profit_rules;
create policy consolidation_unrealized_profit_rules_select on public.consolidation_unrealized_profit_rules
for select using (public.has_admin_permission('accounting.view'));
drop policy if exists consolidation_unrealized_profit_rules_write on public.consolidation_unrealized_profit_rules;
create policy consolidation_unrealized_profit_rules_write on public.consolidation_unrealized_profit_rules
for all using (public.has_admin_permission('accounting.manage'))
with check (public.has_admin_permission('accounting.manage'));

do $$
declare
  v_group uuid;
begin
  for v_group in select id from public.consolidation_groups
  loop
    insert into public.consolidation_elimination_accounts(group_id, elimination_type, account_code, created_by)
    values
      (v_group, 'ar_ap', '1200', auth.uid()),
      (v_group, 'ar_ap', '2010', auth.uid()),
      (v_group, 'revenue_expense', '4010', auth.uid()),
      (v_group, 'revenue_expense', '5010', auth.uid()),
      (v_group, 'fx', '6200', auth.uid()),
      (v_group, 'fx', '6201', auth.uid())
    on conflict (group_id, elimination_type, account_code) do nothing;
    insert into public.consolidation_unrealized_profit_rules(group_id, is_active, created_by)
    values (v_group, false, auth.uid())
    on conflict (group_id) do nothing;
  end loop;
exception when others then
  null;
end $$;

create or replace function public.fx_convert(
  p_amount numeric,
  p_from_currency text,
  p_to_currency text,
  p_date date,
  p_rate_type text default 'accounting'
)
returns numeric
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_base text := upper(nullif(btrim(coalesce(public.get_base_currency(), '')), ''));
  v_from text := upper(nullif(btrim(coalesce(p_from_currency, '')), ''));
  v_to text := upper(nullif(btrim(coalesce(p_to_currency, '')), ''));
  v_date date := coalesce(p_date, current_date);
  v_type text := lower(nullif(btrim(coalesce(p_rate_type, '')), ''));
  v_amt numeric := coalesce(p_amount, 0);
  v_r_from numeric;
  v_r_to numeric;
begin
  if v_type is null then
    v_type := 'accounting';
  end if;
  if v_from is null then
    v_from := v_base;
  end if;
  if v_to is null then
    v_to := v_base;
  end if;
  if v_from = v_to then
    return v_amt;
  end if;
  if v_from = v_base then
    v_r_to := public.get_fx_rate(v_to, v_date, v_type);
    if v_r_to is null or v_r_to <= 0 then
      raise exception 'fx rate missing for %', v_to;
    end if;
    return v_amt / v_r_to;
  end if;
  if v_to = v_base then
    v_r_from := public.get_fx_rate(v_from, v_date, v_type);
    if v_r_from is null or v_r_from <= 0 then
      raise exception 'fx rate missing for %', v_from;
    end if;
    return v_amt * v_r_from;
  end if;
  v_r_from := public.get_fx_rate(v_from, v_date, v_type);
  v_r_to := public.get_fx_rate(v_to, v_date, v_type);
  if v_r_from is null or v_r_from <= 0 then
    raise exception 'fx rate missing for %', v_from;
  end if;
  if v_r_to is null or v_r_to <= 0 then
    raise exception 'fx rate missing for %', v_to;
  end if;
  return (v_amt * v_r_from) / v_r_to;
end;
$$;

revoke all on function public.fx_convert(numeric, text, text, date, text) from public;
grant execute on function public.fx_convert(numeric, text, text, date, text) to authenticated;

create or replace function public.get_fx_rate_avg(
  p_currency text,
  p_start date,
  p_end date,
  p_rate_type text default 'accounting'
)
returns numeric
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_currency text := upper(nullif(btrim(coalesce(p_currency, '')), ''));
  v_type text := lower(nullif(btrim(coalesce(p_rate_type, '')), ''));
  v_start date := coalesce(p_start, coalesce(p_end, current_date));
  v_end date := coalesce(p_end, current_date);
  v_avg numeric;
begin
  if v_type is null then
    v_type := 'accounting';
  end if;
  if v_currency is null or v_currency = upper(public.get_base_currency()) then
    return 1;
  end if;
  if v_start > v_end then
    v_start := v_end;
  end if;
  select avg(fr.rate)
  into v_avg
  from public.fx_rates fr
  where upper(fr.currency_code) = v_currency
    and fr.rate_type = v_type
    and fr.rate_date between v_start and v_end;
  if v_avg is null or v_avg <= 0 then
    v_avg := public.get_fx_rate(v_currency, v_end, v_type);
  end if;
  if v_avg is null or v_avg <= 0 then
    raise exception 'fx avg rate missing for %', v_currency;
  end if;
  return v_avg;
end;
$$;

revoke all on function public.get_fx_rate_avg(text, date, date, text) from public;
grant execute on function public.get_fx_rate_avg(text, date, date, text) to authenticated;

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
  v_base text := upper(public.get_base_currency());
  v_reporting text;
  v_view text := lower(nullif(btrim(coalesce(p_currency_view,'')), ''));
  v_roll text := lower(nullif(btrim(coalesce(p_rollup,'')), ''));
  v_start_ytd date;
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

  select upper(coalesce(nullif(btrim(cg.reporting_currency),''), v_base))
  into v_reporting
  from public.consolidation_groups cg
  where cg.id = p_group_id;

  if v_reporting is null then
    v_reporting := v_base;
  end if;

  v_start_ytd := date_trunc('year', p_as_of)::date;

  return query
  with members as (
    select m.company_id, m.ownership_pct, m.consolidation_method
    from public.consolidation_group_members m
    where m.group_id = p_group_id
  ),
  excluded as (
    select r.account_code
    from public.intercompany_elimination_rules r
    where r.group_id = p_group_id
      and r.rule_type = 'exclude'
  ),
  elim_accounts as (
    select elimination_type, account_code
    from public.consolidation_elimination_accounts a
    where a.group_id = p_group_id
  ),
  upr as (
    select r.inventory_account_code, r.cogs_account_code, r.percent_remaining
    from public.consolidation_unrealized_profit_rules r
    where r.group_id = p_group_id and r.is_active = true
  ),
  lines as (
    select
      l.*,
      m.ownership_pct,
      m.consolidation_method,
      case when m.consolidation_method = 'full' then 1 else coalesce(m.ownership_pct, 1) end as eff_pct,
      exists(
        select 1
        from public.consolidation_intercompany_parties icp
        where icp.group_id = p_group_id
          and icp.company_id = l.company_id
          and icp.party_id = l.party_id
      ) as is_intercompany
    from public.enterprise_gl_lines l
    join members m on m.company_id = l.company_id
    where l.entry_date <= p_as_of
      and not exists (select 1 from excluded e where e.account_code = l.account_code)
  ),
  base_grouped as (
    select
      case
        when v_roll = 'ifrs_line' then coalesce(nullif(l.ifrs_line,''), l.account_code)
        when v_roll = 'ifrs_category' then coalesce(l.ifrs_category, l.account_type, l.account_code)
        else l.account_code
      end as group_key,
      case
        when v_roll = 'ifrs_line' then max(coalesce(nullif(l.ifrs_line,''), l.account_code))
        when v_roll = 'ifrs_category' then max(coalesce(l.ifrs_category, l.account_type, l.account_code))
        else max(l.account_name)
      end as group_name,
      max(l.account_type) as account_type,
      max(l.ifrs_statement) as ifrs_statement,
      max(l.ifrs_category) as ifrs_category,
      upper(
        case
          when v_view in ('revalued','foreign') then coalesce(nullif(l.currency_code,''), v_base)
          when v_view in ('reporting','translated') then v_reporting
          else v_base
        end
      ) as currency_code,
      sum(l.signed_base_amount * l.eff_pct) as balance_base,
      sum(l.signed_foreign_amount * l.eff_pct) as balance_foreign,
      sum(
        case
          when v_view not in ('reporting','translated') then 0
          when l.account_type in ('asset','liability') then public.fx_convert((l.signed_base_amount * l.eff_pct), v_base, v_reporting, p_as_of, 'accounting')
          when l.account_type in ('income','expense') then (l.signed_base_amount * l.eff_pct) / public.get_fx_rate_avg(v_reporting, v_start_ytd, p_as_of, 'accounting')
          else public.fx_convert((l.signed_base_amount * l.eff_pct), v_base, v_reporting, l.entry_date, 'accounting')
        end
      ) as translated_amount
    from lines l
    group by 1, 6
  ),
  elim_adjustments as (
    select
      l.account_code as account_code,
      sum(l.signed_base_amount * l.eff_pct) as amt_base,
      sum(l.signed_foreign_amount * l.eff_pct) as amt_foreign,
      sum(
        case
          when l.account_type in ('asset','liability') then public.fx_convert((l.signed_base_amount * l.eff_pct), v_base, v_reporting, p_as_of, 'accounting')
          when l.account_type in ('income','expense') then (l.signed_base_amount * l.eff_pct) / public.get_fx_rate_avg(v_reporting, v_start_ytd, p_as_of, 'accounting')
          else public.fx_convert((l.signed_base_amount * l.eff_pct), v_base, v_reporting, l.entry_date, 'accounting')
        end
      ) as amt_reporting
    from lines l
    join elim_accounts ea on ea.account_code = l.account_code
    where l.is_intercompany = true
      and ea.elimination_type in ('ar_ap','revenue_expense','fx')
    group by l.account_code
  ),
  elim_rows as (
    select
      ea.account_code,
      coa.name as account_name,
      coa.account_type,
      coa.ifrs_statement,
      coa.ifrs_category,
      coa.ifrs_line,
      (-coalesce(ea.amt_base,0)) as balance_base,
      (-coalesce(ea.amt_foreign,0)) as balance_foreign,
      (-coalesce(ea.amt_reporting,0)) as translated_amount
    from elim_adjustments ea
    join public.chart_of_accounts coa on coa.code = ea.account_code
  ),
  unrealized_calc as (
    select
      (select inventory_account_code from upr) as inventory_code,
      (select cogs_account_code from upr) as cogs_code,
      (select percent_remaining from upr) as pct,
      coalesce(sum(
        case
          when l.is_intercompany is not true then 0
          when l.account_type = 'income' then (l.signed_base_amount * l.eff_pct)
          when l.account_type = 'expense' then -(l.signed_base_amount * l.eff_pct)
          else 0
        end
      ),0) as interco_gross_profit_base
    from lines l
    where exists (select 1 from upr)
  ),
  unrealized_rows as (
    select
      inv.code as account_code,
      inv.name as account_name,
      inv.account_type,
      inv.ifrs_statement,
      inv.ifrs_category,
      inv.ifrs_line,
      (-(coalesce(uc.interco_gross_profit_base,0) * coalesce(uc.pct,0))) as balance_base,
      null::numeric as balance_foreign,
      (-(public.fx_convert((coalesce(uc.interco_gross_profit_base,0) * coalesce(uc.pct,0)), v_base, v_reporting, p_as_of, 'accounting'))) as translated_amount
    from unrealized_calc uc
    join public.chart_of_accounts inv on inv.code = uc.inventory_code
    where coalesce(uc.pct,0) > 0
    union all
    select
      cogs.code as account_code,
      cogs.name as account_name,
      cogs.account_type,
      cogs.ifrs_statement,
      cogs.ifrs_category,
      cogs.ifrs_line,
      (coalesce(uc.interco_gross_profit_base,0) * coalesce(uc.pct,0)) as balance_base,
      null::numeric as balance_foreign,
      (public.fx_convert((coalesce(uc.interco_gross_profit_base,0) * coalesce(uc.pct,0)), v_base, v_reporting, p_as_of, 'accounting')) as translated_amount
    from unrealized_calc uc
    join public.chart_of_accounts cogs on cogs.code = uc.cogs_code
    where coalesce(uc.pct,0) > 0
  ),
  company_net_assets as (
    select
      l.company_id,
      coalesce(sum(case when l.account_type = 'asset' then l.signed_base_amount else 0 end),0) as assets_base,
      coalesce(sum(case when l.account_type = 'liability' then l.signed_base_amount else 0 end),0) as liabilities_base
    from lines l
    group by l.company_id
  ),
  nci_calc as (
    select
      coalesce(sum(
        (1 - coalesce(m.ownership_pct,1)) * (coalesce(c.assets_base,0) - coalesce(c.liabilities_base,0))
      ),0) as nci_base
    from members m
    join company_net_assets c on c.company_id = m.company_id
    where m.consolidation_method = 'full'
      and coalesce(m.ownership_pct,1) < 1
  ),
  nci_row as (
    select
      coa.code as account_code,
      coa.name as account_name,
      coa.account_type,
      coa.ifrs_statement,
      coa.ifrs_category,
      coa.ifrs_line,
      coalesce(n.nci_base,0) as balance_base,
      null::numeric as balance_foreign,
      public.fx_convert(coalesce(n.nci_base,0), v_base, v_reporting, p_as_of, 'accounting') as translated_amount
    from nci_calc n
    join public.chart_of_accounts coa on coa.code = '3060'
    group by coa.code, coa.name, coa.account_type, coa.ifrs_statement, coa.ifrs_category, coa.ifrs_line, n.nci_base
    having abs(coalesce(n.nci_base,0)) > 1e-6
  ),
  all_rows as (
    select
      bg.group_key,
      bg.group_name,
      bg.account_type,
      bg.ifrs_statement,
      bg.ifrs_category,
      bg.currency_code,
      coalesce(bg.balance_base,0) as balance_base,
      case
        when v_view = 'revalued' then
          case
            when upper(bg.currency_code) = upper(v_base) or bg.balance_foreign is null then coalesce(bg.balance_base,0)
            else coalesce(bg.balance_foreign,0) * public.get_fx_rate(bg.currency_code, p_as_of, 'accounting')
          end
        when v_view in ('reporting','translated') then coalesce(bg.translated_amount,0)
        else coalesce(bg.balance_base,0)
      end as view_balance_base
    from base_grouped bg
    union all
    select
      er.account_code as group_key,
      max(er.account_name) as group_name,
      max(er.account_type) as account_type,
      max(er.ifrs_statement) as ifrs_statement,
      max(er.ifrs_category) as ifrs_category,
      upper(case when v_view in ('reporting','translated') then v_reporting else v_base end) as currency_code,
      sum(er.balance_base) as balance_base,
      sum(
        case when v_view in ('reporting','translated') then er.translated_amount else er.balance_base end
      ) as view_balance_base
    from (
      select * from elim_rows
      union all
      select * from unrealized_rows
      union all
      select * from nci_row
    ) er
    group by er.account_code
  ),
  cta_amount as (
    select
      case
        when v_view not in ('reporting','translated') then 0
        else coalesce(sum(case when ar.account_type = 'asset' then ar.view_balance_base else 0 end),0)
           - coalesce(sum(case when ar.account_type = 'liability' then ar.view_balance_base else 0 end),0)
           - coalesce(sum(case when ar.account_type = 'equity' then ar.view_balance_base else 0 end),0)
      end as cta
    from all_rows ar
  ),
  cta_row as (
    select
      coa.code as group_key,
      coa.name as group_name,
      coa.account_type,
      coa.ifrs_statement,
      coa.ifrs_category,
      v_reporting as currency_code,
      public.fx_convert(ca.cta, v_reporting, v_base, p_as_of, 'accounting') as balance_base,
      ca.cta as view_balance_base
    from cta_amount ca
    join public.chart_of_accounts coa on coa.code = '3055'
    where abs(coalesce(ca.cta,0)) > 1e-6
  )
  select
    ar.group_key,
    ar.group_name,
    ar.account_type,
    ar.ifrs_statement,
    ar.ifrs_category,
    ar.currency_code,
    coalesce(ar.balance_base,0) as balance_base,
    coalesce(ar.view_balance_base,0) as revalued_balance_base
  from (
    select * from all_rows
    union all
    select * from cta_row
  ) ar
  where abs(coalesce(ar.view_balance_base,0)) > 1e-9
  order by ar.group_key;
end;
$$;

revoke all on function public.consolidated_trial_balance(uuid, date, text, text) from public;
grant execute on function public.consolidated_trial_balance(uuid, date, text, text) to authenticated;

do $$
begin
  if to_regclass('public.consolidation_snapshot_headers') is null then
    create table public.consolidation_snapshot_headers (
      id uuid primary key default gen_random_uuid(),
      group_id uuid not null references public.consolidation_groups(id) on delete cascade,
      as_of date not null,
      rollup text not null default 'account',
      currency_view text not null default 'base',
      reporting_currency text not null,
      created_at timestamptz not null default now(),
      created_by uuid references auth.users(id) on delete set null,
      unique (group_id, as_of, rollup, currency_view)
    );
  end if;
  if to_regclass('public.consolidation_snapshot_lines') is null then
    create table public.consolidation_snapshot_lines (
      id uuid primary key default gen_random_uuid(),
      snapshot_id uuid not null references public.consolidation_snapshot_headers(id) on delete cascade,
      group_key text not null,
      group_name text,
      account_type text,
      ifrs_statement text,
      ifrs_category text,
      currency_code text not null,
      balance_base numeric not null default 0,
      view_balance numeric not null default 0,
      created_at timestamptz not null default now(),
      unique (snapshot_id, group_key, currency_code)
    );
    create index if not exists idx_consol_snapshot_lines_snapshot on public.consolidation_snapshot_lines(snapshot_id);
  end if;
end $$;

alter table public.consolidation_snapshot_headers enable row level security;
alter table public.consolidation_snapshot_lines enable row level security;

drop policy if exists consolidation_snapshot_headers_select on public.consolidation_snapshot_headers;
create policy consolidation_snapshot_headers_select on public.consolidation_snapshot_headers
for select using (public.has_admin_permission('accounting.view'));
drop policy if exists consolidation_snapshot_headers_write on public.consolidation_snapshot_headers;
create policy consolidation_snapshot_headers_write on public.consolidation_snapshot_headers
for all using (public.has_admin_permission('accounting.manage'))
with check (public.has_admin_permission('accounting.manage'));

drop policy if exists consolidation_snapshot_lines_select on public.consolidation_snapshot_lines;
create policy consolidation_snapshot_lines_select on public.consolidation_snapshot_lines
for select using (public.has_admin_permission('accounting.view'));
drop policy if exists consolidation_snapshot_lines_write_none on public.consolidation_snapshot_lines;
create policy consolidation_snapshot_lines_write_none on public.consolidation_snapshot_lines
for all using (false)
with check (false);

create or replace function public.create_consolidation_snapshot(
  p_group_id uuid,
  p_as_of date,
  p_rollup text default 'account',
  p_currency_view text default 'base'
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_reporting text;
begin
  if not public.has_admin_permission('accounting.manage') then
    raise exception 'not allowed';
  end if;
  if p_group_id is null then
    raise exception 'group_id required';
  end if;
  if p_as_of is null then
    raise exception 'as_of required';
  end if;

  select upper(coalesce(nullif(btrim(cg.reporting_currency),''), public.get_base_currency()))
  into v_reporting
  from public.consolidation_groups cg
  where cg.id = p_group_id;
  if v_reporting is null then
    v_reporting := upper(public.get_base_currency());
  end if;

  insert into public.consolidation_snapshot_headers(group_id, as_of, rollup, currency_view, reporting_currency, created_by)
  values (p_group_id, p_as_of, lower(coalesce(p_rollup,'account')), lower(coalesce(p_currency_view,'base')), v_reporting, auth.uid())
  on conflict (group_id, as_of, rollup, currency_view) do update
  set reporting_currency = excluded.reporting_currency,
      created_at = now(),
      created_by = excluded.created_by
  returning id into v_id;

  delete from public.consolidation_snapshot_lines where snapshot_id = v_id;

  insert into public.consolidation_snapshot_lines(
    snapshot_id, group_key, group_name, account_type, ifrs_statement, ifrs_category, currency_code, balance_base, view_balance
  )
  select
    v_id,
    tb.group_key,
    tb.group_name,
    tb.account_type,
    tb.ifrs_statement,
    tb.ifrs_category,
    tb.currency_code,
    tb.balance_base,
    tb.revalued_balance_base
  from public.consolidated_trial_balance(p_group_id, p_as_of, p_rollup, p_currency_view) tb;

  return v_id;
end;
$$;

revoke all on function public.create_consolidation_snapshot(uuid, date, text, text) from public;
grant execute on function public.create_consolidation_snapshot(uuid, date, text, text) to authenticated;

notify pgrst, 'reload schema';
