create or replace function public.trg_block_system_journal_entry_mutation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(old.source_table, '') <> '' and old.source_table <> 'manual' then
    raise exception 'GL is append-only: system journal entries are immutable';
  end if;
  return coalesce(new, old);
end;
$$;

drop trigger if exists trg_journal_entries_block_system_mutation on public.journal_entries;
create trigger trg_journal_entries_block_system_mutation
before update or delete on public.journal_entries
for each row execute function public.trg_block_system_journal_entry_mutation();

create or replace function public.trg_block_system_journal_lines_mutation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_source_table text;
begin
  select je.source_table
  into v_source_table
  from public.journal_entries je
  where je.id = old.journal_entry_id;

  if coalesce(v_source_table, '') <> '' and v_source_table <> 'manual' then
    raise exception 'GL is append-only: system journal lines cannot be changed';
  end if;

  return old;
end;
$$;

drop trigger if exists trg_journal_lines_block_system_mutation on public.journal_lines;
create trigger trg_journal_lines_block_system_mutation
before update or delete on public.journal_lines
for each row execute function public.trg_block_system_journal_lines_mutation();

create or replace function public.trg_block_journal_entries_in_closed_period()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_date timestamptz;
begin
  v_date := coalesce(new.entry_date, old.entry_date);
  if v_date is not null and public.is_in_closed_period(v_date) then
    raise exception 'accounting period is closed';
  end if;
  return coalesce(new, old);
end;
$$;

drop trigger if exists trg_journal_entries_block_closed_period on public.journal_entries;
create trigger trg_journal_entries_block_closed_period
before insert or update on public.journal_entries
for each row execute function public.trg_block_journal_entries_in_closed_period();

create or replace function public.reverse_journal_entry(p_journal_entry_id uuid, p_reason text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_src public.journal_entries%rowtype;
  v_new_entry_id uuid;
begin
  perform public._require_staff('accounting.post');

  if p_journal_entry_id is null then
    raise exception 'p_journal_entry_id is required';
  end if;

  select *
  into v_src
  from public.journal_entries je
  where je.id = p_journal_entry_id
  for update;

  if not found then
    raise exception 'journal entry not found';
  end if;

  if coalesce(v_src.source_table, '') = '' then
    raise exception 'not allowed';
  end if;

  if exists (
    select 1
    from public.journal_entries je
    where je.source_table = 'journal_entries'
      and je.source_id = p_journal_entry_id::text
      and je.source_event = 'reversal'
  ) then
    raise exception 'already reversed';
  end if;

  insert into public.journal_entries(entry_date, memo, source_table, source_id, source_event, created_by)
  values (
    now(),
    concat('REVERSAL of ', p_journal_entry_id::text, ': ', coalesce(nullif(p_reason,''), '')),
    'journal_entries',
    p_journal_entry_id::text,
    'reversal',
    auth.uid()
  )
  returning id into v_new_entry_id;

  insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo)
  select
    v_new_entry_id,
    jl.account_id,
    jl.credit,
    jl.debit,
    concat('Reversal: ', coalesce(jl.line_memo,''))
  from public.journal_lines jl
  where jl.journal_entry_id = p_journal_entry_id;

  perform public.check_journal_entry_balance(v_new_entry_id);

  return v_new_entry_id;
end;
$$;

revoke all on function public.reverse_journal_entry(uuid, text) from public;
grant execute on function public.reverse_journal_entry(uuid, text) to authenticated;

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
  perform public._require_staff('accounting.post');

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

  if v_mv.movement_type in ('transfer_out', 'transfer_in') then
    return;
  end if;

  v_inventory := public.get_account_id_by_code('1410');
  v_cogs := public.get_account_id_by_code('5010');
  v_ap := public.get_account_id_by_code('2010');
  v_shrinkage := public.get_account_id_by_code('5020');
  v_gain := public.get_account_id_by_code('4021');
  v_vat_input := public.get_account_id_by_code('1420');

  v_supplier_tax_total := coalesce(nullif((v_mv.data->>'supplier_tax_total')::numeric, null), 0);

  begin
    insert into public.journal_entries(entry_date, memo, source_table, source_id, source_event, created_by)
    values (
      v_mv.occurred_at,
      concat('Inventory movement ', v_mv.movement_type, ' ', v_mv.item_id),
      'inventory_movements',
      v_mv.id::text,
      v_mv.movement_type,
      v_mv.created_by
    )
    returning id into v_entry_id;
  exception
    when unique_violation then
      raise exception 'posting already exists for this source; create a reversal instead';
  end;

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
  elsif v_mv.movement_type in ('sale_out','expired_out','wastage_out') then
    insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo)
    values
      (v_entry_id, v_cogs, v_mv.total_cost, 0, case when v_mv.movement_type = 'sale_out' then 'COGS' else concat(v_mv.movement_type, ' (COGS)') end),
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
  elsif v_mv.movement_type = 'return_in' then
    insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo)
    values
      (v_entry_id, v_inventory, v_mv.total_cost, 0, 'Inventory restore (return)'),
      (v_entry_id, v_cogs, 0, v_mv.total_cost, 'Reverse COGS');
  end if;

  perform public.check_journal_entry_balance(v_entry_id);
