\set ON_ERROR_STOP on
set client_min_messages = notice;
set statement_timeout = 0;
set lock_timeout = 0;

do $$
declare
  t0 timestamptz;
  ms int;
  v_owner uuid;
begin
  t0 := clock_timestamp();

  select u.id into v_owner
  from auth.users u
  where lower(u.email) = lower('owner@azta.com')
  limit 1;

  if v_owner is null then
    select au.auth_user_id into v_owner
    from public.admin_users au
    where au.role = 'owner'
    order by au.created_at asc
    limit 1;
  end if;

  if v_owner is null then
    raise exception 'missing owner user';
  end if;

  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_owner::text, 'role', 'authenticated')::text, false);
  set role authenticated;

  ms := (extract(epoch from (clock_timestamp() - t0)) * 1000)::int;
  raise notice 'SMOKE_PASS|UISE00|Auth context set|%|{"owner":"%"}', ms, v_owner::text;
end $$;

do $$
declare
  t0 timestamptz;
  ms int;
  v_party uuid;
  v_doc_inv uuid;
  v_doc_receipt uuid;
  v_cnt int;
begin
  t0 := clock_timestamp();

  insert into public.financial_parties(name, party_type, is_active, created_by, updated_by)
  values ('UI Settlement Party', 'customer', true, auth.uid(), auth.uid())
  returning id into v_party;

  insert into public.financial_party_links(party_id, role, linked_entity_type, linked_entity_id, created_by)
  values (v_party, 'customer', 'smoke_ui', gen_random_uuid()::text, auth.uid());

  select public.create_party_document(
    'ar_invoice',
    now(),
    v_party,
    'UI Settlement Invoice',
    jsonb_build_array(
      jsonb_build_object('accountCode','1210','debit',1000,'credit',0,'memo','ar','partyId',v_party::text),
      jsonb_build_object('accountCode','4010','debit',0,'credit',1000,'memo','rev')
    ),
    null
  ) into v_doc_inv;
  perform public.approve_party_document(v_doc_inv);

  select public.create_party_document(
    'ar_receipt',
    now() + interval '1 second',
    v_party,
    'UI Settlement Receipt',
    jsonb_build_array(
      jsonb_build_object('accountCode','1010','debit',400,'credit',0,'memo','cash'),
      jsonb_build_object('accountCode','1210','debit',0,'credit',400,'memo','ar','partyId',v_party::text)
    ),
    null
  ) into v_doc_receipt;
  perform public.approve_party_document(v_doc_receipt);

  select count(*) into v_cnt
  from public.party_open_items
  where party_id = v_party
    and status in ('open','partially_settled');

  if v_cnt < 2 then
    raise exception 'expected >=2 open items for settlement party, got %', v_cnt;
  end if;

  ms := (extract(epoch from (clock_timestamp() - t0)) * 1000)::int;
  raise notice 'SMOKE_PASS|UISE01|Seed settlement party open items|%|{"partyId":"%","openItems":%}', ms, v_party::text, v_cnt;
end $$;

do $$
declare
  t0 timestamptz;
  ms int;
  v_party uuid;
  v_doc_adv uuid;
  v_doc_inv uuid;
  v_cnt_inv int;
  v_cnt_adv int;
begin
  t0 := clock_timestamp();

  insert into public.financial_parties(name, party_type, is_active, created_by, updated_by)
  values ('UI Advance Party', 'customer', true, auth.uid(), auth.uid())
  returning id into v_party;

  insert into public.financial_party_links(party_id, role, linked_entity_type, linked_entity_id, created_by)
  values (v_party, 'customer', 'smoke_ui', gen_random_uuid()::text, auth.uid());

  select public.create_party_document(
    'advance',
    now(),
    v_party,
    'UI Advance Payment',
    jsonb_build_array(
      jsonb_build_object('accountCode','1010','debit',500,'credit',0,'memo','cash'),
      jsonb_build_object('accountCode','2050','debit',0,'credit',500,'memo','deposit','partyId',v_party::text)
    ),
    null
  ) into v_doc_adv;
  perform public.approve_party_document(v_doc_adv);

  select public.create_party_document(
    'ar_invoice',
    now() + interval '1 second',
    v_party,
    'UI Advance Invoice',
    jsonb_build_array(
      jsonb_build_object('accountCode','1210','debit',500,'credit',0,'memo','ar','partyId',v_party::text),
      jsonb_build_object('accountCode','4010','debit',0,'credit',500,'memo','rev')
    ),
    null
  ) into v_doc_inv;
  perform public.approve_party_document(v_doc_inv);

  select count(*) into v_cnt_inv
  from public.party_open_items
  where party_id = v_party
    and item_type = 'invoice'
    and direction = 'debit'
    and status in ('open','partially_settled');

  select count(*) into v_cnt_adv
  from public.party_open_items
  where party_id = v_party
    and item_type = 'advance'
    and direction = 'credit'
    and status in ('open','partially_settled');

  if v_cnt_inv < 1 or v_cnt_adv < 1 then
    raise exception 'expected invoice+advance open items. inv=% adv=%', v_cnt_inv, v_cnt_adv;
  end if;

  ms := (extract(epoch from (clock_timestamp() - t0)) * 1000)::int;
  raise notice 'SMOKE_PASS|UISE02|Seed advance party invoice+advance|%|{"partyId":"%","invoice":%,"advance":%}', ms, v_party::text, v_cnt_inv, v_cnt_adv;
end $$;

select 'UI_SETTLEMENTS_ADVANCES_SEED_OK' as ok_token;

