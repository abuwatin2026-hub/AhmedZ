create or replace function public.receive_purchase_order(p_order_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_po record;
  v_pi record;
  v_old_qty numeric;
  v_old_avg numeric;
  v_new_qty numeric;
  v_effective_unit_cost numeric;
  v_new_avg numeric;
  v_movement_id uuid;
  v_supplier_tax_unit numeric;
begin
  select *
  into v_po
  from public.purchase_orders
  where id = p_order_id
  for update;

  if not found then
    raise exception 'purchase order not found';
  end if;

  if v_po.status = 'cancelled' then
    raise exception 'cannot receive cancelled purchase order';
  end if;

  for v_pi in
    select pi.item_id, pi.quantity, pi.unit_cost
    from public.purchase_items pi
    where pi.purchase_order_id = p_order_id
  loop
    insert into public.stock_management(item_id, available_quantity, reserved_quantity, unit, low_stock_threshold, last_updated, data)
    select v_pi.item_id, 0, 0, coalesce(mi.unit_type, 'piece'), 5, now(), '{}'::jsonb
    from public.menu_items mi
    where mi.id = v_pi.item_id
    on conflict (item_id) do nothing;

    select coalesce(sm.available_quantity, 0), coalesce(sm.avg_cost, 0)
    into v_old_qty, v_old_avg
    from public.stock_management sm
    where sm.item_id = v_pi.item_id
    for update;

    select (v_pi.unit_cost + coalesce(mi.transport_cost, 0))
    into v_effective_unit_cost
    from public.menu_items mi
    where mi.id = v_pi.item_id;

    select coalesce(mi.supply_tax_cost, 0)
    into v_supplier_tax_unit
    from public.menu_items mi
    where mi.id = v_pi.item_id;

    v_new_qty := v_old_qty + v_pi.quantity;
    if v_new_qty <= 0 then
      v_new_avg := v_effective_unit_cost;
    else
      v_new_avg := ((v_old_qty * v_old_avg) + (v_pi.quantity * v_effective_unit_cost)) / v_new_qty;
    end if;

    update public.stock_management
    set available_quantity = available_quantity + v_pi.quantity,
        avg_cost = v_new_avg,
        last_updated = now(),
        updated_at = now()
    where item_id = v_pi.item_id;

    update public.menu_items
    set buying_price = v_pi.unit_cost,
        cost_price = v_new_avg,
        updated_at = now()
    where id = v_pi.item_id;

    insert into public.inventory_movements(
      item_id, movement_type, quantity, unit_cost, total_cost,
      reference_table, reference_id, occurred_at, created_by, data
    )
    values (
      v_pi.item_id, 'purchase_in', v_pi.quantity, v_effective_unit_cost, (v_pi.quantity * v_effective_unit_cost),
      'purchase_orders', p_order_id::text, now(), auth.uid(),
      jsonb_build_object(
        'purchaseOrderId', p_order_id,
        'supplier_tax_unit', v_supplier_tax_unit,
        'supplier_tax_total', coalesce(v_supplier_tax_unit, 0) * v_pi.quantity
      )
    )
    returning id into v_movement_id;

    perform public.post_inventory_movement(v_movement_id);
  end loop;

  update public.purchase_orders
  set status = 'completed',
      updated_at = now()
  where id = p_order_id;
end;
$$;
revoke all on function public.receive_purchase_order(uuid) from public;
grant execute on function public.receive_purchase_order(uuid) to anon, authenticated;
create or replace function public.receive_purchase_order_partial(
  p_order_id uuid,
  p_items jsonb,
  p_occurred_at timestamptz default now()
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_po record;
  v_item jsonb;
  v_item_id text;
  v_qty numeric;
  v_unit_cost numeric;
  v_effective_unit_cost numeric;
  v_old_qty numeric;
  v_old_avg numeric;
  v_new_qty numeric;
  v_new_avg numeric;
  v_ordered numeric;
  v_received numeric;
  v_receipt_id uuid;
  v_receipt_total numeric := 0;
  v_movement_id uuid;
  v_all_received boolean := true;
begin
  if not public.is_admin() then
    raise exception 'not allowed';
  end if;

  if p_order_id is null then
    raise exception 'p_order_id is required';
  end if;

  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    raise exception 'p_items must be a json array';
  end if;

  select *
  into v_po
  from public.purchase_orders
  where id = p_order_id
  for update;

  if not found then
    raise exception 'purchase order not found';
  end if;

  if v_po.status = 'cancelled' then
    raise exception 'cannot receive cancelled purchase order';
  end if;

  insert into public.purchase_receipts(purchase_order_id, received_at, created_by)
  values (p_order_id, coalesce(p_occurred_at, now()), auth.uid())
  returning id into v_receipt_id;

  for v_item in select value from jsonb_array_elements(p_items)
  loop
    v_item_id := coalesce(v_item->>'itemId', v_item->>'id');
    v_qty := coalesce(nullif(v_item->>'quantity', '')::numeric, 0);
    v_unit_cost := coalesce(nullif(v_item->>'unitCost', '')::numeric, 0);

    if v_item_id is null or v_item_id = '' then
      raise exception 'Invalid itemId';
    end if;

    if v_qty <= 0 then
      continue;
    end if;

    select coalesce(pi.quantity, 0), coalesce(pi.received_quantity, 0), coalesce(pi.unit_cost, 0)
    into v_ordered, v_received, v_unit_cost
    from public.purchase_items pi
    where pi.purchase_order_id = p_order_id
      and pi.item_id = v_item_id
    for update;

    if not found then
      raise exception 'item % not found in purchase order', v_item_id;
    end if;

    if (v_received + v_qty) > (v_ordered + 1e-9) then
      raise exception 'received exceeds ordered for item % (ordered %, received %, add %)', v_item_id, v_ordered, v_received, v_qty;
    end if;

    insert into public.stock_management(item_id, available_quantity, reserved_quantity, unit, low_stock_threshold, last_updated, data)
    select v_item_id, 0, 0, coalesce(mi.unit_type, 'piece'), 5, now(), '{}'::jsonb
    from public.menu_items mi
    where mi.id = v_item_id
    on conflict (item_id) do nothing;

    select coalesce(sm.available_quantity, 0), coalesce(sm.avg_cost, 0)
    into v_old_qty, v_old_avg
    from public.stock_management sm
    where sm.item_id = v_item_id
    for update;

    select (v_unit_cost + coalesce(mi.transport_cost, 0))
    into v_effective_unit_cost
    from public.menu_items mi
    where mi.id = v_item_id;

    v_new_qty := v_old_qty + v_qty;
    if v_new_qty <= 0 then
      v_new_avg := v_effective_unit_cost;
    else
      v_new_avg := ((v_old_qty * v_old_avg) + (v_qty * v_effective_unit_cost)) / v_new_qty;
    end if;

    update public.stock_management
    set available_quantity = available_quantity + v_qty,
        avg_cost = v_new_avg,
        last_updated = now(),
        updated_at = now()
    where item_id = v_item_id;

    update public.menu_items
    set buying_price = v_unit_cost,
        cost_price = v_new_avg,
        updated_at = now()
    where id = v_item_id;

    update public.purchase_items
    set received_quantity = received_quantity + v_qty
    where purchase_order_id = p_order_id
      and item_id = v_item_id;

    insert into public.purchase_receipt_items(receipt_id, item_id, quantity, unit_cost, total_cost)
    values (v_receipt_id, v_item_id, v_effective_unit_cost, (v_qty * v_effective_unit_cost));

    v_receipt_total := v_receipt_total + (v_qty * v_effective_unit_cost);

    insert into public.inventory_movements(
      item_id, movement_type, quantity, unit_cost, total_cost,
      reference_table, reference_id, occurred_at, created_by, data
    )
    values (
      v_item_id, 'purchase_in', v_qty, v_effective_unit_cost, (v_qty * v_effective_unit_cost),
      'purchase_receipts', v_receipt_id::text, coalesce(p_occurred_at, now()), auth.uid(),
      jsonb_build_object(
        'purchaseOrderId', p_order_id,
        'purchaseReceiptId', v_receipt_id,
        'supplier_tax_unit', coalesce((select mi.supply_tax_cost from public.menu_items mi where mi.id = v_item_id), 0),
        'supplier_tax_total', coalesce((select mi.supply_tax_cost from public.menu_items mi where mi.id = v_item_id), 0) * v_qty
      )
    )
    returning id into v_movement_id;

    perform public.post_inventory_movement(v_movement_id);
  end loop;

  for v_item_id, v_ordered, v_received in
    select pi.item_id, coalesce(pi.quantity, 0), coalesce(pi.received_quantity, 0)
    from public.purchase_items pi
    where pi.purchase_order_id = p_order_id
  loop
    if (v_received + 1e-9) < v_ordered then
      v_all_received := false;
      exit;
    end if;
  end loop;

  update public.purchase_orders
  set status = case when v_all_received then 'completed' else 'partial' end,
      updated_at = now()
  where id = p_order_id;

  return v_receipt_id;
end;
$$;
revoke all on function public.receive_purchase_order_partial(uuid, jsonb, timestamptz) from public;
grant execute on function public.receive_purchase_order_partial(uuid, jsonb, timestamptz) to anon, authenticated;
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
  v_vat_input uuid;
  v_supplier_tax_total numeric;
  v_net_cost numeric;
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

  if v_mv.reference_table = 'production_orders' then
    return;
  end if;

  v_inventory := public.get_account_id_by_code('1410');
  v_cogs := public.get_account_id_by_code('5010');
  v_ap := public.get_account_id_by_code('2010');
  v_shrinkage := public.get_account_id_by_code('5020');
  v_gain := public.get_account_id_by_code('4021');
  v_vat_input := public.get_account_id_by_code('1420');
  v_supplier_tax_total := coalesce(nullif((v_mv.data->>'supplier_tax_total')::numeric, null), 0);

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
    if v_supplier_tax_total > 0 and v_vat_input is not null then
      v_net_cost := greatest(0, v_mv.total_cost - v_supplier_tax_total);
      insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo)
      values
        (v_entry_id, v_inventory, v_net_cost, 0, 'Inventory increase (net)'),
        (v_entry_id, v_vat_input, v_supplier_tax_total, 0, 'VAT recoverable'),
        (v_entry_id, v_ap, 0, v_mv.total_cost, 'Supplier payable');
    else
      insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo)
      values
        (v_entry_id, v_inventory, v_mv.total_cost, 0, 'Inventory increase'),
        (v_entry_id, v_ap, 0, v_mv.total_cost, 'Supplier payable');
    end if;
  elsif v_mv.movement_type = 'sale_out' then
    insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo)
    values
      (v_entry_id, v_cogs, v_mv.total_cost, 0, 'COGS'),
      (v_entry_id, v_inventory, 0, v_mv.total_cost, 'Inventory decrease');
  elsif v_mv.movement_type = 'return_in' then
    insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo)
    values
      (v_entry_id, v_inventory, v_mv.total_cost, 0, 'Inventory restore (return)'),
      (v_entry_id, v_cogs, 0, v_mv.total_cost, 'Reverse COGS');
  elsif v_mv.movement_type = 'return_out' then
    insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo)
    values
      (v_entry_id, v_ap, v_mv.total_cost, 0, 'Vendor credit'),
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
  end if;
