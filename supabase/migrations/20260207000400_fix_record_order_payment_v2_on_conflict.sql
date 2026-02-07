set app.allow_ledger_ddl = '1';

create or replace function public.record_order_payment_v2(
  p_order_id uuid,
  p_amount numeric,
  p_method text,
  p_occurred_at timestamptz default null,
  p_idempotency_key text default null,
  p_currency text default null,
  p_data jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_method text;
  v_occurred_at timestamptz;
  v_currency text;
  v_shift_id uuid;
  v_data jsonb;
  v_idempotency text;
begin
  if not public.can_manage_orders() then
    raise exception 'not allowed';
  end if;
  if p_amount <= 0 then
    raise exception 'amount must be positive';
  end if;

  v_method := nullif(trim(p_method), '');
  if v_method is null then
    v_method := 'cash';
  end if;
  if v_method = 'card' then
    v_method := 'network';
  elsif v_method = 'bank' then
    v_method := 'kuraimi';
  end if;

  v_occurred_at := coalesce(p_occurred_at, now());

  v_currency := nullif(trim(coalesce(p_currency, '')), '');
  if v_currency is null then
    v_currency := public.get_base_currency();
  end if;
  v_currency := upper(v_currency);

  v_shift_id := public._resolve_open_shift_for_cash(auth.uid());
  if v_method = 'cash' and v_shift_id is null then
    raise exception 'cash payment requires an open shift';
  end if;

  v_data := jsonb_strip_nulls(jsonb_build_object('orderId', p_order_id::text) || coalesce(p_data, '{}'::jsonb));
  v_idempotency := nullif(trim(coalesce(p_idempotency_key, '')), '');

  insert into public.payments(direction, method, amount, currency, reference_table, reference_id, occurred_at, created_by, data, idempotency_key, shift_id)
  values (
    'in',
    v_method,
    p_amount,
    v_currency,
    'orders',
    p_order_id::text,
    v_occurred_at,
    auth.uid(),
    v_data,
    v_idempotency,
    v_shift_id
  )
  on conflict (reference_table, reference_id, direction, idempotency_key) where idempotency_key is not null
  do update set
    method = excluded.method,
    amount = excluded.amount,
    currency = excluded.currency,
    occurred_at = excluded.occurred_at,
    created_by = excluded.created_by,
    data = excluded.data,
    shift_id = excluded.shift_id;
end;
$$;

revoke all on function public.record_order_payment_v2(uuid, numeric, text, timestamptz, text, text, jsonb) from public;
grant execute on function public.record_order_payment_v2(uuid, numeric, text, timestamptz, text, text, jsonb) to anon, authenticated;

notify pgrst, 'reload schema';

