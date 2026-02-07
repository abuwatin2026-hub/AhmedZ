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

  if to_regclass('public.ledger_entry_hash_chain') is null then
    raise exception 'ledger_entry_hash_chain missing';
  end if;
  if not exists (select 1 from pg_proc where proname = 'verify_ledger_hash_chain') then
    raise exception 'verify_ledger_hash_chain missing';
  end if;

  ms := (extract(epoch from (clock_timestamp() - t0)) * 1000)::int;
  raise notice 'SMOKE_PASS|TD00|Forensic hash chain core exists|%|{}', ms;
end $$;

do $$
declare
  t0 timestamptz;
  ms int;
  v_entry uuid;
  v_ok boolean;
  v_fail boolean := false;
begin
  t0 := clock_timestamp();

  v_entry := public.create_manual_journal_entry(
    clock_timestamp(),
    'TD01 tamper smoke entry',
    jsonb_build_array(
      jsonb_build_object('accountCode','1010','debit',50,'credit',0,'memo','cash'),
      jsonb_build_object('accountCode','4010','debit',0,'credit',50,'memo','rev')
    ),
    null
  );

  execute 'set constraints all immediate';

  select ok into v_ok
  from public.verify_ledger_hash_chain(current_date - 1, current_date + 1, 50000)
  where issue = 'ok'
  limit 1;
  if v_ok is distinct from true then
    raise exception 'hash chain verification failed';
  end if;

  begin
    update public.journal_entries set memo = 'tampered' where id = v_entry;
    v_fail := false;
  exception when others then
    v_fail := true;
  end;
  if v_fail is not true then
    raise exception 'expected tamper update blocked';
  end if;

  ms := (extract(epoch from (clock_timestamp() - t0)) * 1000)::int;
  raise notice 'SMOKE_PASS|TD01|Hash chain verifies and immutability blocks tamper|%|{}', ms;
end $$;

do $$
begin
  raise notice 'TAMPER_SMOKE_OK';
end $$;