end;
$$;
revoke all on function public.post_inventory_movement(uuid) from public;
grant execute on function public.post_inventory_movement(uuid) to anon, authenticated;
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
  v_sales uuid;
  v_ap uuid;
  v_expenses uuid;
  v_debit_account uuid;
  v_credit_account uuid;
  v_ar uuid;
  v_deposits uuid;
  v_delivered_at timestamptz;
begin
  if p_payment_id is null then
    raise exception 'p_payment_id is required';
  end if;

  select *
  into v_pay
  from public.payments p
  where p.id = p_payment_id;

  if not found then
    raise exception 'payment not found';
  end if;

  v_cash := public.get_account_id_by_code('1010');
  v_bank := public.get_account_id_by_code('1020');
  v_sales := public.get_account_id_by_code('4010');
  v_ap := public.get_account_id_by_code('2010');
  v_expenses := public.get_account_id_by_code('6100');
  v_ar := public.get_account_id_by_code('1200');
  v_deposits := public.get_account_id_by_code('2050');

  if v_pay.method = 'cash' then
    v_debit_account := v_cash;
    v_credit_account := v_cash;
  else
    v_debit_account := v_bank;
    v_credit_account := v_bank;
  end if;

  if v_pay.direction = 'in' and v_pay.reference_table = 'orders' then
    insert into public.journal_entries(entry_date, memo, source_table, source_id, source_event, created_by)
    values (
      v_pay.occurred_at,
      concat('Order payment ', coalesce(v_pay.reference_id, v_pay.id::text)),
      'payments',
      v_pay.id::text,
      concat('in:orders:', coalesce(v_pay.reference_id, '')),
      v_pay.created_by
    )
    on conflict (source_table, source_id, source_event)
    do update set entry_date = excluded.entry_date, memo = excluded.memo
    returning id into v_entry_id;

    delete from public.journal_lines jl where jl.journal_entry_id = v_entry_id;

    begin
      select public.order_delivered_at((v_pay.reference_id)::uuid) into v_delivered_at;
    exception when others then
      v_delivered_at := null;
    end;
    if v_delivered_at is null or v_pay.occurred_at < v_delivered_at then
      insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo)
      values
        (v_entry_id, v_debit_account, v_pay.amount, 0, 'Cash/Bank received'),
        (v_entry_id, v_deposits, 0, v_pay.amount, 'Customer deposit');
    else
      insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo)
      values
        (v_entry_id, v_debit_account, v_pay.amount, 0, 'Cash/Bank received'),
        (v_entry_id, v_ar, 0, v_pay.amount, 'Settle accounts receivable');
    end if;
    return;
  end if;

  if v_pay.direction = 'out' and v_pay.reference_table = 'purchase_orders' then
    insert into public.journal_entries(entry_date, memo, source_table, source_id, source_event, created_by)
    values (
      v_pay.occurred_at,
      concat('Supplier payment ', coalesce(v_pay.reference_id, v_pay.id::text)),
      'payments',
      v_pay.id::text,
      concat('out:purchase_orders:', coalesce(v_pay.reference_id, '')),
      v_pay.created_by
    )
    on conflict (source_table, source_id, source_event)
    do update set entry_date = excluded.entry_date, memo = excluded.memo
    returning id into v_entry_id;

    delete from public.journal_lines jl where jl.journal_entry_id = v_entry_id;

    insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo)
    values
      (v_entry_id, v_ap, v_pay.amount, 0, 'Settle payable'),
      (v_entry_id, v_credit_account, 0, v_pay.amount, 'Cash/Bank paid');
    return;
  end if;

  if v_pay.direction = 'out' and v_pay.reference_table = 'expenses' then
    insert into public.journal_entries(entry_date, memo, source_table, source_id, source_event, created_by)
    values (
      v_pay.occurred_at,
      concat('Expense payment ', coalesce(v_pay.reference_id, v_pay.id::text)),
      'payments',
      v_pay.id::text,
      concat('out:expenses:', coalesce(v_pay.reference_id, '')),
      v_pay.created_by
    )
    on conflict (source_table, source_id, source_event)
    do update set entry_date = excluded.entry_date, memo = excluded.memo
    returning id into v_entry_id;

    delete from public.journal_lines jl where jl.journal_entry_id = v_entry_id;

    insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo)
    values
      (v_entry_id, v_expenses, v_pay.amount, 0, 'Operating expense'),
      (v_entry_id, v_credit_account, 0, v_pay.amount, 'Cash/Bank paid');
    return;
  end if;
