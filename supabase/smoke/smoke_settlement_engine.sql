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
  v_anchor date;
begin
  v_anchor := current_date + 3650 + (extract(epoch from clock_timestamp())::int % 300);
  perform set_config('app.smoke_anchor_date', v_anchor::text, false);
end $$;

do $$
declare
  t0 timestamptz;
  ms int;
  v_owner_id text;
begin
  t0 := clock_timestamp();
  v_owner_id := nullif(current_setting('app.smoke_owner_id', true), '');
  if v_owner_id is null then
    raise exception 'missing app.smoke_owner_id';
  end if;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_owner_id, 'role', 'authenticated')::text, false);
  set role authenticated;

  if to_regclass('public.party_open_items') is null then
    raise exception 'party_open_items missing';
  end if;
  if to_regclass('public.settlement_headers') is null then
    raise exception 'settlement_headers missing';
  end if;
  if to_regclass('public.settlement_lines') is null then
    raise exception 'settlement_lines missing';
  end if;

  ms := (extract(epoch from (clock_timestamp() - t0)) * 1000)::int;
  raise notice 'SMOKE_PASS|SE00|Settlement engine core exists|%|{}', ms;
end $$;

do $$
declare
  t0 timestamptz;
  ms int;
  v_party uuid;
  v_doc1 uuid;
  v_doc2 uuid;
  v_set uuid;
  v_cnt int;
  v_anchor date;
  v_ts timestamptz;
begin
  t0 := clock_timestamp();
  v_anchor := nullif(current_setting('app.smoke_anchor_date', true), '')::date;
  v_ts := (v_anchor::timestamptz + interval '12 hours');

  insert into public.financial_parties(name, party_type, is_active, created_by, updated_by)
  values ('Smoke Settle Party', 'customer', true, auth.uid(), auth.uid())
  returning id into v_party;

  insert into public.financial_party_links(party_id, role, linked_entity_type, linked_entity_id, created_by)
  values (v_party, 'customer', 'smoke', gen_random_uuid()::text, auth.uid());

  select public.create_party_document(
    'ar_invoice',
    v_ts,
    v_party,
    'SE01 invoice',
    jsonb_build_array(
      jsonb_build_object('accountCode','1210','debit',1000,'credit',0,'memo','ar','partyId',v_party::text),
      jsonb_build_object('accountCode','4010','debit',0,'credit',1000,'memo','rev')
    ),
    null
  ) into v_doc1;
  perform public.approve_party_document(v_doc1);

  select public.create_party_document(
    'ar_receipt',
    v_ts + interval '1 second',
    v_party,
    'SE01 receipt',
    jsonb_build_array(
      jsonb_build_object('accountCode','1010','debit',1000,'credit',0,'memo','cash'),
      jsonb_build_object('accountCode','1210','debit',0,'credit',1000,'memo','ar','partyId',v_party::text)
    ),
    null
  ) into v_doc2;
  perform public.approve_party_document(v_doc2);

  select public.create_settlement(
    v_party,
    v_ts + interval '2 seconds',
    jsonb_build_array(
      jsonb_build_object('fromOpenItemId', (select id::text from public.party_open_items where party_id = v_party and item_type='invoice' and direction='debit' order by created_at asc limit 1),
                         'toOpenItemId', (select id::text from public.party_open_items where party_id = v_party and item_type='receipt' and direction='credit' order by created_at asc limit 1),
                         'allocatedBaseAmount', 1000)
    ),
    'SE01 full settlement'
  ) into v_set;

  select count(*) into v_cnt
  from public.party_open_items
  where party_id = v_party
    and status <> 'settled'
    and open_base_amount > 1e-6;
  if v_cnt <> 0 then
    raise exception 'expected all items settled for SE01';
  end if;

  ms := (extract(epoch from (clock_timestamp() - t0)) * 1000)::int;
  raise notice 'SMOKE_PASS|SE01|Full settlement invoice->receipt|%|{}', ms;
end $$;

do $$
declare
  t0 timestamptz;
  ms int;
  v_party uuid;
  v_doc1 uuid;
  v_doc2 uuid;
  v_set uuid;
  v_inv_open numeric;
  v_anchor date;
  v_ts timestamptz;
