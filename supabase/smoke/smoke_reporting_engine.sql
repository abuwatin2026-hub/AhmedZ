set client_min_messages = notice;
set statement_timeout = 0;
set lock_timeout = 0;

do $$
declare
  v_owner uuid;
begin
  select u.id into v_owner from auth.users u where lower(u.email) = lower('owner@azta.com') limit 1;
  if v_owner is null then
    raise exception 'missing local owner auth.users row for owner@azta.com';
  end if;
  perform set_config('app.smoke_owner_id', v_owner::text, false);
end $$;

do $$
declare
  t0 timestamptz;
  ms int;
  v_owner_id text;
begin
  t0 := clock_timestamp();
  v_owner_id := nullif(current_setting('app.smoke_owner_id', true), '');
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_owner_id, 'role', 'authenticated')::text, false);
  set role authenticated;

  if to_regclass('public.enterprise_gl_lines') is null then
    raise exception 'enterprise_gl_lines missing';
  end if;
  if to_regclass('public.ledger_snapshot_headers') is null then
    raise exception 'ledger_snapshot_headers missing';
  end if;
  if to_regclass('public.ledger_snapshot_lines') is null then
    raise exception 'ledger_snapshot_lines missing';
  end if;

  ms := (extract(epoch from (clock_timestamp() - t0)) * 1000)::int;
  raise notice 'SMOKE_PASS|RE00|Reporting engine core exists|%|{}', ms;
end $$;

do $$
declare
  t0 timestamptz;
  ms int;
  v_entry uuid;
  v_tb_cnt int;
  v_dr_cnt int;
  v_pnl_cnt int;
  v_snap uuid;
begin
  t0 := clock_timestamp();

  v_entry := public.create_manual_journal_entry(
    clock_timestamp(),
    'RE01 smoke entry',
    jsonb_build_array(
      jsonb_build_object('accountCode','1010','debit',100,'credit',0,'memo','cash'),
      jsonb_build_object('accountCode','4010','debit',0,'credit',100,'memo','rev')
    ),
    null
  );

  select count(*) into v_tb_cnt
  from public.enterprise_trial_balance(current_date - 1, current_date + 1, null, null, null, null, null, 'base', 'account');
  if v_tb_cnt <= 0 then
    raise exception 'trial balance empty';
  end if;

  select count(*) into v_dr_cnt
  from public.enterprise_trial_balance_drilldown('1010', current_date - 1, current_date + 1, null, null, null, null, null);
  if v_dr_cnt <= 0 then
    raise exception 'drilldown empty';
  end if;

  select count(*) into v_pnl_cnt
  from public.enterprise_profit_and_loss(current_date - 1, current_date + 1, null, null, null, null, null, 'ifrs_line');
  if v_pnl_cnt <= 0 then
    raise exception 'pnl empty';
  end if;

  select public.create_ledger_snapshot(current_date, null, null, 'smoke') into v_snap;
  if v_snap is null then
    raise exception 'snapshot not created';
  end if;

  ms := (extract(epoch from (clock_timestamp() - t0)) * 1000)::int;
  raise notice 'SMOKE_PASS|RE01|Trial balance/P&L/drilldown/snapshot works|%|{}', ms;
end $$;

do $$
begin
  raise notice 'REPORTING_SMOKE_OK';
end $$;

