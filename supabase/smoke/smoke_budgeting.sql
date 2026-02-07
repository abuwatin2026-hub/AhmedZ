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

  if to_regclass('public.budget_headers') is null then
    raise exception 'budget_headers missing';
  end if;
  if to_regclass('public.budget_lines') is null then
    raise exception 'budget_lines missing';
  end if;
  if not exists (select 1 from pg_proc where proname = 'budget_vs_actual_pnl') then
    raise exception 'budget_vs_actual_pnl missing';
  end if;

  ms := (extract(epoch from (clock_timestamp() - t0)) * 1000)::int;
  raise notice 'SMOKE_PASS|BUD00|Budget engine core exists|%|{}', ms;
end $$;

do $$
declare
  t0 timestamptz;
  ms int;
  v_year int := extract(year from current_date)::int;
  v_start date := date_trunc('month', current_date)::date;
  v_end date := (date_trunc('month', current_date) + interval '1 month - 1 day')::date;
  v_budget uuid;
  v_entry1 uuid;
  v_entry2 uuid;
  v_cnt int;
begin
  t0 := clock_timestamp();

  delete from public.budget_lines where budget_id in (select id from public.budget_headers where name = 'SMOKE BUDGET');
  delete from public.budget_headers where name = 'SMOKE BUDGET';

  v_budget := public.create_budget('SMOKE BUDGET', v_year, public.get_base_currency(), public.get_default_company_id(), public.get_default_branch_id());
  if v_budget is null then
    raise exception 'budget not created';
  end if;

  perform public.add_budget_line(v_budget, v_start, '4010', null, null, 120, 'revenue budget');
  perform public.add_budget_line(v_budget, v_start, '5010', null, null, 40, 'expense budget');

  v_entry1 := public.create_manual_journal_entry(
    clock_timestamp(),
    'BUD01 smoke revenue',
    jsonb_build_array(
      jsonb_build_object('accountCode','1010','debit',100,'credit',0,'memo','cash'),
      jsonb_build_object('accountCode','4010','debit',0,'credit',100,'memo','rev')
    ),
    null
  );
  if v_entry1 is null then
    raise exception 'missing revenue entry id';
  end if;

  v_entry2 := public.create_manual_journal_entry(
    clock_timestamp(),
    'BUD01 smoke expense',
    jsonb_build_array(
      jsonb_build_object('accountCode','5010','debit',50,'credit',0,'memo','exp'),
      jsonb_build_object('accountCode','1010','debit',0,'credit',50,'memo','cash')
    ),
    null
  );
  if v_entry2 is null then
    raise exception 'missing expense entry id';
  end if;

  select count(*) into v_cnt
  from public.budget_vs_actual_pnl(v_budget, v_start, v_end, null);
  if v_cnt < 1 then
    raise exception 'budget_vs_actual_pnl returned empty';
  end if;

  if not exists (
    select 1 from public.budget_vs_actual_pnl(v_budget, v_start, v_end, null) r where r.account_code in ('4010','5010')
  ) then
    raise exception 'expected rows for 4010/5010';
  end if;

  ms := (extract(epoch from (clock_timestamp() - t0)) * 1000)::int;
  raise notice 'SMOKE_PASS|BUD01|Budget vs actual P&L works|%|{}', ms;
end $$;

do $$
begin
  raise notice 'BUDGET_SMOKE_OK';
end $$;
