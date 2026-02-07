set client_min_messages = notice;
set statement_timeout = 0;
set lock_timeout = 0;

do $$
declare
  t0 timestamptz;
  ms int;
  v_owner uuid;
  v_exists int;
begin
  t0 := clock_timestamp();

  select u.id into v_owner
  from auth.users u
  where lower(u.email) = lower('owner@azta.com')
  limit 1;

  if v_owner is null then
    raise exception 'missing local owner auth.users row for owner@azta.com';
  end if;

  select count(1) into v_exists
  from public.admin_users au
  where au.auth_user_id = v_owner
    and au.is_active = true;

  if v_exists = 0 then
    insert into public.admin_users(auth_user_id, username, full_name, email, role, permissions, is_active)
    values (v_owner, 'owner', 'Owner', 'owner@azta.com', 'owner', array[]::text[], true);
  end if;

  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_owner::text, 'role', 'authenticated')::text, false);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_owner::text, 'role', 'authenticated')::text, true);

  ms := (extract(epoch from (clock_timestamp() - t0)) * 1000)::int;
  raise notice 'SMOKE_PASS|LS00|Owner session ready|%|{}', ms;
end $$;

set role authenticated;

do $$
declare
  t0 timestamptz;
  ms int;
  v_ok boolean;
begin
  t0 := clock_timestamp();

  if to_regclass('public.ledger_public_keys') is null then
    raise exception 'ledger_public_keys missing';
  end if;
  if to_regclass('public.ledger_entry_signatures') is null then
    raise exception 'ledger_entry_signatures missing';
  end if;
  if to_regprocedure('public.sign_ledger_entry(uuid,uuid,text,text,jsonb)') is null then
    raise exception 'sign_ledger_entry missing';
  end if;
  if to_regprocedure('public.export_ledger_hashes(date,date,int)') is null then
    raise exception 'export_ledger_hashes missing';
  end if;

  select public.has_admin_permission('accounting.manage') into v_ok;
  if v_ok is not true then
    raise exception 'has_admin_permission(accounting.manage) failed';
  end if;

  select public.has_admin_permission('accounting.view') into v_ok;
  if v_ok is not true then
    raise exception 'has_admin_permission(accounting.view) failed';
  end if;

  ms := (extract(epoch from (clock_timestamp() - t0)) * 1000)::int;
  raise notice 'SMOKE_PASS|LS01|Sign/export interfaces exist and permissions work|%|{}', ms;
end $$;

do $$
declare
  t0 timestamptz;
  ms int;
  v_key_name text;
  v_key_id uuid;
  v_entry_id uuid;
  v_sig_id uuid;
  v_chain text;
  v_sig_chain text;
  v_export_count int;
begin
  t0 := clock_timestamp();

  v_key_name := 'SMOKE_LEDGER_KEY_' || replace(gen_random_uuid()::text, '-', '');

  insert into public.ledger_public_keys(key_name, public_key, is_active, created_by)
  values (v_key_name, 'pk_smoke', true, auth.uid())
  returning id into v_key_id;

  v_entry_id := public.create_manual_journal_entry(
    clock_timestamp(),
    'LS02 signatures smoke entry',
    jsonb_build_array(
      jsonb_build_object('accountCode','1010','debit',10,'credit',0,'memo','cash'),
      jsonb_build_object('accountCode','4010','debit',0,'credit',10,'memo','rev')
    ),
    null
  );

  execute 'set constraints all immediate';

  select lec.chain_hash into v_chain
  from public.ledger_entry_hash_chain lec
  where lec.journal_entry_id = v_entry_id;

  if nullif(v_chain,'') is null then
    raise exception 'missing chain hash for entry';
  end if;

  select public.sign_ledger_entry(
    v_entry_id,
    v_key_id,
    'sig_smoke',
    'ed25519',
    jsonb_build_object('smoke', true)
  ) into v_sig_id;

  if v_sig_id is null then
    raise exception 'sign_ledger_entry returned null';
  end if;

  select s.chain_hash into v_sig_chain
  from public.ledger_entry_signatures s
  where s.id = v_sig_id;

  if v_sig_chain is distinct from v_chain then
    raise exception 'signature chain hash mismatch';
  end if;

  select count(1) into v_export_count
  from public.export_ledger_hashes(current_date - 1, current_date + 1, 50000) x
  where x.journal_entry_id = v_entry_id
    and x.signature_count >= 1
    and nullif(x.chain_hash,'') is not null;

  if v_export_count <> 1 then
    raise exception 'export_ledger_hashes did not include signed entry';
  end if;

  ms := (extract(epoch from (clock_timestamp() - t0)) * 1000)::int;
  raise notice 'SMOKE_PASS|LS02|Sign ledger entry and export hashes|%|{"entryId":"%","signatureId":"%"}', ms, v_entry_id, v_sig_id;
end $$;

select 'LEDGER_SIGNATURES_EXPORT_SMOKE_OK' as result;
