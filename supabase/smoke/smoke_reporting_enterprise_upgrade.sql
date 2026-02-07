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
  if to_regclass('public.financial_report_snapshots') is null then
    raise exception 'financial_report_snapshots missing';
  end if;
  if not exists (select 1 from pg_proc where proname = 'enterprise_segment_trial_balance') then
    raise exception 'enterprise_segment_trial_balance missing';
  end if;
  if not exists (select 1 from pg_proc where proname = 'enterprise_report_comparative') then
    raise exception 'enterprise_report_comparative missing';
  end if;
  if not exists (select 1 from pg_proc where proname = 'enterprise_cash_flow_indirect_reconciliation') then
    raise exception 'enterprise_cash_flow_indirect_reconciliation missing';
  end if;
  ms := (extract(epoch from (clock_timestamp() - t0)) * 1000)::int;
  raise notice 'SMOKE_PASS|RE10|Reporting enterprise upgrade exists|%|{}', ms;
end $$;

do $$
declare
  t0 timestamptz;
  ms int;
  v_entry uuid;
  v_seg_cnt int;
  v_comp jsonb;
  v_snap uuid;
  v_snap_cnt int;
  v_cf record;
begin
  t0 := clock_timestamp();

  v_entry := public.create_manual_journal_entry(
    clock_timestamp(),
    'RE11 enterprise reporting smoke entry',
    jsonb_build_array(
      jsonb_build_object('accountCode','1010','debit',200,'credit',0,'memo','cash'),
      jsonb_build_object('accountCode','4010','debit',0,'credit',200,'memo','rev')
    ),
    null
  );

  select count(*) into v_seg_cnt
  from public.enterprise_segment_trial_balance(current_date - 1, current_date + 1, 'company', null, null, null, null, null, null, 'base', 'account');
  if v_seg_cnt <= 0 then
    raise exception 'segment trial balance empty';
  end if;

  v_comp := public.enterprise_report_comparative(
    'pl',
    jsonb_build_array(
      jsonb_build_object('label','P1','start',(current_date - 1)::text,'end',(current_date + 1)::text),
      jsonb_build_object('label','P2','start',(current_date - 3)::text,'end',(current_date - 2)::text)
    ),
    '{}'::jsonb
  );
  if jsonb_typeof(v_comp) is distinct from 'array' or jsonb_array_length(v_comp) <> 2 then
    raise exception 'comparative result invalid';
  end if;

  select public.create_financial_report_snapshot('trial_balance', jsonb_build_object('start',(current_date - 1)::text,'end',(current_date + 1)::text,'currencyView','base','rollup','account')) into v_snap;
  if v_snap is null then
    raise exception 'snapshot not created';
  end if;
  select count(*) into v_snap_cnt from public.financial_report_snapshots where id = v_snap;
  if v_snap_cnt <> 1 then
    raise exception 'snapshot row missing';
  end if;

  select * into v_cf
  from public.enterprise_cash_flow_indirect_reconciliation(current_date - 1, current_date + 1, null, null, null);
  if v_cf is null then
    raise exception 'cash flow indirect reconciliation empty';
  end if;

  ms := (extract(epoch from (clock_timestamp() - t0)) * 1000)::int;
  raise notice 'SMOKE_PASS|RE11|Comparative/segments/snapshots/cashflow indirect ok|%|{}', ms;
end $$;

do $$
begin
  raise notice 'REPORTING_ENTERPRISE_UPGRADE_SMOKE_OK';
end $$;

