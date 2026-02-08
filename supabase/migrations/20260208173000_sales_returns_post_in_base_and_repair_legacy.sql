set request.jwt.claims = '';
set app.allow_ledger_ddl = '1';

create or replace function public.process_sales_return(p_return_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ret record;
  v_order record;
  v_entry_id uuid;
  v_cash uuid;
  v_bank uuid;
  v_ar uuid;
  v_deposits uuid;
  v_sales_returns uuid;
  v_vat_payable uuid;
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
  v_shift_id uuid;
  v_item jsonb;
  v_item_id text;
  v_qty numeric;
  v_needed numeric;
  v_sale record;
  v_already numeric;
  v_free numeric;
  v_alloc numeric;
  v_ret_batch_id uuid;
  v_source_batch record;
  v_movement_id uuid;
  v_wh uuid;
  v_ar_reduction_base numeric := 0;
  v_paid_total_base numeric := 0;
  v_prev_refunded_total_base numeric := 0;
  v_base text;
  v_currency text;
  v_fx numeric;
  v_cash_fx_code text;
  v_cash_fx_rate numeric;
  v_cash_fx_amount numeric;
begin
  perform public._require_staff('process_sales_return');
  if not (
    auth.role() = 'service_role'
    or public.has_admin_permission('accounting.manage')
    or public.can_manage_orders()
  ) then
    raise exception 'not authorized';
  end if;

  if p_return_id is null then
    raise exception 'p_return_id is required';
  end if;

  select *
  into v_ret
  from public.sales_returns r
  where r.id = p_return_id
  for update;
  if not found then
    raise exception 'sales return not found';
  end if;
  if v_ret.status = 'completed' then
    return;
  end if;
  if v_ret.status = 'cancelled' then
    raise exception 'sales return is cancelled';
  end if;

  select *
  into v_order
  from public.orders o
  where o.id = v_ret.order_id;
  if not found then
    raise exception 'order not found';
  end if;
  if coalesce(v_order.status,'') <> 'delivered' then
    raise exception 'sales return requires delivered order';
  end if;
  if nullif(trim(coalesce(v_order.data->>'voidedAt','')), '') is not null then
    raise exception 'order already voided';
  end if;

  v_base := public.get_base_currency();
  v_currency := upper(coalesce(nullif(btrim(coalesce(v_order.currency, v_order.data->>'currency', v_base)), ''), v_base));
  begin
    v_fx := coalesce(v_order.fx_rate, nullif((v_order.data->>'fxRate')::numeric, null), 1);
  exception when others then
    v_fx := 1;
  end;
  if v_fx is null or v_fx <= 0 then
    raise exception 'invalid fx_rate on order';
  end if;

  v_cash_fx_code := null;
  v_cash_fx_rate := null;
  v_cash_fx_amount := null;
  if v_currency <> v_base then
    v_cash_fx_code := v_currency;
    v_cash_fx_rate := v_fx;
  end if;

  v_cash := public.get_account_id_by_code('1010');
  v_bank := public.get_account_id_by_code('1020');
  v_ar := public.get_account_id_by_code('1200');
  v_deposits := public.get_account_id_by_code('2050');
  v_sales_returns := public.get_account_id_by_code('4026');
  v_vat_payable := public.get_account_id_by_code('2020');

  v_order_subtotal := coalesce(nullif((v_order.data->>'subtotal')::numeric, null), coalesce(v_order.subtotal, 0), 0);
  v_order_discount := coalesce(nullif((v_order.data->>'discountAmount')::numeric, null), coalesce(v_order.discount, 0), 0);
  v_order_net_subtotal := greatest(0, v_order_subtotal - v_order_discount);
  v_order_tax := coalesce(nullif((v_order.data->>'taxAmount')::numeric, null), coalesce(v_order.tax_amount, 0), 0);

  v_return_subtotal_fx := coalesce(nullif(v_ret.total_refund_amount, null), 0);
  if v_return_subtotal_fx <= 0 then
    raise exception 'invalid return amount';
  end if;
  if v_return_subtotal_fx > (v_order_net_subtotal + 0.000000001) then
    raise exception 'return amount exceeds order net subtotal';
  end if;

  v_tax_refund_fx := 0;
  if v_order_net_subtotal > 0 and v_order_tax > 0 then
    v_tax_refund_fx := least(v_order_tax, (v_return_subtotal_fx / v_order_net_subtotal) * v_order_tax);
  end if;

  v_total_refund_fx := public._money_round(v_return_subtotal_fx + v_tax_refund_fx);
  if v_currency <> v_base then
    v_cash_fx_amount := v_total_refund_fx;
  end if;

  v_return_subtotal_base := case when v_currency = v_base then v_return_subtotal_fx else (v_return_subtotal_fx * v_fx) end;
  v_tax_refund_base := case when v_currency = v_base then v_tax_refund_fx else (v_tax_refund_fx * v_fx) end;
  v_total_refund_base := public._money_round(v_return_subtotal_base + v_tax_refund_base);

  v_refund_method := coalesce(nullif(trim(coalesce(v_ret.refund_method, '')), ''), 'cash');
  if v_refund_method in ('bank', 'bank_transfer') then
    v_refund_method := 'kuraimi';
  elsif v_refund_method in ('card', 'online') then
    v_refund_method := 'network';
  end if;

  if to_regclass('public.payments') is not null then
    begin
      select coalesce(sum(coalesce(p.base_amount, 0)), 0)
      into v_paid_total_base
      from public.payments p
      where p.direction = 'in'
        and p.reference_table = 'orders'
        and p.reference_id = v_order.id::text;
    exception when others then
      v_paid_total_base := 0;
    end;

    begin
      select coalesce(sum(coalesce(p.base_amount, 0)), 0)
      into v_prev_refunded_total_base
      from public.payments p
      where p.direction = 'out'
        and p.reference_table = 'sales_returns'
        and (p.data->>'orderId') = v_order.id::text;
    exception when others then
      v_prev_refunded_total_base := 0;
    end;
  end if;

  if v_refund_method in ('cash','network','kuraimi') then
    if v_paid_total_base > 0 and (v_prev_refunded_total_base + v_total_refund_base) > (v_paid_total_base + 0.000000001) then
      raise exception 'refund exceeds paid amount for this order';
    end if;
  end if;

  begin
    insert into public.journal_entries(entry_date, memo, source_table, source_id, source_event, created_by, status, currency_code, fx_rate, foreign_amount)
    values (
      coalesce(v_ret.return_date, now()),
      concat('Sales return ', v_ret.id::text),
      'sales_returns',
      v_ret.id::text,
      'processed',
      auth.uid(),
      'posted',
      case when v_currency <> v_base then v_currency else null end,
      case when v_currency <> v_base then v_fx else null end,
      case when v_currency <> v_base then v_total_refund_fx else null end
    )
    returning id into v_entry_id;
  exception
    when unique_violation then
      raise exception 'sales return already posted; create a reversal instead';
  end;

  insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo)
  values (v_entry_id, v_sales_returns, public._money_round(v_return_subtotal_base), 0, 'Sales return');

  if v_tax_refund_base > 0 then
    insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo)
    values (v_entry_id, v_vat_payable, public._money_round(v_tax_refund_base), 0, 'Reverse VAT payable');
  end if;

  if v_refund_method = 'cash' then
    insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo, currency_code, fx_rate, foreign_amount)
    values (v_entry_id, v_cash, 0, v_total_refund_base, 'Cash refund', v_cash_fx_code, v_cash_fx_rate, v_cash_fx_amount);
  elsif v_refund_method in ('network','kuraimi') then
    insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo, currency_code, fx_rate, foreign_amount)
    values (v_entry_id, v_bank, 0, v_total_refund_base, 'Bank refund', v_cash_fx_code, v_cash_fx_rate, v_cash_fx_amount);
  elsif v_refund_method = 'ar' then
    insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo)
    values (v_entry_id, v_ar, 0, v_total_refund_base, 'Reduce accounts receivable');
    v_ar_reduction_base := v_total_refund_base;
  elsif v_refund_method = 'store_credit' then
    insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo)
    values (v_entry_id, v_deposits, 0, v_total_refund_base, 'Increase customer deposit');
  else
    v_refund_method := 'cash';
    insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo, currency_code, fx_rate, foreign_amount)
    values (v_entry_id, v_cash, 0, v_total_refund_base, 'Cash refund', v_cash_fx_code, v_cash_fx_rate, v_cash_fx_amount);
  end if;

  for v_item in select value from jsonb_array_elements(coalesce(v_ret.items, '[]'::jsonb))
  loop
    v_item_id := nullif(trim(coalesce(v_item->>'itemId', '')), '');
    v_qty := coalesce(nullif(v_item->>'quantity','')::numeric, 0);
    if v_item_id is null or v_qty <= 0 then
      continue;
    end if;

    v_needed := v_qty;

    for v_sale in
      select im.id, im.item_id, im.quantity, im.unit_cost, im.total_cost, im.batch_id, im.warehouse_id, im.occurred_at
      from public.inventory_movements im
      where im.reference_table = 'orders'
        and im.reference_id = v_ret.order_id::text
        and im.movement_type = 'sale_out'
        and im.item_id::text = v_item_id::text
      order by im.occurred_at asc, im.id asc
    loop
      exit when v_needed <= 0;

      select coalesce(sum(imr.quantity), 0)
      into v_already
      from public.inventory_movements imr
      where imr.reference_table = 'sales_returns'
        and imr.movement_type = 'return_in'
        and (imr.data->>'orderId') = v_ret.order_id::text
        and (imr.data->>'sourceMovementId') = v_sale.id::text;

      v_free := greatest(coalesce(v_sale.quantity, 0) - coalesce(v_already, 0), 0);
      if v_free <= 0 then
        continue;
      end if;

      v_alloc := least(v_needed, v_free);
      if v_alloc <= 0 then
        continue;
      end if;

      select b.expiry_date, b.production_date, b.unit_cost
      into v_source_batch
      from public.batches b
      where b.id = v_sale.batch_id;

      v_wh := v_sale.warehouse_id;
      if v_wh is null then
        v_wh := coalesce(v_order.warehouse_id, public._resolve_default_admin_warehouse_id());
      end if;
      if v_wh is null then
        raise exception 'warehouse_id is required';
      end if;

      v_ret_batch_id := gen_random_uuid();
      insert into public.batches(
        id,
        item_id,
        receipt_item_id,
        receipt_id,
        warehouse_id,
        batch_code,
        production_date,
        expiry_date,
        quantity_received,
        quantity_consumed,
        unit_cost,
        qc_status,
        data
      )
      values (
        v_ret_batch_id,
        v_item_id::text,
        null,
        null,
        v_wh,
        null,
        v_source_batch.production_date,
        v_source_batch.expiry_date,
        v_alloc,
        0,
        coalesce(v_sale.unit_cost, v_source_batch.unit_cost, 0),
        'pending',
        jsonb_build_object(
          'source', 'sales_returns',
          'salesReturnId', v_ret.id::text,
          'orderId', v_ret.order_id::text,
          'sourceBatchId', v_sale.batch_id::text,
          'sourceMovementId', v_sale.id::text
        )
      );

      insert into public.inventory_movements(
        item_id, movement_type, quantity, unit_cost, total_cost,
        reference_table, reference_id, occurred_at, created_by, data, batch_id, warehouse_id
      )
      values (
        v_item_id::text,
        'return_in',
        v_alloc,
        coalesce(v_sale.unit_cost, v_source_batch.unit_cost, 0),
        v_alloc * coalesce(v_sale.unit_cost, v_source_batch.unit_cost, 0),
        'sales_returns',
        v_ret.id::text,
        coalesce(v_ret.return_date, now()),
        auth.uid(),
        jsonb_build_object(
          'orderId', v_ret.order_id::text,
          'warehouseId', v_wh::text,
          'salesReturnId', v_ret.id::text,
          'sourceBatchId', v_sale.batch_id::text,
          'sourceMovementId', v_sale.id::text
        ),
        v_ret_batch_id,
        v_wh
      )
      returning id into v_movement_id;

      perform public.post_inventory_movement(v_movement_id);
      perform public.recompute_stock_for_item(v_item_id::text, v_wh);

      v_needed := v_needed - v_alloc;
    end loop;

    if v_needed > 1e-9 then
      raise exception 'return exceeds sold quantity for item %', v_item_id;
    end if;
  end loop;

  update public.sales_returns
  set status = 'completed',
      updated_at = now()
  where id = p_return_id;

  v_shift_id := public._resolve_open_shift_for_cash(auth.uid());
  if v_refund_method = 'cash' and v_shift_id is null then
    raise exception 'cash refund requires an open cash shift';
  end if;

  if v_refund_method in ('cash','network','kuraimi') then
    insert into public.payments(direction, method, amount, currency, fx_rate, base_amount, reference_table, reference_id, occurred_at, created_by, data, shift_id)
    values (
      'out',
      v_refund_method,
      v_total_refund_fx,
      v_currency,
      case when v_currency <> v_base then v_fx else 1 end,
      v_total_refund_base,
      'sales_returns',
      v_ret.id::text,
      coalesce(v_ret.return_date, now()),
      auth.uid(),
      jsonb_build_object('orderId', v_ret.order_id::text),
      v_shift_id
    );
  end if;

  if v_ar_reduction_base > 0 then
    perform public._apply_ar_open_item_credit(v_ret.order_id, v_ar_reduction_base);
  end if;
