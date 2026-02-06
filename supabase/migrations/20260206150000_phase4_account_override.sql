create or replace function public.resolve_override_account(
  p_default_account_id uuid,
  p_override_account_id_text text,
  p_allowed_account_types text[]
)
returns uuid
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_text text;
  v_id uuid;
  v_type text;
  v_active boolean;
begin
  if p_default_account_id is null then
    raise exception 'default account id is null';
  end if;

  v_text := nullif(trim(coalesce(p_override_account_id_text, '')), '');
  if v_text is null then
    return p_default_account_id;
  end if;

  begin
    v_id := v_text::uuid;
  exception when others then
    raise exception 'invalid overrideAccountId';
  end;

  select account_type, is_active
  into v_type, v_active
  from public.chart_of_accounts
  where id = v_id;

  if v_type is null then
    raise exception 'override account not found';
  end if;
  if coalesce(v_active, false) = false then
    raise exception 'override account is inactive';
  end if;

  if p_allowed_account_types is not null and array_length(p_allowed_account_types, 1) is not null then
    if not (v_type = any(p_allowed_account_types)) then
      raise exception 'override account type not allowed';
    end if;
  end if;

  return v_id;
end;
$$;

revoke all on function public.resolve_override_account(uuid, text, text[]) from public;
grant execute on function public.resolve_override_account(uuid, text, text[]) to anon, authenticated;

alter table public.expenses
  add column if not exists data jsonb not null default '{}'::jsonb;

