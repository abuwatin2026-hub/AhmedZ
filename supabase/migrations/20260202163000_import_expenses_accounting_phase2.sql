do $$
begin
  if to_regclass('public.chart_of_accounts') is not null then
    insert into public.chart_of_accounts(code, name, account_type, normal_balance)
    values ('2060', 'تسوية تكاليف الاستيراد', 'asset', 'debit')
    on conflict (code) do update
    set name = excluded.name,
        account_type = excluded.account_type,
        normal_balance = excluded.normal_balance,
        is_active = true;
  end if;
end $$;

do $$
begin
  if to_regclass('public.import_expenses') is not null then
    begin
      alter table public.import_expenses
        add column payment_method text;
    exception when duplicate_column then
      null;
    end;

    update public.import_expenses
    set payment_method = 'cash'
    where payment_method is null;

    begin
      alter table public.import_expenses
        alter column payment_method set default 'cash';
    exception when undefined_column then
      null;
    end;

    begin
      alter table public.import_expenses
        drop constraint if exists import_expenses_payment_method_check;
      alter table public.import_expenses
        add constraint import_expenses_payment_method_check
        check (payment_method in ('cash','bank'));
    exception when others then
      null;
    end;
  end if;
end $$;

create or replace function public.post_import_expense(p_import_expense_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ie record;
  v_amount numeric;
  v_settings jsonb;
  v_accounts jsonb;
  v_entry_id uuid;
  v_ap uuid;
  v_cash uuid;
  v_bank uuid;
  v_clearing uuid;
  v_credit_account uuid;
  v_event text;
  v_occurred_at timestamptz;
begin
  if p_import_expense_id is null then
    raise exception 'p_import_expense_id is required';
  end if;

  select *
  into v_ie
  from public.import_expenses
  where id = p_import_expense_id;

  if not found then
    raise exception 'import expense not found';
  end if;

  v_amount := coalesce(v_ie.amount, 0) * coalesce(v_ie.exchange_rate, 1);
  if v_amount <= 0 then
    return;
  end if;

  v_occurred_at := coalesce(v_ie.paid_at::timestamptz, v_ie.created_at, now());

  v_ap := public.get_account_id_by_code('2010');
  v_cash := public.get_account_id_by_code('1010');
  v_bank := public.get_account_id_by_code('1020');
  v_clearing := public.get_account_id_by_code('2060');

  if to_regclass('public.app_settings') is not null then
    select s.data
    into v_settings
    from public.app_settings s
    where s.id in ('singleton','app')
    order by (s.id = 'singleton') desc
    limit 1;

    v_accounts := coalesce(v_settings->'settings'->'accounting_accounts', v_settings->'accounting_accounts', '{}'::jsonb);
    begin
      v_clearing := coalesce(nullif(v_accounts->>'landed_cost_clearing', '')::uuid, v_clearing);
    exception when others then
      null;
    end;
  end if;

  if v_clearing is null then
    raise exception 'landed cost clearing account not found';
  end if;

  if v_ie.paid_at is not null then
    v_event := 'paid';
    v_credit_account := case when coalesce(v_ie.payment_method, 'cash') = 'bank' then v_bank else v_cash end;
  else
    v_event := 'accrual';
    v_credit_account := v_ap;
  end if;

  if v_event = 'paid' then
    delete from public.journal_lines jl
    using public.journal_entries je
    where jl.journal_entry_id = je.id
      and je.source_table = 'import_expenses'
      and je.source_id = p_import_expense_id::text
      and je.source_event = 'accrual';
    delete from public.journal_entries je
    where je.source_table = 'import_expenses'
      and je.source_id = p_import_expense_id::text
      and je.source_event = 'accrual';
  else
    delete from public.journal_lines jl
    using public.journal_entries je
    where jl.journal_entry_id = je.id
      and je.source_table = 'import_expenses'
      and je.source_id = p_import_expense_id::text
      and je.source_event = 'paid';
    delete from public.journal_entries je
    where je.source_table = 'import_expenses'
      and je.source_id = p_import_expense_id::text
      and je.source_event = 'paid';
  end if;

  insert into public.journal_entries(entry_date, memo, source_table, source_id, source_event, created_by)
  values (
    v_occurred_at,
    concat('Import expense ', coalesce(v_ie.invoice_number, v_ie.id::text)),
    'import_expenses',
    p_import_expense_id::text,
    v_event,
    coalesce(v_ie.created_by, auth.uid())
  )
  on conflict (source_table, source_id, source_event)
  do update set entry_date = excluded.entry_date, memo = excluded.memo
  returning id into v_entry_id;

  delete from public.journal_lines jl where jl.journal_entry_id = v_entry_id;

  insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo)
  values
    (v_entry_id, v_clearing, v_amount, 0, 'Landed cost service'),
    (v_entry_id, v_credit_account, 0, v_amount, case when v_event = 'paid' then 'Cash/Bank paid' else 'Accounts payable' end);

  perform public.check_journal_entry_balance(v_entry_id);
end;
$$;