begin
  t0 := clock_timestamp();
  v_anchor := nullif(current_setting('app.smoke_anchor_date', true), '')::date;
  v_ts := (v_anchor::timestamptz + interval '12 hours');

  insert into public.financial_parties(name, party_type, is_active, created_by, updated_by)
  values ('Smoke Partial Party', 'customer', true, auth.uid(), auth.uid())
  returning id into v_party;

  insert into public.financial_party_links(party_id, role, linked_entity_type, linked_entity_id, created_by)
  values (v_party, 'customer', 'smoke', gen_random_uuid()::text, auth.uid());

  select public.create_party_document(
    'ar_invoice',
    v_ts,
    v_party,
    'SE02 invoice',
    jsonb_build_array(
      jsonb_build_object('accountCode','1210','debit',1000,'credit',0,'memo','ar','partyId',v_party::text),
      jsonb_build_object('accountCode','4010','debit',0,'credit',1000,'memo','rev')
    ),
    null
  ) into v_doc1;
  perform public.approve_party_document(v_doc1);

  select public.create_party_document(
    'ar_receipt',
    v_ts + interval '1 second',
    v_party,
    'SE02 receipt',
    jsonb_build_array(
      jsonb_build_object('accountCode','1010','debit',400,'credit',0,'memo','cash'),
      jsonb_build_object('accountCode','1210','debit',0,'credit',400,'memo','ar','partyId',v_party::text)
    ),
    null
  ) into v_doc2;
  perform public.approve_party_document(v_doc2);

  select public.create_settlement(
    v_party,
    v_ts + interval '2 seconds',
    jsonb_build_array(
      jsonb_build_object('fromOpenItemId', (select id::text from public.party_open_items where party_id = v_party and item_type='invoice' and direction='debit' order by created_at asc limit 1),
                         'toOpenItemId', (select id::text from public.party_open_items where party_id = v_party and item_type='receipt' and direction='credit' order by created_at asc limit 1),
                         'allocatedBaseAmount', 400)
    ),
    'SE02 partial settlement'
  ) into v_set;

  select open_base_amount into v_inv_open
  from public.party_open_items
  where party_id = v_party and item_type='invoice' and direction='debit'
  order by created_at asc
  limit 1;

  if abs(coalesce(v_inv_open,0) - 600) > 1e-6 then
    raise exception 'expected invoice open 600, got %', v_inv_open;
  end if;

  ms := (extract(epoch from (clock_timestamp() - t0)) * 1000)::int;
  raise notice 'SMOKE_PASS|SE02|Partial settlement keeps remaining open|%|{}', ms;
end $$;

do $$
declare
  t0 timestamptz;
  ms int;
  v_party uuid;
  v_doc1 uuid;
  v_doc2 uuid;
  v_set uuid;
  v_fx_cnt int;
  v_fx_open int;
  v_anchor date;
  v_ts timestamptz;
