do $$
begin
  if to_regclass('public.chart_of_accounts') is null then raise exception 'missing chart_of_accounts'; end if;
  if to_regclass('public.journal_entries') is null then raise exception 'missing journal_entries'; end if;
  if to_regclass('public.journal_lines') is null then raise exception 'missing journal_lines'; end if;
  if to_regclass('public.accounting_documents') is null then raise exception 'missing accounting_documents'; end if;
  if to_regclass('public.accounting_periods') is null then raise exception 'missing accounting_periods'; end if;
  if to_regclass('public.payroll_runs') is null then raise exception 'missing payroll_runs'; end if;
  if to_regclass('public.bank_accounts') is null then raise exception 'missing bank_accounts'; end if;
  if to_regclass('public.departments') is null then raise exception 'missing departments'; end if;
  if to_regclass('public.projects') is null then raise exception 'missing projects'; end if;
end $$;

do $$
declare v int;
begin
  select count(1) into v from pg_trigger where tgname = 'trg_journal_entries_block_system_mutation';
  if v = 0 then raise exception 'missing trigger trg_journal_entries_block_system_mutation'; end if;
  select count(1) into v from pg_trigger where tgname = 'trg_journal_lines_block_system_mutation';
  if v = 0 then raise exception 'missing trigger trg_journal_lines_block_system_mutation'; end if;
  select count(1) into v from pg_trigger where tgname = 'trg_accounting_documents_guard';
  if v = 0 then raise exception 'missing trigger trg_accounting_documents_guard'; end if;
end $$;

do $$
declare v_owner uuid;
declare v_exists int;
begin
  select u.id into v_owner from auth.users u where lower(u.email) = 'owner@azta.com' limit 1;
  if v_owner is null then raise exception 'missing local owner auth.users'; end if;
  select count(1) into v_exists from public.admin_users au where au.auth_user_id = v_owner and au.is_active = true;
  if v_exists = 0 then
    insert into public.admin_users(auth_user_id, username, full_name, email, role, permissions, is_active)
    values (v_owner, 'owner', 'Owner', 'owner@azta.com', 'owner', array[]::text[], true);
  end if;
  perform set_config(
    'request.jwt.claims',
    jsonb_build_object('sub', v_owner::text, 'role', 'authenticated')::text,
    false
  );
end $$;

set role authenticated;

select current_setting('request.jwt.claims') as jwt_claims, auth.uid() as auth_uid, auth.role() as auth_role;

drop table if exists smoke_ids;
create temp table smoke_ids(
  doc_id uuid,
  run_id uuid,
  payroll_line_id uuid,
  payroll_entry_id uuid,
  bank_batch_id uuid
);

do $$
declare v_ok boolean;
begin
  select public.has_admin_permission('accounting.manage') into v_ok;
  if v_ok is not true then raise exception 'has_admin_permission(accounting.manage) failed'; end if;
end $$;

do $$
declare v_doc uuid;
declare v_branch uuid;
declare v_company uuid;
begin
  select public.get_default_branch_id() into v_branch;
  select public.get_default_company_id() into v_company;
  if v_branch is null or v_company is null then
    raise exception 'missing default company/branch';
  end if;
  insert into public.accounting_documents(document_type, source_table, source_id, branch_id, company_id, status, memo, created_by)
  values ('manual', 'manual', gen_random_uuid()::text, v_branch, v_company, 'draft', 'smoke', auth.uid())
  returning id into v_doc;
  insert into smoke_ids(doc_id) values (v_doc);
end $$;

do $$
declare v_num text;
declare v_before int;
declare v_after int;
declare v_status text;
begin
  select print_count, status into v_before, v_status from public.accounting_documents where id = (select doc_id from smoke_ids limit 1);
  if v_status <> 'draft' then raise exception 'expected draft document'; end if;

  perform public.approve_accounting_document((select doc_id from smoke_ids limit 1));
  select status into v_status from public.accounting_documents where id = (select doc_id from smoke_ids limit 1);
  if v_status <> 'approved' then raise exception 'approve_accounting_document failed'; end if;

  v_num := public.ensure_accounting_document_number((select doc_id from smoke_ids limit 1));
  if v_num is null or length(btrim(v_num)) = 0 then raise exception 'ensure_accounting_document_number returned empty'; end if;

  perform public.mark_accounting_document_printed((select doc_id from smoke_ids limit 1), 'Smoke');
  select print_count into v_after from public.accounting_documents where id = (select doc_id from smoke_ids limit 1);
  if coalesce(v_after, 0) <> coalesce(v_before, 0) + 1 then raise exception 'print_count not incremented'; end if;
end $$;

do $$
declare v_rule uuid;
declare v_tax uuid;
begin
  insert into public.payroll_rule_defs(rule_type, name, amount_type, amount_value, is_active)
  values ('allowance', 'Smoke Allowance', 'fixed', 1000, true)
  returning id into v_rule;
  insert into public.payroll_tax_defs(name, rate, applies_to, is_active)
  values ('Smoke Tax', 5, 'gross', true)
  returning id into v_tax;
