do $$
declare
  v_constraint_name text;
begin
  if to_regclass('public.admin_users') is null then
    return;
  end if;

  for v_constraint_name in
    select c.conname
    from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
    where n.nspname = 'public'
      and t.relname = 'admin_users'
      and c.contype = 'c'
      and exists (
        select 1
        from unnest(c.conkey) k
        join pg_attribute a on a.attrelid = t.oid and a.attnum = k
        where a.attname = 'role'
      )
  loop
    execute format('alter table public.admin_users drop constraint if exists %I', v_constraint_name);
  end loop;

  begin
    alter table public.admin_users
      add constraint admin_users_role_check
      check (role in ('owner','manager','employee','cashier','delivery','accountant'));
  exception
    when duplicate_object then null;
  end;
end $$;

create or replace function public.has_admin_permission(p text)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_role text;
  v_perms text[];
begin
  select au.role, au.permissions
  into v_role, v_perms
  from public.admin_users au
  where au.auth_user_id = auth.uid()
    and au.is_active = true;

  if v_role is null then
    return false;
  end if;

  if v_role in ('owner', 'manager') then
    return true;
  end if;

  if v_perms is not null and p = any(v_perms) then
    return true;
  end if;

  if v_role = 'cashier' then
    return p = any(array[
      'dashboard.view',
      'profile.view',
      'orders.view',
      'orders.markPaid',
      'orders.createInStore',
      'cashShifts.open',
      'cashShifts.viewOwn',
      'cashShifts.closeSelf',
      'cashShifts.cashIn',
      'cashShifts.cashOut'
    ]);
  end if;

  if v_role = 'delivery' then
    return p = any(array[
      'profile.view',
      'orders.view',
      'orders.updateStatus.delivery'
    ]);
  end if;

  if v_role = 'employee' then
    return p = any(array[
      'dashboard.view',
      'profile.view',
      'orders.view',
      'orders.markPaid'
    ]);
  end if;

  if v_role = 'accountant' then
    return p = any(array[
      'dashboard.view',
      'profile.view',
      'reports.view',
      'expenses.manage',
      'accounting.view',
      'accounting.manage',
      'accounting.periods.close'
    ]);
  end if;

  return false;
end;
$$;

create or replace function public.can_view_reports()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.has_admin_permission('reports.view') or public.has_admin_permission('accounting.view');
$$;

revoke all on function public.can_view_reports() from public;
grant execute on function public.can_view_reports() to anon, authenticated;

drop policy if exists coa_admin_select on public.chart_of_accounts;
create policy coa_admin_select
on public.chart_of_accounts
for select
using (public.has_admin_permission('accounting.view'));

drop policy if exists coa_admin_write on public.chart_of_accounts;
create policy coa_admin_write
on public.chart_of_accounts
for all
using (public.has_admin_permission('accounting.manage'))
with check (public.has_admin_permission('accounting.manage'));

drop policy if exists journal_entries_admin_select on public.journal_entries;
create policy journal_entries_admin_select
on public.journal_entries
for select
using (public.has_admin_permission('accounting.view'));

drop policy if exists journal_entries_admin_write on public.journal_entries;
create policy journal_entries_admin_write
on public.journal_entries
for all
using (public.has_admin_permission('accounting.manage'))
with check (public.has_admin_permission('accounting.manage'));

drop policy if exists journal_lines_admin_select on public.journal_lines;
create policy journal_lines_admin_select
on public.journal_lines
for select
using (public.has_admin_permission('accounting.view'));

drop policy if exists journal_lines_admin_write on public.journal_lines;
create policy journal_lines_admin_write
on public.journal_lines
for all
using (public.has_admin_permission('accounting.manage'))
with check (public.has_admin_permission('accounting.manage'));

drop policy if exists accounting_periods_admin_select on public.accounting_periods;
create policy accounting_periods_admin_select
on public.accounting_periods
for select
using (public.has_admin_permission('accounting.view'));