begin
  t0 := clock_timestamp();
  v_anchor := nullif(current_setting('app.smoke_anchor_date', true), '')::date;
  v_ts := (v_anchor::timestamptz + interval '12 hours');

  insert into public.financial_parties(name, party_type, is_active, created_by, updated_by)
  values ('Smoke FX Party', 'customer', true, auth.uid(), auth.uid())
  returning id into v_party;

  insert into public.financial_party_links(party_id, role, linked_entity_type, linked_entity_id, created_by)
  values (v_party, 'customer', 'smoke', gen_random_uuid()::text, auth.uid());

  select public.create_party_document(
    'ar_invoice',
    v_ts,
    v_party,
    'SE03 invoice USD',
    jsonb_build_array(
      jsonb_build_object('accountCode','1200','debit',200,'credit',0,'memo','ar usd','partyId',v_party::text,'currencyCode','USD','fxRate',2,'foreignAmount',100),
      jsonb_build_object('accountCode','4010','debit',0,'credit',200,'memo','rev')
    ),
    null
  ) into v_doc1;
  perform public.approve_party_document(v_doc1);

  select public.create_party_document(
    'ar_receipt',
    v_ts + interval '1 second',
    v_party,
    'SE03 receipt USD',
    jsonb_build_array(
      jsonb_build_object('accountCode','1010','debit',250,'credit',0,'memo','cash'),
      jsonb_build_object('accountCode','1200','debit',0,'credit',250,'memo','ar usd','partyId',v_party::text,'currencyCode','USD','fxRate',2.5,'foreignAmount',100)
    ),
    null
  ) into v_doc2;
  perform public.approve_party_document(v_doc2);

  select public.create_settlement(
    v_party,
    v_ts + interval '2 seconds',
    jsonb_build_array(
      jsonb_build_object('fromOpenItemId', (select id::text from public.party_open_items where party_id = v_party and item_role='ar' and item_type='invoice' and direction='debit' and currency_code='USD' order by created_at asc limit 1),
                         'toOpenItemId', (select id::text from public.party_open_items where party_id = v_party and item_role='ar' and item_type='receipt' and direction='credit' and currency_code='USD' order by created_at asc limit 1),
                         'allocatedForeignAmount', 100)
    ),
    'SE03 fx settlement'
  ) into v_set;

  select count(*) into v_fx_cnt
  from public.journal_entries je
  where je.source_table = 'settlements'
    and je.source_id = v_set::text
    and je.source_event = 'realized_fx';
  if v_fx_cnt <> 1 then
    raise exception 'expected 1 fx journal entry, got %', v_fx_cnt;
  end if;

  select count(*) into v_fx_open
  from public.party_open_items poi
  join public.journal_entries je on je.id = poi.journal_entry_id
  where je.source_table = 'settlements'
    and je.source_event = 'realized_fx'
    and poi.party_id = v_party;
  if v_fx_open <> 0 then
    raise exception 'expected no open items from settlement FX';
  end if;

  ms := (extract(epoch from (clock_timestamp() - t0)) * 1000)::int;
  raise notice 'SMOKE_PASS|SE03|Multi-currency settlement with realized FX|%|{}', ms;
end $$;

do $$
declare
  t0 timestamptz;
  ms int;
  v_party uuid;
  v_adv uuid;
  v_inv uuid;
  v_set uuid;
  v_cnt int;
  v_anchor date;
  v_ts timestamptz;
begin
  t0 := clock_timestamp();
  v_anchor := nullif(current_setting('app.smoke_anchor_date', true), '')::date;
  v_ts := (v_anchor::timestamptz + interval '12 hours');

  insert into public.financial_parties(name, party_type, is_active, created_by, updated_by)
  values ('Smoke Advance Party', 'customer', true, auth.uid(), auth.uid())
  returning id into v_party;

  insert into public.financial_party_links(party_id, role, linked_entity_type, linked_entity_id, created_by)
  values (v_party, 'customer', 'smoke', gen_random_uuid()::text, auth.uid());

  select public.create_party_document(
    'advance',
    v_ts,
    v_party,
    'SE04 advance',
    jsonb_build_array(
      jsonb_build_object('accountCode','1010','debit',500,'credit',0,'memo','cash'),
      jsonb_build_object('accountCode','2050','debit',0,'credit',500,'memo','deposit','partyId',v_party::text)
    ),
    null
  ) into v_adv;
  perform public.approve_party_document(v_adv);

  select public.create_party_document(
    'ar_invoice',
    v_ts + interval '1 second',
    v_party,
    'SE04 invoice',
    jsonb_build_array(
      jsonb_build_object('accountCode','1210','debit',500,'credit',0,'memo','ar','partyId',v_party::text),
      jsonb_build_object('accountCode','4010','debit',0,'credit',500,'memo','rev')
    ),
    null
  ) into v_inv;
  perform public.approve_party_document(v_inv);

  select public.create_settlement(
    v_party,
    v_ts + interval '2 seconds',
    jsonb_build_array(
      jsonb_build_object('fromOpenItemId', (select id::text from public.party_open_items where party_id = v_party and item_type='invoice' and direction='debit' order by created_at asc limit 1),
                         'toOpenItemId', (select id::text from public.party_open_items where party_id = v_party and item_type='advance' and direction='credit' order by created_at asc limit 1),
                         'allocatedBaseAmount', 500)
    ),
    'SE04 advance apply'
  ) into v_set;

  select count(*) into v_cnt
  from public.party_open_items
  where party_id = v_party and status <> 'settled' and open_base_amount > 1e-6;
  if v_cnt <> 0 then
    raise exception 'expected invoice and advance settled';
  end if;

  ms := (extract(epoch from (clock_timestamp() - t0)) * 1000)::int;
  raise notice 'SMOKE_PASS|SE04|Advance application via settlement|%|{}', ms;
