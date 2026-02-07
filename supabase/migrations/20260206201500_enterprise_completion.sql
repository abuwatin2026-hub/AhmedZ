set app.allow_ledger_ddl = '1';

-- 1) Bank Reconciliation
create table if not exists public.bank_accounts (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  bank_name text,
  account_number text,
  currency text not null default 'YER',
  coa_account_id uuid references public.chart_of_accounts(id) on delete set null,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);
alter table public.bank_accounts enable row level security;
drop policy if exists bank_accounts_select on public.bank_accounts;
create policy bank_accounts_select on public.bank_accounts
  for select using (public.has_admin_permission('accounting.view'));
drop policy if exists bank_accounts_write on public.bank_accounts;
create policy bank_accounts_write on public.bank_accounts
  for all using (public.has_admin_permission('accounting.manage'))
  with check (public.has_admin_permission('accounting.manage'));

create table if not exists public.bank_statement_batches (
  id uuid primary key default gen_random_uuid(),
  bank_account_id uuid not null references public.bank_accounts(id) on delete restrict,
  period_start date not null,
  period_end date not null,
  status text not null default 'open' check (status in ('open','closed')),
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null
);
alter table public.bank_statement_batches enable row level security;
drop policy if exists bank_statement_batches_select on public.bank_statement_batches;
create policy bank_statement_batches_select on public.bank_statement_batches
  for select using (public.has_admin_permission('accounting.view'));
drop policy if exists bank_statement_batches_write on public.bank_statement_batches;
create policy bank_statement_batches_write on public.bank_statement_batches
  for all using (public.has_admin_permission('accounting.manage'))
  with check (public.has_admin_permission('accounting.manage'));

create table if not exists public.bank_statement_lines (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.bank_statement_batches(id) on delete cascade,
  txn_date date not null,
  amount numeric not null,
  currency text not null default 'YER',
  description text,
  reference text,
  external_id text,
  matched boolean not null default false,
  created_at timestamptz not null default now(),
  unique (batch_id, external_id)
);
alter table public.bank_statement_lines enable row level security;
drop policy if exists bank_statement_lines_select on public.bank_statement_lines;
create policy bank_statement_lines_select on public.bank_statement_lines
  for select using (public.has_admin_permission('accounting.view'));
drop policy if exists bank_statement_lines_write on public.bank_statement_lines;
create policy bank_statement_lines_write on public.bank_statement_lines
  for all using (public.has_admin_permission('accounting.manage'))
  with check (public.has_admin_permission('accounting.manage'));

create table if not exists public.bank_reconciliation_matches (
  id uuid primary key default gen_random_uuid(),
  statement_line_id uuid not null references public.bank_statement_lines(id) on delete cascade,
  payment_id uuid not null references public.payments(id) on delete restrict,
  matched_at timestamptz not null default now(),
  matched_by uuid references auth.users(id) on delete set null,
  status text not null default 'matched' check (status in ('matched','unmatched'))
);
alter table public.bank_reconciliation_matches enable row level security;
drop policy if exists bank_reconciliation_matches_select on public.bank_reconciliation_matches;
create policy bank_reconciliation_matches_select on public.bank_reconciliation_matches
  for select using (public.has_admin_permission('accounting.view'));
drop policy if exists bank_reconciliation_matches_write on public.bank_reconciliation_matches;
create policy bank_reconciliation_matches_write on public.bank_reconciliation_matches
  for all using (public.has_admin_permission('accounting.manage'))
  with check (public.has_admin_permission('accounting.manage'));

create or replace function public.import_bank_statement(p_bank_account_id uuid, p_period_start date, p_period_end date, p_lines jsonb)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_batch_id uuid;
  v_line jsonb;
  v_cnt int := 0;
