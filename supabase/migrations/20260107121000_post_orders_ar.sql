create or replace function public.order_delivered_at(p_order_id uuid)
returns timestamptz
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (
      select min(oe.created_at)
      from public.order_events oe
      where oe.order_id = p_order_id
        and oe.to_status = 'delivered'
    ),
    (
      select case when o.status = 'delivered' then o.updated_at else null end
      from public.orders o
      where o.id = p_order_id
      limit 1
    )
  );
$$;
revoke all on function public.order_delivered_at(uuid) from public;
grant execute on function public.order_delivered_at(uuid) to anon, authenticated;
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

  insert into public.journal_entries(entry_date, memo, source_table, source_id, source_event, created_by)
  values (
    coalesce(v_order.updated_at, now()),
    concat('Order delivered ', v_order.id::text),
    'orders',
    v_order.id::text,
    'delivered',
    auth.uid()
  )
  on conflict (source_table, source_id, source_event)
  do update set entry_date = excluded.entry_date, memo = excluded.memo
  returning id into v_entry_id;

  delete from public.journal_lines jl where jl.journal_entry_id = v_entry_id;

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
end;
$$;
revoke all on function public.post_order_delivery(uuid) from public;
grant execute on function public.post_order_delivery(uuid) to anon, authenticated;
create or replace function public.trg_post_order_delivery()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'delivered' and (old.status is distinct from new.status) then
    perform public.post_order_delivery(new.id);
  end if;
  return new;
end;
$$;
drop trigger if exists trg_orders_post_delivery on public.orders;
create trigger trg_orders_post_delivery
after update on public.orders
for each row execute function public.trg_post_order_delivery();
create or replace function public.check_journal_entry_balance(p_entry_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_debit numeric;
  v_credit numeric;
  v_count int;
begin
  if p_entry_id is null then
    return;
  end if;

  select
    coalesce(sum(jl.debit), 0),
    coalesce(sum(jl.credit), 0),
    count(1)
  into v_debit, v_credit, v_count
  from public.journal_lines jl
  where jl.journal_entry_id = p_entry_id;

  if v_count = 0 then
    return;
  end if;

  if abs((v_debit - v_credit)) > 1e-6 then
    raise exception 'journal entry not balanced % (debit %, credit %)', p_entry_id, v_debit, v_credit;
  end if;
end;
$$;
revoke all on function public.check_journal_entry_balance(uuid) from public;
grant execute on function public.check_journal_entry_balance(uuid) to anon, authenticated;
create or replace function public.trg_check_journal_balance()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.check_journal_entry_balance(coalesce(new.journal_entry_id, old.journal_entry_id));
  return null;
end;
$$;
drop trigger if exists trg_journal_lines_balance on public.journal_lines;
create constraint trigger trg_journal_lines_balance
after insert or update or delete on public.journal_lines
deferrable initially deferred
for each row execute function public.trg_check_journal_balance();
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