drop policy if exists orders_select_permissions on public.orders;
create policy orders_select_permissions
on public.orders
for select
using (
  (auth.role() = 'authenticated' and customer_auth_user_id = auth.uid())
  or (
    exists (
      select 1
      from public.admin_users au
      where au.auth_user_id = auth.uid()
        and au.is_active = true
        and au.role <> 'delivery'
    )
    and public.has_admin_permission('orders.view')
  )
  or (
    exists (
      select 1
      from public.admin_users au
      where au.auth_user_id = auth.uid()
        and au.is_active = true
        and au.role = 'delivery'
    )
    and ((data->>'assignedDeliveryUserId') = auth.uid()::text)
  )
);

drop policy if exists order_events_select_permissions on public.order_events;
create policy order_events_select_permissions
on public.order_events
for select
using (
  exists (
    select 1
    from public.orders o
    where o.id = order_events.order_id
      and (
        (o.customer_auth_user_id = auth.uid())
        or (
          exists (
            select 1
            from public.admin_users au
            where au.auth_user_id = auth.uid()
              and au.is_active = true
              and au.role <> 'delivery'
          )
          and public.has_admin_permission('orders.view')
        )
        or (
          exists (
            select 1
            from public.admin_users au
            where au.auth_user_id = auth.uid()
              and au.is_active = true
              and au.role = 'delivery'
          )
          and ((o.data->>'assignedDeliveryUserId') = auth.uid()::text)
        )
      )
  )
);

create or replace function public.close_accounting_period(p_period_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_period record;
  v_entry_id uuid;
  v_entry_date timestamptz;
  v_retained uuid;
  v_income_total numeric := 0;
  v_expense_total numeric := 0;
  v_profit numeric := 0;
  v_amount numeric := 0;
  v_has_lines boolean := false;
  v_row record;
begin
  if not public.has_admin_permission('accounting.periods.close') then
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

  if v_period.status = 'closed' then
    return;
  end if;

  v_entry_date := (v_period.end_date::timestamptz + interval '23 hours 59 minutes 59 seconds');
  v_retained := public.get_account_id_by_code('3000');
  if v_retained is null then
    raise exception 'Retained earnings account (3000) not found';
  end if;

  insert into public.journal_entries(entry_date, memo, source_table, source_id, source_event, created_by)
  values (
    v_entry_date,
    concat('Close period ', v_period.name),
    'accounting_periods',
    p_period_id::text,
    'closing',
    auth.uid()
  )
  on conflict (source_table, source_id, source_event)
  do update set entry_date = excluded.entry_date, memo = excluded.memo
  returning id into v_entry_id;

  delete from public.journal_lines jl where jl.journal_entry_id = v_entry_id;

  for v_row in
    select
      coa.id as account_id,
      coa.account_type,
      coalesce(sum(jl.debit), 0) as debit,
      coalesce(sum(jl.credit), 0) as credit
    from public.chart_of_accounts coa
    join public.journal_lines jl on jl.account_id = coa.id
    join public.journal_entries je on je.id = jl.journal_entry_id
    where coa.account_type in ('income', 'expense')
      and je.entry_date::date >= v_period.start_date
      and je.entry_date::date <= v_period.end_date
    group by coa.id, coa.account_type
  loop
    if v_row.account_type = 'income' then
      v_amount := (v_row.credit - v_row.debit);
      v_income_total := v_income_total + v_amount;
      if abs(v_amount) > 1e-9 then
        insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo)
        values (
          v_entry_id,
          v_row.account_id,
          greatest(v_amount, 0),
          greatest(-v_amount, 0),
          'Close income'
        );
        v_has_lines := true;
      end if;
    else
      v_amount := (v_row.debit - v_row.credit);
      v_expense_total := v_expense_total + v_amount;
      if abs(v_amount) > 1e-9 then
        insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo)
        values (
          v_entry_id,
          v_row.account_id,
          greatest(-v_amount, 0),
          greatest(v_amount, 0),
          'Close expense'
        );
        v_has_lines := true;
      end if;
    end if;
  end loop;

  v_profit := coalesce(v_income_total, 0) - coalesce(v_expense_total, 0);
  if abs(v_profit) > 1e-9 or v_has_lines then
    insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo)
    values (
      v_entry_id,
      v_retained,
      greatest(-v_profit, 0),
      greatest(v_profit, 0),
      'Retained earnings'
    );
  end if;

  update public.accounting_periods
  set status = 'closed',
      closed_at = now(),
      closed_by = auth.uid()
  where id = p_period_id
    and status <> 'closed';