end;
$$;

create or replace function public.post_order_delivery(p_order_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order record;
  v_entry_id uuid;
  v_total numeric;
  v_ar uuid;
  v_deposits uuid;
  v_sales uuid;
  v_delivery_income uuid;
  v_vat_payable uuid;
  v_delivered_at timestamptz;
  v_deposits_paid numeric;
  v_ar_amount numeric;
  v_subtotal numeric;
  v_discount_amount numeric;
  v_delivery_fee numeric;
  v_tax_amount numeric;
  v_items_revenue numeric;
begin
  perform public._require_staff('accounting.post');

  if p_order_id is null then
    raise exception 'p_order_id is required';
  end if;

  select o.*
  into v_order
  from public.orders o
  where o.id = p_order_id;

  if not found then
    raise exception 'order not found';
  end if;

  v_total := coalesce(nullif((v_order.data->>'total')::numeric, null), 0);
  if v_total <= 0 then
    return;
  end if;

  v_ar := public.get_account_id_by_code('1200');
  v_deposits := public.get_account_id_by_code('2050');
  v_sales := public.get_account_id_by_code('4010');
  v_delivery_income := public.get_account_id_by_code('4020');
  v_vat_payable := public.get_account_id_by_code('2020');

  v_subtotal := coalesce(nullif((v_order.data->>'subtotal')::numeric, null), 0);
  v_discount_amount := coalesce(nullif((v_order.data->>'discountAmount')::numeric, null), 0);
  v_delivery_fee := coalesce(nullif((v_order.data->>'deliveryFee')::numeric, null), 0);
  v_tax_amount := coalesce(nullif((v_order.data->>'taxAmount')::numeric, null), 0);

  v_tax_amount := least(greatest(0, v_tax_amount), v_total);
  v_delivery_fee := least(greatest(0, v_delivery_fee), v_total - v_tax_amount);
  v_items_revenue := greatest(0, v_total - v_delivery_fee - v_tax_amount);

  v_delivered_at := public.order_delivered_at(p_order_id);
  if v_delivered_at is null then
    v_delivered_at := coalesce(v_order.updated_at, now());
  end if;

  select coalesce(sum(p.amount), 0)
  into v_deposits_paid
  from public.payments p
  where p.reference_table = 'orders'
    and p.reference_id = p_order_id::text
    and p.direction = 'in'
    and p.occurred_at < v_delivered_at;

  v_deposits_paid := least(v_total, greatest(0, coalesce(v_deposits_paid, 0)));
  v_ar_amount := greatest(0, v_total - v_deposits_paid);

  begin
    insert into public.journal_entries(entry_date, memo, source_table, source_id, source_event, created_by)
    values (
      coalesce(v_order.updated_at, now()),
      concat('Order delivered ', v_order.id::text),
      'orders',
      v_order.id::text,
      'delivered',
      auth.uid()
    )
    returning id into v_entry_id;
  exception
    when unique_violation then
      raise exception 'posting already exists for this source; create a reversal instead';
  end;

  if v_deposits_paid > 0 then
    insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo)
    values (v_entry_id, v_deposits, v_deposits_paid, 0, 'Apply customer deposit');
  end if;

  if v_ar_amount > 0 then
    insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo)
    values (v_entry_id, v_ar, v_ar_amount, 0, 'Accounts receivable');
  end if;

  if v_items_revenue > 0 then
    insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo)
    values (v_entry_id, v_sales, 0, v_items_revenue, 'Sales revenue');
  end if;

  if v_delivery_fee > 0 and v_delivery_income is not null then
    insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo)
    values (v_entry_id, v_delivery_income, 0, v_delivery_fee, 'Delivery income');
  end if;

  if v_tax_amount > 0 and v_vat_payable is not null then
    insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo)
    values (v_entry_id, v_vat_payable, 0, v_tax_amount, 'VAT payable');
  end if;

  perform public.check_journal_entry_balance(v_entry_id);
