set client_min_messages = warning;
do $$
declare v_owner uuid;
begin
  select id into v_owner from auth.users where email = 'owner@azta.com' limit 1;
  if v_owner is null then
    raise exception 'owner user not found';
  end if;
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated', 'admin_role', 'owner')::text, false);
end $$;

set role authenticated;

do $$
declare
  v_new_journal uuid := gen_random_uuid();
  v_entry uuid;
  v_default uuid;
  v_count int;
begin
  insert into public.journals(id, code, name, is_default, is_active)
  values (v_new_journal, 'SMOKE_SALES', 'دفتر مبيعات (Smoke)', false, true)
  on conflict (code) do update
  set name = excluded.name,
      is_active = true;

  select id into v_new_journal from public.journals where code = 'SMOKE_SALES' limit 1;
  perform public.set_default_journal(v_new_journal);

  select public.get_default_journal_id() into v_default;
  if v_default <> v_new_journal then
    raise exception 'default journal not set';
  end if;

  select count(*) into v_count from public.journals where is_default = true;
  if v_count <> 1 then
    raise exception 'expected exactly 1 default journal, got %', v_count;
  end if;

  v_entry := public.create_manual_journal_entry(
    now(),
    'smoke multi journals',
    jsonb_build_array(
      jsonb_build_object('accountCode','1010','debit',100,'credit',0,'memo','cash'),
      jsonb_build_object('accountCode','4000','debit',0,'credit',100,'memo','income')
    ),
    v_new_journal
  );

  if v_entry is null then
    raise exception 'manual entry returned null';
  end if;

  select count(*) into v_count
  from public.general_ledger('4000', null, null, null, v_new_journal);
  if v_count < 1 then
    raise exception 'expected general_ledger rows for 4000 filtered by journal';
  end if;

  select count(*) into v_count
  from public.general_ledger('4000', null, null, null, '00000000-0000-4000-8000-000000000001'::uuid);
  if v_count <> 0 then
    raise exception 'expected 0 rows for 4000 when filtering by GEN journal';
  end if;
end $$;

select 'SMOKE_MULTI_JOURNALS_OK' as ok;