create or replace function public.record_expense_payment(
  p_expense_id uuid,
  p_amount numeric,
  p_method text,
  p_occurred_at timestamptz default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
    v_method text;
    v_occurred_at timestamptz;
    v_shift_id uuid;
    v_data jsonb := '{}'::jsonb;
    v_override text;
begin
    if not public.can_manage_expenses() then
        raise exception 'not allowed';
    end if;
    if p_amount <= 0 then
        raise exception 'amount must be positive';
    end if;

    v_method := nullif(trim(p_method), '');
    if v_method is null then
      v_method := 'cash';
    end if;

    if v_method = 'card' then
      v_method := 'network';
    elsif v_method = 'bank' then
      v_method := 'kuraimi';
    end if;

    v_occurred_at := coalesce(p_occurred_at, now());
    v_shift_id := public._resolve_open_shift_for_cash(auth.uid());
    if v_method = 'cash' and v_shift_id is null then
        raise exception 'cash payment requires an open shift';
    end if;

    select nullif(trim(coalesce(e.data->>'overrideAccountId','')), '')
    into v_override
    from public.expenses e
    where e.id = p_expense_id;

    v_data := jsonb_strip_nulls(jsonb_build_object('expenseId', p_expense_id::text, 'overrideAccountId', v_override));

    insert into public.payments(direction, method, amount, currency, reference_table, reference_id, occurred_at, created_by, shift_id, data)
    values (
        'out',
        v_method,
        p_amount,
        'YER',
        'expenses',
        p_expense_id::text,
        v_occurred_at,
        auth.uid(),
        v_shift_id,
        v_data
    );
end;
$$;

revoke all on function public.record_expense_payment(uuid, numeric, text, timestamptz) from public;
grant execute on function public.record_expense_payment(uuid, numeric, text, timestamptz) to anon, authenticated;

create or replace function public.record_expense_accrual(
  p_expense_id uuid,
  p_amount numeric,
  p_occurred_at timestamptz default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_entry_id uuid;
  v_expenses uuid;
  v_ap uuid;
  v_override text;
begin
  if not public.is_admin() then
    raise exception 'not allowed';
  end if;

  if p_amount <= 0 then
    raise exception 'amount must be positive';
  end if;

  v_expenses := public.get_account_id_by_code('6100');
  v_ap := public.get_account_id_by_code('2010');
  if v_expenses is null or v_ap is null then
    raise exception 'required accounts not found';
  end if;

  select nullif(trim(coalesce(e.data->>'overrideAccountId','')), '')
  into v_override
  from public.expenses e
  where e.id = p_expense_id;

  v_ap := public.resolve_override_account(v_ap, v_override, array['liability','equity']);

  insert into public.journal_entries(entry_date, memo, source_table, source_id, source_event, created_by)
  values (
    coalesce(p_occurred_at, now()),
    concat('Expense accrual: ', p_expense_id),
    'expenses',
    p_expense_id::text,
    'accrual',
    auth.uid()
  )
  returning id into v_entry_id;

  insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo)
  values
    (v_entry_id, v_expenses, p_amount, 0, 'Expense accrual'),
    (v_entry_id, v_ap, 0, p_amount, 'Expense payable');

  perform public.check_journal_entry_balance(v_entry_id);
end;
$$;

revoke all on function public.record_expense_accrual(uuid, numeric, timestamptz) from public;
grant execute on function public.record_expense_accrual(uuid, numeric, timestamptz) to anon, authenticated;

create or replace function public.post_payment(p_payment_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pay record;
  v_debit_account uuid;
  v_credit_account uuid;
  v_entry_id uuid;
  v_amount_base numeric;
  v_amount_fx numeric;
  v_method text;
  v_currency text;
  v_rate numeric;
  v_cash uuid;
  v_bank uuid;
  v_ar uuid;
  v_ap uuid;
  v_expenses uuid;
  v_fx_gain uuid;
  v_fx_loss uuid;
  v_account_currency text;
  v_amount_account numeric;
  v_fx_diff numeric;
  v_override text;
  v_ap_override uuid;
  v_ar_override uuid;
  v_expenses_override uuid;
  v_has_accrual boolean := false;
begin
  if not public.has_admin_permission('accounting.manage') then
    raise exception 'not allowed';
  end if;

  select *
  into v_pay
  from public.payments
  where id = p_payment_id
  for update;
  if not found then
    raise exception 'payment not found';
  end if;

  select id
  into v_entry_id
  from public.journal_entries
  where source_table = 'payments'
    and source_id = p_payment_id::text
  order by entry_date desc
  limit 1;

  if v_entry_id is not null then
    return;
  end if;

  v_cash := public.get_account_id_by_code('1010');
  v_bank := public.get_account_id_by_code('1020');
  v_ar := public.get_account_id_by_code('1200');
  v_ap := public.get_account_id_by_code('2010');
  v_expenses := public.get_account_id_by_code('6100');
  v_fx_gain := public.get_account_id_by_code('4000');
  v_fx_loss := public.get_account_id_by_code('5000');
  if v_cash is null or v_bank is null or v_ar is null or v_ap is null or v_expenses is null or v_fx_gain is null or v_fx_loss is null then
    raise exception 'required accounts not found';
  end if;

  v_method := v_pay.method;
  v_currency := coalesce(nullif(v_pay.currency, ''), 'YER');
  v_rate := public.get_fx_rate(v_currency, v_pay.occurred_at);
  v_amount_fx := v_pay.amount;
  v_amount_base := round(v_amount_fx * v_rate, 2);

  if v_method = 'cash' then
    v_debit_account := v_cash;
  else
    v_debit_account := v_bank;
  end if;

  v_override := nullif(trim(coalesce(v_pay.data->>'overrideAccountId','')), '');
  v_ar_override := public.resolve_override_account(v_ar, v_override, array['asset','liability','equity','expense']);
  v_ap_override := public.resolve_override_account(v_ap, v_override, array['asset','liability','equity','expense']);
  v_expenses_override := public.resolve_override_account(v_expenses, v_override, array['asset','liability','equity','expense']);

  insert into public.journal_entries(entry_date, memo, source_table, source_id, created_by)
  values (
    v_pay.occurred_at,
    concat('Payment ', v_pay.direction, ' ', v_pay.reference_table, ':', v_pay.reference_id),
    'payments',
    p_payment_id::text,
    auth.uid()
  )
  returning id into v_entry_id;

  if v_pay.direction = 'in' and v_pay.reference_table = 'orders' then
    v_credit_account := v_ar_override;

    insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo)
    values
      (v_entry_id, v_debit_account, v_amount_base, 0, 'Receive payment'),
      (v_entry_id, v_credit_account, 0, v_amount_base, 'Settle receivable');

  elsif v_pay.direction = 'out' and v_pay.reference_table = 'purchase_orders' then
    v_credit_account := case when v_method = 'cash' then v_cash else v_bank end;

    select currency
      into v_account_currency
      from public.ledger_balances
      where account_id = v_ap_override;
    v_account_currency := coalesce(nullif(v_account_currency, ''), v_currency);

    v_amount_account := v_amount_base;
    if v_account_currency <> public.get_base_currency() then
      v_amount_account := round(v_amount_fx, 2);
    end if;

    v_fx_diff := 0;
    if v_account_currency <> v_currency then
      v_fx_diff := v_amount_base - (round(v_amount_account * public.get_fx_rate(v_account_currency, v_pay.occurred_at), 2));
    end if;

    insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo)
    values
      (v_entry_id, v_ap_override, v_amount_account, 0, 'Settle payable'),
      (v_entry_id, v_credit_account, 0, v_amount_base, 'Pay supplier');

    if abs(v_fx_diff) > 0.001 then
      if v_fx_diff > 0 then
        insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo)
        values (v_entry_id, v_fx_gain, 0, abs(v_fx_diff), 'FX gain');
      else
        insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo)
        values (v_entry_id, v_fx_loss, abs(v_fx_diff), 0, 'FX loss');
      end if;
    end if;

  elsif v_pay.direction = 'out' and v_pay.reference_table = 'expenses' then
    v_credit_account := case when v_method = 'cash' then v_cash else v_bank end;

    select exists(
      select 1 from public.journal_entries
      where source_table = 'expenses'
        and source_id = v_pay.reference_id
        and source_event = 'accrual'
    ) into v_has_accrual;

    if v_has_accrual then
      insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo)
      values
        (v_entry_id, v_ap_override, v_amount_base, 0, 'Settle expense payable'),
        (v_entry_id, v_credit_account, 0, v_amount_base, 'Pay expense');
    else
      insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo)
      values
        (v_entry_id, v_expenses_override, v_amount_base, 0, 'Expense payment'),
        (v_entry_id, v_credit_account, 0, v_amount_base, 'Pay expense');
    end if;
  else
    raise exception 'unsupported payment reference';
  end if;

  perform public.check_journal_entry_balance(v_entry_id);
end;
$$;

revoke all on function public.post_payment(uuid) from public;
grant execute on function public.post_payment(uuid) to anon, authenticated;

notify pgrst, 'reload schema';
