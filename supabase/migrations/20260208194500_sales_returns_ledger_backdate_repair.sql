set request.jwt.claims = '';
set app.allow_ledger_ddl = '1';
set app.accounting_bypass = '1';

create or replace function public._is_migration_actor()
returns boolean
language sql
stable
as $$
  select
    (current_user in ('postgres','supabase_admin') or session_user in ('postgres','supabase_admin'))
    and coalesce(nullif(current_setting('request.jwt.claims', true), ''), '') = '';
$$;

do $$
declare
  v_base text := public.get_base_currency();
  v_cash uuid := public.get_account_id_by_code('1010');
  v_bank uuid := public.get_account_id_by_code('1020');
  v_ar uuid := public.get_account_id_by_code('1200');
  v_deposits uuid := public.get_account_id_by_code('2050');
  v_sales_returns uuid := public.get_account_id_by_code('4026');
  v_vat_payable uuid := public.get_account_id_by_code('2020');

  r record;
  v_order record;
  v_ret record;
  v_src_debit numeric;
  v_src_credit numeric;
  v_src_count int;

  v_currency text;
  v_fx numeric;
  v_order_subtotal numeric;
  v_order_discount numeric;
  v_order_net_subtotal numeric;
  v_order_tax numeric;
  v_return_subtotal_fx numeric;
  v_tax_refund_fx numeric;
  v_total_refund_fx numeric;
  v_return_subtotal_base numeric;
  v_tax_refund_base numeric;
  v_total_refund_base numeric;
  v_refund_method text;
  v_cash_fx_code text;
  v_cash_fx_rate numeric;
  v_cash_fx_amount numeric;

  v_rev_id uuid;
  v_fix_id uuid;
  v_rev_source_id text;
  v_repost_source_id text;
  v_pay_rev_source_id text;
