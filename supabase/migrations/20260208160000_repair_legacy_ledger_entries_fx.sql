set app.allow_ledger_ddl = '1';

do $$
declare
  v_base text := public.get_base_currency();

  v_cash uuid := public.get_account_id_by_code('1010');
  v_bank uuid := public.get_account_id_by_code('1020');
  v_ar uuid := public.get_account_id_by_code('1200');
  v_deposits uuid := public.get_account_id_by_code('2050');
  v_ap uuid := public.get_account_id_by_code('2010');
  v_expenses uuid := public.get_account_id_by_code('6100');
  v_clearing uuid := public.get_account_id_by_code('2060');
  v_fx_gain uuid := public.get_account_id_by_code('6200');
  v_fx_loss uuid := public.get_account_id_by_code('6201');

  v_accounts jsonb;
  v_sales uuid;
  v_delivery_income uuid;
  v_vat_payable uuid;

  r record;

  v_data jsonb;
  v_currency text;
  v_fx numeric;
  v_total_foreign numeric;
  v_total_base numeric;
  v_delivery_base numeric;
  v_tax_base numeric;
  v_items_revenue_base numeric;
  v_deposits_paid_base numeric;
  v_ar_amount_base numeric;
  v_cutoff timestamptz;

  v_entry_id uuid;
  v_debit_account uuid;
  v_credit_account uuid;
  v_amount_base numeric;
  v_amount_fx numeric;
  v_rate numeric;
  v_cash_fx_code text;
  v_cash_fx_rate numeric;
  v_cash_fx_amount numeric;
  v_order_id uuid;
  v_delivered_at timestamptz;
  v_source_entry_id uuid;
  v_original_ar_base numeric;
  v_settled_ar_base numeric;
  v_outstanding_base numeric;
  v_settle_base numeric;
  v_diff numeric;
  v_po_id uuid;
  v_has_accrual boolean;