begin
  if not public.has_admin_permission('accounting.manage') then
    raise exception 'not allowed';
  end if;
  if p_bank_account_id is null then
    raise exception 'bank_account_id required';
  end if;
  insert into public.bank_statement_batches(bank_account_id, period_start, period_end, status, created_by)
  values (p_bank_account_id, p_period_start, p_period_end, 'open', auth.uid())
  returning id into v_batch_id;

  for v_line in select value from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb))
  loop
    insert into public.bank_statement_lines(batch_id, txn_date, amount, currency, description, reference, external_id)
    values (
      v_batch_id,
      coalesce(nullif(v_line->>'date','')::date, current_date),
      coalesce(nullif(v_line->>'amount','')::numeric, 0),
      coalesce(nullif(v_line->>'currency',''),'YER'),
      nullif(v_line->>'description',''),
      nullif(v_line->>'reference',''),
      nullif(v_line->>'externalId','')
    )
    on conflict (batch_id, external_id) do nothing;
    v_cnt := v_cnt + 1;
  end loop;
  return v_batch_id;
end;
$$;
revoke all on function public.import_bank_statement(uuid, date, date, jsonb) from public;
revoke execute on function public.import_bank_statement(uuid, date, date, jsonb) from anon;
grant execute on function public.import_bank_statement(uuid, date, date, jsonb) to authenticated;

create or replace function public.reconcile_bank_batch(p_batch_id uuid, p_tolerance_days int default 3, p_tolerance_amount numeric default 0.01)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_line record;
  v_pay record;
begin
  if not public.has_admin_permission('accounting.manage') then
    raise exception 'not allowed';
  end if;
  for v_line in
    select * from public.bank_statement_lines
    where batch_id = p_batch_id and matched = false
  loop
    select *
    into v_pay
    from public.payments p
    where abs(coalesce(p.base_amount, p.amount, 0) - coalesce(v_line.amount, 0)) <= coalesce(p_tolerance_amount, 0.01)
      and p.occurred_at::date between (v_line.txn_date - coalesce(p_tolerance_days,3)) and (v_line.txn_date + coalesce(p_tolerance_days,3))
      and p.method <> 'cash'
    order by abs(coalesce(p.base_amount, p.amount, 0) - coalesce(v_line.amount, 0)) asc,
             abs((p.occurred_at::date - v_line.txn_date)) asc
    limit 1;

    if found then
      insert into public.bank_reconciliation_matches(statement_line_id, payment_id, matched_by, status)
      values (v_line.id, v_pay.id, auth.uid(), 'matched');
      update public.bank_statement_lines set matched = true where id = v_line.id;
    end if;
  end loop;
end;
$$;
revoke all on function public.reconcile_bank_batch(uuid, int, numeric) from public;
revoke execute on function public.reconcile_bank_batch(uuid, int, numeric) from anon;
grant execute on function public.reconcile_bank_batch(uuid, int, numeric) to authenticated;

create or replace function public.close_bank_statement_batch(p_batch_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.has_admin_permission('accounting.manage') then
    raise exception 'not allowed';
  end if;
  update public.bank_statement_batches
  set status = 'closed'
  where id = p_batch_id and status = 'open';
end;
$$;
revoke all on function public.close_bank_statement_batch(uuid) from public;
revoke execute on function public.close_bank_statement_batch(uuid) from anon;
grant execute on function public.close_bank_statement_batch(uuid) to authenticated;

-- 2) Unified Document States & Approval
do $$
begin
  begin
    alter table public.accounting_documents
      drop constraint accounting_documents_document_type_check;
  exception when others then null;
  end;
  alter table public.accounting_documents
    add constraint accounting_documents_document_type_check
    check (document_type in ('po','grn','invoice','payment','receipt','writeoff','manual','movement'));
end $$;

alter table public.accounting_documents
  add column if not exists approved_by uuid references auth.users(id) on delete set null,
  add column if not exists approved_at timestamptz,
  add column if not exists status text not null default 'posted' check (status in ('draft','approved','posted','cancelled','reversed'));

