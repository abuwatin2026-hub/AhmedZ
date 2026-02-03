do $$
begin
  -- Drop forced single-currency triggers and functions if exist
  begin
    drop trigger if exists trg_force_order_yer on public.orders;
  exception when undefined_table then null;
  end;
  begin
    drop trigger if exists trg_force_payment_yer on public.payments;
  exception when undefined_table then null;
  end;
  begin
    drop function if exists public.trg_force_order_yer();
  exception when undefined_function then null;
  end;
  begin
    drop function if exists public.trg_force_payment_yer();
  exception when undefined_function then null;
  end;
end $$;

-- Ensure schema columns exist
do $$
begin
  if to_regclass('public.orders') is not null then
    alter table public.orders
      add column if not exists currency text,
      add column if not exists fx_rate numeric,
      add column if not exists base_total numeric;
  end if;
  if to_regclass('public.payments') is not null then
    alter table public.payments
      add column if not exists fx_rate numeric,
      add column if not exists base_amount numeric;
  end if;
end $$;

-- Base currency is configurable via app_settings.settings.baseCurrency
create or replace function public.get_base_currency()
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_base text;
  v_settings jsonb;
begin
  v_base := null;
  if to_regclass('public.app_settings') is not null then
    select s.data
    into v_settings
    from public.app_settings s
    where s.id in ('singleton','app')
    order by (s.id = 'singleton') desc
    limit 1;
    begin
      v_base := upper(nullif(btrim(coalesce(v_settings->'settings'->>'baseCurrency', '')), ''));
    exception when others then
      v_base := null;
    end;
  end if;
  if v_base is not null then
    return v_base;
  end if;
  begin
    select upper(code) into v_base from public.currencies where is_base = true limit 1;
  exception when undefined_table then
    v_base := null;
  end;
  return coalesce(v_base, 'YER');
end;
$$;

-- FX rate lookup: latest rate <= date for given type
create or replace function public.get_fx_rate(p_currency text, p_date date, p_rate_type text)
returns numeric
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_currency text;
  v_type text;
  v_date date;
  v_base text;
  v_rate numeric;
begin
  v_currency := upper(nullif(btrim(coalesce(p_currency, '')), ''));
  v_type := lower(nullif(btrim(coalesce(p_rate_type, '')), ''));
  v_date := coalesce(p_date, current_date);
  v_base := public.get_base_currency();

  if v_type is null then
    v_type := 'operational';
  end if;
  if v_currency is null then
    v_currency := v_base;
  end if;
  if v_currency = v_base then
    return 1;
  end if;
  begin
    select fr.rate
    into v_rate
    from public.fx_rates fr
    where upper(fr.currency_code) = v_currency
      and fr.rate_type = v_type
      and fr.rate_date <= v_date
    order by fr.rate_date desc
    limit 1;
  exception when undefined_table then
    v_rate := null;
  end;
  return v_rate;
end;
$$;

-- Trigger: set FX on orders
create or replace function public.trg_set_order_fx()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_base text;
  v_rate numeric;
begin
  v_base := public.get_base_currency();
  if new.currency is null then
    new.currency := v_base;
  end if;
  if new.fx_rate is null then
    v_rate := public.get_fx_rate(new.currency, current_date, 'operational');
    if v_rate is null then
      raise exception 'fx rate missing for currency %', new.currency;
    end if;
    new.fx_rate := v_rate;
  end if;
  new.base_total := coalesce(new.total, 0) * coalesce(new.fx_rate, 1);
  return new;
end;
$$;

-- Trigger: set FX on payments
create or replace function public.trg_set_payment_fx()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_base text;
  v_rate numeric;
begin
  v_base := public.get_base_currency();
  if new.currency is null then
    new.currency := v_base;
  end if;
  if new.fx_rate is null then
    v_rate := public.get_fx_rate(new.currency, current_date, 'operational');
    if v_rate is null then
      raise exception 'fx rate missing for currency %', new.currency;
    end if;
    new.fx_rate := v_rate;
  end if;
  new.base_amount := coalesce(new.amount, 0) * coalesce(new.fx_rate, 1);
  return new;
end;
$$;

