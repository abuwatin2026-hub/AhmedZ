drop function if exists public.record_purchase_order_payment(uuid, numeric, text, timestamptz);
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
begin
  if not public.is_admin() then
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

  insert into public.payments(direction, method, amount, currency, reference_table, reference_id, occurred_at, created_by, data)
  values (
    'out',
    v_method,
    v_amount,
    'YER',
    'purchase_orders',
    p_purchase_order_id::text,
    v_occurred_at,
    auth.uid(),
    v_data
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