end $$;

do $$
declare
  t0 timestamptz;
  ms int;
  v_party uuid;
  v_doc1 uuid;
  v_doc2 uuid;
  v_set uuid;
  v_rev uuid;
  v_open numeric;
  v_anchor date;
  v_ts timestamptz;
begin
  t0 := clock_timestamp();
  v_anchor := nullif(current_setting('app.smoke_anchor_date', true), '')::date;
  v_ts := (v_anchor::timestamptz + interval '12 hours');

  insert into public.financial_parties(name, party_type, is_active, created_by, updated_by)
  values ('Smoke Reverse Party', 'customer', true, auth.uid(), auth.uid())
  returning id into v_party;

  insert into public.financial_party_links(party_id, role, linked_entity_type, linked_entity_id, created_by)
  values (v_party, 'customer', 'smoke', gen_random_uuid()::text, auth.uid());

  select public.create_party_document(
    'ar_invoice',
    v_ts,
    v_party,
    'SE05 invoice',
    jsonb_build_array(
      jsonb_build_object('accountCode','1210','debit',800,'credit',0,'memo','ar','partyId',v_party::text),
      jsonb_build_object('accountCode','4010','debit',0,'credit',800,'memo','rev')
    ),
    null
  ) into v_doc1;
  perform public.approve_party_document(v_doc1);

  select public.create_party_document(
    'ar_receipt',
    v_ts + interval '1 second',
    v_party,
    'SE05 receipt',
    jsonb_build_array(
      jsonb_build_object('accountCode','1010','debit',800,'credit',0,'memo','cash'),
      jsonb_build_object('accountCode','1210','debit',0,'credit',800,'memo','ar','partyId',v_party::text)
    ),
    null
  ) into v_doc2;
  perform public.approve_party_document(v_doc2);

  select public.create_settlement(
    v_party,
    v_ts + interval '2 seconds',
    jsonb_build_array(
      jsonb_build_object('fromOpenItemId', (select id::text from public.party_open_items where party_id = v_party and item_type='invoice' and direction='debit' order by created_at asc limit 1),
                         'toOpenItemId', (select id::text from public.party_open_items where party_id = v_party and item_type='receipt' and direction='credit' order by created_at asc limit 1),
                         'allocatedBaseAmount', 800)
    ),
    'SE05 settle'
  ) into v_set;

  select public.void_settlement(v_set, 'SE05 reverse') into v_rev;

  select open_base_amount into v_open
  from public.party_open_items
  where party_id = v_party and item_type='invoice' and direction='debit'
  order by created_at asc
  limit 1;

  if abs(coalesce(v_open,0) - 800) > 1e-6 then
    raise exception 'expected invoice reopened to 800, got %', v_open;
  end if;

  ms := (extract(epoch from (clock_timestamp() - t0)) * 1000)::int;
  raise notice 'SMOKE_PASS|SE05|Reversal settlement reopens items|%|{}', ms;
end $$;

do $$
declare
  t0 timestamptz;
  ms int;
  v_party uuid;
  v_doc1 uuid;
  v_doc2 uuid;
  v_set uuid;
  v_open_cnt int;
  v_anchor date;
  v_ts timestamptz;
