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
  v_current_cc uuid;
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
    set amount = v_net
    where id = v_run.expense_id;

    if v_run.cost_center_id is not null then
      select e.cost_center_id
      into v_current_cc
      from public.expenses e
      where e.id = v_run.expense_id;

      if v_current_cc is distinct from v_run.cost_center_id then
        update public.expenses
        set cost_center_id = v_run.cost_center_id
        where id = v_run.expense_id;
      end if;
    end if;
  end if;
end;
$$;

revoke all on function public.recalc_payroll_run_totals(uuid) from public;
grant execute on function public.recalc_payroll_run_totals(uuid) to anon, authenticated;

notify pgrst, 'reload schema';