end;
$$;

revoke all on function public.close_accounting_period(uuid) from public;
revoke execute on function public.close_accounting_period(uuid) from anon;
grant execute on function public.close_accounting_period(uuid) to authenticated;

create or replace function public.create_manual_journal_entry(
  p_entry_date timestamptz,
  p_memo text,
  p_lines jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_entry_id uuid;
  v_line jsonb;
  v_account_code text;
  v_account_id uuid;
  v_debit numeric;
  v_credit numeric;
  v_memo text;
begin
  if not public.has_admin_permission('accounting.manage') then
    raise exception 'not allowed';
  end if;

  if p_lines is null or jsonb_typeof(p_lines) <> 'array' then
    raise exception 'p_lines must be a json array';
  end if;

  v_memo := nullif(trim(coalesce(p_memo, '')), '');

  insert into public.journal_entries(entry_date, memo, source_table, source_id, source_event, created_by)
  values (
    coalesce(p_entry_date, now()),
    v_memo,
    'manual',
    null,
    null,
    auth.uid()
  )
  returning id into v_entry_id;

  for v_line in select value from jsonb_array_elements(p_lines)
  loop
    v_account_code := nullif(trim(coalesce(v_line->>'accountCode', '')), '');
    v_debit := coalesce(nullif(v_line->>'debit', '')::numeric, 0);
    v_credit := coalesce(nullif(v_line->>'credit', '')::numeric, 0);

    if v_account_code is null then
      raise exception 'accountCode is required';
    end if;

    if v_debit < 0 or v_credit < 0 then
      raise exception 'invalid debit/credit';
    end if;

    if (v_debit > 0 and v_credit > 0) or (v_debit = 0 and v_credit = 0) then
      raise exception 'invalid line amounts';
    end if;

    v_account_id := public.get_account_id_by_code(v_account_code);
    if v_account_id is null then
      raise exception 'account not found %', v_account_code;
    end if;

    insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo)
    values (
      v_entry_id,
      v_account_id,
      v_debit,
      v_credit,
      nullif(trim(coalesce(v_line->>'memo', '')), '')
    );
  end loop;

  return v_entry_id;
end;
$$;

revoke all on function public.create_manual_journal_entry(timestamptz, text, jsonb) from public;
revoke execute on function public.create_manual_journal_entry(timestamptz, text, jsonb) from anon;
grant execute on function public.create_manual_journal_entry(timestamptz, text, jsonb) to authenticated;

