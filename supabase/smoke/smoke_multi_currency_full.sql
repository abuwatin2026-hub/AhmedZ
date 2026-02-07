do $$
begin
  if to_regclass('public.currencies') is null then raise exception 'missing currencies'; end if;
  if to_regclass('public.fx_rates') is null then raise exception 'missing fx_rates'; end if;
  if to_regclass('public.orders') is null then raise exception 'missing orders'; end if;
  if to_regclass('public.payments') is null then raise exception 'missing payments'; end if;
  if to_regclass('public.journal_entries') is null then raise exception 'missing journal_entries'; end if;
  if to_regclass('public.journal_lines') is null then raise exception 'missing journal_lines'; end if;
  if to_regclass('public.payroll_employees') is null then raise exception 'missing payroll_employees'; end if;
  if to_regclass('public.payroll_runs') is null then raise exception 'missing payroll_runs'; end if;
end $$;

do $$
declare v_owner uuid;
declare v_exists int;
begin
  select u.id into v_owner from auth.users u where lower(u.email) = 'owner@azta.com' limit 1;
  if v_owner is null then raise exception 'missing local owner auth.users'; end if;
  select count(1) into v_exists from public.admin_users au where au.auth_user_id = v_owner and au.is_active = true;
  if v_exists = 0 then
    insert into public.admin_users(auth_user_id, username, full_name, email, role, permissions, is_active)
    values (v_owner, 'owner', 'Owner', 'owner@azta.com', 'owner', array[]::text[], true);
  end if;
  perform set_config(
    'request.jwt.claims',
    jsonb_build_object('sub', v_owner::text, 'role', 'authenticated')::text,
    false
  );
end $$;

set role authenticated;

select auth.uid() as auth_uid, auth.role() as auth_role, public.get_base_currency() as base_currency;

drop table if exists smoke_fx_ids;
create temp table smoke_fx_ids(
  order_id uuid,
  payment_id uuid,
  payroll_run_id uuid
);

do $$
declare
  v_base text;
  v_usd text := 'USD';
  v_yer text := 'YER';
  v_rate1 numeric := 2.00;
  v_rate2 numeric := 2.20;
  v_rate_acc numeric := 2.10;
  v_order_id uuid;
  v_payment_id uuid;
  v_exists int;
  v_base_is_high boolean := false;
  v_yer_is_high boolean := true;
  v_saved numeric;
begin
  v_base := public.get_base_currency();
  select coalesce(c.is_high_inflation,false) into v_base_is_high from public.currencies c where upper(c.code)=upper(v_base) limit 1;

  insert into public.currencies(code, name, is_base, is_high_inflation)
  values (v_base, v_base, true, v_base_is_high)
  on conflict (code) do update set is_base = excluded.is_base;

  insert into public.currencies(code, name, is_base, is_high_inflation)
  values (v_usd, 'US Dollar', false, false)
  on conflict (code) do nothing;

  insert into public.currencies(code, name, is_base, is_high_inflation)
  values (v_yer, 'Yemeni Rial', false, v_yer_is_high)
  on conflict (code) do update set is_high_inflation = excluded.is_high_inflation;

  insert into public.fx_rates(currency_code, rate, rate_date, rate_type)
  values (v_usd, v_rate1, '2026-02-10'::date, 'operational')
  on conflict (currency_code, rate_date, rate_type) do update set rate = excluded.rate;
  insert into public.fx_rates(currency_code, rate, rate_date, rate_type)
  values (v_usd, v_rate_acc, '2026-02-28'::date, 'accounting')
  on conflict (currency_code, rate_date, rate_type) do update set rate = excluded.rate;

  if (not v_base_is_high) then
    insert into public.fx_rates(currency_code, rate, rate_date, rate_type)
    values (v_yer, 400, '2026-02-10'::date, 'operational')
    on conflict (currency_code, rate_date, rate_type) do update set rate = excluded.rate;
    select fr.rate into v_saved from public.fx_rates fr where fr.currency_code = v_yer and fr.rate_date = '2026-02-10'::date and fr.rate_type='operational' limit 1;
    if v_saved is null or v_saved >= 1 then
      raise exception 'expected normalized high inflation rate < 1, got %', v_saved;
    end if;
  end if;

  v_order_id := gen_random_uuid();
  insert into public.orders(id, status, data, updated_at, currency, fx_rate, base_total, fx_locked, total)
  values (
    v_order_id,
    'delivered',
    jsonb_build_object(
      'total', 10,
      'subtotal', 10,
      'taxAmount', 0,
      'deliveryFee', 0,
      'discountAmount', 0,
      'orderSource', 'in_store',
      'paymentMethod', 'cash',
      'currency', v_usd,
      'fxRate', v_rate1
    ),
    '2026-02-10T10:00:00Z'::timestamptz,
    v_usd,
    v_rate1,
    10 * v_rate1,
    true,
    10
  );

  perform public.post_order_delivery(v_order_id);

  select count(1) into v_exists
  from public.journal_entries je
  where je.source_table='orders' and je.source_id=v_order_id::text and je.source_event='delivered';
  if v_exists <> 1 then
    raise exception 'missing delivered posting for order';
  end if;

  v_payment_id := gen_random_uuid();
  insert into public.payments(id, direction, method, amount, currency, fx_rate, base_amount, reference_table, reference_id, occurred_at, created_by, data, fx_locked)
  values (
    v_payment_id,
    'in',
    'bank',
    10,
    v_usd,
    v_rate2,
    10 * v_rate2,
    'orders',
    v_order_id::text,
    '2026-02-12T12:00:00Z'::timestamptz,
    auth.uid(),
    jsonb_build_object('orderId', v_order_id::text),
    true
  );

  perform public.post_payment(v_payment_id);

  select count(1) into v_exists
  from public.journal_lines jl
  join public.journal_entries je on je.id = jl.journal_entry_id
  join public.chart_of_accounts coa on coa.id = jl.account_id
  where je.source_table='payments' and je.source_id=v_payment_id::text and coa.code in ('6200','6201');
  if v_exists <> 1 then
    raise exception 'expected 1 realized FX line (6200/6201), got %', v_exists;
  end if;

  insert into public.fx_rates(currency_code, rate, rate_date, rate_type)
  values (v_usd, 2.30, '2026-02-28'::date, 'accounting')
  on conflict (currency_code, rate_date, rate_type) do update set rate = excluded.rate;
  perform public.run_fx_revaluation('2026-02-28'::date);

  select count(1) into v_exists
  from public.fx_revaluation_monetary_audit a
  where a.period_end = '2026-02-28'::date
    and upper(a.currency) = v_usd;
  if v_exists < 1 then
    raise exception 'expected monetary revaluation audit rows';
  end if;

  insert into smoke_fx_ids(order_id, payment_id) values (v_order_id, v_payment_id);