begin
  if v_cash is null or v_bank is null or v_ar is null or v_deposits is null or v_ap is null or v_expenses is null or v_fx_gain is null or v_fx_loss is null then
    raise exception 'required accounts missing';
  end if;

  select s.data->'accounting_accounts'
  into v_accounts
  from public.app_settings s
  where s.id = 'singleton';

  v_sales := public.get_account_id_by_code(coalesce(v_accounts->>'sales','4010'));
  v_delivery_income := public.get_account_id_by_code(coalesce(v_accounts->>'delivery_income','4020'));
  v_vat_payable := public.get_account_id_by_code(coalesce(v_accounts->>'vat_payable','2020'));

  for r in
    select
      je.id as entry_id,
      je.source_event,
      o.id as order_id,
      o.base_total,
      o.fx_rate,
      o.total as order_total_col,
      o.currency as order_currency_col,
      o.data as order_data,
      public.order_delivered_at(o.id) as delivered_at,
      nullif(o.data->'invoiceSnapshot'->>'issuedAt', '')::timestamptz as invoice_issued_at,
      coalesce(sum(jl.debit), 0) as entry_debit_total
    from public.orders o
    join public.journal_entries je
      on je.source_table = 'orders'
     and je.source_id = o.id::text
     and je.source_event in ('delivered', 'invoiced')
    join public.journal_lines jl on jl.journal_entry_id = je.id
    where upper(coalesce(nullif(btrim(o.currency),''), nullif(btrim(o.data->>'currency'),''), v_base)) <> upper(v_base)
      and o.base_total is not null
      and o.base_total > 0
    group by
      je.id, je.source_event,
      o.id, o.base_total, o.fx_rate, o.total, o.currency, o.data
  loop
    if abs(coalesce(r.entry_debit_total, 0) - coalesce(r.base_total, 0)) <= 0.01 then
      continue;
    end if;

    v_data := coalesce(r.order_data, '{}'::jsonb);
    v_currency := upper(coalesce(nullif(btrim(coalesce(r.order_currency_col, v_data->>'currency', v_base)), ''), v_base));

    begin
      v_fx := coalesce(r.fx_rate, nullif((v_data->>'fxRate')::numeric, null), 1);
    exception when others then
      v_fx := 1;
    end;
    if v_fx is null or v_fx <= 0 then
      continue;
    end if;

    v_total_foreign := coalesce(
      nullif((v_data->'invoiceSnapshot'->>'total')::numeric, null),
      nullif((v_data->>'total')::numeric, null),
      coalesce(r.order_total_col, 0),
      0
    );

    v_total_base := coalesce(r.base_total, 0);
    if v_total_base <= 0 then
      continue;
    end if;

    if r.source_event = 'invoiced' then
      v_cutoff := coalesce(r.invoice_issued_at, now());
      v_delivery_base := coalesce(nullif((v_data->'invoiceSnapshot'->>'deliveryFee')::numeric, null), nullif((v_data->>'deliveryFee')::numeric, null), 0) * v_fx;
      v_tax_base := coalesce(nullif((v_data->'invoiceSnapshot'->>'taxAmount')::numeric, null), nullif((v_data->>'taxAmount')::numeric, null), 0) * v_fx;
    else
      v_cutoff := coalesce(r.delivered_at, now());
      if (v_data ? 'invoiceSnapshot') then
        v_delivery_base := coalesce(nullif((v_data->'invoiceSnapshot'->>'deliveryFee')::numeric, null), 0) * v_fx;
        v_tax_base := coalesce(nullif((v_data->'invoiceSnapshot'->>'taxAmount')::numeric, null), 0) * v_fx;
      else
        v_delivery_base := coalesce(nullif((v_data->>'deliveryFee')::numeric, null), 0) * v_fx;
        v_tax_base := coalesce(nullif((v_data->>'taxAmount')::numeric, null), 0) * v_fx;
      end if;
    end if;

    v_tax_base := least(greatest(0, v_tax_base), v_total_base);
    v_delivery_base := least(greatest(0, v_delivery_base), v_total_base - v_tax_base);
    v_items_revenue_base := greatest(0, v_total_base - v_delivery_base - v_tax_base);

    select coalesce(sum(coalesce(p.base_amount, 0)), 0)
    into v_deposits_paid_base
    from public.payments p
    where p.reference_table = 'orders'
      and p.reference_id = r.order_id::text
      and p.direction = 'in'
      and p.occurred_at < v_cutoff;

    v_deposits_paid_base := least(v_total_base, greatest(0, coalesce(v_deposits_paid_base, 0)));
    v_ar_amount_base := greatest(0, v_total_base - v_deposits_paid_base);

    update public.journal_entries
    set
      currency_code = case when v_currency <> v_base then v_currency else null end,
      fx_rate = case when v_currency <> v_base then v_fx else null end,
      foreign_amount = case when v_currency <> v_base then nullif(v_total_foreign, 0) else null end,
      memo = case
        when r.source_event = 'invoiced' then concat('Order invoiced ', r.order_id::text)
        else concat('Order delivered ', r.order_id::text)
      end
    where id = r.entry_id;

    delete from public.journal_lines jl where jl.journal_entry_id = r.entry_id;

    if v_deposits_paid_base > 0 then
      insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo)
      values (r.entry_id, v_deposits, v_deposits_paid_base, 0, 'Apply customer deposit');
    end if;

    if v_ar_amount_base > 0 then
      insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo)
      values (r.entry_id, v_ar, v_ar_amount_base, 0, 'Accounts receivable');
    end if;

    if v_items_revenue_base > 0 and v_sales is not null then
      insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo)
      values (r.entry_id, v_sales, 0, v_items_revenue_base, 'Sales revenue');
    end if;

    if v_delivery_base > 0 and v_delivery_income is not null then
      insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo)
      values (r.entry_id, v_delivery_income, 0, v_delivery_base, 'Delivery income');
    end if;

    if v_tax_base > 0 and v_vat_payable is not null then
      insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo)
      values (r.entry_id, v_vat_payable, 0, v_tax_base, 'VAT payable');
    end if;

    perform public.check_journal_entry_balance(r.entry_id);

    if r.source_event = 'invoiced' then
      perform public.sync_ar_on_invoice(r.order_id);
    end if;
  end loop;

  for r in
    select
      p.id as payment_id,
      p.direction,
      p.method,
      p.reference_table,
      p.reference_id,
      p.occurred_at,
      upper(coalesce(nullif(btrim(p.currency), ''), v_base)) as currency,
      coalesce(p.fx_rate, 1) as fx_rate,
      coalesce(p.amount, 0) as amount_fx,
      coalesce(p.base_amount, 0) as amount_base,
      je.id as entry_id,
      max(case when jl.account_id in (v_cash, v_bank) then greatest(coalesce(jl.debit,0), coalesce(jl.credit,0)) else null end) as cash_bank_amount
    from public.payments p
    join public.journal_entries je
      on je.source_table = 'payments'
     and je.source_id = p.id::text
    join public.journal_lines jl
      on jl.journal_entry_id = je.id
    where upper(coalesce(nullif(btrim(p.currency), ''), v_base)) <> upper(v_base)
      and coalesce(p.base_amount, 0) > 0
      and coalesce(p.reference_table, '') <> 'sales_returns'
    group by p.id, p.direction, p.method, p.reference_table, p.reference_id, p.occurred_at, p.currency, p.fx_rate, p.amount, p.base_amount, je.id
    order by p.occurred_at asc, p.id asc
  loop
    if r.entry_id is null then
      continue;
    end if;
    if r.amount_base <= 0 then
      continue;
    end if;

    if r.cash_bank_amount is not null and abs(r.cash_bank_amount - r.amount_base) <= 0.01 then
      continue;
    end if;

    v_entry_id := r.entry_id;
    v_currency := upper(coalesce(nullif(btrim(r.currency), ''), v_base));
    v_rate := coalesce(r.fx_rate, 1);
    v_amount_fx := coalesce(r.amount_fx, 0);
    v_amount_base := coalesce(r.amount_base, 0);

    v_cash_fx_code := null;
    v_cash_fx_rate := null;
    v_cash_fx_amount := null;
    if v_currency <> v_base then
      v_cash_fx_code := v_currency;
      v_cash_fx_rate := v_rate;
      v_cash_fx_amount := v_amount_fx;
    end if;

    if coalesce(r.method, '') = 'cash' then
      v_debit_account := v_cash;
      v_credit_account := v_cash;
    else
      v_debit_account := v_bank;
      v_credit_account := v_bank;
    end if;

    update public.journal_entries
    set
      entry_date = r.occurred_at,
      memo = concat('Payment ', r.direction, ' ', r.reference_table, ':', r.reference_id),
      status = coalesce(status, 'posted'),
      currency_code = case when v_currency <> v_base then v_currency else null end,
      fx_rate = case when v_currency <> v_base then v_rate else null end,
      foreign_amount = case when v_currency <> v_base then v_amount_fx else null end
    where id = v_entry_id;

    delete from public.journal_lines jl where jl.journal_entry_id = v_entry_id;

    if r.direction = 'in' and r.reference_table = 'orders' then
      v_order_id := nullif(r.reference_id, '')::uuid;
      if v_order_id is null then
        continue;
      end if;

      v_delivered_at := public.order_delivered_at(v_order_id);
      if v_delivered_at is null or r.occurred_at < v_delivered_at then
        insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo, currency_code, fx_rate, foreign_amount)
        values
          (v_entry_id, v_debit_account, v_amount_base, 0, 'Cash/Bank received', v_cash_fx_code, v_cash_fx_rate, v_cash_fx_amount),
          (v_entry_id, v_deposits, 0, v_amount_base, 'Customer deposit', null, null, null);
        perform public.check_journal_entry_balance(v_entry_id);
        continue;
      end if;

      select je.id
      into v_source_entry_id
      from public.journal_entries je
      where je.source_table = 'orders'
        and je.source_id = v_order_id::text
        and je.source_event in ('invoiced','delivered')
      order by
        case when je.source_event = 'invoiced' then 0 else 1 end asc,
        je.entry_date desc
      limit 1;

      if v_source_entry_id is null then
        select coalesce(o.base_total, 0)
        into v_original_ar_base
        from public.orders o
        where o.id = v_order_id;
      else
        select coalesce(sum(jl.debit), 0) - coalesce(sum(jl.credit), 0)
        into v_original_ar_base
        from public.journal_lines jl
        where jl.journal_entry_id = v_source_entry_id
          and jl.account_id = v_ar;
      end if;

      select coalesce(sum(jl.credit), 0) - coalesce(sum(jl.debit), 0)
      into v_settled_ar_base
      from public.payments p
      join public.journal_entries je
        on je.source_table = 'payments'
       and je.source_id = p.id::text
      join public.journal_lines jl
        on jl.journal_entry_id = je.id
      where p.reference_table = 'orders'
        and p.direction = 'in'
        and p.reference_id = v_order_id::text
        and p.id <> r.payment_id
        and jl.account_id = v_ar;

      v_outstanding_base := greatest(0, coalesce(v_original_ar_base, 0) - coalesce(v_settled_ar_base, 0));

      if v_outstanding_base <= 0 then
        insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo, currency_code, fx_rate, foreign_amount)
        values
          (v_entry_id, v_debit_account, v_amount_base, 0, 'Cash/Bank received', v_cash_fx_code, v_cash_fx_rate, v_cash_fx_amount),
          (v_entry_id, v_deposits, 0, v_amount_base, 'Customer deposit', null, null, null);
        perform public.check_journal_entry_balance(v_entry_id);
        continue;
      end if;

      v_settle_base := v_outstanding_base;
      v_diff := v_amount_base - v_settle_base;

      insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo, currency_code, fx_rate, foreign_amount)
      values
        (v_entry_id, v_debit_account, v_amount_base, 0, 'Receive payment', v_cash_fx_code, v_cash_fx_rate, v_cash_fx_amount),
        (v_entry_id, v_ar, 0, v_settle_base, 'Settle receivable', null, null, null);

      if abs(v_diff) > 0.0000001 then
        if v_diff > 0 then
          insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo)
          values (v_entry_id, v_fx_gain, 0, abs(v_diff), 'FX Gain realized');
        else
          insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo)
          values (v_entry_id, v_fx_loss, abs(v_diff), 0, 'FX Loss realized');
        end if;
      end if;

      perform public.check_journal_entry_balance(v_entry_id);
      continue;
    end if;

    if r.direction = 'out' and r.reference_table = 'purchase_orders' then
      v_po_id := nullif(r.reference_id, '')::uuid;
      if v_po_id is null then
        continue;
      end if;

      select greatest(0, coalesce(po.base_total, 0) - coalesce((
        select sum(coalesce(p.base_amount, 0))
        from public.payments p
        where p.reference_table = 'purchase_orders'
          and p.direction = 'out'
          and p.reference_id = v_po_id::text
          and p.id <> r.payment_id
          and p.occurred_at <= r.occurred_at
      ), 0))
      into v_outstanding_base
      from public.purchase_orders po
      where po.id = v_po_id;

      v_settle_base := least(greatest(0, v_outstanding_base), v_amount_base);
      v_diff := 0;
      if v_outstanding_base > 0 and (v_amount_base + 0.0000001) >= v_outstanding_base then
        v_diff := v_amount_base - v_outstanding_base;
        v_settle_base := v_outstanding_base;
      end if;

      insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo, currency_code, fx_rate, foreign_amount)
      values
        (v_entry_id, v_ap, v_settle_base, 0, 'Settle payable', null, null, null),
        (v_entry_id, v_credit_account, 0, v_amount_base, 'Pay supplier', v_cash_fx_code, v_cash_fx_rate, v_cash_fx_amount);

      if abs(v_diff) > 0.0000001 then
        if v_diff > 0 then
          insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo)
          values (v_entry_id, v_fx_loss, abs(v_diff), 0, 'FX Loss realized');
        else
          insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo)
          values (v_entry_id, v_fx_gain, 0, abs(v_diff), 'FX Gain realized');
        end if;
      end if;

      perform public.check_journal_entry_balance(v_entry_id);
      continue;
    end if;

    if r.direction = 'out' and r.reference_table = 'expenses' then
      v_has_accrual := exists(
        select 1 from public.journal_entries je
        where je.source_table = 'expenses'
          and je.source_id = coalesce(r.reference_id, '')
          and je.source_event = 'accrual'
      );

      if v_has_accrual then
        insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo, currency_code, fx_rate, foreign_amount)
        values
          (v_entry_id, v_ap, v_amount_base, 0, 'Settle payable', null, null, null),
          (v_entry_id, v_credit_account, 0, v_amount_base, 'Cash/Bank paid', v_cash_fx_code, v_cash_fx_rate, v_cash_fx_amount);
      else
        insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo, currency_code, fx_rate, foreign_amount)
        values
          (v_entry_id, v_expenses, v_amount_base, 0, 'Operating expense', null, null, null),
          (v_entry_id, v_credit_account, 0, v_amount_base, 'Cash/Bank paid', v_cash_fx_code, v_cash_fx_rate, v_cash_fx_amount);
      end if;
      perform public.check_journal_entry_balance(v_entry_id);
      continue;
    end if;

    if r.direction = 'out' and r.reference_table = 'import_expenses' then
      v_has_accrual := exists(
        select 1 from public.journal_entries je
        where je.source_table = 'import_expenses'
          and je.source_id = coalesce(r.reference_id, '')
          and je.source_event = 'accrual'
      );

      if v_clearing is null then
        continue;
      end if;

      if v_has_accrual then
        insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo, currency_code, fx_rate, foreign_amount)
        values
          (v_entry_id, v_ap, v_amount_base, 0, 'Settle payable', null, null, null),
          (v_entry_id, v_credit_account, 0, v_amount_base, 'Cash/Bank paid', v_cash_fx_code, v_cash_fx_rate, v_cash_fx_amount);
      else
        insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo, currency_code, fx_rate, foreign_amount)
        values
          (v_entry_id, v_clearing, v_amount_base, 0, 'Landed cost service', null, null, null),
          (v_entry_id, v_credit_account, 0, v_amount_base, 'Cash/Bank paid', v_cash_fx_code, v_cash_fx_rate, v_cash_fx_amount);
      end if;
      perform public.check_journal_entry_balance(v_entry_id);
      continue;
    end if;
  end loop;
end $$;

notify pgrst, 'reload schema';
