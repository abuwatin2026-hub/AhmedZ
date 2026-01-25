revoke all on function public.post_payment(uuid) from public;
revoke all on function public.post_inventory_movement(uuid) from public;
revoke all on function public.post_order_delivery(uuid) from public;

grant execute on function public.post_payment(uuid) to service_role;
grant execute on function public.post_inventory_movement(uuid) to service_role;
grant execute on function public.post_order_delivery(uuid) to service_role;

create or replace function public.reverse_journal_entry(p_journal_entry_id uuid, p_reason text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_src public.journal_entries%rowtype;
  v_new_entry_id uuid;
begin
  if not (auth.role() = 'service_role' or public.has_admin_permission('accounting.manage')) then
    raise exception 'not authorized to post accounting entries';
  end if;
  if p_journal_entry_id is null then
    raise exception 'p_journal_entry_id is required';
  end if;

  select *
  into v_src
  from public.journal_entries je
  where je.id = p_journal_entry_id
  for update;

  if not found then
    raise exception 'journal entry not found';
  end if;

  if coalesce(v_src.source_table, '') = '' then
    raise exception 'not allowed';
  end if;

  if exists (
    select 1
    from public.journal_entries je
    where je.source_table = 'journal_entries'
      and je.source_id = p_journal_entry_id::text
      and je.source_event = 'reversal'
  ) then
    raise exception 'already reversed';
  end if;

  insert into public.journal_entries(entry_date, memo, source_table, source_id, source_event, created_by)
  values (
    now(),
    concat('REVERSAL of ', p_journal_entry_id::text, ': ', coalesce(nullif(p_reason,''), '')),
    'journal_entries',
    p_journal_entry_id::text,
    'reversal',
    auth.uid()
  )
  returning id into v_new_entry_id;

  insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo)
  select
    v_new_entry_id,
    jl.account_id,
    jl.credit,
    jl.debit,
    concat('Reversal: ', coalesce(jl.line_memo,''))
  from public.journal_lines jl
  where jl.journal_entry_id = p_journal_entry_id;

  perform public.check_journal_entry_balance(v_new_entry_id);

  return v_new_entry_id;
end;
$$;

revoke all on function public.reverse_journal_entry(uuid, text) from public;
revoke execute on function public.reverse_journal_entry(uuid, text) from anon;
grant execute on function public.reverse_journal_entry(uuid, text) to authenticated;
grant execute on function public.reverse_journal_entry(uuid, text) to service_role;

alter table public.journal_entries force row level security;
alter table public.journal_lines force row level security;
alter table public.accounting_periods force row level security;
alter table public.accounting_period_snapshots force row level security;
alter table public.system_audit_logs force row level security;
alter table public.ledger_audit_log force row level security;

drop policy if exists ledger_audit_log_insert_internal on public.ledger_audit_log;
create policy ledger_audit_log_insert_internal
on public.ledger_audit_log
for insert
with check (true);

create or replace function public.balances_as_of(p_as_of timestamptz)
returns table(account_id uuid, balance numeric)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_period_id uuid;
  v_end date;
  v_from timestamptz;
begin
  if not (auth.role() = 'service_role' or public.has_admin_permission('accounting.view')) then
    raise exception 'not allowed';
  end if;

  if p_as_of is null then
    raise exception 'p_as_of is required';
  end if;

  select ap.id, ap.end_date
  into v_period_id, v_end
  from public.accounting_periods ap
  where ap.status = 'closed'
    and ap.end_date < (p_as_of::date)
    and exists (
      select 1
      from public.accounting_period_snapshots aps
      where aps.period_id = ap.id
      limit 1
    )
  order by ap.end_date desc
  limit 1;

  if v_period_id is null then
    return query
    select
      coa.id as account_id,
      coalesce(sum(
        case
          when coa.normal_balance = 'debit' then jl.debit - jl.credit
          else jl.credit - jl.debit
        end
      ), 0) as balance
    from public.chart_of_accounts coa
    left join public.journal_lines jl on jl.account_id = coa.id
    left join public.journal_entries je
      on je.id = jl.journal_entry_id
     and je.entry_date <= p_as_of
    where coa.is_active = true
    group by coa.id;
    return;
  end if;

  v_from := ((v_end + 1)::timestamptz);

  return query
  with base as (
    select aps.account_id, aps.closing_balance
    from public.accounting_period_snapshots aps
    where aps.period_id = v_period_id
  ),
  delta as (
    select
      coa.id as account_id,
      coalesce(sum(
        case
          when coa.normal_balance = 'debit' then jl.debit - jl.credit
          else jl.credit - jl.debit
        end
      ), 0) as delta_balance
    from public.chart_of_accounts coa
    left join public.journal_lines jl on jl.account_id = coa.id
    left join public.journal_entries je
      on je.id = jl.journal_entry_id
     and je.entry_date >= v_from
     and je.entry_date <= p_as_of
    where coa.is_active = true
    group by coa.id
  )
  select
    coa.id as account_id,
    coalesce(b.closing_balance, 0) + coalesce(d.delta_balance, 0) as balance
  from public.chart_of_accounts coa
  left join base b on b.account_id = coa.id
  left join delta d on d.account_id = coa.id
  where coa.is_active = true;