end $$;

do $$
declare v_emp uuid;
declare v_run uuid;
declare v_line uuid;
declare v_entry uuid;
declare v_dept uuid;
declare v_proj uuid;
declare v_any_line uuid;
declare v_locked boolean := false;
declare v_period text;
declare v_try int := 0;
begin
  insert into public.payroll_employees(full_name, employee_code, monthly_salary, currency, is_active)
  values ('Smoke Employee', concat('SMK-', substr(md5(random()::text), 1, 8)), 20000, 'YER', true)
  returning id into v_emp;

  loop
    v_try := v_try + 1;
    v_period := concat('2099-', lpad(((1 + floor(random()*12))::int)::text, 2, '0'));
    exit when not exists (select 1 from public.payroll_runs pr where pr.period_ym = v_period);
    if v_try > 25 then
      raise exception 'could not find free payroll period';
    end if;
  end loop;

  select public.create_payroll_run(v_period, 'smoke') into v_run;
  if v_run is null then raise exception 'create_payroll_run returned null'; end if;
  update smoke_ids set run_id = v_run;

  select l.id into v_line from public.payroll_run_lines l where l.run_id = v_run and l.employee_id = v_emp limit 1;
  if v_line is null then
    insert into public.payroll_run_lines(run_id, employee_id, gross, allowances, deductions, line_memo)
    values (v_run, v_emp, 20000, 0, 0, 'smoke line')
    returning id into v_line;
  else
    update public.payroll_run_lines set gross = 20000 where id = v_line;
  end if;
  update smoke_ids set payroll_line_id = v_line;

  perform public.compute_payroll_run_v3(v_run);

  if not exists (
    select 1 from public.payroll_run_lines l
    where l.id = v_line
      and coalesce(l.allowances,0) >= 1000
      and coalesce(l.deductions,0) > 0
      and coalesce(l.net,0) > 0
  ) then
    raise exception 'compute_payroll_run_v3 did not update line totals';
  end if;

  select public.record_payroll_run_accrual_v2(v_run, now()) into v_entry;
  if v_entry is null then raise exception 'record_payroll_run_accrual_v2 returned null'; end if;
  update smoke_ids set payroll_entry_id = v_entry;

  insert into public.departments(code, name, is_active)
  values ('SMK', 'Smoke Dept', true)
  on conflict (code) do update set name = excluded.name, is_active = true
  returning id into v_dept;

  insert into public.projects(code, name, is_active)
  values ('SMK', 'Smoke Project', true)
  on conflict (code) do update set name = excluded.name, is_active = true
  returning id into v_proj;

  select jl.id into v_any_line from public.journal_lines jl where jl.journal_entry_id = v_entry limit 1;
  if v_any_line is null then raise exception 'missing journal lines for payroll accrual'; end if;

  perform public.set_journal_line_dimensions(v_any_line, v_dept, v_proj);

  begin
    update public.payroll_run_lines set gross = gross + 1 where id = v_line;
    v_locked := false;
  exception when others then
    v_locked := true;
  end;
  if v_locked is not true then
    raise exception 'payroll_run_lines should be locked after accrual';
  end if;
end $$;

do $$
declare v_bank uuid;
declare v_batch uuid;
declare v_line uuid;
declare v_payment uuid;
declare v_match uuid;
begin
  insert into public.bank_accounts(name, bank_name, account_number, currency, is_active)
  values ('Smoke Bank', 'SmokeBank', '000', 'YER', true)
  returning id into v_bank;

  select public.import_bank_statement(v_bank, date '2026-02-01', date '2026-02-28',
    jsonb_build_array(
      jsonb_build_object('date','2026-02-10','amount',1500,'currency','YER','description','smoke','externalId','SMK-EXT-1')
    )
  ) into v_batch;
  if v_batch is null then raise exception 'import_bank_statement returned null'; end if;
  update smoke_ids set bank_batch_id = v_batch;

  select id into v_line from public.bank_statement_lines where batch_id = v_batch and external_id = 'SMK-EXT-1' limit 1;
  if v_line is null then raise exception 'missing statement line'; end if;

  insert into public.payments(direction, method, amount, currency, reference_table, reference_id, occurred_at, created_by, data)
  values ('out', 'kuraimi', 1500, 'YER', 'expenses', gen_random_uuid()::text, '2026-02-10T10:00:00Z'::timestamptz, auth.uid(), '{}'::jsonb)
  returning id into v_payment;

  insert into public.bank_reconciliation_matches(statement_line_id, payment_id, matched_by, status)
  values (v_line, v_payment, auth.uid(), 'matched')
  returning id into v_match;
  if v_match is null then raise exception 'manual match insert failed'; end if;

  update public.bank_statement_lines set matched = true where id = v_line;

  perform public.reconcile_bank_batch(v_batch, 3, 0.01);
  perform public.close_bank_statement_batch(v_batch);

  if not exists (select 1 from public.bank_statement_batches b where b.id = v_batch and b.status = 'closed') then
    raise exception 'batch not closed';
  end if;
end $$;

select 'SMOKE_OK' as result;
