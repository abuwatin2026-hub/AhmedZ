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
  if v_owner_id is null then
    raise exception 'missing app.smoke_owner_id';
  end if;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_owner_id, 'role', 'authenticated')::text, false);
  set role authenticated;

  if to_regclass('public.financial_parties') is null then
    raise exception 'financial_parties missing';
  end if;
  if to_regclass('public.party_ledger_entries') is null then
    raise exception 'party_ledger_entries missing';
  end if;

  ms := (extract(epoch from (clock_timestamp() - t0)) * 1000)::int;
  raise notice 'SMOKE_PASS|PL00|Party Ledger core exists|%|{}', ms;
end $$;

set role postgres;
do $$
declare
  v_emp uuid;
begin
  insert into public.payroll_employees(full_name, monthly_salary, currency)
  values ('Smoke Employee', 1000, public.get_base_currency())
  returning id into v_emp;
  perform set_config('app.smoke_emp_id', v_emp::text, false);
end $$;
set role authenticated;

do $$
declare
  t0 timestamptz;
  ms int;
  v_emp uuid;
  v_emp_party uuid;
  v_entry uuid;
  v_bal numeric;
  v_failed boolean := false;
  v_cnt int;
begin
  t0 := clock_timestamp();

  v_emp := nullif(current_setting('app.smoke_emp_id', true), '')::uuid;
  if v_emp is null then
    raise exception 'missing emp_id';
  end if;

  v_emp_party := public.ensure_financial_party_for_employee(v_emp);
  if v_emp_party is null then
    raise exception 'employee party not created';
  end if;

  v_entry := public.create_manual_journal_entry(
    clock_timestamp(),
    'Smoke employee advance',
    jsonb_build_array(
      jsonb_build_object('accountCode','1350','debit',100,'credit',0,'memo','advance','partyId',v_emp_party::text),
      jsonb_build_object('accountCode','1010','debit',0,'credit',100,'memo','cash out')
    ),
    null
  );
  perform public.approve_journal_entry(v_entry);

  v_entry := public.create_manual_journal_entry(
    clock_timestamp() + interval '1 second',
    'Smoke employee repayment',
    jsonb_build_array(
      jsonb_build_object('accountCode','1010','debit',40,'credit',0,'memo','cash in'),
      jsonb_build_object('accountCode','1350','debit',0,'credit',40,'memo','repay','partyId',v_emp_party::text)
    ),
    null
  );
  perform public.approve_journal_entry(v_entry);

  select ple.running_balance
  into v_bal
  from public.party_ledger_entries ple
  join public.chart_of_accounts coa on coa.id = ple.account_id
  where ple.party_id = v_emp_party and coa.code = '1350'
  order by ple.occurred_at desc, ple.created_at desc, ple.id desc
  limit 1;

  if coalesce(v_bal, 0) <> 60 then
    raise exception 'unexpected employee advance balance: %', v_bal;
  end if;

  begin
    delete from public.party_ledger_entries where party_id = v_emp_party;
  exception when others then
    v_failed := true;
  end;
  select count(*) into v_cnt from public.party_ledger_entries where party_id = v_emp_party;
  if v_cnt <= 0 then
    raise exception 'party ledger rows were deleted';
  end if;

  ms := (extract(epoch from (clock_timestamp() - t0)) * 1000)::int;
  raise notice 'SMOKE_PASS|PL01|Employee advance and append-only|%|{}', ms;
end $$;

do $$
declare
  t0 timestamptz;
  ms int;
  v_party uuid;
  v_entry uuid;
  v_bal numeric;
begin
  t0 := clock_timestamp();

  insert into public.financial_parties(name, party_type, is_active, created_by, updated_by)
  values ('Smoke Custodian', 'staff_custodian', true, auth.uid(), auth.uid())
  returning id into v_party;

  insert into public.financial_party_links(party_id, role, linked_entity_type, linked_entity_id, created_by)
  values (v_party, 'staff_custodian', 'staff_custodians', gen_random_uuid()::text, auth.uid());

  v_entry := public.create_manual_journal_entry(
    clock_timestamp(),
    'Smoke custodian fund',
    jsonb_build_array(
      jsonb_build_object('accountCode','1035','debit',200,'credit',0,'memo','fund','partyId',v_party::text),
      jsonb_build_object('accountCode','1010','debit',0,'credit',200,'memo','cash out')
    ),
    null
  );
  perform public.approve_journal_entry(v_entry);

  v_entry := public.create_manual_journal_entry(
    clock_timestamp() + interval '1 second',
    'Smoke custodian settlement',
    jsonb_build_array(
      jsonb_build_object('accountCode','6100','debit',50,'credit',0,'memo','expense'),
      jsonb_build_object('accountCode','1035','debit',0,'credit',50,'memo','settle','partyId',v_party::text)
    ),
    null
  );
  perform public.approve_journal_entry(v_entry);

  select ple.running_balance
  into v_bal
  from public.party_ledger_entries ple
  join public.chart_of_accounts coa on coa.id = ple.account_id
  where ple.party_id = v_party and coa.code = '1035'
  order by ple.occurred_at desc, ple.created_at desc, ple.id desc
  limit 1;

  if coalesce(v_bal, 0) <> 150 then
    raise exception 'unexpected custodian balance: %', v_bal;
  end if;

  ms := (extract(epoch from (clock_timestamp() - t0)) * 1000)::int;
  raise notice 'SMOKE_PASS|PL02|Custodian funding and settlement|%|{}', ms;
end $$;

