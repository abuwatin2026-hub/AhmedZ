create table if not exists public.accounting_period_snapshots (
  period_id uuid not null references public.accounting_periods(id) on delete cascade,
  account_id uuid not null references public.chart_of_accounts(id) on delete restrict,
  closing_balance numeric not null,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  primary key (period_id, account_id)
);

alter table public.accounting_period_snapshots enable row level security;
drop policy if exists accounting_period_snapshots_admin_select on public.accounting_period_snapshots;
create policy accounting_period_snapshots_admin_select
on public.accounting_period_snapshots
for select
using (public.has_admin_permission('accounting.view'));
drop policy if exists accounting_period_snapshots_admin_write on public.accounting_period_snapshots;
create policy accounting_period_snapshots_admin_write
on public.accounting_period_snapshots
for insert
with check (public.has_admin_permission('accounting.manage') or auth.role() = 'service_role');

revoke all on table public.accounting_period_snapshots from anon, authenticated;
grant select, insert on table public.accounting_period_snapshots to authenticated;

create or replace function public.trg_accounting_period_snapshots_immutable()
returns trigger
language plpgsql
as $$
begin
  if public._is_migration_actor() then
    return coalesce(new, old);
  end if;
  raise exception 'accounting_period_snapshots are immutable';
end;
$$;

drop trigger if exists trg_accounting_period_snapshots_immutable on public.accounting_period_snapshots;
create trigger trg_accounting_period_snapshots_immutable
before update or delete on public.accounting_period_snapshots
for each row execute function public.trg_accounting_period_snapshots_immutable();

