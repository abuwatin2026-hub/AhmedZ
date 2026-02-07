set app.allow_ledger_ddl = '1';

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
      fp.name as party_name
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
    group by 1,2,3,8
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

notify pgrst, 'reload schema';

