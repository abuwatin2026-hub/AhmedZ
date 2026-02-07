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

  if to_regclass('public.consolidation_groups') is null then
    raise exception 'consolidation_groups missing';
  end if;
  if to_regclass('public.consolidation_group_members') is null then
    raise exception 'consolidation_group_members missing';
  end if;
  if to_regclass('public.intercompany_elimination_rules') is null then
    raise exception 'intercompany_elimination_rules missing';
  end if;
  if not exists (select 1 from pg_proc where proname = 'consolidated_trial_balance') then
    raise exception 'consolidated_trial_balance missing';
  end if;

  ms := (extract(epoch from (clock_timestamp() - t0)) * 1000)::int;
  raise notice 'SMOKE_PASS|CON00|Consolidation engine core exists|%|{}', ms;
end $$;

do $$
declare
  t0 timestamptz;
  ms int;
  v_group uuid;
  v_company uuid;
  v_entry uuid;
  v_cnt_before int;
  v_cnt_after int;
begin
  t0 := clock_timestamp();

  v_company := public.get_default_company_id();
  if v_company is null then
    raise exception 'missing default company id';
  end if;

  delete from public.intercompany_elimination_rules where group_id in (select id from public.consolidation_groups where name = 'SMOKE CONSOLIDATION');
  delete from public.consolidation_group_members where group_id in (select id from public.consolidation_groups where name = 'SMOKE CONSOLIDATION');
  delete from public.consolidation_groups where name = 'SMOKE CONSOLIDATION';

  v_group := public.create_consolidation_group('SMOKE CONSOLIDATION', v_company, public.get_base_currency());
  if v_group is null then
    raise exception 'group not created';
  end if;

  perform public.add_consolidation_member(v_group, v_company, 1);

  v_entry := public.create_manual_journal_entry(
    clock_timestamp(),
    'CON01 smoke entry',
    jsonb_build_array(
      jsonb_build_object('accountCode','1010','debit',70,'credit',0,'memo','cash'),
      jsonb_build_object('accountCode','4010','debit',0,'credit',70,'memo','rev')
    ),
    null
  );
  if v_entry is null then
    raise exception 'missing journal entry id';
  end if;

  select count(*) into v_cnt_before
  from public.consolidated_trial_balance(v_group, current_date, 'account', 'base')
  where group_key = '1010';
  if v_cnt_before < 1 then
    raise exception 'expected 1010 present before elimination';
  end if;

  insert into public.intercompany_elimination_rules(group_id, account_code, rule_type, created_by)
  values (v_group, '1010', 'exclude', auth.uid())
  on conflict (group_id, account_code) do update set rule_type = excluded.rule_type;

  select count(*) into v_cnt_after
  from public.consolidated_trial_balance(v_group, current_date, 'account', 'base')
  where group_key = '1010';
  if v_cnt_after <> 0 then
    raise exception 'expected 1010 eliminated, got %', v_cnt_after;
  end if;

  ms := (extract(epoch from (clock_timestamp() - t0)) * 1000)::int;
  raise notice 'SMOKE_PASS|CON01|Consolidated TB and eliminations work|%|{}', ms;
end $$;

do $$
begin
  raise notice 'CONSOLIDATION_SMOKE_OK';
end $$;