begin
  t0 := clock_timestamp();
  v_anchor := nullif(current_setting('app.smoke_anchor_date', true), '')::date;
  v_ts := (v_anchor::timestamptz + interval '12 hours');

  insert into public.financial_parties(name, party_type, is_active, created_by, updated_by)
  values ('Smoke Auto Party', 'customer', true, auth.uid(), auth.uid())
  returning id into v_party;

  insert into public.financial_party_links(party_id, role, linked_entity_type, linked_entity_id, created_by)
  values (v_party, 'customer', 'smoke', gen_random_uuid()::text, auth.uid());

  select public.create_party_document(
    'ar_invoice',
    v_ts,
    v_party,
    'SE06 invoice',
    jsonb_build_array(
      jsonb_build_object('accountCode','1210','debit',300,'credit',0,'memo','ar','partyId',v_party::text),
      jsonb_build_object('accountCode','4010','debit',0,'credit',300,'memo','rev')
    ),
    null
  ) into v_doc1;
  perform public.approve_party_document(v_doc1);

  select public.create_party_document(
    'ar_receipt',
    v_ts + interval '1 second',
    v_party,
    'SE06 receipt',
    jsonb_build_array(
      jsonb_build_object('accountCode','1010','debit',300,'credit',0,'memo','cash'),
      jsonb_build_object('accountCode','1210','debit',0,'credit',300,'memo','ar','partyId',v_party::text)
    ),
    null
  ) into v_doc2;
  perform public.approve_party_document(v_doc2);

  select public.auto_settle_party_items(v_party) into v_set;
  if v_set is null then
    raise exception 'expected auto settlement id';
  end if;

  select count(*) into v_open_cnt
  from public.party_open_items
  where party_id = v_party and status <> 'settled' and open_base_amount > 1e-6;
  if v_open_cnt <> 0 then
    raise exception 'expected no open items after auto settle';
  end if;

  ms := (extract(epoch from (clock_timestamp() - t0)) * 1000)::int;
  raise notice 'SMOKE_PASS|SE06|Auto settlement FIFO works|%|{}', ms;
end $$;

do $$
declare
  t0 timestamptz;
  ms int;
  v_party uuid;
  v_doc1 uuid;
  v_doc2 uuid;
  v_set uuid;
  v_ar record;
  v_anchor date;
  v_ts timestamptz;
begin
  t0 := clock_timestamp();
  v_anchor := nullif(current_setting('app.smoke_anchor_date', true), '')::date;
  v_ts := (v_anchor::timestamptz + interval '12 hours');

  insert into public.financial_parties(name, party_type, is_active, created_by, updated_by)
  values ('Smoke Aging Party', 'customer', true, auth.uid(), auth.uid())
  returning id into v_party;

  insert into public.financial_party_links(party_id, role, linked_entity_type, linked_entity_id, created_by)
  values (v_party, 'customer', 'smoke', gen_random_uuid()::text, auth.uid());

  select public.create_party_document(
    'ar_invoice',
    v_ts,
    v_party,
    'SE07 invoice',
    jsonb_build_array(
      jsonb_build_object('accountCode','1200','debit',1000,'credit',0,'memo','ar','partyId',v_party::text),
      jsonb_build_object('accountCode','4010','debit',0,'credit',1000,'memo','rev')
    ),
    null
  ) into v_doc1;
  perform public.approve_party_document(v_doc1);

  select public.create_party_document(
    'ar_receipt',
    v_ts + interval '1 second',
    v_party,
    'SE07 receipt',
    jsonb_build_array(
      jsonb_build_object('accountCode','1010','debit',400,'credit',0,'memo','cash'),
      jsonb_build_object('accountCode','1200','debit',0,'credit',400,'memo','ar','partyId',v_party::text)
    ),
    null
  ) into v_doc2;
  perform public.approve_party_document(v_doc2);

  select public.create_settlement(
    v_party,
    v_ts + interval '2 seconds',
    jsonb_build_array(
      jsonb_build_object('fromOpenItemId', (select id::text from public.party_open_items where party_id = v_party and item_role='ar' and item_type='invoice' and direction='debit' order by created_at asc limit 1),
                         'toOpenItemId', (select id::text from public.party_open_items where party_id = v_party and item_role='ar' and item_type='receipt' and direction='credit' order by created_at asc limit 1),
                         'allocatedBaseAmount', 400)
    ),
    'SE07 partial'
  ) into v_set;

  select * into v_ar
  from public.party_ar_aging_summary
  where party_id = v_party;

  if abs(coalesce(v_ar.current,0) - 600) > 1e-6 then
    raise exception 'expected aging current 600, got %', v_ar.current;
  end if;

  ms := (extract(epoch from (clock_timestamp() - t0)) * 1000)::int;
  raise notice 'SMOKE_PASS|SE07|Aging uses open items correctly|%|{}', ms;