end;
$$;

revoke all on function public.process_sales_return(uuid) from public;
revoke execute on function public.process_sales_return(uuid) from anon;
grant execute on function public.process_sales_return(uuid) to authenticated;

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
  v_src_debit numeric;
  v_src_credit numeric;
  v_src_count int;
begin
  for r in
    select
      je.id as entry_id,
      sr.id as return_id,
      sr.order_id,
      sr.return_date,
      sr.refund_method,
      sr.total_refund_amount,
      coalesce(sum(jl.debit), 0) as total_debits
    from public.journal_entries je
    join public.sales_returns sr
      on sr.id::text = je.source_id
    join public.journal_lines jl
      on jl.journal_entry_id = je.id
    where je.source_table = 'sales_returns'
      and je.source_event = 'processed'
    group by je.id, sr.id, sr.order_id, sr.return_date, sr.refund_method, sr.total_refund_amount
  loop
    select * into v_order from public.orders o where o.id = r.order_id;
    if not found then
      continue;
    end if;
    select * into v_ret from public.sales_returns x where x.id = r.return_id;
    if not found then
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

    v_return_subtotal_base := case when v_currency = v_base then v_return_subtotal_fx else (v_return_subtotal_fx * v_fx) end;
    v_tax_refund_base := case when v_currency = v_base then v_tax_refund_fx else (v_tax_refund_fx * v_fx) end;
    v_total_refund_base := public._money_round(v_return_subtotal_base + v_tax_refund_base);

    if v_currency = v_base then
      continue;
    end if;

    if abs(coalesce(r.total_debits, 0) - v_total_refund_fx) > 0.01 then
      continue;
    end if;

    if exists (
      select 1
      from public.journal_entries je2
      where je2.source_table = 'ledger_repairs'
        and je2.source_id = public.uuid_from_text(concat('sales_return:legacy:', r.entry_id::text, ':repost'))::text
        and je2.source_event = 'repost_sales_return'
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

    insert into public.journal_entries(entry_date, memo, source_table, source_id, source_event, created_by, status, currency_code, fx_rate, foreign_amount)
    values (
      now(),
      concat('REVERSAL of legacy sales return entry ', r.entry_id::text),
      'ledger_repairs',
      public.uuid_from_text(concat('sales_return:legacy:', r.entry_id::text, ':reversal'))::text,
      'reversal',
      null,
      'posted',
      null,
      null,
      null
    )
    returning id into v_rev_id;

    insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo, currency_code, fx_rate, foreign_amount)
    select
      v_rev_id,
      jl.account_id,
      jl.credit,
      jl.debit,
      concat('Reversal: ', coalesce(jl.line_memo,'')),
      jl.currency_code,
      jl.fx_rate,
      jl.foreign_amount
    from public.journal_lines jl
    where jl.journal_entry_id = r.entry_id;

    perform public.check_journal_entry_balance(v_rev_id);

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
      coalesce(r.return_date, now()),
      concat('Repost sales return (base fix) ', r.return_id::text),
      'ledger_repairs',
      public.uuid_from_text(concat('sales_return:legacy:', r.entry_id::text, ':repost'))::text,
      'repost_sales_return',
      null,
      'posted',
      v_currency,
      v_fx,
      v_total_refund_fx
    )
    returning id into v_fix_id;

    insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo)
    values (v_fix_id, v_sales_returns, public._money_round(v_return_subtotal_base), 0, 'Sales return (base)');

    if v_tax_refund_base > 0 then
      insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo)
      values (v_fix_id, v_vat_payable, public._money_round(v_tax_refund_base), 0, 'Reverse VAT payable (base)');
    end if;

    if v_refund_method = 'cash' then
      insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo, currency_code, fx_rate, foreign_amount)
      values (v_fix_id, v_cash, 0, v_total_refund_base, 'Cash refund (base)', v_cash_fx_code, v_cash_fx_rate, v_cash_fx_amount);
    elsif v_refund_method in ('network','kuraimi') then
      insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo, currency_code, fx_rate, foreign_amount)
      values (v_fix_id, v_bank, 0, v_total_refund_base, 'Bank refund (base)', v_cash_fx_code, v_cash_fx_rate, v_cash_fx_amount);
    elsif v_refund_method = 'ar' then
      insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo)
      values (v_fix_id, v_ar, 0, v_total_refund_base, 'Reduce accounts receivable (base)');
    elsif v_refund_method = 'store_credit' then
      insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo)
      values (v_fix_id, v_deposits, 0, v_total_refund_base, 'Increase customer deposit (base)');
    else
      insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo, currency_code, fx_rate, foreign_amount)
      values (v_fix_id, v_cash, 0, v_total_refund_base, 'Cash refund (base)', v_cash_fx_code, v_cash_fx_rate, v_cash_fx_amount);
    end if;

    perform public.check_journal_entry_balance(v_fix_id);
  end loop;

  begin
    update public.payments p
    set
      currency = upper(coalesce(nullif(btrim(coalesce(p.currency,'')), ''), v_base)),
      fx_rate = coalesce(nullif(p.fx_rate, 0), case when upper(coalesce(nullif(btrim(coalesce(p.currency,'')), ''), v_base)) = upper(v_base) then 1 else p.fx_rate end,
                         case
                           when p.reference_table = 'sales_returns' and nullif(p.data->>'orderId','') is not null
                             then (select coalesce(o.fx_rate, nullif((o.data->>'fxRate')::numeric, null)) from public.orders o where o.id::text = (p.data->>'orderId') limit 1)
                           else null
                         end),
      base_amount = coalesce(
        nullif(p.base_amount, 0),
        case
          when upper(coalesce(nullif(btrim(coalesce(p.currency,'')), ''), v_base)) = upper(v_base) then coalesce(p.amount, 0)
          when coalesce(nullif(p.fx_rate, 0), 0) > 0 then coalesce(p.amount, 0) * p.fx_rate
          else null
        end
      )
    where p.reference_table = 'sales_returns'
      and p.direction = 'out';
  exception when others then
    null;
  end;

  for r in
    select distinct je.id as entry_id
    from public.journal_entries je
    join public.payments p on p.id::text = je.source_id
    where je.source_table = 'payments'
      and p.reference_table = 'sales_returns'
  loop
    if exists (
      select 1
      from public.journal_entries je2
      where je2.source_table = 'ledger_repairs'
        and je2.source_id = public.uuid_from_text(concat('sales_return:refund_payment:', r.entry_id::text, ':reversal'))::text
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
      now(),
      concat('REVERSAL of legacy refund payment entry ', r.entry_id::text),
      'ledger_repairs',
      public.uuid_from_text(concat('sales_return:refund_payment:', r.entry_id::text, ':reversal'))::text,
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
      concat('Reversal: ', coalesce(jl.line_memo,'')),
      jl.currency_code,
      jl.fx_rate,
      jl.foreign_amount
    from public.journal_lines jl
    where jl.journal_entry_id = r.entry_id;

    perform public.check_journal_entry_balance(v_rev_id);
  end loop;
end $$;

notify pgrst, 'reload schema';
