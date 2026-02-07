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

  select u.id into v_owner from auth.users u where lower(u.email) = lower('owner@azta.com') limit 1;
  if v_owner is null then
    raise exception 'missing local owner auth.users row for owner@azta.com';
  end if;

  select count(1) into v_exists from public.admin_users au where au.auth_user_id = v_owner and au.is_active = true;
  if v_exists = 0 then
    insert into public.admin_users(auth_user_id, username, full_name, email, role, permissions, is_active)
    values (v_owner, 'owner', 'Owner', 'owner@azta.com', 'owner', array[]::text[], true);
  end if;

  perform set_config('app.smoke_owner_id', v_owner::text, false);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_owner::text, 'role', 'authenticated')::text, false);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_owner::text, 'role', 'authenticated')::text, true);

  ms := (extract(epoch from (clock_timestamp() - t0)) * 1000)::int;
  raise notice 'SMOKE_PASS|CON00|Owner session ready|%|{}', ms;
end $$;

set role authenticated;

do $$
declare
  t0 timestamptz;
  ms int;
  v_base text;
  v_c1 uuid;
  v_c2 uuid;
  v_b1 uuid;
  v_b2 uuid;
  v_group uuid;
  v_party_c1 uuid;
  v_party_c2 uuid;
  v_name text := 'SMOKE CONSOLIDATION FULL ' || to_char(now(),'YYYYMMDDHH24MISS');
  v_rev numeric;
  v_ar numeric;
  v_ap numeric;
  v_inv numeric;
  v_nci numeric;
  v_cta numeric;
  v_snap uuid;
  v_entry uuid;
  v_a uuid;