create or replace function public.approve_accounting_document(p_document_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text;
begin
  if not public.has_admin_permission('accounting.approve') then
    raise exception 'not allowed';
  end if;
  select status into v_status from public.accounting_documents where id = p_document_id for update;
  if not found then
    raise exception 'document not found';
  end if;
  if v_status <> 'draft' then
    raise exception 'only draft documents can be approved';
  end if;
  update public.accounting_documents
  set status = 'approved',
      approved_by = auth.uid(),
      approved_at = now()
  where id = p_document_id;
end;
$$;
revoke all on function public.approve_accounting_document(uuid) from public;
revoke execute on function public.approve_accounting_document(uuid) from anon;
grant execute on function public.approve_accounting_document(uuid) to authenticated;

create or replace function public.cancel_accounting_document(p_document_id uuid, p_reason text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.has_admin_permission('accounting.approve') then
    raise exception 'not allowed';
  end if;
  update public.accounting_documents
  set status = 'cancelled',
      memo = concat(coalesce(memo,''), ' | cancelled: ', coalesce(nullif(trim(p_reason),''),''))
  where id = p_document_id
    and status in ('draft','approved');
end;
$$;
revoke all on function public.cancel_accounting_document(uuid, text) from public;
revoke execute on function public.cancel_accounting_document(uuid, text) from anon;
grant execute on function public.cancel_accounting_document(uuid, text) to authenticated;

-- 3) Payroll Compliance (Rules/Taxes/Attendance/Loans)
create table if not exists public.payroll_rule_defs (
  id uuid primary key default gen_random_uuid(),
  rule_type text not null check (rule_type in ('allowance','deduction')),
  name text not null,
  amount_type text not null check (amount_type in ('fixed','percent')),
  amount_value numeric not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);
alter table public.payroll_rule_defs enable row level security;
create policy payroll_rule_defs_select on public.payroll_rule_defs
  for select using (public.has_admin_permission('accounting.view'));
create policy payroll_rule_defs_write on public.payroll_rule_defs
  for all using (public.has_admin_permission('accounting.manage'))
  with check (public.has_admin_permission('accounting.manage'));

create table if not exists public.payroll_tax_defs (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  rate numeric not null default 0,
  applies_to text not null default 'gross' check (applies_to in ('gross','net')),
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);
alter table public.payroll_tax_defs enable row level security;
create policy payroll_tax_defs_select on public.payroll_tax_defs
  for select using (public.has_admin_permission('accounting.view'));
create policy payroll_tax_defs_write on public.payroll_tax_defs
  for all using (public.has_admin_permission('accounting.manage'))
  with check (public.has_admin_permission('accounting.manage'));

create table if not exists public.payroll_attendance (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.payroll_employees(id) on delete restrict,
  work_date date not null,
  hours_worked numeric not null default 0,
  created_at timestamptz not null default now(),
  unique (employee_id, work_date)
);
alter table public.payroll_attendance enable row level security;
create policy payroll_attendance_select on public.payroll_attendance
  for select using (public.has_admin_permission('accounting.view'));
create policy payroll_attendance_write on public.payroll_attendance
  for all using (public.has_admin_permission('accounting.manage'))
  with check (public.has_admin_permission('accounting.manage'));

create table if not exists public.payroll_loans (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.payroll_employees(id) on delete restrict,
  principal numeric not null default 0,
  balance numeric not null default 0,
  installment_amount numeric not null default 0,
  start_period_ym text,
  status text not null default 'active' check (status in ('active','closed')),
  created_at timestamptz not null default now()
);
alter table public.payroll_loans enable row level security;
create policy payroll_loans_select on public.payroll_loans
  for select using (public.has_admin_permission('accounting.view'));
create policy payroll_loans_write on public.payroll_loans
  for all using (public.has_admin_permission('accounting.manage'))
  with check (public.has_admin_permission('accounting.manage'));

create or replace function public.compute_payroll_run_v3(p_run_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_line record;
  v_rules record;
  v_tax record;
  v_allowances numeric;
  v_deductions numeric;
  v_taxes numeric;
  v_loan record;
begin
  if not public.has_admin_permission('accounting.manage') then
    raise exception 'not allowed';
  end if;
  for v_line in
    select l.id, l.run_id, l.employee_id, l.gross, l.allowances, l.deductions, l.net
    from public.payroll_run_lines l where l.run_id = p_run_id
  loop
    v_allowances := 0; v_deductions := 0; v_taxes := 0;
    for v_rules in
      select * from public.payroll_rule_defs rd where rd.is_active = true
    loop
      if v_rules.rule_type = 'allowance' then
        v_allowances := v_allowances + case when v_rules.amount_type = 'fixed' then v_rules.amount_value else (v_rules.amount_value/100.0) * coalesce(v_line.gross,0) end;
      else
        v_deductions := v_deductions + case when v_rules.amount_type = 'fixed' then v_rules.amount_value else (v_rules.amount_value/100.0) * coalesce(v_line.gross,0) end;
      end if;
    end loop;
    for v_tax in
      select * from public.payroll_tax_defs td where td.is_active = true
    loop
      if v_tax.applies_to = 'gross' then
        v_taxes := v_taxes + (coalesce(v_tax.rate,0)/100.0) * coalesce(v_line.gross,0);
      else
        v_taxes := v_taxes + (coalesce(v_tax.rate,0)/100.0) * greatest(0, coalesce(v_line.gross,0) + v_allowances - v_deductions);
      end if;
    end loop;
    select * into v_loan from public.payroll_loans pl where pl.employee_id = v_line.employee_id and pl.status = 'active' order by pl.created_at asc limit 1;
    if found and coalesce(v_loan.installment_amount,0) > 0 then
      v_deductions := v_deductions + coalesce(v_loan.installment_amount,0);
      update public.payroll_loans set balance = greatest(0, coalesce(balance,0) - coalesce(v_loan.installment_amount,0)), status = case when (coalesce(balance,0) - coalesce(v_loan.installment_amount,0)) <= 1e-9 then 'closed' else status end where id = v_loan.id;
    end if;
    update public.payroll_run_lines
    set allowances = v_allowances,
        deductions = v_deductions + v_taxes,
        net = greatest(0, coalesce(v_line.gross,0) + v_allowances - (v_deductions + v_taxes))
    where id = v_line.id;
  end loop;
  perform public.recalc_payroll_run_totals(p_run_id);
end;
$$;
revoke all on function public.compute_payroll_run_v3(uuid) from public;
revoke execute on function public.compute_payroll_run_v3(uuid) from anon;
grant execute on function public.compute_payroll_run_v3(uuid) to authenticated;

-- 4) Financial Dimensions (Departments/Projects) & Reporting
create table if not exists public.departments (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);
alter table public.departments enable row level security;
create policy departments_select on public.departments
  for select using (public.has_admin_permission('accounting.view'));
create policy departments_write on public.departments
  for all using (public.has_admin_permission('accounting.manage'))
  with check (public.has_admin_permission('accounting.manage'));

create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);
alter table public.projects enable row level security;
create policy projects_select on public.projects
  for select using (public.has_admin_permission('accounting.view'));
