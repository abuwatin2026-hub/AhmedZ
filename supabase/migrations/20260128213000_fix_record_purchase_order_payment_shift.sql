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
  v_status text;
  v_method text;
  v_occurred_at timestamptz;
  v_payment_id uuid;
  v_data jsonb;
  v_idempotency_key text;
  v_shift_id uuid;
begin
  if not public.can_manage_stock() then
    raise exception 'not allowed';
  end if;

  if p_purchase_order_id is null then
    raise exception 'p_purchase_order_id is required';
  end if;

  select coalesce(po.paid_amount, 0), coalesce(po.total_amount, 0), po.status
  into v_paid, v_total, v_status
  from public.purchase_orders po
  where po.id = p_purchase_order_id
  for update;

  if not found then
    raise exception 'purchase order not found';
  end if;

  if v_status = 'cancelled' then
    raise exception 'cannot pay cancelled purchase order';
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
  v_idempotency_key := nullif(trim(coalesce(v_data->>'idempotencyKey', '')), '');
  v_shift_id := public._resolve_open_shift_for_cash(auth.uid());

  if v_method = 'cash' and v_shift_id is null then
    raise exception 'cash method requires an open cash shift';
  end if;

  if v_idempotency_key is null then
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
  else
    insert into public.payments(direction, method, amount, currency, reference_table, reference_id, occurred_at, created_by, data, idempotency_key, shift_id)
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
      v_idempotency_key,
      v_shift_id
    )
    on conflict (reference_table, reference_id, direction, idempotency_key)
    do update set
      method = excluded.method,
      amount = excluded.amount,
      occurred_at = excluded.occurred_at,
      created_by = coalesce(public.payments.created_by, excluded.created_by),
      data = excluded.data,
      shift_id = coalesce(public.payments.shift_id, excluded.shift_id)
    returning id into v_payment_id;
  end if;

  perform public.post_payment(v_payment_id);

  update public.purchase_orders
  set paid_amount = paid_amount + v_amount,
      updated_at = now()
  where id = p_purchase_order_id;
end;
$$;

do $$
begin
  update public.payments p
  set shift_id = (
    select cs.id
    from public.cash_shifts cs
    where cs.cashier_id = p.created_by
      and coalesce(cs.status, 'open') = 'open'
    order by cs.opened_at desc
    limit 1
  )
  where p.shift_id is null
    and p.method = 'cash'
    and p.created_by is not null;
exception when undefined_table then
  null;
end $$;

