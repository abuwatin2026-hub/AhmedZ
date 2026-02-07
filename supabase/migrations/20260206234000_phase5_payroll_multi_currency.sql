do $$
begin
  if to_regclass('public.payroll_run_lines') is not null then
    begin
      alter table public.payroll_run_lines add column foreign_amount numeric;
    exception when duplicate_column then null;
    end;
    begin
      alter table public.payroll_run_lines add column fx_rate numeric;
    exception when duplicate_column then null;
    end;
    begin
      alter table public.payroll_run_lines add column currency_code text;
    exception when duplicate_column then null;
    end;
  end if;
end $$;

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
  v_base text;
  v_cur text;
  v_fx numeric;
  v_gross_foreign numeric;
  v_gross_base numeric;
begin
  if not (public.can_manage_expenses() or public.has_admin_permission('accounting.manage') or public.is_admin()) then
    raise exception 'not allowed';
  end if;

  v_date := public._payroll_last_day(p_period_ym);

  if exists (select 1 from public.payroll_runs pr where pr.period_ym = p_period_ym) then
    raise exception 'payroll run already exists';
  end if;

  v_base := public.get_base_currency();

  insert into public.payroll_runs(period_ym, status, memo, created_by)
  values (p_period_ym, 'draft', nullif(trim(coalesce(p_memo,'')), ''), auth.uid())
  returning id into v_run_id;

  for v_row in
    select id, full_name, monthly_salary, currency
    from public.payroll_employees
    where is_active = true
    order by full_name asc
  loop
    v_cur := upper(nullif(btrim(coalesce(v_row.currency, v_base)), ''));
    if v_cur is null then
      v_cur := v_base;
    end if;
    v_gross_foreign := coalesce(v_row.monthly_salary, 0);
    if v_gross_foreign < 0 then
      raise exception 'invalid salary';
    end if;

    if v_cur = v_base then
      v_fx := 1;
    else
      v_fx := public.get_fx_rate(v_cur, v_date, 'accounting');
      if v_fx is null then
        v_fx := public.get_fx_rate(v_cur, v_date, 'operational');
      end if;
      if v_fx is null or v_fx <= 0 then
        raise exception 'fx rate missing for currency % at %', v_cur, v_date;
      end if;
    end if;

    v_gross_base := round(v_gross_foreign * v_fx, 2);

    insert into public.payroll_run_lines(run_id, employee_id, gross, deductions, net, line_memo, foreign_amount, fx_rate, currency_code)
    values (v_run_id, v_row.id, v_gross_base, 0, v_gross_base, null, v_gross_foreign, v_fx, v_cur);

    v_total := v_total + v_gross_base;
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
    jsonb_build_object('runId', v_run_id::text, 'period', p_period_ym, 'expenseId', v_expense_id::text, 'total_base', v_total, 'base_currency', v_base)
  );

  return v_run_id;
end;
$$;

revoke all on function public.create_payroll_run(text, text) from public;
grant execute on function public.create_payroll_run(text, text) to anon, authenticated;

notify pgrst, 'reload schema';

