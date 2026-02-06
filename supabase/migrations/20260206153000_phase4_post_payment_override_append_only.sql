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
  v_settle_ar numeric;
  v_settle_ap numeric;
  v_override text;
  v_party_account uuid;
  v_has_accrual boolean := false;
begin
  if not public.has_admin_permission('accounting.manage') then
    raise exception 'not allowed';
  end if;

  select * into v_pay
  from public.payments
  where id = p_payment_id
  for update;
  if not found then
    raise exception 'payment not found';
  end if;

  select id into v_entry_id
  from public.journal_entries
  where source_table = 'payments' and source_id = p_payment_id::text
  order by entry_date desc limit 1;

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

  v_override := nullif(trim(coalesce(v_pay.data->>'overrideAccountId','')), '');

  v_method := v_pay.method;
  v_currency := coalesce(nullif(v_pay.currency,''), public.get_base_currency());
  v_rate := public.get_fx_rate(v_currency, v_pay.occurred_at);
  v_amount_fx := v_pay.amount;
  v_amount_base := round(v_amount_fx * v_rate, 2);

  if v_method = 'cash' then
    v_debit_account := v_cash;
  else
    v_debit_account := v_bank;
  end if;

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
    v_party_account := public.resolve_override_account(v_ar, v_override, array['asset','liability']);

    select currency into v_account_currency
    from public.ledger_balances
    where account_id = v_party_account;
    v_account_currency := coalesce(nullif(v_account_currency,''), v_currency);

    v_amount_account := v_amount_base;
    if v_account_currency <> public.get_base_currency() then
      v_amount_account := round(v_amount_fx, 2);
    end if;

    v_fx_diff := 0;
    if v_account_currency <> v_currency then
      v_fx_diff := v_amount_base - (round(v_amount_account * public.get_fx_rate(v_account_currency, v_pay.occurred_at), 2));
    end if;

    v_settle_ar := v_amount_account;

    insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo)
    values
      (v_entry_id, v_debit_account, v_amount_base, 0, 'Receive payment'),
      (v_entry_id, v_party_account, 0, v_settle_ar, 'Settle receivable');

    if abs(v_fx_diff) > 0.001 then
      if v_fx_diff > 0 then
        insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo)
        values (v_entry_id, v_fx_loss, abs(v_fx_diff), 0, 'FX loss');
      else
        insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo)
        values (v_entry_id, v_fx_gain, 0, abs(v_fx_diff), 'FX gain');
      end if;
    end if;

  elsif v_pay.direction = 'out' and v_pay.reference_table = 'purchase_orders' then
    v_party_account := public.resolve_override_account(v_ap, v_override, array['liability','asset']);
    v_credit_account := case when v_method = 'cash' then v_cash else v_bank end;

    select currency into v_account_currency
    from public.ledger_balances
    where account_id = v_party_account;
    v_account_currency := coalesce(nullif(v_account_currency,''), v_currency);

    v_amount_account := v_amount_base;
    if v_account_currency <> public.get_base_currency() then
      v_amount_account := round(v_amount_fx, 2);
    end if;

    v_fx_diff := 0;
    if v_account_currency <> v_currency then
      v_fx_diff := v_amount_base - (round(v_amount_account * public.get_fx_rate(v_account_currency, v_pay.occurred_at), 2));
    end if;

    v_settle_ap := v_amount_account;

    insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo)
    values
      (v_entry_id, v_party_account, v_settle_ap, 0, 'Settle payable'),
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
      v_party_account := public.resolve_override_account(v_ap, v_override, array['liability','equity']);
      insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo)
      values
        (v_entry_id, v_party_account, v_amount_base, 0, 'Settle expense payable'),
        (v_entry_id, v_credit_account, 0, v_amount_base, 'Pay expense');
    else
      v_party_account := public.resolve_override_account(v_expenses, v_override, array['asset','liability','expense','equity']);
      insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo)
      values
        (v_entry_id, v_party_account, v_amount_base, 0, 'Expense payment'),
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

