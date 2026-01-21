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
  if not public.is_staff() then
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

  if v_method = 'cash' and v_shift_id is null then
    raise exception 'cash method requires an open cash shift';
  end if;

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
      null
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
      null
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
