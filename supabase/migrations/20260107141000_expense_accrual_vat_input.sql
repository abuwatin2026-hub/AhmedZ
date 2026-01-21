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
      insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo)
      values
        (v_entry_id, v_inventory, v_mv.total_cost, 0, 'Inventory increase (net)'),
        (v_entry_id, v_vat_input, v_supplier_tax_total, 0, 'VAT recoverable'),
        (v_entry_id, v_ap, 0, v_mv.total_cost + v_supplier_tax_total, 'Supplier payable');
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
  elsif v_mv.movement_type = 'return_out' then
    insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo)
    values
      (v_entry_id, v_ap, v_mv.total_cost, 0, 'Vendor credit'),
      (v_entry_id, v_inventory, 0, v_mv.total_cost, 'Inventory decrease');
  end if;
end;
$$;
revoke all on function public.post_inventory_movement(uuid) from public;
grant execute on function public.post_inventory_movement(uuid) to anon, authenticated;
create or replace function public.record_expense_accrual(
  p_expense_id uuid,
  p_amount numeric,
  p_occurred_at timestamptz default now()
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_amount numeric;
  v_entry_id uuid;
  v_expenses uuid;
  v_ap uuid;
begin
  if not public.is_admin() then
    raise exception 'not allowed';
  end if;

  if p_expense_id is null then
    raise exception 'p_expense_id is required';
  end if;

  select coalesce(p_amount, 0)
  into v_amount;
  if v_amount <= 0 then
    select coalesce(e.amount, 0)
    into v_amount
    from public.expenses e
    where e.id = p_expense_id;
  end if;
  if v_amount <= 0 then
    raise exception 'invalid amount';
  end if;

  v_expenses := public.get_account_id_by_code('6100');
  v_ap := public.get_account_id_by_code('2010');
  if v_expenses is null or v_ap is null then
    raise exception 'required accounts not found';
  end if;

  insert into public.journal_entries(entry_date, memo, source_table, source_id, source_event, created_by)
  values (
    coalesce(p_occurred_at, now()),
    concat('Expense accrual ', p_expense_id::text),
    'expenses',
    p_expense_id::text,
    'accrual',
    auth.uid()
  )
  on conflict (source_table, source_id, source_event)
  do update set entry_date = excluded.entry_date, memo = excluded.memo
  returning id into v_entry_id;

  delete from public.journal_lines jl where jl.journal_entry_id = v_entry_id;

  insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo)
  values
    (v_entry_id, v_expenses, v_amount, 0, 'Accrued expense'),
    (v_entry_id, v_ap, 0, v_amount, 'Accounts payable');
end;
$$;
revoke all on function public.record_expense_accrual(uuid, numeric, timestamptz) from public;
grant execute on function public.record_expense_accrual(uuid, numeric, timestamptz) to anon, authenticated;
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
  v_debit_account uuid;
  v_credit_account uuid;
  v_order_id uuid;
  v_delivered_at timestamptz;
  v_has_accrual boolean := false;
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
  v_ar := public.get_account_id_by_code('1200');
  v_deposits := public.get_account_id_by_code('2050');
  v_ap := public.get_account_id_by_code('2010');
  v_expenses := public.get_account_id_by_code('6100');

  if v_pay.method = 'cash' then
    v_debit_account := v_cash;
    v_credit_account := v_cash;
  else
    v_debit_account := v_bank;
    v_credit_account := v_bank;
  end if;

  if v_pay.direction = 'in' and v_pay.reference_table = 'orders' then
    v_order_id := nullif(v_pay.reference_id, '')::uuid;
    if v_order_id is null then
      raise exception 'invalid order reference_id';
    end if;

    v_delivered_at := public.order_delivered_at(v_order_id);

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

    if v_delivered_at is null or v_pay.occurred_at < v_delivered_at then
      insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo)
      values
        (v_entry_id, v_debit_account, v_pay.amount, 0, 'Cash/Bank received'),
        (v_entry_id, v_deposits, 0, v_pay.amount, 'Customer deposit');
    else
      insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo)
      values
        (v_entry_id, v_debit_account, v_pay.amount, 0, 'Cash/Bank received'),
        (v_entry_id, v_ar, 0, v_pay.amount, 'Settle receivable');
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
    v_has_accrual := exists(
      select 1
      from public.journal_entries je
      where je.source_table = 'expenses'
        and je.source_id = coalesce(v_pay.reference_id, '')
        and je.source_event = 'accrual'
    );

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

    if v_has_accrual then
      insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo)
      values
        (v_entry_id, v_ap, v_pay.amount, 0, 'Settle payable'),
        (v_entry_id, v_credit_account, 0, v_pay.amount, 'Cash/Bank paid');
    else
      insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo)
      values
        (v_entry_id, v_expenses, v_pay.amount, 0, 'Operating expense'),
        (v_entry_id, v_credit_account, 0, v_pay.amount, 'Cash/Bank paid');
    end if;
    return;
  end if;
end;
$$;
revoke all on function public.post_payment(uuid) from public;
grant execute on function public.post_payment(uuid) to anon, authenticated;
