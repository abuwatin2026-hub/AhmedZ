alter table public.payments
add column if not exists shift_id uuid;
alter table public.payments
drop constraint if exists payments_shift_id_fkey;
alter table public.payments
add constraint payments_shift_id_fkey
foreign key (shift_id) references public.cash_shifts(id)
on delete set null;
create index if not exists idx_payments_shift_id on public.payments(shift_id);
update public.payments p
set shift_id = (
  select cs.id
  from public.cash_shifts cs
  where cs.cashier_id = p.created_by
    and p.occurred_at >= cs.opened_at
    and p.occurred_at <= coalesce(cs.closed_at, p.occurred_at)
  order by cs.opened_at desc
  limit 1
)
where p.shift_id is null
  and p.created_by is not null;
create or replace function public.calculate_cash_shift_expected(p_shift_id uuid)
returns numeric
language plpgsql
security definer
set search_path = public
as $$
declare
  v_shift record;
  v_cash_in numeric;
  v_cash_out numeric;
begin
  if p_shift_id is null then
    raise exception 'p_shift_id is required';
  end if;

  select *
  into v_shift
  from public.cash_shifts s
  where s.id = p_shift_id;

  if not found then
    raise exception 'cash shift not found';
  end if;

  select
    coalesce(sum(case when p.direction = 'in' then p.amount else 0 end), 0),
    coalesce(sum(case when p.direction = 'out' then p.amount else 0 end), 0)
  into v_cash_in, v_cash_out
  from public.payments p
  where p.method = 'cash'
    and (
      p.shift_id = p_shift_id
      or (
        p.shift_id is null
        and p.created_by = v_shift.cashier_id
        and p.occurred_at >= coalesce(v_shift.opened_at, now())
        and p.occurred_at <= coalesce(v_shift.closed_at, now())
      )
    );

  return coalesce(v_shift.start_amount, 0) + coalesce(v_cash_in, 0) - coalesce(v_cash_out, 0);
end;
$$;
revoke all on function public.calculate_cash_shift_expected(uuid) from public;
grant execute on function public.calculate_cash_shift_expected(uuid) to anon, authenticated;
create or replace function public.record_order_payment(
  p_order_id uuid,
  p_amount numeric,
  p_method text,
  p_occurred_at timestamptz,
  p_idempotency_key text default null
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
begin
  if not public.is_admin() then
    raise exception 'not allowed';
  end if;

  if p_order_id is null then
    raise exception 'p_order_id is required';
  end if;

  select coalesce(nullif((o.data->>'total')::numeric, null), 0)
  into v_total
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

  select s.id
  into v_shift_id
  from public.cash_shifts s
  where s.cashier_id = auth.uid()
    and coalesce(s.status, 'open') = 'open'
  order by s.opened_at desc
  limit 1;

  if v_idempotency is null then
    insert into public.payments(direction, method, amount, currency, reference_table, reference_id, occurred_at, created_by, data, shift_id)
    values (
      'in',
      v_method,
      v_amount,
      'YER',
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
      'YER',
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
      occurred_at = excluded.occurred_at,
      created_by = coalesce(public.payments.created_by, excluded.created_by),
      data = excluded.data,
      shift_id = coalesce(public.payments.shift_id, excluded.shift_id);
  end if;
end;
$$;
revoke all on function public.record_order_payment(uuid, numeric, text, timestamptz, text) from public;
grant execute on function public.record_order_payment(uuid, numeric, text, timestamptz, text) to anon, authenticated;
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

  v_occurred_at := coalesce(p_occurred_at, now());

  select s.id
  into v_shift_id
  from public.cash_shifts s
  where s.cashier_id = auth.uid()
    and coalesce(s.status, 'open') = 'open'
  order by s.opened_at desc
  limit 1;

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

  v_occurred_at := coalesce(p_occurred_at, now());
  v_data := jsonb_strip_nulls(jsonb_build_object('purchaseOrderId', p_purchase_order_id::text) || coalesce(p_data, '{}'::jsonb));

  select s.id
  into v_shift_id
  from public.cash_shifts s
  where s.cashier_id = auth.uid()
    and coalesce(s.status, 'open') = 'open'
  order by s.opened_at desc
  limit 1;

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
