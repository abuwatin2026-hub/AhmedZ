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
  v_return_subtotal numeric;
  v_tax_refund numeric;
  v_total_refund numeric;
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
  v_ar_reduction numeric := 0;
  v_paid_total numeric := 0;
  v_prev_refunded_total numeric := 0;
begin
  perform public._require_staff('process_sales_return');
  if not (auth.role() = 'service_role' or public.has_admin_permission('accounting.manage')) then
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

  v_return_subtotal := coalesce(nullif(v_ret.total_refund_amount, null), 0);
  if v_return_subtotal <= 0 then
    raise exception 'invalid return amount';
  end if;
  if v_return_subtotal > (v_order_net_subtotal + 0.000000001) then
    raise exception 'return amount exceeds order net subtotal';
  end if;

  v_tax_refund := 0;
  if v_order_net_subtotal > 0 and v_order_tax > 0 then
    v_tax_refund := least(v_order_tax, (v_return_subtotal / v_order_net_subtotal) * v_order_tax);
  end if;
  v_total_refund := public._money_round(v_return_subtotal + v_tax_refund);

  v_refund_method := coalesce(nullif(trim(coalesce(v_ret.refund_method, '')), ''), 'cash');
  if v_refund_method in ('bank', 'bank_transfer') then
    v_refund_method := 'kuraimi';
  elsif v_refund_method in ('card', 'online') then
    v_refund_method := 'network';
  end if;

  if to_regclass('public.payments') is not null then
    begin
      select coalesce(sum(p.amount), 0)
      into v_paid_total
      from public.payments p
      where p.direction = 'in'
        and p.reference_table = 'orders'
        and p.reference_id = v_order.id::text;
    exception when others then
      v_paid_total := 0;
    end;

    begin
      select coalesce(sum(p.amount), 0)
      into v_prev_refunded_total
      from public.payments p
      where p.direction = 'out'
        and p.reference_table = 'sales_returns'
        and (p.data->>'orderId') = v_order.id::text;
    exception when others then
      v_prev_refunded_total := 0;
    end;
  end if;

  if v_refund_method in ('cash','network','kuraimi') then
    if v_paid_total > 0 and (v_prev_refunded_total + v_total_refund) > (v_paid_total + 0.000000001) then
      raise exception 'refund exceeds paid amount for this order';
    end if;
  end if;

  insert into public.journal_entries(entry_date, memo, source_table, source_id, source_event, created_by, status)
  values (
    coalesce(v_ret.return_date, now()),
    concat('Sales return ', v_ret.id::text),
    'sales_returns',
    v_ret.id::text,
    'processed',
    auth.uid(),
    'posted'
  )
  on conflict (source_table, source_id, source_event)
  do update set entry_date = excluded.entry_date, memo = excluded.memo
  returning id into v_entry_id;

  delete from public.journal_lines jl where jl.journal_entry_id = v_entry_id;

  insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo)
  values (v_entry_id, v_sales_returns, public._money_round(v_return_subtotal), 0, 'Sales return');

  if v_tax_refund > 0 then
    insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo)
    values (v_entry_id, v_vat_payable, public._money_round(v_tax_refund), 0, 'Reverse VAT payable');
  end if;

  if v_refund_method = 'cash' then
    insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo)
    values (v_entry_id, v_cash, 0, v_total_refund, 'Cash refund');
  elsif v_refund_method in ('network','kuraimi') then
    insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo)
    values (v_entry_id, v_bank, 0, v_total_refund, 'Bank refund');
  elsif v_refund_method = 'ar' then
    insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo)
    values (v_entry_id, v_ar, 0, v_total_refund, 'Reduce accounts receivable');
    v_ar_reduction := v_total_refund;
  elsif v_refund_method = 'store_credit' then
    insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo)
    values (v_entry_id, v_deposits, 0, v_total_refund, 'Increase customer deposit');
  else
    v_refund_method := 'cash';
    insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo)
    values (v_entry_id, v_cash, 0, v_total_refund, 'Cash refund');
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
    insert into public.payments(direction, method, amount, currency, reference_table, reference_id, occurred_at, created_by, data, shift_id)
    values (
      'out',
      v_refund_method,
      v_total_refund,
      coalesce(v_order.data->>'currency', v_order.currency, 'YER'),
      'sales_returns',
      v_ret.id::text,
      coalesce(v_ret.return_date, now()),
      auth.uid(),
      jsonb_build_object('orderId', v_ret.order_id::text),
      v_shift_id
    );
  end if;

  if v_ar_reduction > 0 then
    perform public._apply_ar_open_item_credit(v_ret.order_id, v_ar_reduction);
  end if;
end;
$$;

revoke all on function public.process_sales_return(uuid) from public;
revoke execute on function public.process_sales_return(uuid) from anon;
grant execute on function public.process_sales_return(uuid) to authenticated;

notify pgrst, 'reload schema';
