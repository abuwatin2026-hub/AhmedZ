set app.allow_ledger_ddl = '1';

do $$
declare
  v_base text;
  r record;
  r_fix record;

  v_expected numeric;
  v_inv numeric;
  v_ratio numeric;

  v_fix_id uuid;
  v_rev_id uuid;
  v_undo_id uuid;
  v_fix_source_id uuid;
  v_rev_source_id uuid;
  v_undo_source_id uuid;

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
  v_delivered_at timestamptz;
  v_source_entry_id uuid;
  v_original_ar_base numeric := 0;
  v_settled_ar_base numeric := 0;
  v_outstanding_base numeric := 0;
  v_settle_base numeric := 0;
  v_diff numeric := 0;

  v_po_id uuid;
  v_has_accrual boolean := false;
begin
  perform set_config('request.jwt.claims', '', true);

  v_base := public.get_base_currency();

  v_cash := public.get_account_id_by_code('1010');
  v_bank := public.get_account_id_by_code('1020');
  v_ar := public.get_account_id_by_code('1200');
  v_deposits := public.get_account_id_by_code('2050');
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

    for r_fix in
      select je_fix.id as fix_entry_id
      from public.journal_entries je_fix
      where je_fix.source_table = 'ledger_repairs'
        and je_fix.source_event in ('reverse_payment_fx_inv','repost_payment_fx_inv')
        and je_fix.memo ~ ('payment ' || r.payment_id::text)
        and je_fix.entry_date = r.occurred_at
    loop
      v_undo_source_id := public.uuid_from_text(concat('fxinv2:payments:undo:', r_fix.fix_entry_id::text));
      if exists (
        select 1
        from public.journal_entries je_u
        where je_u.source_table = 'ledger_repairs'
          and je_u.source_id = v_undo_source_id::text
          and je_u.source_event = 'undo_payment_fx_inv_v1'
      ) then
        continue;
      end if;

      insert into public.journal_entries(entry_date, memo, source_table, source_id, source_event, created_by, status, document_id, branch_id, company_id)
      values (
        r.occurred_at,
        concat('Undo (fx inv fix v1) entry ', r_fix.fix_entry_id::text),
        'ledger_repairs',
        v_undo_source_id::text,
        'undo_payment_fx_inv_v1',
        null,
        'posted',
        r.document_id,
        r.branch_id,
        r.company_id
      )
      returning id into v_undo_id;

      insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo, currency_code, fx_rate, foreign_amount)
      select v_undo_id, jl.account_id, jl.credit, jl.debit, 'Undo v1', jl.currency_code, jl.fx_rate, jl.foreign_amount
      from public.journal_lines jl
      where jl.journal_entry_id = r_fix.fix_entry_id;

      perform public.check_journal_entry_balance(v_undo_id);
    end loop;

    v_rev_source_id := public.uuid_from_text(concat('fxinv2:payments:rev:', r.entry_id::text));
    v_fix_source_id := public.uuid_from_text(concat('fxinv2:payments:repost:', r.entry_id::text));

    if exists (
      select 1
      from public.journal_entries je2
      where je2.source_table = 'ledger_repairs'
        and je2.source_id = v_fix_source_id::text
        and je2.source_event = 'repost_payment_fx_inv_v2'
    ) then
      continue;
    end if;

    insert into public.journal_entries(entry_date, memo, source_table, source_id, source_event, created_by, status, document_id, branch_id, company_id)
    values (
      r.occurred_at,
      concat('Reverse (fx inv fix v2) payment ', r.payment_id::text),
      'ledger_repairs',
      v_rev_source_id::text,
      'reverse_payment_fx_inv_v2',
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
      concat('Repost (fx inv fix v2) payment ', r.direction, ' ', r.reference_table, ':', r.reference_id),
      'ledger_repairs',
      v_fix_source_id::text,
      'repost_payment_fx_inv_v2',
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

      if v_order_id is null then
        insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo, currency_code, fx_rate, foreign_amount)
        values
          (v_fix_id, v_debit_account, v_amount_base, 0, 'Cash/Bank received (fx inv fix v2)', v_cash_fx_code, v_cash_fx_rate, v_cash_fx_amount),
          (v_fix_id, v_deposits, 0, v_amount_base, 'Customer deposit (fx inv fix v2)', null, null, null);
        perform public.check_journal_entry_balance(v_fix_id);
        continue;
      end if;

      v_delivered_at := public.order_delivered_at(v_order_id);
      if v_delivered_at is null or r.occurred_at < v_delivered_at then
        insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo, currency_code, fx_rate, foreign_amount)
        values
          (v_fix_id, v_debit_account, v_amount_base, 0, 'Cash/Bank received (fx inv fix v2)', v_cash_fx_code, v_cash_fx_rate, v_cash_fx_amount),
          (v_fix_id, v_deposits, 0, v_amount_base, 'Customer deposit (fx inv fix v2)', null, null, null);
        perform public.check_journal_entry_balance(v_fix_id);
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
        select coalesce(sum(jl.debit), 0) - coalesce(sum(jl.credit), 0)
        into v_original_ar_base
        from public.journal_lines jl
        join public.journal_entries je on je.id = jl.journal_entry_id
        where je.source_table = 'ledger_repairs'
          and je.source_event in ('repost_order_fx_inv','repost_order_fx')
          and je.memo ~ ('order ' || v_order_id::text)
          and jl.account_id = v_ar
        order by je.entry_date desc
        limit 1;

        v_original_ar_base := coalesce(v_original_ar_base, 0);
        if v_original_ar_base <= 0 then
          select coalesce(o.base_total, 0) into v_original_ar_base
          from public.orders o where o.id = v_order_id;
        end if;
      else
        select coalesce(sum(jl.debit), 0) - coalesce(sum(jl.credit), 0)
        into v_original_ar_base
        from public.journal_lines jl
        where jl.journal_entry_id = v_source_entry_id
          and jl.account_id = v_ar;
      end if;

      select coalesce(sum(jl.credit), 0) - coalesce(sum(jl.debit), 0)
      into v_settled_ar_base
      from public.payments p2
      join public.journal_entries je2
        on je2.source_table = 'payments'
       and je2.source_id = p2.id::text
      join public.journal_lines jl
        on jl.journal_entry_id = je2.id
      where p2.reference_table = 'orders'
        and p2.direction = 'in'
        and p2.reference_id = v_order_id::text
        and p2.id <> r.payment_id
        and jl.account_id = v_ar;

      v_outstanding_base := greatest(0, coalesce(v_original_ar_base, 0) - coalesce(v_settled_ar_base, 0));

      if v_outstanding_base <= 0 then
        insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo, currency_code, fx_rate, foreign_amount)
        values
          (v_fix_id, v_debit_account, v_amount_base, 0, 'Cash/Bank received (fx inv fix v2)', v_cash_fx_code, v_cash_fx_rate, v_cash_fx_amount),
          (v_fix_id, v_deposits, 0, v_amount_base, 'Customer deposit (fx inv fix v2)', null, null, null);
        perform public.check_journal_entry_balance(v_fix_id);
        continue;
      end if;

      v_settle_base := v_outstanding_base;
      v_diff := v_amount_base - v_settle_base;

      insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo, currency_code, fx_rate, foreign_amount)
      values
        (v_fix_id, v_debit_account, v_amount_base, 0, 'Receive payment (fx inv fix v2)', v_cash_fx_code, v_cash_fx_rate, v_cash_fx_amount),
        (v_fix_id, v_ar, 0, v_settle_base, 'Settle receivable (fx inv fix v2)', null, null, null);

      if abs(v_diff) > 0.0000001 then
        if v_diff > 0 then
          insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo)
          values (v_fix_id, v_fx_gain, 0, abs(v_diff), 'FX Gain realized (fx inv fix v2)');
        else
          insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo)
          values (v_fix_id, v_fx_loss, abs(v_diff), 0, 'FX Loss realized (fx inv fix v2)');
        end if;
      end if;

      perform public.check_journal_entry_balance(v_fix_id);
      continue;
    end if;

    if r.direction = 'out' and r.reference_table = 'purchase_orders' then
      begin
        v_po_id := nullif(r.reference_id, '')::uuid;
      exception when others then
        v_po_id := null;
      end;

      if v_po_id is null then
        insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo, currency_code, fx_rate, foreign_amount)
        values
          (v_fix_id, v_ap, v_amount_base, 0, 'Settle payable (fx inv fix v2)', null, null, null),
          (v_fix_id, v_credit_account, 0, v_amount_base, 'Pay supplier (fx inv fix v2)', v_cash_fx_code, v_cash_fx_rate, v_cash_fx_amount);
        perform public.check_journal_entry_balance(v_fix_id);
        continue;
      end if;

      select greatest(0, coalesce(po.base_total, 0) - coalesce((
        select sum(coalesce(p3.base_amount, 0))
        from public.payments p3
        where p3.reference_table = 'purchase_orders'
          and p3.direction = 'out'
          and p3.reference_id = v_po_id::text
          and p3.id <> r.payment_id
          and p3.occurred_at <= r.occurred_at
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
        (v_fix_id, v_ap, v_settle_base, 0, 'Settle payable (fx inv fix v2)', null, null, null),
        (v_fix_id, v_credit_account, 0, v_amount_base, 'Pay supplier (fx inv fix v2)', v_cash_fx_code, v_cash_fx_rate, v_cash_fx_amount);

      if abs(v_diff) > 0.0000001 then
        if v_diff > 0 then
          insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo)
          values (v_fix_id, v_fx_loss, abs(v_diff), 0, 'FX Loss realized (fx inv fix v2)');
        else
          insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo)
          values (v_fix_id, v_fx_gain, 0, abs(v_diff), 'FX Gain realized (fx inv fix v2)');
        end if;
      end if;

      perform public.check_journal_entry_balance(v_fix_id);
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
          (v_fix_id, v_ap, v_amount_base, 0, 'Settle payable (fx inv fix v2)', null, null, null),
          (v_fix_id, v_credit_account, 0, v_amount_base, 'Cash/Bank paid (fx inv fix v2)', v_cash_fx_code, v_cash_fx_rate, v_cash_fx_amount);
      else
        insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo, currency_code, fx_rate, foreign_amount)
        values
          (v_fix_id, v_expenses, v_amount_base, 0, 'Operating expense (fx inv fix v2)', null, null, null),
          (v_fix_id, v_credit_account, 0, v_amount_base, 'Cash/Bank paid (fx inv fix v2)', v_cash_fx_code, v_cash_fx_rate, v_cash_fx_amount);
      end if;

      perform public.check_journal_entry_balance(v_fix_id);
      continue;
    end if;

    if r.direction = 'out' and r.reference_table = 'import_expenses' then
      v_has_accrual := exists(
        select 1 from public.journal_entries je
        where je.source_table = 'import_expenses'
          and je.source_id = coalesce(r.reference_id, '')
          and je.source_event = 'accrual'
      );

      if v_has_accrual then
        insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo, currency_code, fx_rate, foreign_amount)
        values
          (v_fix_id, v_ap, v_amount_base, 0, 'Settle payable (fx inv fix v2)', null, null, null),
          (v_fix_id, v_credit_account, 0, v_amount_base, 'Cash/Bank paid (fx inv fix v2)', v_cash_fx_code, v_cash_fx_rate, v_cash_fx_amount);
      else
        insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo, currency_code, fx_rate, foreign_amount)
        values
          (v_fix_id, v_clearing, v_amount_base, 0, 'Landed cost service (fx inv fix v2)', null, null, null),
          (v_fix_id, v_credit_account, 0, v_amount_base, 'Cash/Bank paid (fx inv fix v2)', v_cash_fx_code, v_cash_fx_rate, v_cash_fx_amount);
      end if;

      perform public.check_journal_entry_balance(v_fix_id);
      continue;
    end if;
  end loop;
end $$;

notify pgrst, 'reload schema';

