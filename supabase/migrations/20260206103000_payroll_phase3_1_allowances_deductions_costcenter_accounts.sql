do $$
begin
  if to_regclass('public.chart_of_accounts') is null then
    return;
  end if;
  insert into public.chart_of_accounts(code, name, account_type, normal_balance, is_active)
  values
    ('6120', 'Salaries Expense', 'expense', 'debit', true),
    ('2120', 'Salaries Payable', 'liability', 'credit', true)
  on conflict (code) do update
  set name = excluded.name,
      account_type = excluded.account_type,
      normal_balance = excluded.normal_balance,
      is_active = true;
exception when others then
  null;
end $$;

do $$
begin
  if to_regclass('public.chart_of_accounts') is null then
    return;
  end if;
  update public.chart_of_accounts
  set name = 'مصروفات الرواتب'
  where code = '6120' and (name is null or name = 'Salaries Expense');
  update public.chart_of_accounts
  set name = 'ذمم الرواتب'
  where code = '2120' and (name is null or name = 'Salaries Payable');
exception when others then
  null;
end $$;

create table if not exists public.payroll_settings (
  id text primary key default 'app',
  salary_expense_account_id uuid references public.chart_of_accounts(id) on delete set null,
  salary_payable_account_id uuid references public.chart_of_accounts(id) on delete set null,
  default_cost_center_id uuid references public.cost_centers(id) on delete set null,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null
);

alter table public.payroll_settings enable row level security;

drop policy if exists payroll_settings_select on public.payroll_settings;
create policy payroll_settings_select
on public.payroll_settings
for select
using (public.has_admin_permission('accounting.view'));

drop policy if exists payroll_settings_write on public.payroll_settings;
create policy payroll_settings_write
on public.payroll_settings
for all
using (public.has_admin_permission('accounting.manage') or public.is_admin())
with check (public.has_admin_permission('accounting.manage') or public.is_admin());

do $$
begin
  if to_regclass('public.payroll_settings') is null then
    return;
  end if;
  insert into public.payroll_settings(id, salary_expense_account_id, salary_payable_account_id)
  values (
    'app',
    public.get_account_id_by_code('6120'),
    public.get_account_id_by_code('2120')
  )
  on conflict (id) do update
  set salary_expense_account_id = coalesce(public.payroll_settings.salary_expense_account_id, excluded.salary_expense_account_id),
      salary_payable_account_id = coalesce(public.payroll_settings.salary_payable_account_id, excluded.salary_payable_account_id),
      updated_at = now();
exception when others then
  null;
end $$;

alter table public.payroll_runs
  add column if not exists cost_center_id uuid references public.cost_centers(id) on delete set null;

alter table public.payroll_run_lines
  add column if not exists allowances numeric not null default 0,
  add column if not exists cost_center_id uuid references public.cost_centers(id) on delete set null;

create or replace function public._payroll_line_apply()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_g numeric;
  v_a numeric;
  v_d numeric;
begin
  v_g := coalesce(new.gross, 0);
  v_a := coalesce(new.allowances, 0);
  v_d := coalesce(new.deductions, 0);
  if v_g < 0 or v_a < 0 or v_d < 0 then
    raise exception 'invalid payroll line values';
  end if;
  new.net := greatest(0, v_g + v_a - v_d);
  return new;
end;
$$;

revoke all on function public._payroll_line_apply() from public;
grant execute on function public._payroll_line_apply() to anon, authenticated;

drop trigger if exists trg_payroll_run_lines_apply on public.payroll_run_lines;
create trigger trg_payroll_run_lines_apply
before insert or update of gross, allowances, deductions on public.payroll_run_lines
for each row execute function public._payroll_line_apply();

