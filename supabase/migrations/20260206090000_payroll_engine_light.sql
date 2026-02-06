create table if not exists public.payroll_employees (
  id uuid primary key default gen_random_uuid(),
  full_name text not null,
  employee_code text,
  is_active boolean not null default true,
  monthly_salary numeric not null default 0,
  currency text not null default 'YER',
  notes text,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null
);

create index if not exists idx_payroll_employees_active on public.payroll_employees(is_active);
create unique index if not exists uq_payroll_employees_employee_code on public.payroll_employees(employee_code) where employee_code is not null;

create table if not exists public.payroll_runs (
  id uuid primary key default gen_random_uuid(),
  period_ym text not null,
  status text not null default 'draft',
  expense_id uuid references public.expenses(id) on delete set null,
  memo text,
  total_gross numeric not null default 0,
  total_deductions numeric not null default 0,
  total_net numeric not null default 0,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  accrued_at timestamptz,
  paid_at timestamptz
);

do $$
begin
  if not exists (
    select 1
    from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
    where n.nspname = 'public'
      and t.relname = 'payroll_runs'
      and c.conname = 'payroll_runs_status_check'
  ) then
    alter table public.payroll_runs
      add constraint payroll_runs_status_check
      check (status in ('draft','accrued','paid','voided'));
  end if;
end $$;

create unique index if not exists uq_payroll_runs_period on public.payroll_runs(period_ym);
create index if not exists idx_payroll_runs_created_at on public.payroll_runs(created_at desc);

create table if not exists public.payroll_run_lines (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.payroll_runs(id) on delete cascade,
  employee_id uuid not null references public.payroll_employees(id) on delete restrict,
  gross numeric not null default 0,
  deductions numeric not null default 0,
  net numeric not null default 0,
  line_memo text,
  created_at timestamptz not null default now()
);

create index if not exists idx_payroll_run_lines_run on public.payroll_run_lines(run_id);
create unique index if not exists uq_payroll_run_lines_unique_employee on public.payroll_run_lines(run_id, employee_id);

alter table public.payroll_employees enable row level security;
alter table public.payroll_runs enable row level security;
alter table public.payroll_run_lines enable row level security;

drop policy if exists payroll_employees_select on public.payroll_employees;
create policy payroll_employees_select
on public.payroll_employees
for select
using (public.has_admin_permission('accounting.view') or public.can_manage_expenses() or public.is_admin());

drop policy if exists payroll_employees_write on public.payroll_employees;
create policy payroll_employees_write
on public.payroll_employees
for all
using (public.can_manage_expenses() or public.has_admin_permission('accounting.manage') or public.is_admin())
with check (public.can_manage_expenses() or public.has_admin_permission('accounting.manage') or public.is_admin());

drop policy if exists payroll_runs_select on public.payroll_runs;
create policy payroll_runs_select
on public.payroll_runs
for select
using (public.has_admin_permission('accounting.view') or public.can_manage_expenses() or public.is_admin());

drop policy if exists payroll_runs_write on public.payroll_runs;
create policy payroll_runs_write
on public.payroll_runs
for all
using (public.can_manage_expenses() or public.has_admin_permission('accounting.manage') or public.is_admin())
with check (public.can_manage_expenses() or public.has_admin_permission('accounting.manage') or public.is_admin());

drop policy if exists payroll_run_lines_select on public.payroll_run_lines;
create policy payroll_run_lines_select
on public.payroll_run_lines
for select
using (public.has_admin_permission('accounting.view') or public.can_manage_expenses() or public.is_admin());

drop policy if exists payroll_run_lines_write on public.payroll_run_lines;
create policy payroll_run_lines_write
on public.payroll_run_lines
for all
using (public.can_manage_expenses() or public.has_admin_permission('accounting.manage') or public.is_admin())
with check (public.can_manage_expenses() or public.has_admin_permission('accounting.manage') or public.is_admin());

create or replace function public._payroll_last_day(p_period_ym text)
returns date
language plpgsql
immutable
as $$
declare
  v_year int;
  v_month int;
  v_first date;
