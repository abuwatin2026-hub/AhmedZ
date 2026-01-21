create or replace function public.record_expense_payment(
  p_expense_id uuid,
  p_amount numeric,
  p_method text,
  p_occurred_at timestamptz
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_amount numeric;
  v_method text;
  v_occurred_at timestamptz;
  v_payment_id uuid;
  v_shift_id uuid;
begin
  if not public.can_manage_expenses() then
    raise exception 'not allowed';
  end if;

  if p_expense_id is null then
    raise exception 'p_expense_id is required';
  end if;

  v_amount := coalesce(p_amount, 0);
  if v_amount <= 0 then
    select coalesce(e.amount, 0)
    into v_amount
    from public.expenses e
    where e.id = p_expense_id;
  end if;

  if v_amount <= 0 then
    raise exception 'invalid amount';
  end if;

  v_method := nullif(trim(coalesce(p_method, '')), '');
  if v_method is null then
    v_method := 'cash';
  end if;
  if v_method = 'card' then
    v_method := 'network';
  elsif v_method = 'bank' then
    v_method := 'kuraimi';
  end if;

  v_occurred_at := coalesce(p_occurred_at, now());
  v_shift_id := public._resolve_open_shift_for_cash(auth.uid());

  if v_method = 'cash' and v_shift_id is null then
    raise exception 'cash method requires an open cash shift';
  end if;

  insert into public.payments(direction, method, amount, currency, reference_table, reference_id, occurred_at, created_by, data, shift_id)
  values (
    'out',
    v_method,
    v_amount,
    'YER',
    'expenses',
    p_expense_id::text,
    v_occurred_at,
    auth.uid(),
    jsonb_build_object('expenseId', p_expense_id::text),
    v_shift_id
  )
  returning id into v_payment_id;

  perform public.post_payment(v_payment_id);
end;
$$;
revoke all on function public.record_expense_payment(uuid, numeric, text, timestamptz) from public;
grant execute on function public.record_expense_payment(uuid, numeric, text, timestamptz) to anon, authenticated;
create or replace function public.record_purchase_order_payment(
  p_purchase_order_id uuid,
  p_amount numeric,
  p_method text,
  p_occurred_at timestamptz,
  p_data jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_amount numeric;
  v_paid numeric;
  v_total numeric;
  v_method text;
  v_occurred_at timestamptz;
  v_payment_id uuid;
  v_data jsonb;
  v_shift_id uuid;
begin
  if not public.can_manage_stock() then
    raise exception 'not allowed';
  end if;

  if p_purchase_order_id is null then
    raise exception 'p_purchase_order_id is required';
  end if;

  select coalesce(po.paid_amount, 0), coalesce(po.total_amount, 0)
  into v_paid, v_total
  from public.purchase_orders po
  where po.id = p_purchase_order_id
  for update;

  if not found then
    raise exception 'purchase order not found';
  end if;

  v_amount := coalesce(p_amount, 0);
  if v_amount <= 0 then
    raise exception 'invalid amount';
  end if;

  if v_total > 0 and (v_paid + v_amount) > (v_total + 1e-9) then
    raise exception 'paid amount exceeds total';
  end if;

  v_method := nullif(trim(coalesce(p_method, '')), '');
  if v_method is null then
    v_method := 'cash';
  end if;
  if v_method = 'card' then
    v_method := 'network';
  elsif v_method = 'bank' then
    v_method := 'kuraimi';
  end if;

  v_occurred_at := coalesce(p_occurred_at, now());
  v_data := jsonb_strip_nulls(jsonb_build_object('purchaseOrderId', p_purchase_order_id::text) || coalesce(p_data, '{}'::jsonb));
  v_shift_id := public._resolve_open_shift_for_cash(auth.uid());

  if v_method = 'cash' and v_shift_id is null then
    raise exception 'cash method requires an open cash shift';
  end if;

  insert into public.payments(direction, method, amount, currency, reference_table, reference_id, occurred_at, created_by, data, shift_id)
  values (
    'out',
    v_method,
    v_amount,
    'YER',
    'purchase_orders',
    p_purchase_order_id::text,
    v_occurred_at,
    auth.uid(),
    v_data,
    v_shift_id
  )
  returning id into v_payment_id;

  perform public.post_payment(v_payment_id);

  update public.purchase_orders
  set paid_amount = paid_amount + v_amount,
      updated_at = now()
  where id = p_purchase_order_id;
end;
$$;
revoke all on function public.record_purchase_order_payment(uuid, numeric, text, timestamptz, jsonb) from public;
grant execute on function public.record_purchase_order_payment(uuid, numeric, text, timestamptz, jsonb) to anon, authenticated;
do $$
declare
  v_con_name text;
begin
  update public.sales_returns
  set refund_method = case
    when refund_method in ('bank', 'bank_transfer') then 'kuraimi'
    when refund_method in ('card', 'online') then 'network'
    else refund_method
  end
  where refund_method in ('bank', 'bank_transfer', 'card', 'online');

  select c.conname
  into v_con_name
  from pg_constraint c
  join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any(c.conkey)
  where c.conrelid = 'public.sales_returns'::regclass
    and c.contype = 'c'
    and a.attname = 'refund_method'
  limit 1;

  if v_con_name is not null then
    execute format('alter table public.sales_returns drop constraint if exists %I', v_con_name);
  end if;
end;
$$;
alter table public.sales_returns
add constraint sales_returns_refund_method_check
check (refund_method in ('cash','network','kuraimi','ar','store_credit')) not valid;
alter table public.sales_returns
validate constraint sales_returns_refund_method_check;
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
  v_inventory uuid;
  v_cogs uuid;
  v_order_subtotal numeric;
  v_order_tax numeric;
  v_return_subtotal numeric;
  v_tax_refund numeric;
  v_total_refund numeric;
  v_item jsonb;
  v_item_id text;
  v_qty numeric;
  v_unit_cost numeric;
  v_old_qty numeric;
  v_old_avg numeric;
  v_new_qty numeric;
  v_new_avg numeric;
  v_movement_id uuid;
  v_shift_id uuid;
  v_refund_method text;
begin
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

  select *
  into v_order
  from public.orders o
  where o.id = v_ret.order_id;

  if not found then
    raise exception 'order not found';
  end if;

  v_cash := public.get_account_id_by_code('1010');
  v_bank := public.get_account_id_by_code('1020');
  v_ar := public.get_account_id_by_code('1200');
  v_deposits := public.get_account_id_by_code('2050');
  v_sales_returns := public.get_account_id_by_code('4026');
  v_vat_payable := public.get_account_id_by_code('2020');
  v_inventory := public.get_account_id_by_code('1410');
  v_cogs := public.get_account_id_by_code('5010');

  v_order_subtotal := coalesce(nullif((v_order.data->>'subtotal')::numeric, null), 0);
  v_order_tax := coalesce(nullif((v_order.data->>'taxAmount')::numeric, null), 0);
  v_return_subtotal := coalesce(nullif(v_ret.total_refund_amount, null), 0);

  if v_return_subtotal <= 0 then
    return;
  end if;

  v_tax_refund := 0;
  if v_order_subtotal > 0 and v_order_tax > 0 then
    v_tax_refund := least(v_order_tax, (v_return_subtotal / v_order_subtotal) * v_order_tax);
  end if;

  v_total_refund := v_return_subtotal + v_tax_refund;

  insert into public.journal_entries(entry_date, memo, source_table, source_id, source_event, created_by)
  values (
    coalesce(v_ret.return_date, now()),
    concat('Sales return ', v_ret.id::text),
    'sales_returns',
    v_ret.id::text,
    'processed',
    auth.uid()
  )
  on conflict (source_table, source_id, source_event)
  do update set entry_date = excluded.entry_date, memo = excluded.memo
  returning id into v_entry_id;

  delete from public.journal_lines jl where jl.journal_entry_id = v_entry_id;

  insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo)
  values (v_entry_id, v_sales_returns, v_return_subtotal, 0, 'Sales return');

  if v_tax_refund > 0 then
    insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo)
    values (v_entry_id, v_vat_payable, v_tax_refund, 0, 'Reverse VAT payable');
  end if;

  v_refund_method := coalesce(nullif(trim(coalesce(v_ret.refund_method, '')), ''), 'cash');
  if v_refund_method in ('bank', 'bank_transfer') then
    v_refund_method := 'kuraimi';
  elsif v_refund_method in ('card', 'online') then
    v_refund_method := 'network';
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
  elsif v_refund_method = 'store_credit' then
    insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo)
    values (v_entry_id, v_deposits, 0, v_total_refund, 'Increase customer deposit');
  end if;

  for v_item in select value from jsonb_array_elements(coalesce(v_ret.items, '[]'::jsonb))
  loop
    v_item_id := v_item->>'itemId';
    v_qty := coalesce(nullif(v_item->>'quantity','')::numeric, 0);

    if v_item_id is null or v_qty <= 0 then
      continue;
    end if;

    select oic.unit_cost
    into v_unit_cost
    from public.order_item_cogs oic
    where oic.order_id = v_ret.order_id
      and oic.item_id = v_item_id
    limit 1;

    if v_unit_cost is null then
      select coalesce(sm.avg_cost, 0)
      into v_unit_cost
      from public.stock_management sm
      where sm.item_id = v_item_id;
    end if;

    select coalesce(sm.available_quantity,0), coalesce(sm.avg_cost,0)
    into v_old_qty, v_old_avg
    from public.stock_management sm
    where sm.item_id = v_item_id
    for update;

    v_new_qty := v_old_qty + v_qty;
    if v_new_qty <= 0 then
      v_new_avg := coalesce(v_unit_cost, v_old_avg);
    else
      v_new_avg := ((v_old_qty * v_old_avg) + (v_qty * coalesce(v_unit_cost, v_old_avg))) / v_new_qty;
    end if;

    update public.stock_management
    set available_quantity = v_new_qty,
        avg_cost = v_new_avg,
        last_updated = now(),
        updated_at = now()
    where item_id = v_item_id;

    insert into public.inventory_movements(
      item_id, movement_type, quantity, unit_cost, total_cost,
      reference_table, reference_id, occurred_at, created_by, data
    )
    values (
      v_item_id, 'return_in', v_qty, coalesce(v_unit_cost,0), (v_qty * coalesce(v_unit_cost,0)),
      'sales_returns', v_ret.id::text, coalesce(v_ret.return_date, now()), auth.uid(), jsonb_build_object('orderId', v_ret.order_id)
    )
    returning id into v_movement_id;

    perform public.post_inventory_movement(v_movement_id);
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
      coalesce(v_order.data->>'currency','YER'),
      'sales_returns',
      v_ret.id::text,
      coalesce(v_ret.return_date, now()),
      auth.uid(),
      jsonb_build_object('orderId', v_ret.order_id),
      v_shift_id
    );
  end if;
end;
$$;
revoke all on function public.process_sales_return(uuid) from public;
grant execute on function public.process_sales_return(uuid) to anon, authenticated;
