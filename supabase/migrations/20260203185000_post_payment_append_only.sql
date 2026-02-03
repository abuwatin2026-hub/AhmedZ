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
  v_ap uuid;
  v_expenses uuid;
  v_gain_real uuid;
  v_loss_real uuid;
  v_debit_account uuid;
  v_credit_account uuid;
  v_amount_base numeric;
  v_order_id uuid;
  v_open_ar numeric;
  v_settle_ar numeric;
  v_po_id uuid;
  v_po_base_total numeric;
  v_po_paid_base numeric;
  v_settle_ap numeric;
begin
  if p_payment_id is null then
    raise exception 'p_payment_id is required';
  end if;

  select * into v_pay
  from public.payments p
  where p.id = p_payment_id;

  if not found then
    raise exception 'payment not found';
  end if;

  select je.id into v_entry_id
  from public.journal_entries je
  where je.source_table = 'payments'
    and je.source_id = v_pay.id::text
  limit 1;

  if v_entry_id is not null then
    return;
  end if;

  v_amount_base := coalesce(v_pay.base_amount, v_pay.amount, 0);
  v_cash := public.get_account_id_by_code('1010');
  v_bank := public.get_account_id_by_code('1020');
  v_ar := public.get_account_id_by_code('1200');
  v_ap := public.get_account_id_by_code('2010');
  v_expenses := public.get_account_id_by_code('6100');
  v_gain_real := public.get_account_id_by_code('6200');
  v_loss_real := public.get_account_id_by_code('6201');

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

    insert into public.journal_entries(entry_date, memo, source_table, source_id, source_event, created_by)
    values (
      v_pay.occurred_at,
      concat('Order payment ', coalesce(v_pay.reference_id, v_pay.id::text)),
      'payments',
      v_pay.id::text,
      concat('in:orders:', coalesce(v_pay.reference_id, '')),
      v_pay.created_by
    )
    returning id into v_entry_id;

    select coalesce(open_balance, 0) into v_open_ar
    from public.ar_open_items
    where invoice_id = v_order_id and status = 'open'
    limit 1;

    if v_open_ar is null then
      select coalesce(o.base_total, 0) - coalesce((
        select sum(coalesce(p.base_amount, p.amount))
        from public.payments p
        where p.reference_table = 'orders'
          and p.direction = 'in'
          and p.reference_id = v_order_id::text
          and p.id <> v_pay.id
      ), 0)
      into v_open_ar
      from public.orders o
      where o.id = v_order_id;
    end if;

    v_settle_ar := greatest(0, v_open_ar);

    if v_amount_base >= v_settle_ar then
      insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo)
      values
        (v_entry_id, v_debit_account, v_amount_base, 0, 'Cash/Bank received'),
        (v_entry_id, v_ar, 0, v_settle_ar, 'Settle receivable');
      if (v_amount_base - v_settle_ar) > 0.0000001 then
        insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo)
        values (v_entry_id, v_gain_real, 0, v_amount_base - v_settle_ar, 'FX Gain realized');
      end if;
    else
      insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo)
      values
        (v_entry_id, v_debit_account, v_amount_base, 0, 'Cash/Bank received'),
        (v_entry_id, v_ar, 0, v_settle_ar, 'Settle receivable'),
        (v_entry_id, v_loss_real, v_settle_ar - v_amount_base, 0, 'FX Loss realized');
    end if;

    update public.ar_open_items
    set status = 'closed',
        open_balance = 0,
        closed_at = v_pay.occurred_at
    where invoice_id = v_order_id and status = 'open';
    return;
  end if;

  if v_pay.direction = 'out' and v_pay.reference_table = 'purchase_orders' then
    v_po_id := nullif(v_pay.reference_id, '')::uuid;
    if v_po_id is null then
      raise exception 'invalid purchase order reference_id';
    end if;

    select coalesce(base_total, 0) into v_po_base_total
    from public.purchase_orders
    where id = v_po_id;

    select coalesce(sum(coalesce(p.base_amount, p.amount)), 0)
    into v_po_paid_base
    from public.payments p
    where p.reference_table = 'purchase_orders'
      and p.direction = 'out'
      and p.reference_id = v_po_id::text
      and p.id <> v_pay.id;

    v_settle_ap := greatest(0, v_po_base_total - coalesce(v_po_paid_base, 0));

    insert into public.journal_entries(entry_date, memo, source_table, source_id, source_event, created_by)
    values (
      v_pay.occurred_at,
      concat('Supplier payment ', coalesce(v_pay.reference_id, v_pay.id::text)),
      'payments',
      v_pay.id::text,
      concat('out:purchase_orders:', coalesce(v_pay.reference_id, '')),
      v_pay.created_by
    )
    returning id into v_entry_id;

    if v_amount_base >= v_settle_ap then
      insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo)
      values
        (v_entry_id, v_ap, v_settle_ap, 0, 'Settle payable'),
        (v_entry_id, v_credit_account, 0, v_amount_base, 'Cash/Bank paid');
      if (v_amount_base - v_settle_ap) > 0.0000001 then
        insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo)
        values (v_entry_id, v_loss_real, v_amount_base - v_settle_ap, 0, 'FX Loss realized');
      end if;
    else
      insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo)
      values
        (v_entry_id, v_ap, v_settle_ap, 0, 'Settle payable'),
        (v_entry_id, v_credit_account, 0, v_amount_base, 'Cash/Bank paid'),
        (v_entry_id, v_gain_real, 0, v_settle_ap - v_amount_base, 'FX Gain realized');
    end if;
    return;
  end if;

  if v_pay.direction = 'out' and v_pay.reference_table = 'expenses' then
    insert into public.journal_entries(entry_date, memo, source_table, source_id, source_event, created_by)
    values (
      v_pay.occurred_at,
      concat('Expense payment ', coalesce(v_pay.reference_id, v_pay.id::text)),
      'payments',
      v_pay.id::text,
      concat('out:expenses:', coalesce(v_pay.reference_id, '')),
      v_pay.created_by
    )
    returning id into v_entry_id;

    insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo)
    values
      (v_entry_id, v_expenses, v_amount_base, 0, 'Operating expense'),
      (v_entry_id, v_credit_account, 0, v_amount_base, 'Cash/Bank paid');
    return;
  end if;
end;
$$;

revoke all on function public.post_payment(uuid) from public;
grant execute on function public.post_payment(uuid) to service_role, authenticated, anon;

notify pgrst, 'reload schema';
