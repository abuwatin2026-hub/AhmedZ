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

  v_fx numeric;
  v_currency text;

  v_returns_line numeric;
  v_tax_line numeric;
  v_refund_credit numeric;
  v_refund_account uuid;

  v_returns_fx numeric;
  v_returns_base numeric;
  v_tax_fx numeric;
  v_tax_base numeric;
  v_total_fx numeric;
  v_total_base numeric;

  v_cash_credit numeric;
  v_bank_credit numeric;
  v_ar_credit numeric;
  v_dep_credit numeric;

  v_rev_id uuid;
  v_fix_id uuid;
  v_rev_source_id text;
  v_repost_source_id text;
begin
  for r in
    select
      je.id as entry_id,
      je.entry_date,
      je.source_id as return_id_text,
      sr.id as return_id,
      sr.order_id,
      sr.total_refund_amount as return_subtotal_fx,
      sr.refund_method
    from public.journal_entries je
    join public.sales_returns sr on sr.id::text = je.source_id
    where je.source_table = 'sales_returns'
      and je.source_event = 'processed'
  loop
    select * into v_order from public.orders o where o.id = r.order_id;
    if not found then
      continue;
    end if;

    v_currency := upper(coalesce(nullif(btrim(coalesce(v_order.currency, v_order.data->>'currency', v_base)), ''), v_base));
    if v_currency = v_base then
      continue;
    end if;

    begin
      v_fx := coalesce(nullif(v_order.fx_rate, 0), nullif((v_order.data->>'fxRate')::numeric, null));
    exception when others then
      v_fx := null;
    end;
    if v_fx is null or v_fx <= 0 then
      continue;
    end if;

    v_returns_fx := coalesce(nullif(r.return_subtotal_fx, null), 0);
    if v_returns_fx <= 0 then
      continue;
    end if;

    select
      coalesce(sum(coalesce(jl.debit,0) - coalesce(jl.credit,0)), 0)
    into v_returns_line
    from public.journal_lines jl
    where jl.journal_entry_id = r.entry_id
      and jl.account_id = v_sales_returns;

    if abs(coalesce(v_returns_line, 0) - (v_returns_fx * v_fx)) <= 0.01 then
      continue;
    end if;

    if abs(coalesce(v_returns_line, 0) - v_returns_fx) > 0.01 then
      continue;
    end if;

    if exists (
      select 1
      from public.journal_entries je2
      where je2.source_table = 'ledger_repairs'
        and je2.source_id = public.uuid_from_text(concat('sales_return:legacy:', r.entry_id::text, ':repost:v3'))::text
        and je2.source_event = 'repost_sales_return'
    ) then
      continue;
    end if;

    v_rev_source_id := public.uuid_from_text(concat('sales_return:legacy:', r.entry_id::text, ':reversal:v4'))::text;
    v_repost_source_id := public.uuid_from_text(concat('sales_return:legacy:', r.entry_id::text, ':repost:v4'))::text;

    if exists (
      select 1
      from public.journal_entries je2
      where je2.source_table = 'ledger_repairs'
        and je2.source_id = v_repost_source_id
        and je2.source_event = 'repost_sales_return'
    ) then
      continue;
    end if;

    select
      coalesce(sum(coalesce(jl.debit,0) - coalesce(jl.credit,0)), 0)
    into v_tax_line
    from public.journal_lines jl
    where jl.journal_entry_id = r.entry_id
      and jl.account_id = v_vat_payable;

    v_tax_fx := greatest(0, coalesce(v_tax_line, 0));
    v_total_fx := public._money_round(v_returns_fx + v_tax_fx);

    v_returns_base := public._money_round(v_returns_fx * v_fx);
    v_tax_base := public._money_round(v_tax_fx * v_fx);
    v_total_base := public._money_round(v_returns_base + v_tax_base);

    v_refund_account := null;
    v_refund_credit := 0;
    select
      case when v_cash is not null then coalesce(sum(case when jl.account_id = v_cash then coalesce(jl.credit,0) - coalesce(jl.debit,0) else 0 end), 0) else 0 end,
      case when v_bank is not null then coalesce(sum(case when jl.account_id = v_bank then coalesce(jl.credit,0) - coalesce(jl.debit,0) else 0 end), 0) else 0 end,
      case when v_ar is not null then coalesce(sum(case when jl.account_id = v_ar then coalesce(jl.credit,0) - coalesce(jl.debit,0) else 0 end), 0) else 0 end,
      case when v_deposits is not null then coalesce(sum(case when jl.account_id = v_deposits then coalesce(jl.credit,0) - coalesce(jl.debit,0) else 0 end), 0) else 0 end
    into
      v_cash_credit,
      v_bank_credit,
      v_ar_credit,
      v_dep_credit
    from public.journal_lines jl
    where jl.journal_entry_id = r.entry_id;

    if coalesce(v_cash_credit,0) > v_refund_credit then
      v_refund_credit := v_cash_credit;
      v_refund_account := v_cash;
    end if;
    if coalesce(v_bank_credit,0) > v_refund_credit then
      v_refund_credit := v_bank_credit;
      v_refund_account := v_bank;
    end if;
    if coalesce(v_ar_credit,0) > v_refund_credit then
      v_refund_credit := v_ar_credit;
      v_refund_account := v_ar;
    end if;
    if coalesce(v_dep_credit,0) > v_refund_credit then
      v_refund_credit := v_dep_credit;
      v_refund_account := v_deposits;
    end if;
    if v_refund_account is null then
      v_refund_account := v_cash;
    end if;

    insert into public.journal_entries(entry_date, memo, source_table, source_id, source_event, created_by, status)
    values (
      r.entry_date,
      concat('REVERSAL (v4) of legacy sales return entry ', r.entry_id::text),
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
      concat('Reversal v4: ', coalesce(jl.line_memo,'')),
      jl.currency_code,
      jl.fx_rate,
      jl.foreign_amount
    from public.journal_lines jl
    where jl.journal_entry_id = r.entry_id;

    perform public.check_journal_entry_balance(v_rev_id);

    insert into public.journal_entries(entry_date, memo, source_table, source_id, source_event, created_by, status, currency_code, fx_rate, foreign_amount)
    values (
      r.entry_date,
      concat('Repost (v4) sales return (base fix) ', r.return_id::text),
      'ledger_repairs',
      v_repost_source_id,
      'repost_sales_return',
      null,
      'posted',
      v_currency,
      v_fx,
      v_total_fx
    )
    returning id into v_fix_id;

    insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo)
    values (v_fix_id, v_sales_returns, v_returns_base, 0, 'Sales return (base v4)');

    if v_tax_base > 0 then
      insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo)
      values (v_fix_id, v_vat_payable, v_tax_base, 0, 'Reverse VAT payable (base v4)');
    end if;

    insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo, currency_code, fx_rate, foreign_amount)
    values (v_fix_id, v_refund_account, 0, v_total_base, 'Refund (base v4)', v_currency, v_fx, v_total_fx);

    perform public.check_journal_entry_balance(v_fix_id);
  end loop;
end $$;

notify pgrst, 'reload schema';