end;
$$;
revoke all on function public.post_payment(uuid) from public;
grant execute on function public.post_payment(uuid) to anon, authenticated;
create table if not exists public.production_orders (
  id uuid primary key default gen_random_uuid(),
  occurred_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  notes text,
  created_at timestamptz not null default now()
);
create index if not exists idx_production_orders_date on public.production_orders(occurred_at desc);
alter table public.production_orders enable row level security;
drop policy if exists production_orders_admin_only on public.production_orders;
create policy production_orders_admin_only
on public.production_orders
for all
using (public.is_admin())
with check (public.is_admin());
create table if not exists public.production_order_inputs (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.production_orders(id) on delete cascade,
  item_id text not null references public.menu_items(id) on delete cascade,
  quantity numeric not null check (quantity > 0),
  unit_cost numeric not null default 0,
  total_cost numeric not null default 0
);
create index if not exists idx_prod_inputs_order on public.production_order_inputs(order_id);
alter table public.production_order_inputs enable row level security;
drop policy if exists production_order_inputs_admin_only on public.production_order_inputs;
create policy production_order_inputs_admin_only
on public.production_order_inputs
for all
using (public.is_admin())
with check (public.is_admin());
create table if not exists public.production_order_outputs (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.production_orders(id) on delete cascade,
  item_id text not null references public.menu_items(id) on delete cascade,
  quantity numeric not null check (quantity > 0),
  unit_cost numeric not null default 0,
  total_cost numeric not null default 0
);
create index if not exists idx_prod_outputs_order on public.production_order_outputs(order_id);
alter table public.production_order_outputs enable row level security;
drop policy if exists production_order_outputs_admin_only on public.production_order_outputs;
create policy production_order_outputs_admin_only
on public.production_order_outputs
for all
using (public.is_admin())
with check (public.is_admin());
create or replace function public.create_production_order(
  p_inputs jsonb,
  p_outputs jsonb,
  p_notes text default null,
  p_occurred_at timestamptz default now()
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order_id uuid;
  v_in jsonb;
  v_out jsonb;
  v_item_id text;
  v_qty numeric;
  v_old_qty numeric;
  v_old_avg numeric;
  v_unit_cost numeric;
  v_total_cost numeric;
  v_inputs_total_cost numeric := 0;
  v_outputs_total_qty numeric := 0;
  v_out_unit_cost numeric := 0;
  v_movement_id uuid;
begin
  if not public.is_admin() then
    raise exception 'not allowed';
  end if;
  if p_inputs is null or jsonb_typeof(p_inputs) <> 'array' then
    raise exception 'p_inputs must be a json array';
  end if;
  if p_outputs is null or jsonb_typeof(p_outputs) <> 'array' then
    raise exception 'p_outputs must be a json array';
  end if;

  insert into public.production_orders(occurred_at, created_by, notes)
  values (coalesce(p_occurred_at, now()), auth.uid(), p_notes)
  returning id into v_order_id;

  for v_in in select value from jsonb_array_elements(p_inputs)
  loop
    v_item_id := v_in->>'itemId';
    v_qty := coalesce(nullif(v_in->>'quantity', '')::numeric, 0);
    if v_item_id is null or v_item_id = '' then
      raise exception 'Invalid input itemId';
    end if;
    if v_qty <= 0 then
      continue;
    end if;

    select coalesce(sm.available_quantity, 0), coalesce(sm.avg_cost, 0)
    into v_old_qty, v_old_avg
    from public.stock_management sm
    where sm.item_id = v_item_id
    for update;
    if not found then
      raise exception 'Stock record not found for input %', v_item_id;
    end if;
    if (v_old_qty + 1e-9) < v_qty then
      raise exception 'Insufficient stock for input % (available %, requested %)', v_item_id, v_old_qty, v_qty;
    end if;

    v_unit_cost := v_old_avg;
    v_total_cost := v_unit_cost * v_qty;
    v_inputs_total_cost := v_inputs_total_cost + v_total_cost;

    update public.stock_management
    set available_quantity = greatest(0, available_quantity - v_qty),
        last_updated = now(),
        updated_at = now()
    where item_id = v_item_id;

    insert into public.production_order_inputs(order_id, item_id, quantity, unit_cost, total_cost)
    values (v_order_id, v_item_id, v_qty, v_unit_cost, v_total_cost);

    insert into public.inventory_movements(
      item_id, movement_type, quantity, unit_cost, total_cost,
      reference_table, reference_id, occurred_at, created_by, data
    )
    values (
      v_item_id, 'adjust_out', v_qty, v_unit_cost, v_total_cost,
      'production_orders', v_order_id::text, coalesce(p_occurred_at, now()), auth.uid(),
      jsonb_build_object('reason', 'production_consume', 'productionOrderId', v_order_id)
    )
    returning id into v_movement_id;
  end loop;

  for v_out in select value from jsonb_array_elements(p_outputs)
  loop
    v_outputs_total_qty := v_outputs_total_qty + coalesce(nullif(v_out->>'quantity', '')::numeric, 0);
  end loop;
  if v_outputs_total_qty <= 0 then
    raise exception 'Total output quantity must be > 0';
  end if;
  v_out_unit_cost := v_inputs_total_cost / v_outputs_total_qty;

  for v_out in select value from jsonb_array_elements(p_outputs)
  loop
    v_item_id := v_out->>'itemId';
    v_qty := coalesce(nullif(v_out->>'quantity', '')::numeric, 0);
    if v_item_id is null or v_item_id = '' then
      raise exception 'Invalid output itemId';
    end if;
    if v_qty <= 0 then
      continue;
    end if;

    select coalesce(sm.available_quantity, 0), coalesce(sm.avg_cost, 0)
    into v_old_qty, v_old_avg
    from public.stock_management sm
    where sm.item_id = v_item_id
    for update;

    v_unit_cost := v_out_unit_cost;
    v_total_cost := v_unit_cost * v_qty;

    update public.stock_management
    set available_quantity = available_quantity + v_qty,
        avg_cost = case when (coalesce(v_old_qty, 0) + v_qty) <= 1e-9
                        then v_unit_cost
                        else ((coalesce(v_old_qty, 0) * coalesce(v_old_avg, 0)) + (v_qty * v_unit_cost)) / (coalesce(v_old_qty, 0) + v_qty)
                   end,
        last_updated = now(),
        updated_at = now()
    where item_id = v_item_id;

    insert into public.production_order_outputs(order_id, item_id, quantity, unit_cost, total_cost)
    values (v_order_id, v_item_id, v_qty, v_unit_cost, v_total_cost);

    insert into public.inventory_movements(
      item_id, movement_type, quantity, unit_cost, total_cost,
      reference_table, reference_id, occurred_at, created_by, data
    )
    values (
      v_item_id, 'adjust_in', v_qty, v_unit_cost, v_total_cost,
      'production_orders', v_order_id::text, coalesce(p_occurred_at, now()), auth.uid(),
      jsonb_build_object('reason', 'production_output', 'productionOrderId', v_order_id)
    )
    returning id into v_movement_id;
  end loop;

  perform public.post_production_order(v_order_id);
  return v_order_id;
end;
$$;
revoke all on function public.create_production_order(jsonb, jsonb, text, timestamptz) from public;
grant execute on function public.create_production_order(jsonb, jsonb, text, timestamptz) to anon, authenticated;
create or replace function public.post_production_order(p_order_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_entry_id uuid;
  v_inventory uuid;
  v_shrinkage uuid;
  v_gain uuid;
  v_inputs_total numeric;
  v_outputs_total numeric;
begin
  if p_order_id is null then
    raise exception 'p_order_id is required';
  end if;
  v_inventory := public.get_account_id_by_code('1410');
  v_shrinkage := public.get_account_id_by_code('5020');
  v_gain := public.get_account_id_by_code('4021');

  select coalesce(sum(total_cost), 0) into v_inputs_total
  from public.production_order_inputs where order_id = p_order_id;
  select coalesce(sum(total_cost), 0) into v_outputs_total
  from public.production_order_outputs where order_id = p_order_id;

  insert into public.journal_entries(entry_date, memo, source_table, source_id, source_event, created_by)
  values (
    coalesce((select occurred_at from public.production_orders where id = p_order_id), now()),
    concat('Production order ', p_order_id::text),
    'production_orders',
    p_order_id::text,
    'posted',
    auth.uid()
  )
  on conflict (source_table, source_id, source_event)
  do update set entry_date = excluded.entry_date, memo = excluded.memo
  returning id into v_entry_id;

  delete from public.journal_lines jl where jl.journal_entry_id = v_entry_id;

  if v_outputs_total > 0 then
    insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo)
    values (v_entry_id, v_inventory, v_outputs_total, 0, 'Production outputs to inventory');
  end if;
  if v_inputs_total > 0 then
    insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo)
    values (v_entry_id, v_inventory, 0, v_inputs_total, 'Production inputs from inventory');
  end if;

  if abs(v_outputs_total - v_inputs_total) > 1e-6 then
    if v_outputs_total > v_inputs_total then
      insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo)
      values (v_entry_id, v_gain, 0, v_outputs_total - v_inputs_total, 'Production variance (gain)');
    else
      insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo)
      values (v_entry_id, v_shrinkage, v_inputs_total - v_outputs_total, 0, 'Production variance (loss)');
    end if;
  end if;
end;
$$;
revoke all on function public.post_production_order(uuid) from public;
grant execute on function public.post_production_order(uuid) to anon, authenticated;
