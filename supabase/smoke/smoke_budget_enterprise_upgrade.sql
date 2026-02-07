set client_min_messages = notice;
set statement_timeout = 0;
set lock_timeout = 0;

do $$
declare
  v_owner uuid;
  v_exists int;
begin
  select u.id into v_owner from auth.users u where lower(u.email) = lower('owner@azta.com') limit 1;
  if v_owner is null then
    raise exception 'missing local owner auth.users row for owner@azta.com';
  end if;
  select count(1) into v_exists from public.admin_users au where au.auth_user_id = v_owner and au.is_active = true;
  if v_exists = 0 then
    insert into public.admin_users(auth_user_id, username, full_name, email, role, permissions, is_active)
    values (v_owner, 'owner', 'Owner', 'owner@azta.com', 'owner', array[]::text[], true);
  end if;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_owner::text, 'role', 'authenticated')::text, false);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_owner::text, 'role', 'authenticated')::text, true);
end $$;

set role authenticated;

do $$
declare
  t0 timestamptz;
  ms int;
begin
  t0 := clock_timestamp();
  if to_regclass('public.budget_scenarios') is null then
    raise exception 'budget_scenarios missing';
  end if;
  if not exists (select 1 from pg_proc where proname = 'create_budget_scenario') then
    raise exception 'create_budget_scenario missing';
  end if;
  if not exists (select 1 from pg_proc where proname = 'roll_budget_forward') then
    raise exception 'roll_budget_forward missing';
  end if;
  if not exists (select 1 from pg_proc where proname = 'create_forecast_budget_from_actuals') then
    raise exception 'create_forecast_budget_from_actuals missing';
  end if;
  if not exists (select 1 from pg_proc where proname = 'budget_variance_analysis') then
    raise exception 'budget_variance_analysis missing';
  end if;
  ms := (extract(epoch from (clock_timestamp() - t0)) * 1000)::int;
  raise notice 'SMOKE_PASS|BUD10|Budget enterprise upgrade exists|%|{}', ms;
end $$;

do $$
declare
  t0 timestamptz;
  ms int;
  v_year int := extract(year from current_date)::int;
  v_start date := date_trunc('month', current_date)::date;
  v_end date := (date_trunc('month', current_date) + interval '1 month - 1 day')::date;
  v_budget uuid;
  v_scn_budget uuid;
  v_roll_cnt int;
  v_forecast uuid;
  v_var_cnt int;
begin
  t0 := clock_timestamp();

  v_budget := public.create_budget('SMOKE BUDGET ENTERPRISE', v_year, public.get_base_currency(), public.get_default_company_id(), public.get_default_branch_id());
  perform public.add_budget_line(v_budget, v_start, '4010', null, null, 120, 'revenue budget');
  perform public.add_budget_line(v_budget, v_start, '5010', null, null, 40, 'expense budget');

  v_scn_budget := public.create_budget_scenario(v_budget, 'Scenario A');
  if v_scn_budget is null then
    raise exception 'scenario budget not created';
  end if;

  select public.roll_budget_forward(v_scn_budget, 2) into v_roll_cnt;
  if coalesce(v_roll_cnt,0) < 1 then
    raise exception 'expected roll forward inserts';
  end if;

  perform public.create_manual_journal_entry(
    clock_timestamp(),
    'BUD11 enterprise actuals',
    jsonb_build_array(
      jsonb_build_object('accountCode','1010','debit',100,'credit',0,'memo','cash'),
      jsonb_build_object('accountCode','4010','debit',0,'credit',100,'memo','rev')
    ),
    null
  );
  perform public.create_manual_journal_entry(
    clock_timestamp(),
    'BUD11 enterprise actuals exp',
    jsonb_build_array(
      jsonb_build_object('accountCode','5010','debit',30,'credit',0,'memo','exp'),
      jsonb_build_object('accountCode','1010','debit',0,'credit',30,'memo','cash')
    ),
    null
  );

  v_forecast := public.create_forecast_budget_from_actuals('SMOKE FORECAST', v_start, 2, 1, public.get_default_company_id(), public.get_default_branch_id(), 'avg');
  if v_forecast is null then
    raise exception 'forecast budget not created';
  end if;

  select count(*) into v_var_cnt
  from public.budget_variance_analysis(v_budget, v_start, v_end, 'ifrs_line', null);
  if v_var_cnt < 1 then
    raise exception 'variance analysis empty';
  end if;

  ms := (extract(epoch from (clock_timestamp() - t0)) * 1000)::int;
  raise notice 'SMOKE_PASS|BUD11|Scenario/rolling/forecast/variance work|%|{}', ms;
end $$;

do $$
begin
  raise notice 'BUDGET_ENTERPRISE_UPGRADE_SMOKE_OK';
end $$;