create or replace function public.generate_accounting_period_snapshot(p_period_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_period record;
  v_as_of timestamptz;
begin
  if p_period_id is null then
    raise exception 'p_period_id is required';
  end if;

  if not public._is_migration_actor() and not public.has_admin_permission('accounting.periods.close') then
    raise exception 'not allowed';
  end if;

  select *
  into v_period
  from public.accounting_periods ap
  where ap.id = p_period_id
  for update;

  if not found then
    raise exception 'period not found';
  end if;

  if v_period.status <> 'closed' then
    raise exception 'period must be closed before snapshot';
  end if;

  v_as_of := ((v_period.end_date + 1)::timestamptz);

  insert into public.accounting_period_snapshots(period_id, account_id, closing_balance, created_by)
  select
    v_period.id,
    coa.id,
    coalesce(sum(
      case
        when coa.normal_balance = 'debit' then jl.debit - jl.credit
        else jl.credit - jl.debit
      end
    ), 0) as closing_balance,
    auth.uid()
  from public.chart_of_accounts coa
  left join public.journal_lines jl on jl.account_id = coa.id
  left join public.journal_entries je
    on je.id = jl.journal_entry_id
   and je.entry_date < v_as_of
  where coa.is_active = true
  group by coa.id
  on conflict (period_id, account_id) do nothing;
end;
$$;

revoke all on function public.generate_accounting_period_snapshot(uuid) from public;
grant execute on function public.generate_accounting_period_snapshot(uuid) to authenticated;

create or replace function public.trg_accounting_period_generate_snapshot_on_close()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'UPDATE'
     and old.status is distinct from new.status
     and new.status = 'closed' then
    perform public.generate_accounting_period_snapshot(new.id);
  end if;
  return new;
end;
$$;

drop trigger if exists trg_accounting_period_generate_snapshot_on_close on public.accounting_periods;
create trigger trg_accounting_period_generate_snapshot_on_close
after update on public.accounting_periods
for each row execute function public.trg_accounting_period_generate_snapshot_on_close();

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

revoke all on function public.balances_as_of(timestamptz) from public;
grant execute on function public.balances_as_of(timestamptz) to authenticated;

create or replace view public.v_balance_sheet as
with b as (
  select *
  from public.balances_as_of(now())
),
rows as (
  select
    coa.account_type,
    coa.code as account_code,
    coa.name as account_name,
    b.balance
  from public.chart_of_accounts coa
  join b on b.account_id = coa.id
  where coa.account_type in ('asset','liability','equity')
)
select
  r.account_type,
  r.account_code,
  r.account_name,
  r.balance,
  sum(case when r.account_type = 'asset' then r.balance else 0 end) over () as total_assets,
  sum(case when r.account_type in ('liability','equity') then r.balance else 0 end) over () as total_liabilities_equity,
  (sum(case when r.account_type = 'asset' then r.balance else 0 end) over ()
   - sum(case when r.account_type in ('liability','equity') then r.balance else 0 end) over ()) as discrepancy
from rows r
order by
  case r.account_type when 'asset' then 1 when 'liability' then 2 else 3 end,
  r.account_code;

alter view public.v_balance_sheet set (security_invoker = true);
grant select on public.v_balance_sheet to authenticated;

comment on view public.v_balance_sheet is 'Purpose: Balance Sheet as-of now. Source of truth: balances_as_of(now()) which uses accounting_period_snapshots for closed periods and journal_entries/journal_lines only for post-snapshot deltas. Output: one row per BS account plus totals and discrepancy.';

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

revoke all on function public.assert_balance_sheet(timestamptz) from public;
grant execute on function public.assert_balance_sheet(timestamptz) to authenticated;

create or replace function public.profit_and_loss_by_range(p_start date, p_end date)
returns table(
  statement_section text,
  account_code text,
  account_name text,
  amount numeric
)
language sql
stable
security definer
set search_path = public
as $$
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
$$;

revoke all on function public.profit_and_loss_by_range(date, date) from public;
grant execute on function public.profit_and_loss_by_range(date, date) to authenticated;

create or replace function public.profit_and_loss_by_period(p_period_id uuid)
returns table(
  statement_section text,
  account_code text,
  account_name text,
  amount numeric
)
language sql
stable
security definer
set search_path = public
as $$
  select *
  from public.profit_and_loss_by_range(
    (select ap.start_date from public.accounting_periods ap where ap.id = p_period_id),
    (select ap.end_date from public.accounting_periods ap where ap.id = p_period_id)
  );
$$;

revoke all on function public.profit_and_loss_by_period(uuid) from public;
grant execute on function public.profit_and_loss_by_period(uuid) to authenticated;

create or replace view public.v_profit_and_loss as
select *
from public.profit_and_loss_by_range(
  date_trunc('month', now())::date,
  (date_trunc('month', now())::date + interval '1 month - 1 day')::date
);

alter view public.v_profit_and_loss set (security_invoker = true);
grant select on public.v_profit_and_loss to authenticated;

comment on view public.v_profit_and_loss is 'Purpose: Profit & Loss for current month. Source of truth: journal_entries/journal_lines filtered by entry_date::date range; closed periods are protected by Phase 10 period lock. Output: account rows grouped into Revenue/COGS/Operating Expenses.';

create or replace function public.cogs_reconciliation_by_range(p_start date, p_end date)
returns table(
  item_id text,
  expected_cogs numeric,
  actual_cogs numeric,
  delta numeric
)
language sql
stable
security definer
set search_path = public
as $$
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
$$;

revoke all on function public.cogs_reconciliation_by_range(date, date) from public;
grant execute on function public.cogs_reconciliation_by_range(date, date) to authenticated;

create or replace view public.v_cogs_reconciliation as
select *
from public.cogs_reconciliation_by_range(
  date_trunc('month', now())::date,
  (date_trunc('month', now())::date + interval '1 month - 1 day')::date
);

alter view public.v_cogs_reconciliation set (security_invoker = true);
grant select on public.v_cogs_reconciliation to authenticated;

comment on view public.v_cogs_reconciliation is 'Purpose: COGS reconciliation for current month. Source of truth: inventory_movements (sale_out/wastage_out/expired_out) vs journal_entries/journal_lines posted to COGS account 5010 for the same movement source. Output: expected, actual, delta per item_id.';

create or replace function public.trial_balance_by_range(p_start date, p_end date)
returns table(
  account_code text,
  account_name text,
  account_type text,
  normal_balance text,
  opening_balance numeric,
  total_debits numeric,
  total_credits numeric,
  closing_balance numeric
)
language sql
stable
security definer
set search_path = public
as $$
  with opening as (
    select
      coa.id as account_id,
      coalesce(sum(
        case
          when coa.normal_balance = 'debit' then jl.debit - jl.credit
          else jl.credit - jl.debit
        end
      ), 0) as opening_balance
    from public.chart_of_accounts coa
    left join public.journal_lines jl on jl.account_id = coa.id
    left join public.journal_entries je
      on je.id = jl.journal_entry_id
     and (p_start is null or je.entry_date::date < p_start)
    where coa.is_active = true
    group by coa.id
  ),
  period as (
    select
      coa.id as account_id,
      coalesce(sum(jl.debit), 0) as total_debits,
      coalesce(sum(jl.credit), 0) as total_credits,
      coalesce(sum(
        case
          when coa.normal_balance = 'debit' then jl.debit - jl.credit
          else jl.credit - jl.debit
        end
      ), 0) as period_delta
    from public.chart_of_accounts coa
    left join public.journal_lines jl on jl.account_id = coa.id
    left join public.journal_entries je
      on je.id = jl.journal_entry_id
     and (p_start is null or je.entry_date::date >= p_start)
     and (p_end is null or je.entry_date::date <= p_end)
    where coa.is_active = true
    group by coa.id
  )
  select
    coa.code as account_code,
    coa.name as account_name,
    coa.account_type,
    coa.normal_balance,
    o.opening_balance,
    p.total_debits,
    p.total_credits,
    (o.opening_balance + p.period_delta) as closing_balance
  from public.chart_of_accounts coa
  join opening o on o.account_id = coa.id
  join period p on p.account_id = coa.id
  where public.has_admin_permission('accounting.view')
  order by coa.code;
$$;

revoke all on function public.trial_balance_by_range(date, date) from public;
grant execute on function public.trial_balance_by_range(date, date) to authenticated;

create or replace view public.v_trial_balance as
select *
from public.trial_balance_by_range(
  date_trunc('month', now())::date,
  (date_trunc('month', now())::date + interval '1 month - 1 day')::date
);

alter view public.v_trial_balance set (security_invoker = true);
grant select on public.v_trial_balance to authenticated;

comment on view public.v_trial_balance is 'Purpose: Trial balance for current month with opening/period/closing. Source of truth: journal_entries/journal_lines with signed balances by normal_balance. Output: one row per account.';

create or replace view public.v_trial_balance_totals as
with tb as (
  select * from public.v_trial_balance
)
select
  coalesce(sum(tb.total_debits), 0) as sum_debits,
  coalesce(sum(tb.total_credits), 0) as sum_credits,
  (coalesce(sum(tb.total_debits), 0) - coalesce(sum(tb.total_credits), 0)) as discrepancy
from tb;

alter view public.v_trial_balance_totals set (security_invoker = true);
grant select on public.v_trial_balance_totals to authenticated;

comment on view public.v_trial_balance_totals is 'Purpose: Trial balance control totals for current month. Source of truth: v_trial_balance. Output: sum_debits, sum_credits, discrepancy.';

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

revoke all on function public.assert_trial_balance_by_range(date, date) from public;
grant execute on function public.assert_trial_balance_by_range(date, date) to authenticated;

comment on table public.accounting_period_snapshots is 'Purpose: immutable account closing balances captured at period close. Source of truth: journal_entries/journal_lines up to period end at close time. Used by balances_as_of() to avoid recalculating closed periods.';
comment on function public.generate_accounting_period_snapshot(uuid) is 'Purpose: create snapshot rows for a closed accounting period. Source of truth: journal_entries/journal_lines up to (end_date + 1 day). Expected output: one row per active account in accounting_period_snapshots.';
comment on function public.balances_as_of(timestamptz) is 'Purpose: compute signed balances as-of timestamp using last available closed snapshot + post-snapshot deltas, or full journal scan when no snapshot exists. Source of truth: accounting_period_snapshots and journal_entries/journal_lines.';
comment on function public.profit_and_loss_by_range(date, date) is 'Purpose: compute P&L over a date range from journal_entries/journal_lines grouped by chart_of_accounts. Source of truth: journal_entries/journal_lines; period lock enforced by Phase 10.';
comment on function public.cogs_reconciliation_by_range(date, date) is 'Purpose: reconcile expected COGS from inventory_movements vs journaled COGS (account 5010) posted from those movements. Source of truth: inventory_movements and journal_entries/journal_lines.';
comment on function public.trial_balance_by_range(date, date) is 'Purpose: period trial balance with opening/period/closing and control totals computed externally. Source of truth: journal_entries/journal_lines signed by normal_balance.';
comment on function public.trg_accounting_period_snapshots_immutable() is 'Purpose: hard-seal snapshots (no update/delete). Source of truth: accounting_period_snapshots; migration actors bypass via _is_migration_actor().';
comment on function public.trg_accounting_period_generate_snapshot_on_close() is 'Purpose: auto-generate snapshots when accounting_periods.status transitions to closed. Source of truth: accounting_periods updates performed by close_accounting_period.';
comment on function public.profit_and_loss_by_period(uuid) is 'Purpose: P&L by accounting_periods.id. Source of truth: profit_and_loss_by_range using period start_date/end_date.';
comment on function public.assert_balance_sheet(timestamptz) is 'Purpose: hard assertion that Assets = Liabilities + Equity as-of timestamp. Source of truth: balances_as_of() and chart_of_accounts classifications.';
comment on function public.assert_trial_balance_by_range(date, date) is 'Purpose: hard assertion that Σdebits = Σcredits for a date range. Source of truth: trial_balance_by_range().';