end;
$$;

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
  perform public._require_staff('accounting.post');

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
    begin
      insert into public.journal_entries(entry_date, memo, source_table, source_id, source_event, created_by)
      values (
        v_pay.occurred_at,
        concat('Order payment ', coalesce(v_pay.reference_id, v_pay.id::text)),
        'payments',
        v_pay.id::text,
        concat('in:orders:', coalesce(v_pay.reference_id, '')),
        v_pay.created_by
      )
      returning id into v_entry_id;
    exception
      when unique_violation then
        raise exception 'posting already exists for this source; create a reversal instead';
    end;

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

    perform public.check_journal_entry_balance(v_entry_id);
    return;
  end if;

  if v_pay.direction = 'out' and v_pay.reference_table = 'purchase_orders' then
    begin
      insert into public.journal_entries(entry_date, memo, source_table, source_id, source_event, created_by)
      values (
        v_pay.occurred_at,
        concat('Supplier payment ', coalesce(v_pay.reference_id, v_pay.id::text)),
        'payments',
        v_pay.id::text,
        concat('out:purchase_orders:', coalesce(v_pay.reference_id, '')),
        v_pay.created_by
      )
      returning id into v_entry_id;
    exception
      when unique_violation then
        raise exception 'posting already exists for this source; create a reversal instead';
    end;

    insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo)
    values
      (v_entry_id, v_ap, v_pay.amount, 0, 'Settle payable'),
      (v_entry_id, v_credit_account, 0, v_pay.amount, 'Cash/Bank paid');

    perform public.check_journal_entry_balance(v_entry_id);
    return;
  end if;

  if v_pay.direction = 'out' and v_pay.reference_table = 'expenses' then
    begin
      insert into public.journal_entries(entry_date, memo, source_table, source_id, source_event, created_by)
      values (
        v_pay.occurred_at,
        concat('Expense payment ', coalesce(v_pay.reference_id, v_pay.id::text)),
        'payments',
        v_pay.id::text,
        concat('out:expenses:', coalesce(v_pay.reference_id, '')),
        v_pay.created_by
      )
      returning id into v_entry_id;
    exception
      when unique_violation then
        raise exception 'posting already exists for this source; create a reversal instead';
    end;

    insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo)
    values
      (v_entry_id, v_expenses, v_pay.amount, 0, 'Operating expense'),
      (v_entry_id, v_credit_account, 0, v_pay.amount, 'Cash/Bank paid');

    perform public.check_journal_entry_balance(v_entry_id);
    return;
  end if;
end;
$$;

create or replace function public.trg_freeze_posting_engine()
returns event_trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cmd record;
  v_upgrade text;
begin
  v_upgrade := current_setting('app.posting_engine_upgrade', true);
  if v_upgrade = '1' then
    return;
  end if;

  for v_cmd in
    select *
    from pg_event_trigger_ddl_commands()
  loop
    if v_cmd.object_type = 'function'
      and coalesce(v_cmd.schema_name,'') = 'public'
      and (
        v_cmd.object_identity like 'function public.post_inventory_movement(%'
        or v_cmd.object_identity like 'function public.post_order_delivery(%'
        or v_cmd.object_identity like 'function public.post_payment(%'
      )
    then
      raise exception 'posting engine frozen: overriding post_* functions is forbidden';
    end if;
  end loop;
end;
$$;

drop event trigger if exists trg_freeze_posting_engine;
create event trigger trg_freeze_posting_engine
on ddl_command_end
when tag in ('CREATE FUNCTION', 'ALTER FUNCTION', 'DROP FUNCTION')
execute function public.trg_freeze_posting_engine();