end;
$$;

create or replace function public.assert_balance_sheet(p_as_of timestamptz)
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_assets numeric;
  v_le numeric;
begin
  if not (auth.role() = 'service_role' or public.has_admin_permission('accounting.view')) then
    raise exception 'not allowed';
  end if;

  select
    sum(case when coa.account_type = 'asset' then b.balance else 0 end),
    sum(case when coa.account_type in ('liability','equity') then b.balance else 0 end)
  into v_assets, v_le
  from public.balances_as_of(p_as_of) b
  join public.chart_of_accounts coa on coa.id = b.account_id
  where coa.account_type in ('asset','liability','equity')
    and coa.is_active = true;

  if abs(coalesce(v_assets,0) - coalesce(v_le,0)) > 1e-6 then
    raise exception 'Balance Sheet not balanced (assets %, liabilities+equity %)', v_assets, v_le;
  end if;
end;
$$;

create or replace function public.profit_and_loss_by_range(p_start date, p_end date)
returns table(
  statement_section text,
  account_code text,
  account_name text,
  amount numeric
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not (auth.role() = 'service_role' or public.has_admin_permission('accounting.view')) then
    raise exception 'not allowed';
  end if;

  return query
  with lines as (
    select
      coa.code,
      coa.name,
      coa.account_type,
      coa.normal_balance,
      coalesce(sum(jl.debit), 0) as debit,
      coalesce(sum(jl.credit), 0) as credit
    from public.chart_of_accounts coa
    left join public.journal_lines jl on jl.account_id = coa.id
    left join public.journal_entries je
      on je.id = jl.journal_entry_id
     and (p_start is null or je.entry_date::date >= p_start)
     and (p_end is null or je.entry_date::date <= p_end)
    where coa.account_type in ('income','expense')
      and coa.is_active = true
    group by coa.code, coa.name, coa.account_type, coa.normal_balance
  ),
  amounts as (
    select
      case
        when l.account_type = 'income' then 'Revenue'
        when l.code = '5010' then 'COGS'
        else 'Operating Expenses'
      end as statement_section,
      l.code as account_code,
      l.name as account_name,
      case
        when l.normal_balance = 'debit' then (l.debit - l.credit)
        else (l.credit - l.debit)
      end as amount
    from lines l
  )
  select a.statement_section, a.account_code, a.account_name, a.amount
  from amounts a
  where abs(a.amount) > 1e-9
  order by
    case a.statement_section when 'Revenue' then 1 when 'COGS' then 2 else 3 end,
    a.account_code;
end;
$$;

create or replace function public.cogs_reconciliation_by_range(p_start date, p_end date)
returns table(
  item_id text,
  expected_cogs numeric,
  actual_cogs numeric,
  delta numeric
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not (auth.role() = 'service_role' or public.has_admin_permission('accounting.view')) then
    raise exception 'not allowed';
  end if;

  return query
  with mv as (
    select
      im.id,
      im.item_id,
      im.total_cost,
      im.occurred_at::date as d,
      im.movement_type
    from public.inventory_movements im
    where im.movement_type in ('sale_out','wastage_out','expired_out')
      and (p_start is null or im.occurred_at::date >= p_start)
      and (p_end is null or im.occurred_at::date <= p_end)
  ),
  expected as (
    select m.item_id, coalesce(sum(m.total_cost), 0) as expected_cogs
    from mv m
    group by m.item_id
  ),
  actual as (
    select
      m.item_id,
      coalesce(sum(jl.debit - jl.credit), 0) as actual_cogs
    from mv m
    join public.journal_entries je
      on je.source_table = 'inventory_movements'
     and je.source_id = m.id::text
     and je.source_event = m.movement_type
    join public.journal_lines jl
      on jl.journal_entry_id = je.id
    join public.chart_of_accounts coa
      on coa.id = jl.account_id
    where coa.code = '5010'
    group by m.item_id
  )
  select
    coalesce(e.item_id, a.item_id) as item_id,
    coalesce(e.expected_cogs, 0) as expected_cogs,
    coalesce(a.actual_cogs, 0) as actual_cogs,
    (coalesce(e.expected_cogs, 0) - coalesce(a.actual_cogs, 0)) as delta
  from expected e
  full join actual a on a.item_id = e.item_id
  order by abs(coalesce(e.expected_cogs, 0) - coalesce(a.actual_cogs, 0)) desc, item_id;
end;
$$;

create or replace function public.assert_trial_balance_by_range(p_start date, p_end date)
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_d numeric;
  v_c numeric;
begin
  if not (auth.role() = 'service_role' or public.has_admin_permission('accounting.view')) then
    raise exception 'not allowed';
  end if;

  select
    coalesce(sum(tb.total_debits), 0),
    coalesce(sum(tb.total_credits), 0)
  into v_d, v_c
  from public.trial_balance_by_range(p_start, p_end) tb;

  if abs(coalesce(v_d,0) - coalesce(v_c,0)) > 1e-6 then
    raise exception 'Trial balance not balanced (debits %, credits %)', v_d, v_c;
  end if;
end;
$$;
