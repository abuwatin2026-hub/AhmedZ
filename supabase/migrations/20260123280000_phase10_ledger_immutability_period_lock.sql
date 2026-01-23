create or replace function public._is_migration_actor()
returns boolean
language sql
stable
as $$
  select current_user in ('postgres','supabase_admin');
$$;

create or replace function public.trg_journal_entries_immutable()
returns trigger
language plpgsql
as $$
begin
  if public._is_migration_actor() then
    return coalesce(new, old);
  end if;
  raise exception 'Journal entries are immutable';
end;
$$;

drop trigger if exists trg_journal_entries_immutable on public.journal_entries;
create trigger trg_journal_entries_immutable
before update or delete on public.journal_entries
for each row execute function public.trg_journal_entries_immutable();

create or replace function public.trg_journal_lines_immutable()
returns trigger
language plpgsql
as $$
begin
  if public._is_migration_actor() then
    return coalesce(new, old);
  end if;
  raise exception 'Journal entries are immutable';
end;
$$;

drop trigger if exists trg_journal_lines_immutable on public.journal_lines;
create trigger trg_journal_lines_immutable
before update or delete on public.journal_lines
for each row execute function public.trg_journal_lines_immutable();

drop trigger if exists trg_journal_entries_block_system_mutation on public.journal_entries;
drop trigger if exists trg_journal_lines_block_system_mutation on public.journal_lines;

create or replace function public.check_journal_entry_balance(p_entry_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_debit numeric;
  v_credit numeric;
  v_count int;
begin
  if p_entry_id is null then
    raise exception 'p_entry_id is required';
  end if;

  select
    coalesce(sum(jl.debit), 0),
    coalesce(sum(jl.credit), 0),
    count(1)
  into v_debit, v_credit, v_count
  from public.journal_lines jl
  where jl.journal_entry_id = p_entry_id;

  if v_count < 2 then
    raise exception 'journal entry must have at least 2 lines %', p_entry_id;
  end if;

  if abs((v_debit - v_credit)) > 1e-6 then
    raise exception 'journal entry not balanced % (debit %, credit %)', p_entry_id, v_debit, v_credit;
  end if;
end;
$$;

create or replace function public.trg_check_journal_balance()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.check_journal_entry_balance(coalesce(new.journal_entry_id, old.journal_entry_id));
  return null;
end;
$$;

drop trigger if exists trg_journal_lines_balance on public.journal_lines;
create constraint trigger trg_journal_lines_balance
after insert on public.journal_lines
deferrable initially deferred
for each row execute function public.trg_check_journal_balance();

create or replace function public.trg_check_journal_entry_balance_on_entry()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.check_journal_entry_balance(new.id);
  return null;
end;
$$;

drop trigger if exists trg_journal_entries_balance on public.journal_entries;
create constraint trigger trg_journal_entries_balance
after insert on public.journal_entries
deferrable initially deferred
for each row execute function public.trg_check_journal_entry_balance_on_entry();

create unique index if not exists uq_journal_entries_source_strict
on public.journal_entries(source_table, source_id)
where source_table is not null
  and btrim(source_table) <> ''
  and source_table <> 'manual'
  and source_id is not null
  and btrim(source_id) <> '';

create or replace function public.trg_journal_entries_hard_rules()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_max_date timestamptz;
  v_date timestamptz;
  v_is_finance_admin boolean := false;
begin
  if public._is_migration_actor() then
    return new;
  end if;

  v_is_finance_admin := (auth.role() = 'service_role') or public.has_admin_permission('accounting.manage');

  if new.source_table is null or btrim(new.source_table) = '' then
    raise exception 'source_type is required';
  end if;

  if new.source_table = 'manual' then
    if not v_is_finance_admin then
      raise exception 'not allowed';
    end if;
  else
    if new.source_id is null or btrim(new.source_id) = '' then
      raise exception 'source_id is required';
    end if;
    if new.source_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
      raise exception 'source_id must be uuid';
    end if;
  end if;

  v_date := coalesce(new.entry_date, now());

  if public.is_in_closed_period(v_date) then
    raise exception 'Accounting period is closed';
  end if;

  if not v_is_finance_admin then
    if (v_date::date) < (current_date - 1) or (v_date::date) > (current_date + 1) then
      raise exception 'Back/forward dating not allowed';
    end if;
  end if;

  select max(je.entry_date) into v_max_date
  from public.journal_entries je;

  if v_max_date is not null and v_date < v_max_date and not v_is_finance_admin then
    raise exception 'Back-dating not allowed';
  end if;

  new.entry_date := v_date;
  return new;
end;
$$;

drop trigger if exists trg_journal_entries_hard_rules on public.journal_entries;
create trigger trg_journal_entries_hard_rules
before insert on public.journal_entries
for each row execute function public.trg_journal_entries_hard_rules();

create or replace function public.trg_inventory_movement_requires_journal_entry()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if public._is_migration_actor() then
    return null;
  end if;

  if new.movement_type in ('transfer_out','transfer_in') then
    return null;
  end if;

  if not exists (
    select 1
    from public.journal_entries je
    where je.source_table = 'inventory_movements'
      and je.source_id = new.id::text
  ) then
    raise exception 'inventory movement requires journal entry';
  end if;

  return null;
end;
$$;

drop trigger if exists trg_inventory_movement_requires_journal_entry on public.inventory_movements;
create constraint trigger trg_inventory_movement_requires_journal_entry
after insert on public.inventory_movements
deferrable initially deferred
for each row execute function public.trg_inventory_movement_requires_journal_entry();

create or replace function public.trg_payment_requires_journal_entry()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if public._is_migration_actor() then
    return null;
  end if;

  if new.reference_table in ('orders','purchase_orders','expenses') then
    if not exists (
      select 1
      from public.journal_entries je
      where je.source_table = 'payments'
        and je.source_id = new.id::text
    ) then
      raise exception 'payment requires journal entry';
    end if;
  end if;

  return null;
end;
$$;

drop trigger if exists trg_payment_requires_journal_entry on public.payments;
create constraint trigger trg_payment_requires_journal_entry
after insert on public.payments
deferrable initially deferred
for each row execute function public.trg_payment_requires_journal_entry();

create or replace function public.trg_delivered_order_requires_journal_entry()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if public._is_migration_actor() then
    return null;
  end if;

  if tg_op = 'UPDATE' and old.status is distinct from new.status and new.status = 'delivered' then
    if not exists (
      select 1
      from public.journal_entries je
      where je.source_table = 'orders'
        and je.source_id = new.id::text
        and je.source_event = 'delivered'
    ) then
      raise exception 'delivered order requires journal entry';
    end if;
  end if;

  return null;
end;
$$;

drop trigger if exists trg_delivered_order_requires_journal_entry on public.orders;
create constraint trigger trg_delivered_order_requires_journal_entry
after update on public.orders
deferrable initially deferred
for each row execute function public.trg_delivered_order_requires_journal_entry();

create table if not exists public.ledger_audit_log (
  id uuid primary key default gen_random_uuid(),
  actor_user_id uuid,
  actor_role text,
  action text not null,
  table_name text not null,
  record_id text,
  context jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_ledger_audit_log_created_at on public.ledger_audit_log(created_at desc);
create index if not exists idx_ledger_audit_log_table_record on public.ledger_audit_log(table_name, record_id);

create or replace function public.trg_ledger_audit_log_immutable()
returns trigger
language plpgsql
as $$
begin
  if public._is_migration_actor() then
    return coalesce(new, old);
  end if;
  raise exception 'ledger_audit_log is immutable';
end;
$$;

drop trigger if exists trg_ledger_audit_log_immutable on public.ledger_audit_log;
create trigger trg_ledger_audit_log_immutable
before update or delete on public.ledger_audit_log
for each row execute function public.trg_ledger_audit_log_immutable();

create or replace function public.trg_audit_journal_entries_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.ledger_audit_log(actor_user_id, actor_role, action, table_name, record_id, context)
  values (
    auth.uid(),
    auth.role(),
    'insert',
    'journal_entries',
    new.id::text,
    jsonb_build_object('source_table', new.source_table, 'source_id', new.source_id, 'source_event', new.source_event, 'entry_date', new.entry_date)
  );
  return new;
end;
$$;

drop trigger if exists trg_audit_journal_entries_insert on public.journal_entries;
create trigger trg_audit_journal_entries_insert
after insert on public.journal_entries
for each row execute function public.trg_audit_journal_entries_insert();

create or replace function public.trg_audit_journal_lines_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.ledger_audit_log(actor_user_id, actor_role, action, table_name, record_id, context)
  values (
    auth.uid(),
    auth.role(),
    'insert',
    'journal_lines',
    new.id::text,
    jsonb_build_object('journal_entry_id', new.journal_entry_id, 'account_id', new.account_id, 'debit', new.debit, 'credit', new.credit)
  );
  return new;
end;
$$;

drop trigger if exists trg_audit_journal_lines_insert on public.journal_lines;
create trigger trg_audit_journal_lines_insert
after insert on public.journal_lines
for each row execute function public.trg_audit_journal_lines_insert();

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
      'accounting.periods.close'
    ]);
  end if;

  return false;
