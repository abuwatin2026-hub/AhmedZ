set app.allow_ledger_ddl = '1';

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
    where abs(coalesce(n.nci_base,0)) > 1e-6
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
  ),
  final_rows as (
    select * from all_rows
    union all
    select * from cta_row
  )
  select
    fr.group_key,
    max(fr.group_name) as group_name,
    max(fr.account_type) as account_type,
    max(fr.ifrs_statement) as ifrs_statement,
    max(fr.ifrs_category) as ifrs_category,
    fr.currency_code,
    coalesce(sum(fr.balance_base),0) as balance_base,
    coalesce(sum(fr.view_balance_base),0) as revalued_balance_base
  from final_rows fr
  group by fr.group_key, fr.currency_code
  having abs(coalesce(sum(fr.view_balance_base),0)) > 1e-9
  order by fr.group_key;
end;
$$;

revoke all on function public.consolidated_trial_balance(uuid, date, text, text) from public;
grant execute on function public.consolidated_trial_balance(uuid, date, text, text) to authenticated;

notify pgrst, 'reload schema';

