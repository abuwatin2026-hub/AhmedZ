create table if not exists public.sales_returns (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  return_date timestamptz not null default now(),
  reason text,
  refund_method text not null check (refund_method in ('cash','bank','ar','store_credit')) default 'cash',
  total_refund_amount numeric not null default 0,
  items jsonb not null default '[]'::jsonb,
  status text not null check (status in ('draft','completed','cancelled')) default 'draft',
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.sales_returns enable row level security;
drop policy if exists sales_returns_admin_only on public.sales_returns;
create policy sales_returns_admin_only
on public.sales_returns
for all
using (public.is_admin())
with check (public.is_admin());
create index if not exists idx_sales_returns_order on public.sales_returns(order_id, return_date desc);
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

  if coalesce(v_ret.refund_method, 'cash') = 'cash' then
    insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo)
    values (v_entry_id, v_cash, 0, v_total_refund, 'Cash refund');
  elsif v_ret.refund_method = 'bank' then
    insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo)
    values (v_entry_id, v_bank, 0, v_total_refund, 'Bank refund');
  elsif v_ret.refund_method = 'ar' then
    insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo)
    values (v_entry_id, v_ar, 0, v_total_refund, 'Reduce accounts receivable');
  elsif v_ret.refund_method = 'store_credit' then
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

  if coalesce(v_ret.refund_method, 'cash') in ('cash','bank') then
    insert into public.payments(direction, method, amount, currency, reference_table, reference_id, occurred_at, created_by, data)
    values (
      'out',
      coalesce(v_ret.refund_method, 'cash'),
      v_total_refund,
      coalesce(v_order.data->>'currency','YER'),
      'sales_returns',
      v_ret.id::text,
      coalesce(v_ret.return_date, now()),
      auth.uid(),
      jsonb_build_object('orderId', v_ret.order_id)
    );
  end if;
end;
$$;
revoke all on function public.process_sales_return(uuid) from public;
grant execute on function public.process_sales_return(uuid) to anon, authenticated;
create or replace function public.post_inventory_movement(p_movement_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_mv record;
  v_entry_id uuid;
  v_inventory uuid;
  v_cogs uuid;
  v_ap uuid;
  v_shrinkage uuid;
  v_gain uuid;
begin
  if p_movement_id is null then
    raise exception 'p_movement_id is required';
  end if;

  select *
  into v_mv
  from public.inventory_movements im
  where im.id = p_movement_id;

  if not found then
    raise exception 'inventory movement not found';
  end if;

  -- Skip automatic posting for production movements; handled by post_production_order
  if v_mv.reference_table = 'production_orders' then
    return;
  end if;

  v_inventory := public.get_account_id_by_code('1410');
  v_cogs := public.get_account_id_by_code('5010');
  v_ap := public.get_account_id_by_code('2010');
  v_shrinkage := public.get_account_id_by_code('5020');
  v_gain := public.get_account_id_by_code('4021');

  insert into public.journal_entries(entry_date, memo, source_table, source_id, source_event, created_by)
  values (
    v_mv.occurred_at,
    concat('Inventory movement ', v_mv.movement_type, ' ', v_mv.item_id),
    'inventory_movements',
    v_mv.id::text,
    v_mv.movement_type,
    v_mv.created_by
  )
  on conflict (source_table, source_id, source_event)
  do update set entry_date = excluded.entry_date, memo = excluded.memo
  returning id into v_entry_id;

  delete from public.journal_lines jl where jl.journal_entry_id = v_entry_id;

  if v_mv.movement_type = 'purchase_in' then
    insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo)
    values
      (v_entry_id, v_inventory, v_mv.total_cost, 0, 'Inventory increase'),
      (v_entry_id, v_ap, 0, v_mv.total_cost, 'Supplier payable');
  elsif v_mv.movement_type = 'sale_out' then
    insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo)
    values
      (v_entry_id, v_cogs, v_mv.total_cost, 0, 'COGS'),
      (v_entry_id, v_inventory, 0, v_mv.total_cost, 'Inventory decrease');
  elsif v_mv.movement_type = 'wastage_out' then
    insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo)
    values
      (v_entry_id, v_shrinkage, v_mv.total_cost, 0, 'Wastage'),
      (v_entry_id, v_inventory, 0, v_mv.total_cost, 'Inventory decrease');
  elsif v_mv.movement_type = 'adjust_out' then
    insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo)
    values
      (v_entry_id, v_shrinkage, v_mv.total_cost, 0, 'Adjustment out'),
      (v_entry_id, v_inventory, 0, v_mv.total_cost, 'Inventory decrease');
  elsif v_mv.movement_type = 'adjust_in' then
    insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo)
    values
      (v_entry_id, v_inventory, v_mv.total_cost, 0, 'Adjustment in'),
      (v_entry_id, v_gain, 0, v_mv.total_cost, 'Inventory gain');
  elsif v_mv.movement_type = 'return_in' then
    insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo)
    values
      (v_entry_id, v_inventory, v_mv.total_cost, 0, 'Inventory restore (return)'),
      (v_entry_id, v_cogs, 0, v_mv.total_cost, 'Reverse COGS');
  end if;
end;
$$;
revoke all on function public.post_inventory_movement(uuid) from public;
grant execute on function public.post_inventory_movement(uuid) to anon, authenticated;