begin
  for r in
    select
      je.id as entry_id,
      je.entry_date,
      je.source_event,
      sr.id as return_id,
      sr.order_id,
      sr.return_date,
      sr.refund_method,
      sr.total_refund_amount
    from public.journal_entries je
    join public.sales_returns sr
      on sr.id::text = je.source_id
    where je.source_table = 'sales_returns'
  loop
    select * into v_order from public.orders o where o.id = r.order_id;
    if not found then
      continue;
    end if;
    select * into v_ret from public.sales_returns x where x.id = r.return_id;
    if not found then
      continue;
    end if;

    select
      coalesce(sum(jl.debit), 0),
      coalesce(sum(jl.credit), 0),
      count(1)
    into v_src_debit, v_src_credit, v_src_count
    from public.journal_lines jl
    where jl.journal_entry_id = r.entry_id;

    if v_src_count < 2 or abs(coalesce(v_src_debit, 0) - coalesce(v_src_credit, 0)) > 1e-6 then
      continue;
    end if;

    v_currency := upper(coalesce(nullif(btrim(coalesce(v_order.currency, v_order.data->>'currency', v_base)), ''), v_base));
    begin
      v_fx := coalesce(v_order.fx_rate, nullif((v_order.data->>'fxRate')::numeric, null), 1);
    exception when others then
      v_fx := 1;
    end;
    if v_fx is null or v_fx <= 0 then
      continue;
    end if;

    if v_currency = v_base then
      continue;
    end if;

    v_order_subtotal := coalesce(nullif((v_order.data->>'subtotal')::numeric, null), coalesce(v_order.subtotal, 0), 0);
    v_order_discount := coalesce(nullif((v_order.data->>'discountAmount')::numeric, null), coalesce(v_order.discount, 0), 0);
    v_order_net_subtotal := greatest(0, v_order_subtotal - v_order_discount);
    v_order_tax := coalesce(nullif((v_order.data->>'taxAmount')::numeric, null), coalesce(v_order.tax_amount, 0), 0);

    v_return_subtotal_fx := coalesce(nullif(v_ret.total_refund_amount, null), 0);
    if v_return_subtotal_fx <= 0 then
      continue;
    end if;

    v_tax_refund_fx := 0;
    if v_order_net_subtotal > 0 and v_order_tax > 0 then
      v_tax_refund_fx := least(v_order_tax, (v_return_subtotal_fx / v_order_net_subtotal) * v_order_tax);
    end if;
    v_total_refund_fx := public._money_round(v_return_subtotal_fx + v_tax_refund_fx);

    v_return_subtotal_base := v_return_subtotal_fx * v_fx;
    v_tax_refund_base := v_tax_refund_fx * v_fx;
    v_total_refund_base := public._money_round(v_return_subtotal_base + v_tax_refund_base);

    if not (abs(coalesce(v_src_debit, 0) - v_total_refund_fx) <= 0.01 and abs(coalesce(v_src_debit, 0) - v_total_refund_base) > 0.01) then
      continue;
    end if;

    v_rev_source_id := public.uuid_from_text(concat('sales_return:legacy:', r.entry_id::text, ':reversal:v3'))::text;
    v_repost_source_id := public.uuid_from_text(concat('sales_return:legacy:', r.entry_id::text, ':repost:v3'))::text;

    if not exists (
      select 1
      from public.journal_entries je2
      where je2.source_table = 'ledger_repairs'
        and je2.source_id = v_rev_source_id
        and je2.source_event = 'reversal'
    ) then
      insert into public.journal_entries(entry_date, memo, source_table, source_id, source_event, created_by, status)
      values (
        r.entry_date,
        concat('REVERSAL (v3) of legacy sales return entry ', r.entry_id::text),
        'ledger_repairs',
        v_rev_source_id,
        'reversal',
        null,
        'posted'
      )
      returning id into v_rev_id;

      insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo, currency_code, fx_rate, foreign_amount)
      select
        v_rev_id,
        jl.account_id,
        jl.credit,
        jl.debit,
        concat('Reversal v3: ', coalesce(jl.line_memo,'')),
        jl.currency_code,
        jl.fx_rate,
        jl.foreign_amount
      from public.journal_lines jl
      where jl.journal_entry_id = r.entry_id;

      perform public.check_journal_entry_balance(v_rev_id);
    end if;

    if not exists (
      select 1
      from public.journal_entries je2
      where je2.source_table = 'ledger_repairs'
        and je2.source_id = v_repost_source_id
        and je2.source_event = 'repost_sales_return'
    ) then
      v_refund_method := coalesce(nullif(trim(coalesce(v_ret.refund_method, '')), ''), 'cash');
      if v_refund_method in ('bank', 'bank_transfer') then
        v_refund_method := 'kuraimi';
      elsif v_refund_method in ('card', 'online') then
        v_refund_method := 'network';
      end if;

      v_cash_fx_code := v_currency;
      v_cash_fx_rate := v_fx;
      v_cash_fx_amount := v_total_refund_fx;

      insert into public.journal_entries(entry_date, memo, source_table, source_id, source_event, created_by, status, currency_code, fx_rate, foreign_amount)
      values (
        r.entry_date,
        concat('Repost (v3) sales return (base fix) ', r.return_id::text),
        'ledger_repairs',
        v_repost_source_id,
        'repost_sales_return',
        null,
        'posted',
        v_currency,
        v_fx,
        v_total_refund_fx
      )
      returning id into v_fix_id;

      insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo)
      values (v_fix_id, v_sales_returns, public._money_round(v_return_subtotal_base), 0, 'Sales return (base v3)');

      if v_tax_refund_base > 0 then
        insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo)
        values (v_fix_id, v_vat_payable, public._money_round(v_tax_refund_base), 0, 'Reverse VAT payable (base v3)');
      end if;

      if v_refund_method = 'cash' then
        insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo, currency_code, fx_rate, foreign_amount)
        values (v_fix_id, v_cash, 0, v_total_refund_base, 'Cash refund (base v3)', v_cash_fx_code, v_cash_fx_rate, v_cash_fx_amount);
      elsif v_refund_method in ('network','kuraimi') then
        insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo, currency_code, fx_rate, foreign_amount)
        values (v_fix_id, v_bank, 0, v_total_refund_base, 'Bank refund (base v3)', v_cash_fx_code, v_cash_fx_rate, v_cash_fx_amount);
      elsif v_refund_method = 'ar' then
        insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo)
        values (v_fix_id, v_ar, 0, v_total_refund_base, 'Reduce accounts receivable (base v3)');
      elsif v_refund_method = 'store_credit' then
        insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo)
        values (v_fix_id, v_deposits, 0, v_total_refund_base, 'Increase customer deposit (base v3)');
      else
        insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo, currency_code, fx_rate, foreign_amount)
        values (v_fix_id, v_cash, 0, v_total_refund_base, 'Cash refund (base v3)', v_cash_fx_code, v_cash_fx_rate, v_cash_fx_amount);
      end if;

      perform public.check_journal_entry_balance(v_fix_id);
    end if;
  end loop;

  for r in
    select
      je.id as entry_id,
      je.entry_date
    from public.journal_entries je
    join public.payments p on p.id::text = je.source_id
    where je.source_table = 'payments'
      and p.reference_table = 'sales_returns'
  loop
    v_pay_rev_source_id := public.uuid_from_text(concat('sales_return:refund_payment:', r.entry_id::text, ':reversal:v3'))::text;

    if exists (
      select 1
      from public.journal_entries je2
      where je2.source_table = 'ledger_repairs'
        and je2.source_id = v_pay_rev_source_id
        and je2.source_event = 'reversal'
    ) then
      continue;
    end if;

    select
      coalesce(sum(jl.debit), 0),
      coalesce(sum(jl.credit), 0),
      count(1)
    into v_src_debit, v_src_credit, v_src_count
    from public.journal_lines jl
    where jl.journal_entry_id = r.entry_id;

    if v_src_count < 2 or abs(coalesce(v_src_debit, 0) - coalesce(v_src_credit, 0)) > 1e-6 then
      continue;
    end if;

    insert into public.journal_entries(entry_date, memo, source_table, source_id, source_event, created_by, status)
    values (
      r.entry_date,
      concat('REVERSAL (v3) of legacy refund payment entry ', r.entry_id::text),
      'ledger_repairs',
      v_pay_rev_source_id,
      'reversal',
      null,
      'posted'
    )
    returning id into v_rev_id;

    insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo, currency_code, fx_rate, foreign_amount)
    select
      v_rev_id,
      jl.account_id,
      jl.credit,
      jl.debit,
      concat('Reversal v3: ', coalesce(jl.line_memo,'')),
      jl.currency_code,
      jl.fx_rate,
      jl.foreign_amount
    from public.journal_lines jl
    where jl.journal_entry_id = r.entry_id;

    perform public.check_journal_entry_balance(v_rev_id);
  end loop;
end $$;

notify pgrst, 'reload schema';
