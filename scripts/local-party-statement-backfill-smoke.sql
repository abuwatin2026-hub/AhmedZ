select set_config('request.jwt.claim.role','authenticated', false);

do $$
declare
  v_company uuid;
  v_branch uuid;
  v_party uuid;
  v_entry uuid;
begin
  select id into v_company from public.companies order by created_at asc limit 1;
  select id into v_branch from public.branches order by created_at asc limit 1;

  perform set_config('request.jwt.claim.sub','aaaaaaaa-1111-1111-1111-aaaaaaaaaaaa', false);
  insert into auth.users(id,aud,role,email,email_confirmed_at,created_at,updated_at)
  values ('aaaaaaaa-1111-1111-1111-aaaaaaaaaaaa','authenticated','authenticated','manager2@example.com',now(),now(),now())
  on conflict (id) do nothing;
  insert into public.admin_users(auth_user_id,username,role,is_active,company_id,branch_id)
  values ('aaaaaaaa-1111-1111-1111-aaaaaaaaaaaa','m2','manager',true,v_company,v_branch)
  on conflict (auth_user_id) do update set role='manager', is_active=true;

  insert into public.financial_parties(name,party_type,is_active)
  values ('طرف اختبار كشف الحساب','supplier',true)
  returning id into v_party;

  insert into public.journal_entries(entry_date,memo,source_table,source_id,source_event,status,created_by,branch_id,company_id)
  values (now(),'Entry for statement','payments','cccccccc-cccc-cccc-cccc-cccccccccccc','test','posted','aaaaaaaa-1111-1111-1111-aaaaaaaaaaaa',v_branch,v_company)
  returning id into v_entry;

  insert into public.journal_lines(journal_entry_id,account_id,credit,line_memo,party_id)
  select v_entry, id, 50, 'AP credit', v_party from public.chart_of_accounts where code='2010' limit 1;
  insert into public.journal_lines(journal_entry_id,account_id,debit,line_memo)
  select v_entry, id, 50, 'Cash debit' from public.chart_of_accounts where code='1010' limit 1;

  perform set_config('request.jwt.claim.sub','bbbbbbbb-2222-2222-2222-bbbbbbbbbbbb', false);
  insert into auth.users(id,aud,role,email,email_confirmed_at,created_at,updated_at)
  values ('bbbbbbbb-2222-2222-2222-bbbbbbbbbbbb','authenticated','authenticated','accountant@example.com',now(),now(),now())
  on conflict (id) do nothing;
  insert into public.admin_users(auth_user_id,username,role,is_active,company_id,branch_id)
  values ('bbbbbbbb-2222-2222-2222-bbbbbbbbbbbb','acc','accountant',true,v_company,v_branch)
  on conflict (auth_user_id) do update set role='accountant', is_active=true;

  raise notice 'can_view=% can_manage=%', public.has_admin_permission('accounting.view'), public.has_admin_permission('accounting.manage');

  raise notice 'backfill_entries=%', public.backfill_party_ledger_entries_for_party(v_party, 5000);
  raise notice 'ple_total=%', (select count(*) from public.party_ledger_entries where party_id=v_party);
end $$;

select 'ok' as result;