begin
  t0 := clock_timestamp();
  v_base := upper(public.get_base_currency());

  insert into public.currencies(code, name, is_base)
  values ('USD','US Dollar', false)
  on conflict (code) do update set name = excluded.name;

  insert into public.fx_rates(currency_code, rate, rate_date, rate_type)
  values
    ('USD', 1000, date_trunc('year', current_date)::date, 'accounting'),
    ('USD', 1200, current_date, 'accounting')
  on conflict (currency_code, rate_date, rate_type) do update set rate = excluded.rate;

  insert into public.companies(name, is_active)
  values ('SMOKE_PARENT_' || replace(gen_random_uuid()::text,'-',''), true)
  returning id into v_c1;

  insert into public.companies(name, is_active)
  values ('SMOKE_SUB_' || replace(gen_random_uuid()::text,'-',''), true)
  returning id into v_c2;

  update public.companies
  set functional_currency = v_base
  where id in (v_c1, v_c2);

  insert into public.branches(company_id, code, name, is_active)
  values (v_c1, 'B1', 'Branch 1', true)
  returning id into v_b1;

  insert into public.branches(company_id, code, name, is_active)
  values (v_c2, 'B2', 'Branch 2', true)
  returning id into v_b2;

  update public.admin_users
  set company_id = v_c1,
      branch_id = v_b1
  where auth_user_id = auth.uid();

  v_group := public.create_consolidation_group(v_name, v_c1, 'USD');
  perform public.add_consolidation_member(v_group, v_c1, 1);
  perform public.add_consolidation_member(v_group, v_c2, 0.8);

  insert into public.consolidation_elimination_accounts(group_id, elimination_type, account_code, created_by)
  values
    (v_group, 'ar_ap', '1200', auth.uid()),
    (v_group, 'ar_ap', '2010', auth.uid()),
    (v_group, 'revenue_expense', '4010', auth.uid()),
    (v_group, 'revenue_expense', '5010', auth.uid()),
    (v_group, 'fx', '6200', auth.uid()),
    (v_group, 'fx', '6201', auth.uid())
  on conflict (group_id, elimination_type, account_code) do nothing;

  insert into public.consolidation_unrealized_profit_rules(group_id, inventory_account_code, cogs_account_code, percent_remaining, is_active, created_by)
  values (v_group, '1410', '5010', 0, false, auth.uid())
  on conflict (group_id) do nothing;

  insert into public.financial_parties(name, party_type, linked_entity_type, linked_entity_id, is_active, created_by, updated_by)
  values ('IC Party ' || v_c2::text, 'generic', 'companies', v_c2::text, true, auth.uid(), auth.uid())
  returning id into v_party_c2;

  insert into public.financial_parties(name, party_type, linked_entity_type, linked_entity_id, is_active, created_by, updated_by)
  values ('IC Party ' || v_c1::text, 'generic', 'companies', v_c1::text, true, auth.uid(), auth.uid())
  returning id into v_party_c1;

  insert into public.consolidation_intercompany_parties(group_id, company_id, counterparty_company_id, party_id, created_by)
  values
    (v_group, v_c1, v_c2, v_party_c2, auth.uid()),
    (v_group, v_c2, v_c1, v_party_c1, auth.uid())
  on conflict (group_id, company_id, counterparty_company_id, party_id) do nothing;

  insert into public.journal_entries(entry_date, memo, source_table, source_id, source_event, created_by, branch_id, company_id)
  values (now(), 'CON_FULL parent external inv purchase', 'manual', gen_random_uuid()::text, 'smoke', auth.uid(), v_b1, v_c1)
  returning id into v_entry;

  insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo)
  values
    (v_entry, public.get_account_id_by_code('1410'), 60, 0, 'inventory'),
    (v_entry, public.get_account_id_by_code('1010'), 0, 60, 'cash');
  perform public.check_journal_entry_balance(v_entry);

  insert into public.journal_entries(entry_date, memo, source_table, source_id, source_event, created_by, branch_id, company_id)
  values (now(), 'CON_FULL parent interco sale', 'manual', gen_random_uuid()::text, 'smoke', auth.uid(), v_b1, v_c1)
  returning id into v_entry;

  insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo, party_id)
  values
    (v_entry, public.get_account_id_by_code('1200'), 80, 0, 'AR', v_party_c2),
    (v_entry, public.get_account_id_by_code('4010'), 0, 80, 'REV', v_party_c2),
    (v_entry, public.get_account_id_by_code('5010'), 60, 0, 'COGS', v_party_c2),
    (v_entry, public.get_account_id_by_code('1410'), 0, 60, 'INV', v_party_c2);
  perform public.check_journal_entry_balance(v_entry);

  update public.admin_users
  set company_id = v_c2,
      branch_id = v_b2
  where auth_user_id = auth.uid();

  insert into public.journal_entries(entry_date, memo, source_table, source_id, source_event, created_by, branch_id, company_id)
  values ((date_trunc('year', now())::date)::timestamptz + interval '12 hours', 'CON_FULL sub equity injection historical', 'manual', gen_random_uuid()::text, 'smoke', auth.uid(), v_b2, v_c2)
  returning id into v_entry;

  insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo)
  values
    (v_entry, public.get_account_id_by_code('1010'), 50, 0, 'cash'),
    (v_entry, public.get_account_id_by_code('3000'), 0, 50, 'equity');
  perform public.check_journal_entry_balance(v_entry);

  insert into public.journal_entries(entry_date, memo, source_table, source_id, source_event, created_by, branch_id, company_id)
  values (now(), 'CON_FULL sub interco purchase', 'manual', gen_random_uuid()::text, 'smoke', auth.uid(), v_b2, v_c2)
  returning id into v_entry;

  insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo, party_id)
  values
    (v_entry, public.get_account_id_by_code('1410'), 80, 0, 'inventory', v_party_c1),
    (v_entry, public.get_account_id_by_code('2010'), 0, 80, 'AP', v_party_c1);
  perform public.check_journal_entry_balance(v_entry);

  select coalesce(sum(tb.revalued_balance_base),0)
  into v_ar
  from public.consolidated_trial_balance(v_group, current_date, 'account', 'base') tb
  where tb.group_key = '1200';
  if abs(v_ar) > 1e-6 then
    raise exception 'expected AR eliminated to 0, got %', v_ar;
  end if;

  select coalesce(sum(tb.revalued_balance_base),0)
  into v_ap
  from public.consolidated_trial_balance(v_group, current_date, 'account', 'base') tb
  where tb.group_key = '2010';
  if abs(v_ap) > 1e-6 then
    raise exception 'expected AP eliminated to 0, got %', v_ap;
  end if;

  select coalesce(sum(tb.revalued_balance_base),0)
  into v_rev
  from public.consolidated_trial_balance(v_group, current_date, 'account', 'base') tb
  where tb.group_key = '4010';
  if abs(v_rev) > 1e-6 then
    raise exception 'expected intercompany revenue eliminated to 0, got %', v_rev;
  end if;

  update public.consolidation_unrealized_profit_rules
  set is_active = true,
      percent_remaining = 1
  where group_id = v_group;

  select coalesce(sum(tb.revalued_balance_base),0)
  into v_inv
  from public.consolidated_trial_balance(v_group, current_date, 'account', 'base') tb
  where tb.group_key = '1410';
  if abs(v_inv - 60) > 1e-6 then
    raise exception 'expected inventory at group cost 60, got %', v_inv;
  end if;

  select coalesce(sum(tb.revalued_balance_base),0)
  into v_nci
  from public.consolidated_trial_balance(v_group, current_date, 'account', 'base') tb
  where tb.group_key = '3060';
  if abs(v_nci - 10) > 1e-6 then
    raise exception 'expected NCI=10, got %', v_nci;
  end if;

  select coalesce(sum(tb.revalued_balance_base),0)
  into v_cta
  from public.consolidated_trial_balance(v_group, current_date, 'account', 'reporting') tb
  where tb.group_key = '3055';
  if abs(v_cta) <= 1e-9 then
    raise exception 'expected non-zero CTA in reporting view';
  end if;

  v_snap := public.create_consolidation_snapshot(v_group, current_date, 'account', 'reporting');
  if v_snap is null then
    raise exception 'snapshot not created';
  end if;

  if not exists (select 1 from public.consolidation_snapshot_lines l where l.snapshot_id = v_snap limit 1) then
    raise exception 'snapshot lines missing';
  end if;

  ms := (extract(epoch from (clock_timestamp() - t0)) * 1000)::int;
  raise notice 'SMOKE_PASS|CON01|Multi-company consolidation with eliminations, IAS21, ownership, snapshots|%|{"group_id":"%","snapshot_id":"%"}', ms, v_group::text, v_snap::text;
end $$;

do $$
begin
  raise notice 'CONSOLIDATION_FULL_SMOKE_OK';
end $$;
