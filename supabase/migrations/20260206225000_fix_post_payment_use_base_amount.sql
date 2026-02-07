set app.allow_ledger_ddl = '1';

create or replace function public.post_payment(p_payment_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pay record;
  v_cash uuid;
  v_bank uuid;
  v_ar uuid;
  v_deposits uuid;
  v_ap uuid;
  v_expenses uuid;
  v_clearing uuid;
  v_entry_id uuid;
  v_debit_account uuid;
  v_credit_account uuid;
  v_amount_base numeric;
  v_order_id uuid;
  v_delivered_at timestamptz;
  v_has_accrual boolean := false;
begin
  if not public.has_admin_permission('accounting.manage') then
    raise exception 'not allowed';
  end if;

  if p_payment_id is null then
    raise exception 'p_payment_id is required';
  end if;

  select *
  into v_pay
  from public.payments p
  where p.id = p_payment_id
  for update;
  if not found then
    raise exception 'payment not found';
  end if;

  if exists (
    select 1
    from public.journal_entries je
    where je.source_table = 'payments'
      and je.source_id = p_payment_id::text
  ) then
    return;
  end if;

  v_amount_base := coalesce(v_pay.base_amount, v_pay.amount, 0);
  if v_amount_base <= 0 then
    raise exception 'invalid amount';
  end if;

  v_cash := public.get_account_id_by_code('1010');
  v_bank := public.get_account_id_by_code('1020');
  v_ar := public.get_account_id_by_code('1200');
  v_deposits := public.get_account_id_by_code('2050');
  v_ap := public.get_account_id_by_code('2010');
  v_expenses := public.get_account_id_by_code('6100');
  v_clearing := public.get_account_id_by_code('2060');

  if v_cash is null or v_bank is null or v_ar is null or v_deposits is null or v_ap is null or v_expenses is null then
    raise exception 'required accounts not found';
  end if;

  if v_pay.method = 'cash' then
    v_debit_account := v_cash;
    v_credit_account := v_cash;
  else
    v_debit_account := v_bank;
    v_credit_account := v_bank;
  end if;

  insert into public.journal_entries(entry_date, memo, source_table, source_id, source_event, created_by, status)
  values (
    v_pay.occurred_at,
    concat('Payment ', v_pay.direction, ' ', v_pay.reference_table, ':', v_pay.reference_id),
    'payments',
    v_pay.id::text,
    concat(v_pay.direction, ':', v_pay.reference_table, ':', coalesce(v_pay.reference_id, '')),
    auth.uid(),
    'posted'
  )
  returning id into v_entry_id;

  if v_pay.direction = 'in' and v_pay.reference_table = 'orders' then
    v_order_id := nullif(v_pay.reference_id, '')::uuid;
    if v_order_id is null then
      raise exception 'invalid order reference_id';
    end if;
    v_delivered_at := public.order_delivered_at(v_order_id);
    if v_delivered_at is null or v_pay.occurred_at < v_delivered_at then
      insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo)
      values
        (v_entry_id, v_debit_account, v_amount_base, 0, 'Cash/Bank received'),
        (v_entry_id, v_deposits, 0, v_amount_base, 'Customer deposit');
    else
      insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo)
      values
        (v_entry_id, v_debit_account, v_amount_base, 0, 'Cash/Bank received'),
        (v_entry_id, v_ar, 0, v_amount_base, 'Settle receivable');
    end if;
    perform public.check_journal_entry_balance(v_entry_id);
    return;
  end if;

  if v_pay.direction = 'out' and v_pay.reference_table = 'purchase_orders' then
    insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo)
    values
      (v_entry_id, v_ap, v_amount_base, 0, 'Settle payable'),
      (v_entry_id, v_credit_account, 0, v_amount_base, 'Cash/Bank paid');
    perform public.check_journal_entry_balance(v_entry_id);
    return;
  end if;

  if v_pay.direction = 'out' and v_pay.reference_table = 'expenses' then
    v_has_accrual := exists(
      select 1 from public.journal_entries je
      where je.source_table = 'expenses'
        and je.source_id = coalesce(v_pay.reference_id, '')
        and je.source_event = 'accrual'
    );
    if v_has_accrual then
      insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo)
      values
        (v_entry_id, v_ap, v_amount_base, 0, 'Settle payable'),
        (v_entry_id, v_credit_account, 0, v_amount_base, 'Cash/Bank paid');
    else
      insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo)
      values
        (v_entry_id, v_expenses, v_amount_base, 0, 'Operating expense'),
        (v_entry_id, v_credit_account, 0, v_amount_base, 'Cash/Bank paid');
    end if;
    perform public.check_journal_entry_balance(v_entry_id);
    return;
  end if;

  if v_pay.direction = 'out' and v_pay.reference_table = 'import_expenses' then
    v_has_accrual := exists(
      select 1 from public.journal_entries je
      where je.source_table = 'import_expenses'
        and je.source_id = coalesce(v_pay.reference_id, '')
        and je.source_event = 'accrual'
    );
    if v_clearing is null then
      raise exception 'landed cost clearing account missing';
    end if;
    if v_has_accrual then
      insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo)
      values
        (v_entry_id, v_ap, v_amount_base, 0, 'Settle payable'),
        (v_entry_id, v_credit_account, 0, v_amount_base, 'Cash/Bank paid');
    else
      insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo)
      values
        (v_entry_id, v_clearing, v_amount_base, 0, 'Landed cost service'),
        (v_entry_id, v_credit_account, 0, v_amount_base, 'Cash/Bank paid');
    end if;
    perform public.check_journal_entry_balance(v_entry_id);
    return;
  end if;

  raise exception 'unsupported payment reference';
end;
$$;

revoke all on function public.post_payment(uuid) from public;
revoke execute on function public.post_payment(uuid) from anon;
grant execute on function public.post_payment(uuid) to authenticated;

notify pgrst, 'reload schema';