do $$
begin
  if to_regclass('public.orders') is not null then
    drop trigger if exists trg_set_order_fx on public.orders;
    create trigger trg_set_order_fx
    before insert or update on public.orders
    for each row execute function public.trg_set_order_fx();
  end if;
  if to_regclass('public.payments') is not null then
    drop trigger if exists trg_set_payment_fx on public.payments;
    create trigger trg_set_payment_fx
    before insert or update on public.payments
    for each row execute function public.trg_set_payment_fx();
  end if;
end $$;

-- Expand record_order_payment to accept currency (overload; preserves idempotency key)
create or replace function public.record_order_payment(
  p_order_id uuid,
  p_amount numeric,
  p_method text,
  p_occurred_at timestamptz,
  p_idempotency_key text default null,
  p_currency text default null
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
  v_total numeric;
  v_paid numeric;
  v_idempotency text;
  v_shift_id uuid;
  v_base text;
  v_currency text;
begin
  if not public.is_staff() then
    raise exception 'not allowed';
  end if;
  if p_order_id is null then
    raise exception 'p_order_id is required';
  end if;
  v_base := public.get_base_currency();

  select coalesce(o.total, coalesce(nullif((o.data->>'total')::numeric, null), 0)),
         coalesce(nullif(btrim(coalesce(o.currency, '')), ''), nullif(btrim(coalesce(o.data->>'currency', '')), ''), v_base)
  into v_total, v_currency
  from public.orders o
  where o.id = p_order_id;

  if not found then
    raise exception 'order not found';
  end if;

  v_amount := coalesce(p_amount, 0);
  if v_amount <= 0 then
    raise exception 'invalid amount';
  end if;

  select coalesce(sum(p.amount), 0)
  into v_paid
  from public.payments p
  where p.reference_table = 'orders'
    and p.reference_id = p_order_id::text
    and p.direction = 'in';

  if v_total > 0 and (v_paid + v_amount) > (v_total + 1e-9) then
    raise exception 'paid amount exceeds total';
  end if;

  v_method := nullif(trim(coalesce(p_method, '')), '');
  if v_method is null then
    v_method := 'cash';
  end if;
  v_occurred_at := coalesce(p_occurred_at, now());
  v_idempotency := nullif(trim(coalesce(p_idempotency_key, '')), '');

  v_currency := upper(nullif(btrim(coalesce(p_currency, '')), ''));
  if v_currency is null then
    v_currency := upper(nullif(btrim(coalesce(v_currency, '')), ''));
  end if;
  if v_currency is null then
    v_currency := v_base;
  end if;

  select s.id
  into v_shift_id
  from public.cash_shifts s
  where s.cashier_id = auth.uid()
    and coalesce(s.status, 'open') = 'open'
  order by s.opened_at desc
  limit 1;

  if v_method = 'cash' and v_shift_id is null then
    raise exception 'cash method requires an open cash shift';
  end if;

  if v_idempotency is null then
    insert into public.payments(direction, method, amount, currency, reference_table, reference_id, occurred_at, created_by, data, shift_id)
    values (
      'in',
      v_method,
      v_amount,
      v_currency,
      'orders',
      p_order_id::text,
      v_occurred_at,
      auth.uid(),
      jsonb_build_object('orderId', p_order_id::text),
      v_shift_id
    );
  else
    insert into public.payments(direction, method, amount, currency, reference_table, reference_id, occurred_at, created_by, data, idempotency_key, shift_id)
    values (
      'in',
      v_method,
      v_amount,
      v_currency,
      'orders',
      p_order_id::text,
      v_occurred_at,
      auth.uid(),
      jsonb_build_object('orderId', p_order_id::text),
      v_idempotency,
      v_shift_id
    )
    on conflict (reference_table, reference_id, direction, idempotency_key)
    do update set
      method = excluded.method,
      amount = excluded.amount,
      currency = excluded.currency,
      occurred_at = excluded.occurred_at,
      created_by = coalesce(public.payments.created_by, excluded.created_by),
      data = excluded.data,
      shift_id = coalesce(public.payments.shift_id, excluded.shift_id);
  end if;
end;
$$;
revoke all on function public.record_order_payment(uuid, numeric, text, timestamptz, text) from public;
grant execute on function public.record_order_payment(uuid, numeric, text, timestamptz, text) to anon, authenticated;
revoke all on function public.record_order_payment(uuid, numeric, text, timestamptz, text, text) from public;
grant execute on function public.record_order_payment(uuid, numeric, text, timestamptz, text, text) to anon, authenticated;

-- Expand record_purchase_order_payment to accept currency (defaults to base)
create or replace function public.record_purchase_order_payment(
  p_purchase_order_id uuid,
  p_amount numeric,
  p_method text,
  p_occurred_at timestamptz,
  p_data jsonb default '{}'::jsonb,
  p_currency text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_amount numeric;
  v_total numeric;
  v_status text;
  v_method text;
  v_occurred_at timestamptz;
  v_payment_id uuid;
  v_data jsonb;
  v_idempotency_key text;
  v_shift_id uuid;
  v_paid_sum numeric;
  v_currency text;
  v_base text;
begin
  if not public.can_manage_stock() then
    raise exception 'not allowed';
  end if;
  if p_purchase_order_id is null then
    raise exception 'p_purchase_order_id is required';
  end if;
  select coalesce(po.total_amount, 0), po.status
  into v_total, v_status
  from public.purchase_orders po
  where po.id = p_purchase_order_id
  for update;
  if not found then
    raise exception 'purchase order not found';
  end if;
  if v_status = 'cancelled' then
    raise exception 'cannot pay cancelled purchase order';
  end if;
  v_total := coalesce(v_total, 0);
  if v_total <= 0 then
    raise exception 'purchase order total is zero';
  end if;
  v_amount := coalesce(p_amount, 0);
  if v_amount <= 0 then
    raise exception 'invalid amount';
  end if;
  select coalesce(sum(p.amount), 0)
  into v_paid_sum
  from public.payments p
  where p.reference_table = 'purchase_orders'
    and p.direction = 'out'
    and p.reference_id = p_purchase_order_id::text;
  if (v_total - coalesce(v_paid_sum, 0)) <= 0.000000001 then
    raise exception 'purchase order already fully paid';
  end if;
  if (coalesce(v_paid_sum, 0) + v_amount) > (v_total + 0.000000001) then
    raise exception 'paid amount exceeds total';
  end if;
  v_method := nullif(trim(coalesce(p_method, '')), '');
  if v_method is null then
    v_method := 'cash';
  end if;
  v_occurred_at := coalesce(p_occurred_at, now());
  v_data := jsonb_strip_nulls(jsonb_build_object('purchaseOrderId', p_purchase_order_id::text) || coalesce(p_data, '{}'::jsonb));
  v_idempotency_key := nullif(trim(coalesce(v_data->>'idempotencyKey', '')), '');
  v_shift_id := public._resolve_open_shift_for_cash(auth.uid());
  if v_method = 'cash' and v_shift_id is null then
    raise exception 'cash method requires an open cash shift';
  end if;
  v_base := public.get_base_currency();
  v_currency := upper(nullif(btrim(coalesce(p_currency, '')), ''));
  if v_currency is null then
    v_currency := v_base;
  end if;
  if v_idempotency_key is null then
    insert into public.payments(direction, method, amount, currency, reference_table, reference_id, occurred_at, created_by, data, shift_id)
    values (
      'out',
      v_method,
      v_amount,
      v_currency,
      'purchase_orders',
      p_purchase_order_id::text,
      v_occurred_at,
      auth.uid(),
      v_data,
      v_shift_id
    )
    returning id into v_payment_id;
  else
    insert into public.payments(direction, method, amount, currency, reference_table, reference_id, occurred_at, created_by, data, idempotency_key, shift_id)
    values (
      'out',
      v_method,
      v_amount,
      v_currency,
      'purchase_orders',
      p_purchase_order_id::text,
      v_occurred_at,
      auth.uid(),
      v_data,
      v_idempotency_key,
      v_shift_id
    )
    on conflict (reference_table, reference_id, direction, idempotency_key)
    do nothing
    returning id into v_payment_id;
    if v_payment_id is null then
      return;
    end if;
  end if;
end;
$$;
revoke all on function public.record_purchase_order_payment(uuid, numeric, text, timestamptz, jsonb, text) from public;
grant execute on function public.record_purchase_order_payment(uuid, numeric, text, timestamptz, jsonb, text) to anon, authenticated;

-- Update post_payment to use base_amount for ledger postings
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
  v_settings jsonb;
  v_accounts jsonb;
  v_clearing uuid;
  v_amount_base numeric;
begin
  if p_payment_id is null then
    raise exception 'p_payment_id is required';
  end if;
  select * into v_pay from public.payments p where p.id = p_payment_id;
  if not found then
    raise exception 'payment not found';
  end if;
  v_amount_base := coalesce(v_pay.base_amount, v_pay.amount, 0);
  v_cash := public.get_account_id_by_code('1010');
  v_bank := public.get_account_id_by_code('1020');
  v_ar := public.get_account_id_by_code('1200');
  v_deposits := public.get_account_id_by_code('2050');
  v_ap := public.get_account_id_by_code('2010');
  v_expenses := public.get_account_id_by_code('6100');
  v_clearing := public.get_account_id_by_code('2060');
  if to_regclass('public.app_settings') is not null then
    select s.data into v_settings from public.app_settings s where s.id in ('singleton','app') order by (s.id = 'singleton') desc limit 1;
    v_accounts := coalesce(v_settings->'settings'->'accounting_accounts', v_settings->'accounting_accounts', '{}'::jsonb);
    begin
      v_clearing := coalesce(nullif(v_accounts->>'landed_cost_clearing', '')::uuid, v_clearing);
    exception when others then null;
    end;
  end if;
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
        (v_entry_id, v_debit_account, v_amount_base, 0, 'Cash/Bank received'),
        (v_entry_id, v_deposits, 0, v_amount_base, 'Customer deposit');
    else
      insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo)
      values
        (v_entry_id, v_debit_account, v_amount_base, 0, 'Cash/Bank received'),
        (v_entry_id, v_ar, 0, v_amount_base, 'Settle receivable');
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
      (v_entry_id, v_ap, v_amount_base, 0, 'Settle payable'),
      (v_entry_id, v_credit_account, 0, v_amount_base, 'Cash/Bank paid');
    return;
  end if;

  if v_pay.direction = 'out' and v_pay.reference_table = 'expenses' then
    v_has_accrual := exists(
      select 1 from public.journal_entries je
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
        (v_entry_id, v_ap, v_amount_base, 0, 'Settle payable'),
        (v_entry_id, v_credit_account, 0, v_amount_base, 'Cash/Bank paid');
    else
      insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo)
      values
        (v_entry_id, v_expenses, v_amount_base, 0, 'Operating expense'),
        (v_entry_id, v_credit_account, 0, v_amount_base, 'Cash/Bank paid');
    end if;
    return;
  end if;

  if v_pay.direction = 'out' and v_pay.reference_table = 'import_expenses' then
    v_has_accrual := exists(
      select 1 from public.journal_entries je
      where je.source_table = 'import_expenses'
        and je.source_id = coalesce(v_pay.reference_id, '')
        and je.source_event = 'accrual'
    );
    insert into public.journal_entries(entry_date, memo, source_table, source_id, source_event, created_by)
    values (
      v_pay.occurred_at,
      concat('Import expense payment ', coalesce(v_pay.reference_id, v_pay.id::text)),
      'payments',
      v_pay.id::text,
      concat('out:import_expenses:', coalesce(v_pay.reference_id, '')),
      v_pay.created_by
    )
    on conflict (source_table, source_id, source_event)
    do update set entry_date = excluded.entry_date, memo = excluded.memo
    returning id into v_entry_id;
    delete from public.journal_lines jl where jl.journal_entry_id = v_entry_id;
    if v_has_accrual then
      insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo)
      values
        (v_entry_id, v_ap, v_amount_base, 0, 'Settle payable'),
        (v_entry_id, v_credit_account, 0, v_amount_base, 'Cash/Bank paid');
    else
      insert into public.journal_lines(journal_entry_id, account_id, debit, credit, line_memo)
      values
        (v_entry_id, v_clearing, v_amount_base, 0, 'Landed cost service'),
        (v_entry_id, v_credit_account, 0, v_amount_base, 'Cash/Bank paid');
    end if;
    return;
  end if;
end;
$$;
revoke all on function public.post_payment(uuid) from public;
grant execute on function public.post_payment(uuid) to anon, authenticated;

notify pgrst, 'reload schema';

