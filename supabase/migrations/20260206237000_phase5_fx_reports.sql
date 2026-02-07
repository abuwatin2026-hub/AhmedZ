create or replace function public.get_fx_gain_loss_report(
  p_start date default null,
  p_end date default null
)
returns table(
  entry_date date,
  account_code text,
  account_name text,
  debit numeric,
  credit numeric,
  net_credit numeric
)
language sql
stable
security definer
set search_path = public
as $$
  select
    je.entry_date::date as entry_date,
    coa.code as account_code,
    coa.name as account_name,
    sum(jl.debit) as debit,
    sum(jl.credit) as credit,
    sum(jl.credit - jl.debit) as net_credit
  from public.journal_lines jl
  join public.journal_entries je on je.id = jl.journal_entry_id
  join public.chart_of_accounts coa on coa.id = jl.account_id
  where public.has_admin_permission('accounting.view')
    and coa.code in ('6200','6201','6250','6251')
    and (p_start is null or je.entry_date::date >= p_start)
    and (p_end is null or je.entry_date::date <= p_end)
  group by je.entry_date::date, coa.code, coa.name
  order by je.entry_date::date desc, coa.code asc;
$$;

revoke all on function public.get_fx_gain_loss_report(date, date) from public;
revoke execute on function public.get_fx_gain_loss_report(date, date) from anon;
grant execute on function public.get_fx_gain_loss_report(date, date) to authenticated;

create or replace function public.get_revaluation_summary(p_period_end date)
returns table(
  entity_type text,
  currency text,
  items_count int,
  diff_total numeric
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.has_admin_permission('accounting.view') then
    raise exception 'not allowed';
  end if;
  if p_period_end is null then
    raise exception 'period_end required';
  end if;
  return query
    select x.entity_type, upper(x.currency) as currency, count(*)::int as items_count, sum(x.diff) as diff_total
    from public.fx_revaluation_audit x
    where x.period_end = p_period_end
    group by x.entity_type, upper(x.currency)
    union all
    select 'MONETARY'::text, upper(m.currency) as currency, count(*)::int as items_count, sum(m.diff) as diff_total
    from public.fx_revaluation_monetary_audit m
    where m.period_end = p_period_end
    group by upper(m.currency)
    order by 1, 2;
end;
$$;

revoke all on function public.get_revaluation_summary(date) from public;
revoke execute on function public.get_revaluation_summary(date) from anon;
grant execute on function public.get_revaluation_summary(date) to authenticated;

create or replace function public.get_foreign_balance_report(p_as_of date default null)
returns table(
  entity_type text,
  entity_id text,
  currency text,
  foreign_amount numeric,
  base_amount numeric
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_as_of date := coalesce(p_as_of, current_date);
  v_base text := public.get_base_currency();
begin
  if not public.has_admin_permission('accounting.view') then
    raise exception 'not allowed';
  end if;

  return query
  with ar as (
    select
      'AR'::text as entity_type,
      o.id::text as entity_id,
      upper(coalesce(o.currency, v_base)) as currency,
      case
        when upper(coalesce(o.currency, v_base)) = upper(v_base) then null
        when coalesce(o.base_total, 0) <= 0 then null
        else (coalesce(o.total, 0) * (coalesce(a.open_balance,0) / nullif(o.base_total,0)))
      end as foreign_amount,
      coalesce(a.open_balance, 0) as base_amount
    from public.ar_open_items a
    join public.orders o on o.id = a.invoice_id
    where a.status = 'open'
  ),
  ap as (
    select
      'AP'::text as entity_type,
      po.id::text as entity_id,
      upper(coalesce(po.currency, v_base)) as currency,
      greatest(0, coalesce(po.total_amount, 0) - coalesce((
        select sum(coalesce(p.amount,0))
        from public.payments p
        where p.reference_table = 'purchase_orders'
          and p.direction = 'out'
          and p.reference_id = po.id::text
          and p.occurred_at::date <= v_as_of
      ), 0)) as foreign_amount,
      greatest(0, coalesce(po.base_total, 0) - coalesce((
        select sum(coalesce(p.base_amount,0))
        from public.payments p
        where p.reference_table = 'purchase_orders'
          and p.direction = 'out'
          and p.reference_id = po.id::text
          and p.occurred_at::date <= v_as_of
      ), 0)) as base_amount
    from public.purchase_orders po
  ),
  monetary as (
    select
      'MONETARY'::text as entity_type,
      coa.code as entity_id,
      upper(jl.currency_code) as currency,
      sum(case when jl.debit > 0 then coalesce(jl.foreign_amount, 0) else -coalesce(jl.foreign_amount, 0) end) as foreign_amount,
      sum(jl.debit - jl.credit) as base_amount
    from public.journal_lines jl
    join public.journal_entries je on je.id = jl.journal_entry_id
    join public.chart_of_accounts coa on coa.id = jl.account_id
    where je.entry_date::date <= v_as_of
      and jl.currency_code is not null
      and upper(jl.currency_code) <> upper(v_base)
      and jl.foreign_amount is not null
      and coa.code in ('1010','1020')
    group by coa.code, upper(jl.currency_code)
    having abs(sum(case when jl.debit > 0 then coalesce(jl.foreign_amount, 0) else -coalesce(jl.foreign_amount, 0) end)) > 0.0000001
  )
  select * from ar
  union all
  select * from ap
  union all
  select * from monetary;
end;
$$;

revoke all on function public.get_foreign_balance_report(date) from public;
revoke execute on function public.get_foreign_balance_report(date) from anon;
grant execute on function public.get_foreign_balance_report(date) to authenticated;

notify pgrst, 'reload schema';