revoke all on function public.post_import_expense(uuid) from public;
revoke execute on function public.post_import_expense(uuid) from anon;
revoke execute on function public.post_import_expense(uuid) from authenticated;
grant execute on function public.post_import_expense(uuid) to service_role;

create or replace function public.trg_post_import_expense()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'UPDATE' then
    if new.amount is not distinct from old.amount
      and new.exchange_rate is not distinct from old.exchange_rate
      and new.paid_at is not distinct from old.paid_at
      and new.payment_method is not distinct from old.payment_method
      and new.invoice_number is not distinct from old.invoice_number then
      return new;
    end if;
  end if;

  perform public.post_import_expense(new.id);
  return new;
end;
$$;

revoke all on function public.trg_post_import_expense() from public;
revoke execute on function public.trg_post_import_expense() from anon;
revoke execute on function public.trg_post_import_expense() from authenticated;
grant execute on function public.trg_post_import_expense() to service_role;

do $$
begin
  if to_regclass('public.import_expenses') is not null then
    drop trigger if exists trg_import_expenses_post on public.import_expenses;
    create trigger trg_import_expenses_post
    after insert or update on public.import_expenses
    for each row execute function public.trg_post_import_expense();
  end if;
end $$;

create or replace function public.record_import_expense_payment(
  p_import_expense_id uuid,
  p_amount numeric,
  p_method text,
  p_occurred_at timestamptz
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_amount numeric;
  v_method text;
  v_occurred_at timestamptz;
  v_payment_id uuid;
begin
  if not public.is_admin() then
    raise exception 'not allowed';
  end if;

  if p_import_expense_id is null then
    raise exception 'p_import_expense_id is required';
  end if;

  v_amount := coalesce(p_amount, 0);
  if v_amount <= 0 then
    select coalesce(ie.amount, 0) * coalesce(ie.exchange_rate, 1)
    into v_amount
    from public.import_expenses ie
    where ie.id = p_import_expense_id;
  end if;
  if v_amount <= 0 then
    raise exception 'invalid amount';
  end if;

  v_method := nullif(trim(coalesce(p_method, '')), '');
  if v_method is null then
    v_method := 'cash';
  end if;

  v_occurred_at := coalesce(p_occurred_at, now());

  insert into public.payments(direction, method, amount, currency, reference_table, reference_id, occurred_at, created_by, data)
  values (
    'out',
    v_method,
    v_amount,
    'YER',
    'import_expenses',
    p_import_expense_id::text,
    v_occurred_at,
    auth.uid(),
    jsonb_build_object('importExpenseId', p_import_expense_id::text)
  )
  returning id into v_payment_id;

  perform public.post_payment(v_payment_id);
end;
$$;

revoke all on function public.record_import_expense_payment(uuid, numeric, text, timestamptz) from public;
grant execute on function public.record_import_expense_payment(uuid, numeric, text, timestamptz) to anon, authenticated;

create or replace function public.post_payment(p_payment_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pay record;
  v_entry_id uuid;
  v_cash uuid;
  v_bank uuid;
  v_ar uuid;
  v_deposits uuid;
  v_ap uuid;
  v_expenses uuid;
  v_debit_account uuid;
  v_credit_account uuid;
  v_order_id uuid;
  v_delivered_at timestamptz;
  v_has_accrual boolean := false;
  v_settings jsonb;
  v_accounts jsonb;
  v_clearing uuid;
begin
  if p_payment_id is null then
    raise exception 'p_payment_id is required';
  end if;

  select *
  into v_pay
  from public.payments p
  where p.id = p_payment_id;

  if not found then
    raise exception 'payment not found';
  end if;

  v_cash := public.get_account_id_by_code('1010');
  v_bank := public.get_account_id_by_code('1020');
  v_ar := public.get_account_id_by_code('1200');
  v_deposits := public.get_account_id_by_code('2050');
  v_ap := public.get_account_id_by_code('2010');
  v_expenses := public.get_account_id_by_code('6100');
  v_clearing := public.get_account_id_by_code('2060');

  if to_regclass('public.app_settings') is not null then
    select s.data
    into v_settings
    from public.app_settings s
    where s.id in ('singleton','app')
    order by (s.id = 'singleton') desc
    limit 1;

    v_accounts := coalesce(v_settings->'settings'->'accounting_accounts', v_settings->'accounting_accounts', '{}'::jsonb);
    begin
      v_clearing := coalesce(nullif(v_accounts->>'landed_cost_clearing', '')::uuid, v_clearing);
    exception when others then
      null;
    end;
  end if;

  if v_pay.method = 'cash' then
    v_debit_account := v_cash;
    v_credit_account := v_cash;
  else
    v_debit_account := v_bank;
    v_credit_account := v_bank;
  end if;

  if v_pay.direction = 'in' and v_pay.reference_table = 'orders' then
    v_order_id := nullif(v_pay.reference_id, '')::uuid;
    if v_order_id is null then
      raise exception 'invalid order reference_id';
    end if;

    v_delivered_at := public.order_delivered_at(v_order_id);

    insert into public.journal_entries(entry_date, memo, source_table, source_id, source_event, created_by)
    values (
      v_pay.occurred_at,
      concat('Order payment ', coalesce(v_pay.reference_id, v_pay.id::text)),
      'payments',
      v_pay.id::text,
      concat('in:orders:', coalesce(v_pay.reference_id, '')),
      v_pay.created_by
    )
    on conflict (source_table, source_id, source_event)
    do update set entry_date = excluded.entry_date, memo = excluded.memo
    returning id into v_entry_id;

    delete from public.journal_lines jl where jl.journal_entry_id = v_entry_id;

    if v_delivered_at is null or v_pay.occurred_at < v_delivered_at then
      insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo)
      values
        (v_entry_id, v_debit_account, v_pay.amount, 0, 'Cash/Bank received'),
        (v_entry_id, v_deposits, 0, v_pay.amount, 'Customer deposit');
    else
      insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo)
      values
        (v_entry_id, v_debit_account, v_pay.amount, 0, 'Cash/Bank received'),
        (v_entry_id, v_ar, 0, v_pay.amount, 'Settle receivable');
    end if;
    return;
  end if;

  if v_pay.direction = 'out' and v_pay.reference_table = 'purchase_orders' then
    insert into public.journal_entries(entry_date, memo, source_table, source_id, source_event, created_by)
    values (
      v_pay.occurred_at,
      concat('Supplier payment ', coalesce(v_pay.reference_id, v_pay.id::text)),
      'payments',
      v_pay.id::text,
      concat('out:purchase_orders:', coalesce(v_pay.reference_id, '')),
      v_pay.created_by
    )
    on conflict (source_table, source_id, source_event)
    do update set entry_date = excluded.entry_date, memo = excluded.memo
    returning id into v_entry_id;

    delete from public.journal_lines jl where jl.journal_entry_id = v_entry_id;

    insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo)
    values
      (v_entry_id, v_ap, v_pay.amount, 0, 'Settle payable'),
      (v_entry_id, v_credit_account, 0, v_pay.amount, 'Cash/Bank paid');
    return;
  end if;

  if v_pay.direction = 'out' and v_pay.reference_table = 'expenses' then
    v_has_accrual := exists(
      select 1
      from public.journal_entries je
      where je.source_table = 'expenses'
        and je.source_id = coalesce(v_pay.reference_id, '')
        and je.source_event = 'accrual'
    );

    insert into public.journal_entries(entry_date, memo, source_table, source_id, source_event, created_by)
    values (
      v_pay.occurred_at,
      concat('Expense payment ', coalesce(v_pay.reference_id, v_pay.id::text)),
      'payments',
      v_pay.id::text,
      concat('out:expenses:', coalesce(v_pay.reference_id, '')),
      v_pay.created_by
    )
    on conflict (source_table, source_id, source_event)
    do update set entry_date = excluded.entry_date, memo = excluded.memo
    returning id into v_entry_id;

    delete from public.journal_lines jl where jl.journal_entry_id = v_entry_id;

    if v_has_accrual then
      insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo)
      values
        (v_entry_id, v_ap, v_pay.amount, 0, 'Settle payable'),
        (v_entry_id, v_credit_account, 0, v_pay.amount, 'Cash/Bank paid');
    else
      insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo)
      values
        (v_entry_id, v_expenses, v_pay.amount, 0, 'Operating expense'),
        (v_entry_id, v_credit_account, 0, v_pay.amount, 'Cash/Bank paid');
    end if;
    return;
  end if;

  if v_pay.direction = 'out' and v_pay.reference_table = 'import_expenses' then
    v_has_accrual := exists(
      select 1
      from public.journal_entries je
      where je.source_table = 'import_expenses'
        and je.source_id = coalesce(v_pay.reference_id, '')
        and je.source_event = 'accrual'
    );

    insert into public.journal_entries(entry_date, memo, source_table, source_id, source_event, created_by)
    values (
      v_pay.occurred_at,
      concat('Import expense payment ', coalesce(v_pay.reference_id, v_pay.id::text)),
      'payments',
      v_pay.id::text,
      concat('out:import_expenses:', coalesce(v_pay.reference_id, '')),
      v_pay.created_by
    )
    on conflict (source_table, source_id, source_event)
    do update set entry_date = excluded.entry_date, memo = excluded.memo
    returning id into v_entry_id;

    delete from public.journal_lines jl where jl.journal_entry_id = v_entry_id;

    if v_has_accrual then
      insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo)
      values
        (v_entry_id, v_ap, v_pay.amount, 0, 'Settle payable'),
        (v_entry_id, v_credit_account, 0, v_pay.amount, 'Cash/Bank paid');
    else
      insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo)
      values
        (v_entry_id, v_clearing, v_pay.amount, 0, 'Landed cost service'),
        (v_entry_id, v_credit_account, 0, v_pay.amount, 'Cash/Bank paid');
    end if;
    return;
  end if;
end;
$$;

revoke all on function public.post_payment(uuid) from public;
grant execute on function public.post_payment(uuid) to anon, authenticated;

notify pgrst, 'reload schema';