create or replace function public.recalc_payroll_run_totals(p_run_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_gross numeric;
  v_ded numeric;
  v_net numeric;
  v_run record;
begin
  if p_run_id is null then
    raise exception 'run_id is required';
  end if;

  select *
  into v_run
  from public.payroll_runs
  where id = p_run_id
  for update;

  if not found then
    raise exception 'run not found';
  end if;

  select
    coalesce(sum(coalesce(l.gross,0) + coalesce(l.allowances,0)), 0),
    coalesce(sum(coalesce(l.deductions,0)), 0),
    coalesce(sum(coalesce(l.net,0)), 0)
  into v_gross, v_ded, v_net
  from public.payroll_run_lines l
  where l.run_id = p_run_id;

  update public.payroll_runs
  set total_gross = v_gross,
      total_deductions = v_ded,
      total_net = v_net
  where id = p_run_id;

  if v_run.expense_id is not null then
    update public.expenses
    set amount = v_net,
        cost_center_id = coalesce(v_run.cost_center_id, cost_center_id)
    where id = v_run.expense_id;
  end if;
end;
$$;

revoke all on function public.recalc_payroll_run_totals(uuid) from public;
grant execute on function public.recalc_payroll_run_totals(uuid) to anon, authenticated;

create or replace function public._trg_payroll_run_lines_recalc()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.recalc_payroll_run_totals(coalesce(new.run_id, old.run_id));
  return coalesce(new, old);
end;
$$;

revoke all on function public._trg_payroll_run_lines_recalc() from public;
grant execute on function public._trg_payroll_run_lines_recalc() to anon, authenticated;

drop trigger if exists trg_payroll_run_lines_recalc on public.payroll_run_lines;
create trigger trg_payroll_run_lines_recalc
after insert or update or delete on public.payroll_run_lines
for each row execute function public._trg_payroll_run_lines_recalc();

create or replace function public.record_payroll_run_accrual_v2(
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
  v_expense_account uuid;
  v_payable_account uuid;
  v_amount numeric;
  v_occurred_at timestamptz;
  v_settings record;
begin
  if not (public.can_manage_expenses() or public.has_admin_permission('accounting.manage') or public.is_admin()) then
    raise exception 'not allowed';
  end if;

  v_occurred_at := coalesce(p_occurred_at, now());

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
  if coalesce(v_run.status,'') = 'voided' then
    raise exception 'run is voided';
  end if;

  perform public.recalc_payroll_run_totals(p_run_id);

  select total_net, cost_center_id, period_ym, memo, expense_id
  into v_amount, v_run.cost_center_id, v_run.period_ym, v_run.memo, v_run.expense_id
  from public.payroll_runs
  where id = p_run_id;

  v_amount := coalesce(v_amount, 0);
  if v_amount <= 0 then
    raise exception 'invalid amount';
  end if;

  select *
  into v_settings
  from public.payroll_settings
  where id = 'app';

  v_expense_account := coalesce(v_settings.salary_expense_account_id, public.get_account_id_by_code('6100'));
  v_payable_account := coalesce(v_settings.salary_payable_account_id, public.get_account_id_by_code('2010'));
  if v_expense_account is null or v_payable_account is null then
    raise exception 'required accounts not found';
  end if;

  insert into public.journal_entries(entry_date, memo, source_table, source_id, source_event, created_by)
  values (
    v_occurred_at,
    concat('Payroll accrual ', coalesce(v_run.period_ym, p_run_id::text)),
    'expenses',
    v_run.expense_id::text,
    'accrual',
    auth.uid()
  )
  on conflict (source_table, source_id, source_event)
  do update set entry_date = excluded.entry_date, memo = excluded.memo
  returning id into v_entry_id;

  delete from public.journal_lines jl where jl.journal_entry_id = v_entry_id;

  insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo, cost_center_id)
  values
    (v_entry_id, v_expense_account, v_amount, 0, 'Payroll expense', v_run.cost_center_id),
    (v_entry_id, v_payable_account, 0, v_amount, 'Payroll payable', v_run.cost_center_id);

  perform public.check_journal_entry_balance(v_entry_id);

  update public.payroll_runs
  set status = 'accrued',
      accrued_at = v_occurred_at
  where id = p_run_id;

  insert into public.system_audit_logs(action, module, details, performed_by, performed_at, metadata)
  values (
    'payroll_run_accrued',
    'payroll',
    concat('Payroll run accrued ', v_run.period_ym),
    auth.uid(),
    now(),
    jsonb_build_object('runId', p_run_id::text, 'period', v_run.period_ym, 'expenseId', v_run.expense_id::text, 'journalEntryId', v_entry_id::text, 'amount', v_amount)
  );

  return v_entry_id;
end;
$$;

revoke all on function public.record_payroll_run_accrual_v2(uuid, timestamptz) from public;
grant execute on function public.record_payroll_run_accrual_v2(uuid, timestamptz) to anon, authenticated;

notify pgrst, 'reload schema';
