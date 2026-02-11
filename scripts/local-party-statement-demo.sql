select set_config('request.jwt.claim.role','authenticated', false);
select set_config('request.jwt.claim.sub','aaaaaaaa-1111-1111-1111-aaaaaaaaaaaa', false);

insert into auth.users(id,aud,role,email,email_confirmed_at,created_at,updated_at)
values ('aaaaaaaa-1111-1111-1111-aaaaaaaaaaaa','authenticated','authenticated','local_manager@example.com',now(),now(),now())
on conflict (id) do nothing;

do $$
declare
  v_company uuid;
  v_branch uuid;
  v_supplier uuid;
  v_customer uuid;
  v_je_sup uuid;
  v_je_cus uuid;
  v_ap uuid;
  v_ar uuid;
  v_cash uuid;
begin
  select id into v_company from public.companies order by created_at asc limit 1;
  select id into v_branch from public.branches order by created_at asc limit 1;

  insert into public.admin_users(auth_user_id,username,role,is_active,company_id,branch_id)
  values ('aaaaaaaa-1111-1111-1111-aaaaaaaaaaaa','local_manager','manager',true,v_company,v_branch)
  on conflict (auth_user_id) do update set role='manager', is_active=true;

  select id into v_cash from public.chart_of_accounts where code='1010' limit 1;
  select id into v_ar from public.chart_of_accounts where code='1200' limit 1;
  select id into v_ap from public.chart_of_accounts where code='2010' limit 1;
  if v_cash is null or v_ar is null or v_ap is null then
    raise exception 'missing required COA codes (1010,1200,2010)';
  end if;

  insert into public.financial_parties(name,party_type,is_active)
  values ('مورد تجريبي للطباعة','supplier',true)
  on conflict do nothing
  returning id into v_supplier;
  if v_supplier is null then
    select id into v_supplier from public.financial_parties where name='مورد تجريبي للطباعة' limit 1;
  end if;

  insert into public.financial_parties(name,party_type,is_active)
  values ('عميل تجريبي للطباعة','customer',true)
  on conflict do nothing
  returning id into v_customer;
  if v_customer is null then
    select id into v_customer from public.financial_parties where name='عميل تجريبي للطباعة' limit 1;
  end if;

  insert into public.journal_entries(entry_date,memo,source_table,source_id,source_event,status,created_by,branch_id,company_id)
  values (now() - interval '2 days','Demo Supplier Entry','payments','11111111-1111-1111-1111-111111111111','demo','posted',auth.uid(),v_branch,v_company)
  returning id into v_je_sup;

  insert into public.journal_lines(journal_entry_id,account_id,credit,line_memo,party_id)
  values (v_je_sup,v_ap,150,'AP credit',v_supplier);
  insert into public.journal_lines(journal_entry_id,account_id,debit,line_memo)
  values (v_je_sup,v_cash,150,'Cash debit');

  insert into public.journal_entries(entry_date,memo,source_table,source_id,source_event,status,created_by,branch_id,company_id)
  values (now() - interval '1 days','Demo Customer Entry','payments','22222222-2222-2222-2222-222222222222','demo','posted',auth.uid(),v_branch,v_company)
  returning id into v_je_cus;

  insert into public.journal_lines(journal_entry_id,account_id,debit,line_memo,party_id)
  values (v_je_cus,v_ar,200,'AR debit',v_customer);
  insert into public.journal_lines(journal_entry_id,account_id,credit,line_memo)
  values (v_je_cus,v_cash,200,'Cash credit');
end $$;

select id, name, party_type
from public.financial_parties
where name in ('مورد تجريبي للطباعة','عميل تجريبي للطباعة')
order by name;
