set app.allow_ledger_ddl = '1';

do $$
declare
  v_base text;
  r record;

  v_expected numeric;
  v_inv numeric;
  v_ratio numeric;

  v_fix_id uuid;
  v_rev_id uuid;
  v_fix_source_id uuid;
  v_rev_source_id uuid;

  v_cash uuid;
  v_bank uuid;
  v_ar uuid;
  v_deposits uuid;
  v_ap uuid;
  v_expenses uuid;
  v_clearing uuid;
  v_fx_gain uuid;
  v_fx_loss uuid;
  v_debit_account uuid;
  v_credit_account uuid;

  v_currency text;
  v_rate numeric;
  v_amount_fx numeric;
  v_amount_base numeric;
  v_cash_fx_code text;
  v_cash_fx_rate numeric;
  v_cash_fx_amount numeric;

  v_order_id uuid;
  v_total_foreign numeric;
  v_total_base numeric;
  v_deposits_paid_base numeric;
  v_ar_amount_base numeric;
  v_delivery_base numeric;
  v_tax_base numeric;
  v_accounts jsonb;
  v_sales uuid;
  v_delivery_income uuid;
  v_vat_payable uuid;
  v_cutoff timestamptz;
begin
  perform set_config('request.jwt.claims', '', true);

  v_base := public.get_base_currency();

  select s.data->'accounting_accounts' into v_accounts from public.app_settings s where s.id = 'singleton';
  v_ar := public.get_account_id_by_code(coalesce(v_accounts->>'ar','1200'));
  v_deposits := public.get_account_id_by_code(coalesce(v_accounts->>'deposits','2050'));
  v_sales := public.get_account_id_by_code(coalesce(v_accounts->>'sales','4010'));
  v_delivery_income := public.get_account_id_by_code(coalesce(v_accounts->>'delivery_income','4020'));
  v_vat_payable := public.get_account_id_by_code(coalesce(v_accounts->>'vat_payable','2020'));

  v_cash := public.get_account_id_by_code('1010');
  v_bank := public.get_account_id_by_code('1020');
  v_ap := public.get_account_id_by_code('2010');
  v_expenses := public.get_account_id_by_code('6100');
  v_clearing := public.get_account_id_by_code('2060');
  v_fx_gain := public.get_account_id_by_code('6200');
  v_fx_loss := public.get_account_id_by_code('6201');

  for r in
    select
      p.id as payment_id,
      p.occurred_at,
      p.direction,
      p.method,
      p.reference_table,
      p.reference_id,
      upper(coalesce(nullif(btrim(p.currency), ''), v_base)) as currency,
      coalesce(p.fx_rate, 0) as fx_rate,
      coalesce(p.amount, 0) as amount_fx,
      je.id as entry_id,
      je.document_id,
      je.branch_id,
      je.company_id
    from public.payments p
    join public.journal_entries je
      on je.source_table = 'payments'
     and je.source_id = p.id::text
    where upper(coalesce(nullif(btrim(p.currency), ''), v_base)) <> upper(v_base)
      and coalesce(p.amount, 0) > 0
      and coalesce(p.fx_rate, 0) > 0
      and coalesce(p.reference_table, '') <> 'sales_returns'
  loop
    v_currency := r.currency;
    v_expected := public.get_fx_rate(v_currency, (r.occurred_at::date), 'operational');
    if v_expected is null or v_expected <= 0 then
      continue;
    end if;

    v_inv := 1 / nullif(r.fx_rate, 0);
    if v_inv is null or v_inv <= 0 then
      continue;
    end if;

    v_ratio := abs(v_inv - v_expected) / v_expected;
    if v_ratio > 0.02 then
      continue;
    end if;

    if abs(r.fx_rate - v_expected) / v_expected <= 0.2 then
      continue;
    end if;

    v_rev_source_id := public.uuid_from_text(concat('fxinv:payments:rev:', r.entry_id::text));
    v_fix_source_id := public.uuid_from_text(concat('fxinv:payments:repost:', r.entry_id::text));

    if exists (
      select 1
      from public.journal_entries je2
      where je2.source_table = 'ledger_repairs'
        and je2.source_id = v_fix_source_id::text
        and je2.source_event = 'repost_payment_fx_inv'
    ) then
      continue;
    end if;

    insert into public.journal_entries(entry_date, memo, source_table, source_id, source_event, created_by, status, document_id, branch_id, company_id)
    values (
      r.occurred_at,
      concat('Reverse (fx inv fix) payment ', r.payment_id::text),
      'ledger_repairs',
      v_rev_source_id::text,
      'reverse_payment_fx_inv',
      null,
      'posted',
      r.document_id,
      r.branch_id,
      r.company_id
    )
    returning id into v_rev_id;

    insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo, currency_code, fx_rate, foreign_amount)
    select v_rev_id, jl.account_id, jl.credit, jl.debit, concat('Reverse ', coalesce(jl.line_memo,'')), jl.currency_code, jl.fx_rate, jl.foreign_amount
    from public.journal_lines jl
    where jl.journal_entry_id = r.entry_id;

    perform public.check_journal_entry_balance(v_rev_id);

    v_rate := v_expected;
    v_amount_fx := r.amount_fx;
    v_amount_base := public._money_round(v_amount_fx * v_rate);

    v_cash_fx_code := v_currency;
    v_cash_fx_rate := v_rate;
    v_cash_fx_amount := v_amount_fx;

    if r.method = 'cash' then
      v_debit_account := v_cash;
      v_credit_account := v_cash;
    else
      v_debit_account := v_bank;
      v_credit_account := v_bank;
    end if;

    insert into public.journal_entries(entry_date, memo, source_table, source_id, source_event, created_by, status, currency_code, fx_rate, foreign_amount, document_id, branch_id, company_id)
    values (
      r.occurred_at,
      concat('Repost (fx inv fix) payment ', r.payment_id::text),
      'ledger_repairs',
      v_fix_source_id::text,
      'repost_payment_fx_inv',
      null,
      'posted',
      v_currency,
      v_rate,
      v_amount_fx,
      r.document_id,
      r.branch_id,
      r.company_id
    )
    returning id into v_fix_id;

    if r.direction = 'in' and r.reference_table = 'orders' then
      begin
        v_order_id := nullif(r.reference_id, '')::uuid;
      exception when others then
        v_order_id := null;
      end;

      if v_order_id is not null then
        insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo, currency_code, fx_rate, foreign_amount)
        values
          (v_fix_id, v_debit_account, v_amount_base, 0, 'Cash/Bank received (fx inv fix)', v_cash_fx_code, v_cash_fx_rate, v_cash_fx_amount),
          (v_fix_id, v_ar, 0, v_amount_base, 'Settle receivable (fx inv fix)', null, null, null);
        perform public.check_journal_entry_balance(v_fix_id);
        continue;
      end if;
    end if;

    if r.direction = 'in' then
      insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo, currency_code, fx_rate, foreign_amount)
      values
        (v_fix_id, v_debit_account, v_amount_base, 0, 'Cash/Bank received (fx inv fix)', v_cash_fx_code, v_cash_fx_rate, v_cash_fx_amount),
        (v_fix_id, v_deposits, 0, v_amount_base, 'Customer deposit (fx inv fix)', null, null, null);
      perform public.check_journal_entry_balance(v_fix_id);
      continue;
    end if;

    if r.direction = 'out' and r.reference_table = 'purchase_orders' then
      insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo, currency_code, fx_rate, foreign_amount)
      values
        (v_fix_id, v_ap, v_amount_base, 0, 'Settle payable (fx inv fix)', null, null, null),
        (v_fix_id, v_credit_account, 0, v_amount_base, 'Pay supplier (fx inv fix)', v_cash_fx_code, v_cash_fx_rate, v_cash_fx_amount);
      perform public.check_journal_entry_balance(v_fix_id);
      continue;
    end if;

    if r.direction = 'out' and r.reference_table = 'expenses' then
      insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo, currency_code, fx_rate, foreign_amount)
      values
        (v_fix_id, v_expenses, v_amount_base, 0, 'Operating expense (fx inv fix)', null, null, null),
        (v_fix_id, v_credit_account, 0, v_amount_base, 'Cash/Bank paid (fx inv fix)', v_cash_fx_code, v_cash_fx_rate, v_cash_fx_amount);
      perform public.check_journal_entry_balance(v_fix_id);
      continue;
    end if;

    if r.direction = 'out' and r.reference_table = 'import_expenses' then
      insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo, currency_code, fx_rate, foreign_amount)
      values
        (v_fix_id, v_clearing, v_amount_base, 0, 'Landed cost service (fx inv fix)', null, null, null),
        (v_fix_id, v_credit_account, 0, v_amount_base, 'Cash/Bank paid (fx inv fix)', v_cash_fx_code, v_cash_fx_rate, v_cash_fx_amount);
      perform public.check_journal_entry_balance(v_fix_id);
      continue;
    end if;
  end loop;

  for r in
    select
      o.id as order_id,
      je.id as entry_id,
      je.entry_date,
      je.source_event,
      je.document_id,
      je.branch_id,
      je.company_id,
      upper(coalesce(nullif(btrim(o.currency),''), nullif(btrim(o.data->>'currency'),''), v_base)) as currency,
      coalesce(o.fx_rate, 0) as fx_rate,
      o.data as order_data
    from public.orders o
    join public.journal_entries je
      on je.source_table = 'orders'
     and je.source_id = o.id::text
     and je.source_event in ('delivered','invoiced')
    where upper(coalesce(nullif(btrim(o.currency),''), nullif(btrim(o.data->>'currency'),''), v_base)) <> upper(v_base)
      and coalesce(o.fx_rate, 0) > 0
  loop
    v_currency := r.currency;
    v_expected := public.get_fx_rate(v_currency, (r.entry_date::date), 'operational');
    if v_expected is null or v_expected <= 0 then
      continue;
    end if;

    v_inv := 1 / nullif(r.fx_rate, 0);
    if v_inv is null or v_inv <= 0 then
      continue;
    end if;

    v_ratio := abs(v_inv - v_expected) / v_expected;
    if v_ratio > 0.02 then
      continue;
    end if;

    if abs(r.fx_rate - v_expected) / v_expected <= 0.2 then
      continue;
    end if;

    begin
      v_total_foreign := coalesce(
        nullif((r.order_data->'invoiceSnapshot'->>'total')::numeric, null),
        nullif((r.order_data->>'total')::numeric, null),
        0
      );
    exception when others then
      v_total_foreign := 0;
    end;
    if v_total_foreign <= 0 then
      continue;
    end if;

    v_rate := v_expected;
    v_total_base := public._money_round(v_total_foreign * v_rate);
    if v_total_base <= 0 then
      continue;
    end if;

    begin
      v_delivery_base := coalesce(nullif((r.order_data->'invoiceSnapshot'->>'deliveryFee')::numeric, null), nullif((r.order_data->>'deliveryFee')::numeric, null), 0) * v_rate;
    exception when others then
      v_delivery_base := 0;
    end;
    begin
      v_tax_base := coalesce(nullif((r.order_data->'invoiceSnapshot'->>'taxAmount')::numeric, null), nullif((r.order_data->>'taxAmount')::numeric, null), 0) * v_rate;
    exception when others then
      v_tax_base := 0;
    end;
    v_tax_base := least(greatest(0, v_tax_base), v_total_base);
    v_delivery_base := least(greatest(0, v_delivery_base), v_total_base - v_tax_base);

    v_cutoff := r.entry_date;
    select coalesce(sum(coalesce(p.base_amount, 0)), 0)
    into v_deposits_paid_base
    from public.payments p
    where p.reference_table = 'orders'
      and p.reference_id = r.order_id::text
      and p.direction = 'in'
      and p.occurred_at < coalesce(v_cutoff, now());
    v_deposits_paid_base := least(v_total_base, greatest(0, coalesce(v_deposits_paid_base, 0)));
    v_ar_amount_base := greatest(0, v_total_base - v_deposits_paid_base);

    v_rev_source_id := public.uuid_from_text(concat('fxinv:orders:rev:', r.entry_id::text));
    v_fix_source_id := public.uuid_from_text(concat('fxinv:orders:repost:', r.entry_id::text));

    if exists (
      select 1
      from public.journal_entries je2
      where je2.source_table = 'ledger_repairs'
        and je2.source_id = v_fix_source_id::text
        and je2.source_event = 'repost_order_fx_inv'
    ) then
      continue;
    end if;

    insert into public.journal_entries(entry_date, memo, source_table, source_id, source_event, created_by, status, document_id, branch_id, company_id)
    values (
      r.entry_date,
      concat('Reverse (fx inv fix) order ', r.order_id::text, ' ', r.source_event),
      'ledger_repairs',
      v_rev_source_id::text,
      'reverse_order_fx_inv',
      null,
      'posted',
      r.document_id,
      r.branch_id,
      r.company_id
    )
    returning id into v_rev_id;

    insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo)
    select v_rev_id, jl.account_id, jl.credit, jl.debit, concat('Reverse ', coalesce(jl.line_memo,''))
    from public.journal_lines jl
    where jl.journal_entry_id = r.entry_id;

    perform public.check_journal_entry_balance(v_rev_id);

    insert into public.journal_entries(entry_date, memo, source_table, source_id, source_event, created_by, status, currency_code, fx_rate, foreign_amount, document_id, branch_id, company_id)
    values (
      r.entry_date,
      concat('Repost (fx inv fix) order ', r.order_id::text, ' ', r.source_event),
      'ledger_repairs',
      v_fix_source_id::text,
      'repost_order_fx_inv',
      null,
      'posted',
      v_currency,
      v_rate,
      v_total_foreign,
      r.document_id,
      r.branch_id,
      r.company_id
    )
    returning id into v_fix_id;

    if v_deposits_paid_base > 0 and v_deposits is not null then
      insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo)
      values (v_fix_id, v_deposits, v_deposits_paid_base, 0, 'Apply customer deposit (fx inv fix)');
    end if;
    if v_ar_amount_base > 0 and v_ar is not null then
      insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo)
      values (v_fix_id, v_ar, v_ar_amount_base, 0, 'Accounts receivable (fx inv fix)');
    end if;
    if (v_total_base - v_delivery_base - v_tax_base) > 0 and v_sales is not null then
      insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo)
      values (v_fix_id, v_sales, 0, (v_total_base - v_delivery_base - v_tax_base), 'Sales revenue (fx inv fix)');
    end if;
    if v_delivery_base > 0 and v_delivery_income is not null then
      insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo)
      values (v_fix_id, v_delivery_income, 0, v_delivery_base, 'Delivery income (fx inv fix)');
    end if;
    if v_tax_base > 0 and v_vat_payable is not null then
      insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo)
      values (v_fix_id, v_vat_payable, 0, v_tax_base, 'VAT payable (fx inv fix)');
    end if;

    perform public.check_journal_entry_balance(v_fix_id);
    if r.source_event = 'invoiced' then
      perform public.sync_ar_on_invoice(r.order_id);
    end if;
  end loop;
end $$;

notify pgrst, 'reload schema';

