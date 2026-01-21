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
  v_sales_returns uuid;
  v_inventory uuid;
  v_cogs uuid;
  v_return_subtotal numeric;
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
  v_sold_qty numeric;
  v_prev_returned numeric;
  v_curr_returned numeric;
  v_seen jsonb;
  v_inventory_movements_item_id_is_uuid boolean;
  v_inventory_movements_reference_id_is_uuid boolean;
  v_item_id_uuid uuid;
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
  where o.id::text = v_ret.order_id::text;

  if not found then
    raise exception 'order not found';
  end if;

  v_cash := public.get_account_id_by_code('1010');
  v_bank := public.get_account_id_by_code('1020');
  v_sales_returns := public.get_account_id_by_code('4026');
  v_inventory := public.get_account_id_by_code('1410');
  v_cogs := public.get_account_id_by_code('5010');

  select (t.typname = 'uuid')
  into v_inventory_movements_item_id_is_uuid
  from pg_attribute a
  join pg_class c on a.attrelid = c.oid
  join pg_namespace n on c.relnamespace = n.oid
  join pg_type t on a.atttypid = t.oid
  where n.nspname = 'public'
    and c.relname = 'inventory_movements'
    and a.attname = 'item_id'
    and a.attnum > 0
    and not a.attisdropped;

  select (t.typname = 'uuid')
  into v_inventory_movements_reference_id_is_uuid
  from pg_attribute a
  join pg_class c on a.attrelid = c.oid
  join pg_namespace n on c.relnamespace = n.oid
  join pg_type t on a.atttypid = t.oid
  where n.nspname = 'public'
    and c.relname = 'inventory_movements'
    and a.attname = 'reference_id'
    and a.attnum > 0
    and not a.attisdropped;

  v_return_subtotal := coalesce(nullif(v_ret.total_refund_amount, null), 0);
  if v_return_subtotal <= 0 then
    return;
  end if;

  v_total_refund := v_return_subtotal;

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

  v_refund_method := coalesce(nullif(trim(coalesce(v_ret.refund_method, '')), ''), 'cash');
  if v_refund_method in ('bank', 'bank_transfer') then
    v_refund_method := 'kuraimi';
  elsif v_refund_method in ('card', 'online') then
    v_refund_method := 'network';
  end if;
  if v_refund_method not in ('cash', 'network', 'kuraimi') then
    v_refund_method := 'cash';
  end if;

  if v_refund_method = 'cash' then
    insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo)
    values (v_entry_id, v_cash, 0, v_total_refund, 'Cash refund');
  elsif v_refund_method in ('network','kuraimi') then
    insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo)
    values (v_entry_id, v_bank, 0, v_total_refund, 'Bank refund');
  end if;

  v_seen := '{}'::jsonb;
  for v_item in select value from jsonb_array_elements(coalesce(v_ret.items, '[]'::jsonb))
  loop
    v_item_id := nullif(trim(coalesce(v_item->>'itemId', '')), '');
    v_qty := coalesce(nullif(v_item->>'quantity','')::numeric, 0);

    if v_item_id is null or v_qty <= 0 then
      continue;
    end if;

    select coalesce(sum(oic.quantity), 0)
    into v_sold_qty
    from public.order_item_cogs oic
    where oic.order_id::text = v_ret.order_id::text
      and oic.item_id::text = v_item_id;

    if coalesce(v_sold_qty, 0) <= 0 then
      select coalesce(sum(coalesce(nullif((i->>'quantity')::numeric, null), 0)), 0)
      into v_sold_qty
      from jsonb_array_elements(coalesce(v_order.data->'items', '[]'::jsonb)) i
      where coalesce(i->>'itemId', i->>'id', i->>'menuItemId') = v_item_id;
    end if;

    if coalesce(v_sold_qty, 0) <= 0 then
      raise exception 'لا يمكن معالجة المرتجع: لا يمكن تحديد كمية البيع للصنف %', v_item_id;
    end if;

    select coalesce(sum(coalesce(nullif((e->>'quantity')::numeric, null), 0)), 0)
    into v_prev_returned
    from public.sales_returns r
    cross join lateral jsonb_array_elements(coalesce(r.items, '[]'::jsonb)) e
    where r.order_id::text = v_ret.order_id::text
      and r.status = 'completed'
      and r.id <> p_return_id
      and (e->>'itemId') = v_item_id;

    v_curr_returned := coalesce(nullif((v_seen->>v_item_id), '')::numeric, 0);
    if (coalesce(v_prev_returned, 0) + coalesce(v_curr_returned, 0) + v_qty) > (v_sold_qty + 1e-9) then
      raise exception 'لا يمكن معالجة المرتجع: كمية الصنف % تتجاوز المسموح. المباع=%، المرتجع سابقاً=%، المطلوب=%',
        v_item_id, v_sold_qty, coalesce(v_prev_returned, 0), (coalesce(v_curr_returned, 0) + v_qty);
    end if;

    v_seen := jsonb_set(v_seen, array[v_item_id], to_jsonb(coalesce(v_curr_returned, 0) + v_qty), true);

    select oic.unit_cost
    into v_unit_cost
    from public.order_item_cogs oic
    where oic.order_id::text = v_ret.order_id::text
      and oic.item_id::text = v_item_id
    limit 1;

    if v_unit_cost is null then
      select coalesce(sm.avg_cost, 0)
      into v_unit_cost
      from public.stock_management sm
      where sm.item_id::text = v_item_id;
    end if;

    select coalesce(sm.available_quantity,0), coalesce(sm.avg_cost,0)
    into v_old_qty, v_old_avg
    from public.stock_management sm
    where sm.item_id::text = v_item_id
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
    where item_id::text = v_item_id;

    if coalesce(v_inventory_movements_item_id_is_uuid, false) then
      begin
        v_item_id_uuid := v_item_id::uuid;
      exception when others then
        raise exception 'Invalid itemId %', v_item_id;
      end;
    end if;

    insert into public.inventory_movements(
      item_id, movement_type, quantity, unit_cost, total_cost,
      reference_table, reference_id, occurred_at, created_by, data
    )
    values (
      case
        when coalesce(v_inventory_movements_item_id_is_uuid, false) then v_item_id_uuid
        else v_item_id
      end,
      'return_in',
      v_qty,
      coalesce(v_unit_cost,0),
      (v_qty * coalesce(v_unit_cost,0)),
      'sales_returns',
      case
        when coalesce(v_inventory_movements_reference_id_is_uuid, false) then v_ret.id
        else v_ret.id::text
      end,
      coalesce(v_ret.return_date, now()),
      auth.uid(),
      jsonb_build_object('orderId', v_ret.order_id)
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