end;
$$;

drop policy if exists journal_entries_admin_write on public.journal_entries;
create policy journal_entries_admin_insert
on public.journal_entries
for insert
with check (public.has_admin_permission('accounting.manage') or auth.role() = 'service_role');

drop policy if exists journal_lines_admin_write on public.journal_lines;
create policy journal_lines_admin_insert
on public.journal_lines
for insert
with check (public.has_admin_permission('accounting.manage') or auth.role() = 'service_role');

revoke update, delete on table public.journal_entries from anon, authenticated;
revoke update, delete on table public.journal_lines from anon, authenticated;
grant select, insert on table public.journal_entries to authenticated;
grant select, insert on table public.journal_lines to authenticated;

alter table public.ledger_audit_log enable row level security;
drop policy if exists ledger_audit_log_admin_only on public.ledger_audit_log;
create policy ledger_audit_log_admin_only
on public.ledger_audit_log
for select
using (public.has_admin_permission('accounting.view'));

revoke all on table public.ledger_audit_log from anon, authenticated;
grant select on table public.ledger_audit_log to authenticated;

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
  if not public.has_admin_permission('accounting.manage') then
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
    raise exception 'period already closed';
  end if;

  v_entry_date := (v_period.end_date::timestamptz + interval '23 hours 59 minutes 59 seconds');
  v_retained := public.get_account_id_by_code('3000');
  if v_retained is null then
    raise exception 'Retained earnings account (3000) not found';
  end if;

  begin
    insert into public.journal_entries(entry_date, memo, source_table, source_id, source_event, created_by)
    values (
      v_entry_date,
      concat('Close period ', v_period.name),
      'accounting_periods',
      p_period_id::text,
      'closing',
      auth.uid()
    )
    returning id into v_entry_id;
  exception
    when unique_violation then
      raise exception 'closing entry already exists';
  end;

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

  perform public.check_journal_entry_balance(v_entry_id);

  update public.accounting_periods
  set status = 'closed',
      closed_at = now(),
      closed_by = auth.uid()
  where id = p_period_id
    and status <> 'closed';
end;
$$;
