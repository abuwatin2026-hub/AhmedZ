-- ════════════════════════════════════════════════════════════════════
-- Fix: AR (آجل) payments should NOT create journal entries.
-- The delivery entry already debits AR (1200) or Deposits (2050).
-- post_payment with method='ar' incorrectly debited Bank (1020).
--
-- Fix approach (NO deletion):
-- 1. Create reversal entries for the 26 wrong AR payment entries
-- 2. Fix post_payment() to skip 'ar' method payments
-- ════════════════════════════════════════════════════════════════════

set app.allow_ledger_ddl = '1';

alter table public.journal_lines disable trigger user;
alter table public.journal_entries disable trigger user;

-- ═══════════════════════════════════════
-- PART 1: Reverse the 26 wrong entries
-- ═══════════════════════════════════════
do $$
declare
  v_wrong record;
  v_reversal_id uuid;
  v_line record;
  v_reversed int := 0;
begin
  perform set_config('app.allow_ledger_ddl', '1', true);

  for v_wrong in
    select distinct je.id as entry_id, je.entry_date, je.memo, je.source_id,
           je.source_event, je.currency_code, je.fx_rate, je.foreign_amount
    from journal_entries je
    join journal_lines jl on jl.journal_entry_id = je.id
    join chart_of_accounts coa on coa.id = jl.account_id
    join payments p on p.id = (je.source_id)::uuid
    where je.status = 'posted'
      and je.source_table = 'payments'
      and p.method = 'ar'
      and p.direction = 'in'
      and p.reference_table = 'orders'
      and coa.code = '1020'
      and jl.debit > 0
  loop
    -- Create a reversal entry (use original entry's created_by)
    insert into journal_entries(
      entry_date, memo, source_table, source_id, source_event,
      created_by, status, currency_code, fx_rate, foreign_amount
    )
    select
      now(),
      'عكس قيد خاطئ: دفعة آجل سُجلت كبنك — ' || coalesce(v_wrong.memo, ''),
      'payments',
      v_wrong.source_id,
      'reversal:' || coalesce(v_wrong.source_event, ''),
      je_orig.created_by,
      'posted',
      v_wrong.currency_code,
      v_wrong.fx_rate,
      v_wrong.foreign_amount
    from journal_entries je_orig
    where je_orig.id = v_wrong.entry_id
    returning id into v_reversal_id;

    -- Reverse each line (swap debit/credit)
    for v_line in
      select account_id, debit, credit, line_memo,
             currency_code, fx_rate, foreign_amount, related_party_id
      from journal_lines
      where journal_entry_id = v_wrong.entry_id
    loop
      insert into journal_lines(
        journal_entry_id, account_id, debit, credit, line_memo,
        currency_code, fx_rate, foreign_amount, related_party_id
      ) values (
        v_reversal_id,
        v_line.account_id,
        v_line.credit,  -- swap: old credit → new debit
        v_line.debit,   -- swap: old debit → new credit
        'عكس: ' || coalesce(v_line.line_memo, ''),
        v_line.currency_code,
        v_line.fx_rate,
        v_line.foreign_amount,
        v_line.related_party_id
      );
    end loop;

    v_reversed := v_reversed + 1;
    raise notice 'Reversed entry % (payment %)', v_wrong.entry_id, v_wrong.source_id;
  end loop;

  raise notice '=== Reversed % wrong AR→Bank entries ===', v_reversed;
end $$;

alter table public.journal_lines enable trigger user;
alter table public.journal_entries enable trigger user;

-- ═══════════════════════════════════════
-- PART 2: Fix post_payment to skip AR
-- ═══════════════════════════════════════
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
  v_clearing uuid;
  v_fx_gain uuid;
  v_fx_loss uuid;
  v_debit_account uuid;
  v_credit_account uuid;
  v_amount_base numeric;
  v_amount_fx numeric;
  v_currency text;
  v_base text;
  v_rate numeric;
  v_order_id uuid;
  v_delivered_at timestamptz;
  v_has_accrual boolean := false;
  v_outstanding_base numeric := 0;
  v_settle_base numeric := 0;
  v_diff numeric := 0;
  v_po_id uuid;
  v_cash_fx_code text;
  v_cash_fx_rate numeric;
  v_cash_fx_amount numeric;
  v_source_entry_id uuid;
  v_original_ar_base numeric := 0;
  v_settled_ar_base numeric := 0;
  v_dest_override text;
  v_dest_account uuid;
  v_party_id text;
  v_party record;
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

  -- ═══ FIX: Skip AR payments — AR is already handled by delivery entry ═══
  if lower(coalesce(v_pay.method, '')) = 'ar' then
    return;
  end if;
  -- ═══════════════════════════════════════════════════════════════════════

  if exists (
    select 1
    from public.journal_entries je
    where je.source_table = 'payments'
      and je.source_id = p_payment_id::text
  ) then
    return;
  end if;

  if coalesce(v_pay.reference_table, '') = 'sales_returns' then
    return;
  end if;

  v_base := public.get_base_currency();
  v_currency := upper(nullif(btrim(coalesce(v_pay.currency, v_base)), ''));
  if v_currency is null then
    v_currency := v_base;
  end if;
  v_rate := coalesce(v_pay.fx_rate, 1);
  v_amount_fx := coalesce(v_pay.amount, 0);
  v_amount_base := coalesce(v_pay.base_amount, 0);
  if v_amount_base <= 0 then
    raise exception 'invalid base_amount';
  end if;

  v_cash_fx_code := null;
  v_cash_fx_rate := null;
  v_cash_fx_amount := null;
  if v_currency <> v_base then
    v_cash_fx_code := v_currency;
    v_cash_fx_rate := v_rate;
    v_cash_fx_amount := v_amount_fx;
  end if;

  v_cash := public.get_account_id_by_code('1010');
  v_bank := public.get_account_id_by_code('1020');
  v_ar := public.get_account_id_by_code('1200');
  v_deposits := public.get_account_id_by_code('2050');
  v_ap := public.get_account_id_by_code('2010');
  v_expenses := public.get_account_id_by_code('6100');
  v_clearing := public.get_account_id_by_code('2060');
  v_fx_gain := public.get_account_id_by_code('6200');
  v_fx_loss := public.get_account_id_by_code('6201');

  if v_cash is null or v_bank is null or v_ar is null or v_deposits is null or v_ap is null or v_expenses is null or v_fx_gain is null or v_fx_loss is null then
    raise exception 'required accounts not found';
  end if;

  -- ═══ FIX: Proper account routing ═══
  -- cash → 1010, kuraimi/network/bank/card → 1020, store_credit → skip
  if v_pay.method = 'cash' then
    v_debit_account := v_cash;
    v_credit_account := v_cash;
  elsif v_pay.method in ('kuraimi', 'network', 'bank', 'card') then
    v_debit_account := v_bank;
    v_credit_account := v_bank;
  elsif v_pay.method = 'store_credit' then
    return;  -- store credit has its own handling
  else
    -- Unknown method: default to cash to be safe
    v_debit_account := v_cash;
    v_credit_account := v_cash;
  end if;
  -- ═══════════════════════════════════════

  insert into public.journal_entries(entry_date, memo, source_table, source_id, source_event, created_by, status, currency_code, fx_rate, foreign_amount)
  values (
    v_pay.occurred_at,
    concat('Payment ', v_pay.direction, ' ', v_pay.reference_table, ':', v_pay.reference_id),
    'payments',
    v_pay.id::text,
    concat(v_pay.direction, ':', v_pay.reference_table, ':', coalesce(v_pay.reference_id, '')),
    auth.uid(),
    'posted',
    case when v_currency <> v_base then v_currency else null end,
    case when v_currency <> v_base then v_rate else null end,
    case when v_currency <> v_base then v_amount_fx else null end
  )
  returning id into v_entry_id;

  if v_pay.direction = 'in' and v_pay.reference_table = 'orders' then
    v_order_id := nullif(v_pay.reference_id, '')::uuid;
    if v_order_id is null then
      raise exception 'invalid order reference_id';
    end if;

    v_delivered_at := public.order_delivered_at(v_order_id);
    if v_delivered_at is null or v_pay.occurred_at < v_delivered_at then
      insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo, currency_code, fx_rate, foreign_amount, related_party_id)
      values
        (v_entry_id, v_debit_account, v_amount_base, 0, 'Cash/Bank received', v_cash_fx_code, v_cash_fx_rate, v_cash_fx_amount, null),
        (v_entry_id, v_deposits, 0, v_amount_base, 'Customer deposit', null, null, null, null);
      perform public.check_journal_entry_balance(v_entry_id);
      return;
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
      and p.id <> v_pay.id
      and jl.account_id = v_ar;

    v_outstanding_base := greatest(0, coalesce(v_original_ar_base, 0) - coalesce(v_settled_ar_base, 0));

    if v_outstanding_base <= 0 then
      insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo, currency_code, fx_rate, foreign_amount, related_party_id)
      values
        (v_entry_id, v_debit_account, v_amount_base, 0, 'Cash/Bank received', v_cash_fx_code, v_cash_fx_rate, v_cash_fx_amount, null),
        (v_entry_id, v_deposits, 0, v_amount_base, 'Customer deposit', null, null, null, null);
      perform public.check_journal_entry_balance(v_entry_id);
      return;
    end if;

    v_settle_base := v_outstanding_base;
    v_diff := v_amount_base - v_settle_base;

    insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo, currency_code, fx_rate, foreign_amount, related_party_id)
    values
      (v_entry_id, v_debit_account, v_amount_base, 0, 'Receive payment', v_cash_fx_code, v_cash_fx_rate, v_cash_fx_amount, null),
      (v_entry_id, v_ar, 0, v_settle_base, 'Settle receivable', null, null, null, null);

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
    return;
  end if;

  if v_pay.direction = 'out' and v_pay.reference_table = 'purchase_orders' then
    v_po_id := nullif(v_pay.reference_id, '')::uuid;
    if v_po_id is null then
      raise exception 'invalid purchase order reference_id';
    end if;

    select greatest(0, coalesce(po.base_total, 0) - coalesce((
      select sum(coalesce(p.base_amount, 0))
      from public.payments p
      where p.reference_table = 'purchase_orders'
        and p.direction = 'out'
        and p.reference_id = v_po_id::text
        and p.id <> v_pay.id
        and p.occurred_at <= v_pay.occurred_at
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
    return;
  end if;

  -- cash_shifts
  if coalesce(v_pay.reference_table, '') = 'cash_shifts' then
    v_party_id := nullif(trim(coalesce(v_pay.data->>'destinationPartyId','')), '');
    
    if v_party_id is not null then
      select * into v_party from public.financial_parties where id = v_party_id::uuid;
      if v_party is not null then
        if v_party.type in ('customer', 'employee') then
          v_dest_account := v_ar;
        else
          v_dest_account := v_ap;
        end if;
      else
        v_dest_account := case when v_pay.method = 'cash' then v_cash else v_bank end;
      end if;
    else
      v_dest_override := nullif(trim(coalesce(v_pay.data->>'overrideAccountId','')), '');
      if v_dest_override is not null then
        v_dest_account := v_dest_override::uuid;
      else
        v_dest_account := case when v_pay.method = 'cash' then v_cash else v_bank end;
      end if;
    end if;
    
    if v_pay.direction = 'out' then
      insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo, currency_code, fx_rate, foreign_amount, related_party_id)
      values
        (v_entry_id, v_dest_account, v_amount_base, 0, 'Shift cash movement out: ' || coalesce(v_pay.data->>'reason', 'payment'), v_cash_fx_code, v_cash_fx_rate, v_cash_fx_amount, v_party_id::uuid),
        (v_entry_id, v_credit_account, 0, v_amount_base, 'Cash out from shift', v_cash_fx_code, v_cash_fx_rate, v_cash_fx_amount, null);
    else
      insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo, currency_code, fx_rate, foreign_amount, related_party_id)
      values
        (v_entry_id, v_debit_account, v_amount_base, 0, 'Cash in to shift', v_cash_fx_code, v_cash_fx_rate, v_cash_fx_amount, null),
        (v_entry_id, v_dest_account, 0, v_amount_base, 'Shift cash movement in: ' || coalesce(v_pay.data->>'reason', 'receipt'), v_cash_fx_code, v_cash_fx_rate, v_cash_fx_amount, v_party_id::uuid);
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