end $$;

set role postgres;
do $$
declare
  v_period uuid;
  v_anchor date;
  v_start date;
  v_end date;
begin
  v_anchor := nullif(current_setting('app.smoke_anchor_date', true), '')::date;
  v_start := v_anchor - 1;
  v_end := v_anchor + 1;
  insert into public.accounting_periods(name, start_date, end_date, status)
  values (concat('Smoke Period ', to_char(v_anchor,'YYYY-MM-DD')), v_start, v_end, 'open')
  returning id into v_period;
  perform set_config('app.smoke_period_id', v_period::text, false);
end $$;
set role authenticated;

do $$
declare
  t0 timestamptz;
  ms int;
  v_party uuid;
  v_doc1 uuid;
  v_doc2 uuid;
  v_period uuid;
  v_ok boolean := false;
  v_anchor date;
  v_ts timestamptz;
begin
  t0 := clock_timestamp();
  v_anchor := nullif(current_setting('app.smoke_anchor_date', true), '')::date;
  v_ts := (v_anchor::timestamptz + interval '12 hours');

  v_period := nullif(current_setting('app.smoke_period_id', true), '')::uuid;
  if v_period is null then
    raise exception 'missing smoke period';
  end if;

  insert into public.financial_parties(name, party_type, is_active, created_by, updated_by)
  values ('Smoke Locked Party', 'customer', true, auth.uid(), auth.uid())
  returning id into v_party;

  insert into public.financial_party_links(party_id, role, linked_entity_type, linked_entity_id, created_by)
  values (v_party, 'customer', 'smoke', gen_random_uuid()::text, auth.uid());

  select public.create_party_document(
    'ar_invoice',
    v_ts,
    v_party,
    'SE08 invoice',
    jsonb_build_array(
      jsonb_build_object('accountCode','1210','debit',100,'credit',0,'memo','ar','partyId',v_party::text),
      jsonb_build_object('accountCode','4010','debit',0,'credit',100,'memo','rev')
    ),
    null
  ) into v_doc1;
  perform public.approve_party_document(v_doc1);

  select public.create_party_document(
    'ar_receipt',
    v_ts + interval '1 second',
    v_party,
    'SE08 receipt',
    jsonb_build_array(
      jsonb_build_object('accountCode','1010','debit',100,'credit',0,'memo','cash'),
      jsonb_build_object('accountCode','1210','debit',0,'credit',100,'memo','ar','partyId',v_party::text)
    ),
    null
  ) into v_doc2;
  perform public.approve_party_document(v_doc2);

  perform public.close_accounting_period(v_period);

  begin
    perform public.create_settlement(
      v_party,
      v_ts + interval '2 seconds',
      jsonb_build_array(
        jsonb_build_object('fromOpenItemId', (select id::text from public.party_open_items where party_id = v_party and item_type='invoice' and direction='debit' order by created_at asc limit 1),
                           'toOpenItemId', (select id::text from public.party_open_items where party_id = v_party and item_type='receipt' and direction='credit' order by created_at asc limit 1),
                           'allocatedBaseAmount', 100)
      ),
      'SE08 should fail'
    );
    v_ok := false;
  exception
    when others then
      v_ok := true;
  end;

  if v_ok is not true then
    raise exception 'expected settlement blocked by period lock';
  end if;

  ms := (extract(epoch from (clock_timestamp() - t0)) * 1000)::int;
  raise notice 'SMOKE_PASS|SE08|Period lock enforcement on settlement|%|{}', ms;
end $$;

do $$
begin
  raise notice 'SETTLEMENT_SMOKE_OK';
end $$;