begin
  v_year := nullif(split_part(p_period_ym, '-', 1), '')::int;
  v_month := nullif(split_part(p_period_ym, '-', 2), '')::int;
  if v_year is null or v_month is null or v_month < 1 or v_month > 12 then
    raise exception 'invalid period_ym';
  end if;
  v_first := make_date(v_year, v_month, 1);
  return (v_first + interval '1 month - 1 day')::date;
end;
$$;

revoke all on function public._payroll_last_day(text) from public;
grant execute on function public._payroll_last_day(text) to anon, authenticated;

create or replace function public.create_payroll_run(
  p_period_ym text,
  p_memo text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_run_id uuid;
  v_expense_id uuid;
  v_date date;
  v_total numeric := 0;
  v_row record;
begin
  if not (public.can_manage_expenses() or public.has_admin_permission('accounting.manage') or public.is_admin()) then
    raise exception 'not allowed';
  end if;

  v_date := public._payroll_last_day(p_period_ym);

  if exists (select 1 from public.payroll_runs pr where pr.period_ym = p_period_ym) then
    raise exception 'payroll run already exists';
  end if;

  insert into public.payroll_runs(period_ym, status, memo, created_by)
  values (p_period_ym, 'draft', nullif(trim(coalesce(p_memo,'')), ''), auth.uid())
  returning id into v_run_id;

  for v_row in
    select id, full_name, monthly_salary, currency
    from public.payroll_employees
    where is_active = true
    order by full_name asc
  loop
    insert into public.payroll_run_lines(run_id, employee_id, gross, deductions, net, line_memo)
    values (v_run_id, v_row.id, coalesce(v_row.monthly_salary, 0), 0, coalesce(v_row.monthly_salary, 0), null);
    v_total := v_total + coalesce(v_row.monthly_salary, 0);
  end loop;

  if v_total <= 0 then
    raise exception 'no active employees or total is zero';
  end if;

  insert into public.expenses(title, amount, category, date, notes, created_by)
  values (
    concat('رواتب ', p_period_ym),
    v_total,
    'salary',
    v_date,
    concat('Payroll run ', p_period_ym),
    auth.uid()
  )
  returning id into v_expense_id;

  update public.payroll_runs
  set expense_id = v_expense_id,
      total_gross = v_total,
      total_net = v_total,
      total_deductions = 0
  where id = v_run_id;

  insert into public.system_audit_logs(action, module, details, performed_by, performed_at, metadata)
  values (
    'payroll_run_created',
    'payroll',
    concat('Payroll run created ', p_period_ym),
    auth.uid(),
    now(),
    jsonb_build_object('runId', v_run_id::text, 'period', p_period_ym, 'expenseId', v_expense_id::text, 'total', v_total)
  );

  return v_run_id;
end;
$$;

revoke all on function public.create_payroll_run(text, text) from public;
grant execute on function public.create_payroll_run(text, text) to anon, authenticated;

create or replace function public.record_payroll_run_accrual(
  p_run_id uuid,
  p_occurred_at timestamptz default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_run record;
  v_entry_id uuid;
begin
  if not (public.can_manage_expenses() or public.has_admin_permission('accounting.manage') or public.is_admin()) then
    raise exception 'not allowed';
  end if;

  select *
  into v_run
  from public.payroll_runs
  where id = p_run_id
  for update;

  if not found then
    raise exception 'run not found';
  end if;
  if v_run.expense_id is null then
    raise exception 'run has no expense_id';
  end if;

  perform public.record_expense_accrual(v_run.expense_id, v_run.total_net, coalesce(p_occurred_at, now()));

  select id into v_entry_id
  from public.journal_entries
  where source_table = 'expenses'
    and source_id = v_run.expense_id::text
    and source_event = 'accrual'
  order by entry_date desc
  limit 1;

  update public.payroll_runs
  set status = 'accrued',
      accrued_at = coalesce(p_occurred_at, now())
  where id = p_run_id;

  insert into public.system_audit_logs(action, module, details, performed_by, performed_at, metadata)
  values (
    'payroll_run_accrued',
    'payroll',
    concat('Payroll run accrued ', v_run.period_ym),
    auth.uid(),
    now(),
    jsonb_build_object('runId', p_run_id::text, 'period', v_run.period_ym, 'expenseId', v_run.expense_id::text, 'journalEntryId', coalesce(v_entry_id::text,''))
  );

  return v_entry_id;
end;
$$;

revoke all on function public.record_payroll_run_accrual(uuid, timestamptz) from public;
grant execute on function public.record_payroll_run_accrual(uuid, timestamptz) to anon, authenticated;

create or replace function public.record_payroll_run_payment(
  p_run_id uuid,
  p_amount numeric default null,
  p_method text default 'cash',
  p_occurred_at timestamptz default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_run record;
  v_method text;
  v_occurred_at timestamptz;
  v_paid numeric := 0;
  v_amount numeric := 0;
  v_payment_id uuid;
  v_shift_id uuid;
begin
  if not (public.can_manage_expenses() or public.has_admin_permission('accounting.manage') or public.is_admin()) then
    raise exception 'not allowed';
  end if;

  select *
  into v_run
  from public.payroll_runs
  where id = p_run_id
  for update;

  if not found then
    raise exception 'run not found';
  end if;
  if v_run.expense_id is null then
    raise exception 'run has no expense_id';
  end if;

  select coalesce(sum(p.amount), 0)
  into v_paid
  from public.payments p
  where p.reference_table = 'expenses'
    and p.reference_id = v_run.expense_id::text
    and p.direction = 'out';

  v_amount := coalesce(p_amount, 0);
  if v_amount <= 0 then
    v_amount := greatest(0, coalesce(v_run.total_net, 0) - v_paid);
  end if;
  if v_amount <= 0 then
    raise exception 'nothing to pay';
  end if;
  if (v_paid + v_amount) > (coalesce(v_run.total_net, 0) + 1e-9) then
    raise exception 'paid amount exceeds total';
  end if;

  v_method := nullif(trim(coalesce(p_method, '')), '');
  if v_method is null then
    v_method := 'cash';
  end if;
  if v_method = 'card' then
    v_method := 'network';
  elsif v_method = 'bank' then
    v_method := 'kuraimi';
  end if;

  v_occurred_at := coalesce(p_occurred_at, now());
  v_shift_id := public._resolve_open_shift_for_cash(auth.uid());
  if v_method = 'cash' and v_shift_id is null then
    raise exception 'cash method requires an open cash shift';
  end if;

  insert into public.payments(direction, method, amount, currency, reference_table, reference_id, occurred_at, created_by, data, shift_id)
  values (
    'out',
    v_method,
    v_amount,
    'YER',
    'expenses',
    v_run.expense_id::text,
    v_occurred_at,
    auth.uid(),
    jsonb_strip_nulls(jsonb_build_object('expenseId', v_run.expense_id::text, 'payrollRunId', p_run_id::text, 'kind', 'payroll')),
    v_shift_id
  )
  returning id into v_payment_id;

  perform public.post_payment(v_payment_id);

  if (v_paid + v_amount) >= (coalesce(v_run.total_net, 0) - 1e-9) then
    update public.payroll_runs
    set status = 'paid',
        paid_at = v_occurred_at
    where id = p_run_id;
  else
    update public.payroll_runs
    set status = 'accrued'
    where id = p_run_id;
  end if;

  insert into public.system_audit_logs(action, module, details, performed_by, performed_at, metadata)
  values (
    'payroll_run_paid',
    'payroll',
    concat('Payroll run payment ', v_run.period_ym),
    auth.uid(),
    now(),
    jsonb_build_object('runId', p_run_id::text, 'period', v_run.period_ym, 'expenseId', v_run.expense_id::text, 'paymentId', v_payment_id::text, 'amount', v_amount, 'method', v_method)
  );

  return v_payment_id;
end;
$$;

revoke all on function public.record_payroll_run_payment(uuid, numeric, text, timestamptz) from public;
grant execute on function public.record_payroll_run_payment(uuid, numeric, text, timestamptz) to anon, authenticated;

notify pgrst, 'reload schema';