do $$
declare
  t0 timestamptz;
  ms int;
  v_supplier uuid;
  v_party uuid;
  v_entry uuid;
  v_as_of date := current_date;
  v_rev uuid;
begin
  t0 := clock_timestamp();

  insert into public.suppliers(name, email, preferred_currency)
  values ('Smoke FX Supplier', concat('fx-supplier-', gen_random_uuid()::text, '@smoke.local'), 'USD')
  returning id into v_supplier;

  v_party := public.ensure_financial_party_for_supplier(v_supplier);
  if v_party is null then raise exception 'supplier party missing'; end if;

  insert into public.fx_rates(currency_code, rate, rate_date, rate_type)
  values ('USD', 250, v_as_of, 'accounting')
  on conflict (currency_code, rate_date, rate_type) do update set rate = excluded.rate;
  insert into public.fx_rates(currency_code, rate, rate_date, rate_type)
  values ('USD', 260, v_as_of + 1, 'accounting')
  on conflict (currency_code, rate_date, rate_type) do update set rate = excluded.rate;

  v_entry := public.create_manual_journal_entry(
    (v_as_of::timestamptz + interval '12 hours'),
    'Smoke supplier invoice USD',
    jsonb_build_array(
      jsonb_build_object('accountCode','6100','debit',25000,'credit',0,'memo','expense'),
      jsonb_build_object('accountCode','2010','debit',0,'credit',25000,'memo','ap','partyId',v_party::text,'currencyCode','USD','fxRate',250,'foreignAmount',100)
    ),
    null
  );
  perform public.approve_journal_entry(v_entry);

  v_rev := public.run_party_fx_revaluation(v_as_of + 1, array['2010']);
  if v_rev is null then
    raise exception 'expected party fx revaluation to create entry';
  end if;

  ms := (extract(epoch from (clock_timestamp() - t0)) * 1000)::int;
  raise notice 'SMOKE_PASS|PL03|Party multi-currency and revaluation|%|{}', ms;
end $$;

do $$
declare
  t0 timestamptz;
  ms int;
  v_party uuid;
  v_entry uuid;
  v_stmt_count int;
begin
  t0 := clock_timestamp();

  insert into public.financial_parties(name, party_type, is_active, created_by, updated_by)
  values ('Smoke Dual Party', 'generic', true, auth.uid(), auth.uid())
  returning id into v_party;

  insert into public.financial_party_links(party_id, role, linked_entity_type, linked_entity_id, created_by)
  values
    (v_party, 'customer', 'dual', gen_random_uuid()::text, auth.uid()),
    (v_party, 'supplier', 'dual', gen_random_uuid()::text, auth.uid());

  v_entry := public.create_manual_journal_entry(
    now(),
    'Smoke dual party receivable',
    jsonb_build_array(
      jsonb_build_object('accountCode','1210','debit',300,'credit',0,'memo','other ar','partyId',v_party::text),
      jsonb_build_object('accountCode','4010','debit',0,'credit',300,'memo','revenue')
    ),
    null
  );
  perform public.approve_journal_entry(v_entry);

  v_entry := public.create_manual_journal_entry(
    now(),
    'Smoke dual party payable',
    jsonb_build_array(
      jsonb_build_object('accountCode','6100','debit',200,'credit',0,'memo','expense'),
      jsonb_build_object('accountCode','2110','debit',0,'credit',200,'memo','other ap','partyId',v_party::text)
    ),
    null
  );
  perform public.approve_journal_entry(v_entry);

  select count(*) into v_stmt_count
  from public.party_ledger_statement(v_party, null, null, null, null);

  if v_stmt_count < 2 then
    raise exception 'expected statement rows';
  end if;

  ms := (extract(epoch from (clock_timestamp() - t0)) * 1000)::int;
  raise notice 'SMOKE_PASS|PL04|Unified statement across roles|%|{}', ms;
end $$;

do $$
declare
  t0 timestamptz;
  ms int;
  v_party uuid;
  v_doc uuid;
  v_entry uuid;
  v_cnt int;
begin
  t0 := clock_timestamp();

  insert into public.financial_parties(name, party_type, is_active, created_by, updated_by)
  values ('Smoke Doc Party', 'customer', true, auth.uid(), auth.uid())
  returning id into v_party;

  insert into public.financial_party_links(party_id, role, linked_entity_type, linked_entity_id, created_by)
  values (v_party, 'customer', 'smoke', gen_random_uuid()::text, auth.uid());

  select public.create_party_document(
    'ar_invoice',
    clock_timestamp(),
    v_party,
    'Smoke AR invoice doc',
    jsonb_build_array(
      jsonb_build_object('accountCode','1210','debit',123,'credit',0,'memo','ar','partyId',v_party::text),
      jsonb_build_object('accountCode','4010','debit',0,'credit',123,'memo','rev')
    ),
    null
  ) into v_doc;

  if v_doc is null then
    raise exception 'create_party_document returned null';
  end if;

  select public.approve_party_document(v_doc) into v_entry;
  if v_entry is null then
    raise exception 'approve_party_document returned null';
  end if;

  select count(*) into v_cnt
  from public.party_ledger_statement(v_party, '1210', null, null, null);
  if v_cnt < 1 then
    raise exception 'expected party ledger rows for party document';
  end if;

  ms := (extract(epoch from (clock_timestamp() - t0)) * 1000)::int;
  raise notice 'SMOKE_PASS|PL05|Party documents create+approve posting|%|{}', ms;
end $$;

do $$
begin
  raise notice 'PARTY_LEDGER_SMOKE_OK';
end $$;