end $$;

do $$
declare
  v_base text;
  v_usd text := 'USD';
  v_period text := '2099-12';
  v_date date;
  v_run uuid;
  v_line record;
  v_expected numeric;
  v_emp_id uuid;
  v_fx numeric := 2.00;
  v_gross_base numeric;
begin
  v_base := public.get_base_currency();
  v_date := public._payroll_last_day(v_period);
  insert into public.fx_rates(currency_code, rate, rate_date, rate_type)
  values (v_usd, v_fx, v_date, 'accounting')
  on conflict (currency_code, rate_date, rate_type) do update set rate = excluded.rate;

  update public.payroll_employees
  set full_name = 'Smoke MC Employee',
      monthly_salary = 100,
      currency = v_usd,
      is_active = true
  where employee_code = 'SMK-MC-001';
  if not found then
    insert into public.payroll_employees(full_name, employee_code, monthly_salary, currency, is_active)
    values ('Smoke MC Employee', 'SMK-MC-001', 100, v_usd, true);
  end if;

  select pr.id
  into v_run
  from public.payroll_runs pr
  where pr.period_ym = v_period
  limit 1;
  if v_run is null then
    select public.create_payroll_run(v_period, 'smoke mc') into v_run;
  else
    update public.payroll_runs pr set status = 'draft' where pr.id = v_run;
  end if;

  select e.id
  into v_emp_id
  from public.payroll_employees e
  where e.employee_code = 'SMK-MC-001'
  limit 1;
  if v_emp_id is null then
    raise exception 'missing payroll employee';
  end if;

  v_gross_base := round(100 * v_fx, 2);
  update public.payroll_run_lines l
  set gross = v_gross_base,
      foreign_amount = 100,
      fx_rate = v_fx,
      currency_code = v_usd
  where l.run_id = v_run and l.employee_id = v_emp_id;
  if not found then
    insert into public.payroll_run_lines(run_id, employee_id, gross, foreign_amount, fx_rate, currency_code)
    values (v_run, v_emp_id, v_gross_base, 100, v_fx, v_usd);
  end if;

  insert into smoke_fx_ids(payroll_run_id) values (v_run);

  select l.gross, l.foreign_amount, l.fx_rate, l.currency_code
  into v_line
  from public.payroll_run_lines l
  join public.payroll_employees e on e.id = l.employee_id
  where l.run_id = v_run and e.employee_code = 'SMK-MC-001'
  limit 1;

  v_expected := round(100 * coalesce(v_line.fx_rate,0), 2);
  if coalesce(v_line.foreign_amount, 0) <> 100 then
    raise exception 'expected foreign_amount=100, got %', v_line.foreign_amount;
  end if;
  if upper(coalesce(v_line.currency_code,'')) <> v_usd then
    raise exception 'expected currency_code=USD, got %', v_line.currency_code;
  end if;
  if coalesce(v_line.gross, 0) <> v_expected then
    raise exception 'expected gross_base %, got %', v_expected, v_line.gross;
  end if;
end $$;