create policy projects_write on public.projects
  for all using (public.has_admin_permission('accounting.manage'))
  with check (public.has_admin_permission('accounting.manage'));

alter table public.journal_lines
  add column if not exists dept_id uuid references public.departments(id) on delete set null,
  add column if not exists project_id uuid references public.projects(id) on delete set null;

create or replace view public.general_ledger_by_dimensions as
select
  je.entry_date::date as entry_date,
  je.id as journal_entry_id,
  coa.code as account_code,
  coa.name as account_name,
  jl.debit,
  jl.credit,
  jl.line_memo,
  cc.id as cost_center_id,
  d.id as dept_id,
  p.id as project_id
from public.journal_lines jl
join public.journal_entries je on je.id = jl.journal_entry_id
join public.chart_of_accounts coa on coa.id = jl.account_id
left join public.cost_centers cc on cc.id = jl.cost_center_id
left join public.departments d on d.id = jl.dept_id
left join public.projects p on p.id = jl.project_id;
alter view public.general_ledger_by_dimensions set (security_invoker = true);
grant select on public.general_ledger_by_dimensions to authenticated;

create or replace function public.set_journal_line_dimensions(p_line_id uuid, p_dept_id uuid default null, p_project_id uuid default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.has_admin_permission('accounting.manage') then
    raise exception 'not allowed';
  end if;
  update public.journal_lines
  set dept_id = p_dept_id,
      project_id = p_project_id
  where id = p_line_id;
end;
$$;
revoke all on function public.set_journal_line_dimensions(uuid, uuid, uuid) from public;
revoke execute on function public.set_journal_line_dimensions(uuid, uuid, uuid) from anon;
grant execute on function public.set_journal_line_dimensions(uuid, uuid, uuid) to authenticated;

-- 5) Strengthen SoD: expand permission function with accounting.approve
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
      'accounting.periods.close',
      'accounting.approve'
    ]);
  end if;

  return false;
end;
$$;

notify pgrst, 'reload schema';