create or replace function public.trial_balance(p_start date, p_end date)
returns table(
  account_code text,
  account_name text,
  account_type text,
  normal_balance text,
  debit numeric,
  credit numeric,
  balance numeric
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

  return query
  select
    coa.code as account_code,
    coa.name as account_name,
    coa.account_type,
    coa.normal_balance,
    coalesce(sum(jl.debit), 0) as debit,
    coalesce(sum(jl.credit), 0) as credit,
    coalesce(sum(jl.debit - jl.credit), 0) as balance
  from public.chart_of_accounts coa
  left join public.journal_lines jl on jl.account_id = coa.id
  left join public.journal_entries je
    on je.id = jl.journal_entry_id
   and (p_start is null or je.entry_date::date >= p_start)
   and (p_end is null or je.entry_date::date <= p_end)
  group by coa.code, coa.name, coa.account_type, coa.normal_balance
  order by coa.code;
end;
$$;

revoke all on function public.trial_balance(date, date) from public;
revoke execute on function public.trial_balance(date, date) from anon;
grant execute on function public.trial_balance(date, date) to authenticated;

create or replace function public.income_statement(p_start date, p_end date)
returns table(
  income numeric,
  expenses numeric,
  net_profit numeric
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

  return query
  with tb as (
    select *
    from public.trial_balance(p_start, p_end)
  )
  select
    coalesce(sum(case when tb.account_type = 'income' then (tb.credit - tb.debit) else 0 end), 0) as income,
    coalesce(sum(case when tb.account_type = 'expense' then (tb.debit - tb.credit) else 0 end), 0) as expenses,
    coalesce(sum(case when tb.account_type = 'income' then (tb.credit - tb.debit) else 0 end), 0)
      - coalesce(sum(case when tb.account_type = 'expense' then (tb.debit - tb.credit) else 0 end), 0) as net_profit
  from tb;
end;
$$;

revoke all on function public.income_statement(date, date) from public;
revoke execute on function public.income_statement(date, date) from anon;
grant execute on function public.income_statement(date, date) to authenticated;

create or replace function public.balance_sheet(p_as_of date)
returns table(
  assets numeric,
  liabilities numeric,
  equity numeric
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

  return query
  with tb as (
    select *
    from public.trial_balance(null, p_as_of)
  )
  select
    coalesce(sum(case when tb.account_type = 'asset' then (tb.debit - tb.credit) else 0 end), 0) as assets,
    coalesce(sum(case when tb.account_type = 'liability' then (tb.credit - tb.debit) else 0 end), 0) as liabilities,
    coalesce(sum(case when tb.account_type = 'equity' then (tb.credit - tb.debit) else 0 end), 0) as equity
  from tb;
end;
$$;

revoke all on function public.balance_sheet(date) from public;
revoke execute on function public.balance_sheet(date) from anon;
grant execute on function public.balance_sheet(date) to authenticated;

create or replace function public.general_ledger(p_account_code text, p_start date, p_end date)
returns table(
  entry_date date,
  journal_entry_id uuid,
  memo text,
  source_table text,
  source_id text,
  source_event text,
  debit numeric,
  credit numeric,
  amount numeric,
  running_balance numeric
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

  return query
  with acct as (
    select coa.id, coa.normal_balance
    from public.chart_of_accounts coa
    where coa.code = p_account_code
    limit 1
  ),
  opening as (
    select coalesce(sum(
      case
        when a.normal_balance = 'credit' then (jl.credit - jl.debit)
        else (jl.debit - jl.credit)
      end
    ), 0) as opening_balance
    from public.journal_lines jl
    join public.journal_entries je on je.id = jl.journal_entry_id
    join acct a on a.id = jl.account_id
    where p_start is not null
      and je.entry_date::date < p_start
  ),
  lines as (
    select
      je.entry_date::date as entry_date,
      je.id as journal_entry_id,
      je.memo,
      je.source_table,
      je.source_id,
      je.source_event,
      jl.debit,
      jl.credit,
      case
        when a.normal_balance = 'credit' then (jl.credit - jl.debit)
        else (jl.debit - jl.credit)
      end as amount,
      je.created_at as entry_created_at,
      jl.created_at as line_created_at
    from public.journal_lines jl
    join public.journal_entries je on je.id = jl.journal_entry_id
    join acct a on a.id = jl.account_id
    where (p_start is null or je.entry_date::date >= p_start)
      and (p_end is null or je.entry_date::date <= p_end)
  )
  select
    l.entry_date,
    l.journal_entry_id,
    l.memo,
    l.source_table,
    l.source_id,
    l.source_event,
    l.debit,
    l.credit,
    l.amount,
    (select opening_balance from opening)
      + sum(l.amount) over (order by l.entry_date, l.entry_created_at, l.line_created_at, l.journal_entry_id) as running_balance
  from lines l
  order by l.entry_date, l.entry_created_at, l.line_created_at, l.journal_entry_id;
end;
$$;

revoke all on function public.general_ledger(text, date, date) from public;
revoke execute on function public.general_ledger(text, date, date) from anon;
grant execute on function public.general_ledger(text, date, date) to authenticated;

create or replace function public.ar_aging_summary(p_as_of date default current_date)
returns table(
  customer_auth_user_id uuid,
  current numeric,
  days_1_30 numeric,
  days_31_60 numeric,
  days_61_90 numeric,
  days_91_plus numeric,
  total_outstanding numeric
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

  return query
  with delivered as (
    select
      o.id as order_id,
      o.customer_auth_user_id,
      o.updated_at::date as invoice_date,
      coalesce(nullif((o.data->>'total')::numeric, null), 0) as total
    from public.orders o
    where o.status = 'delivered'
      and o.updated_at::date <= p_as_of
  ),
  paid as (
    select
      p.reference_id::uuid as order_id,
      coalesce(sum(p.amount), 0) as paid
    from public.payments p
    where p.reference_table = 'orders'
      and p.direction = 'in'
      and p.occurred_at::date <= p_as_of
    group by p.reference_id
  ),
  open_items as (
    select
      d.customer_auth_user_id,
      greatest(0, d.total - coalesce(p.paid, 0)) as outstanding,
      (p_as_of - d.invoice_date) as age_days
    from delivered d
    left join paid p on p.order_id = d.order_id
    where (d.total - coalesce(p.paid, 0)) > 1e-9
  )
  select
    oi.customer_auth_user_id,
    coalesce(sum(case when oi.age_days <= 0 then oi.outstanding else 0 end), 0) as current,
    coalesce(sum(case when oi.age_days between 1 and 30 then oi.outstanding else 0 end), 0) as days_1_30,
    coalesce(sum(case when oi.age_days between 31 and 60 then oi.outstanding else 0 end), 0) as days_31_60,
    coalesce(sum(case when oi.age_days between 61 and 90 then oi.outstanding else 0 end), 0) as days_61_90,
    coalesce(sum(case when oi.age_days >= 91 then oi.outstanding else 0 end), 0) as days_91_plus,
    coalesce(sum(oi.outstanding), 0) as total_outstanding
  from open_items oi
  group by oi.customer_auth_user_id
  order by total_outstanding desc;
end;
$$;

revoke all on function public.ar_aging_summary(date) from public;
revoke execute on function public.ar_aging_summary(date) from anon;
grant execute on function public.ar_aging_summary(date) to authenticated;

create or replace function public.ap_aging_summary(p_as_of date default current_date)
returns table(
  supplier_id uuid,
  current numeric,
  days_1_30 numeric,
  days_31_60 numeric,
  days_61_90 numeric,
  days_91_plus numeric,
  total_outstanding numeric
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

  return query
  with po as (
    select
      po.id as purchase_order_id,
      po.supplier_id,
      po.purchase_date as invoice_date,
      coalesce(po.total_amount, 0) as total
    from public.purchase_orders po
    where po.status <> 'cancelled'
      and po.purchase_date <= p_as_of
  ),
  paid as (
    select
      p.reference_id::uuid as purchase_order_id,
      coalesce(sum(p.amount), 0) as paid
    from public.payments p
    where p.reference_table = 'purchase_orders'
      and p.direction = 'out'
      and p.occurred_at::date <= p_as_of
    group by p.reference_id
  ),
  open_items as (
    select
      po.supplier_id,
      greatest(0, po.total - coalesce(p.paid, 0)) as outstanding,
      (p_as_of - po.invoice_date) as age_days
    from po
    left join paid p on p.purchase_order_id = po.purchase_order_id
    where (po.total - coalesce(p.paid, 0)) > 1e-9
  )
  select
    oi.supplier_id,
    coalesce(sum(case when oi.age_days <= 0 then oi.outstanding else 0 end), 0) as current,
    coalesce(sum(case when oi.age_days between 1 and 30 then oi.outstanding else 0 end), 0) as days_1_30,
    coalesce(sum(case when oi.age_days between 31 and 60 then oi.outstanding else 0 end), 0) as days_31_60,
    coalesce(sum(case when oi.age_days between 61 and 90 then oi.outstanding else 0 end), 0) as days_61_90,
    coalesce(sum(case when oi.age_days >= 91 then oi.outstanding else 0 end), 0) as days_91_plus,
    coalesce(sum(oi.outstanding), 0) as total_outstanding
  from open_items oi
  group by oi.supplier_id
  order by total_outstanding desc;
end;
$$;

revoke all on function public.ap_aging_summary(date) from public;
revoke execute on function public.ap_aging_summary(date) from anon;
grant execute on function public.ap_aging_summary(date) to authenticated;

