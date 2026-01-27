create or replace function public.create_order_secure_with_payment_proof(
    p_items jsonb,
    p_delivery_zone_id uuid,
    p_payment_method text,
    p_notes text,
    p_address text,
    p_location jsonb,
    p_customer_name text,
    p_phone_number text,
    p_is_scheduled boolean,
    p_scheduled_at timestamptz,
    p_coupon_code text default null,
    p_points_redeemed_value numeric default 0,
    p_payment_proof_type text default null,
    p_payment_proof text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_payment_method text;
  v_proof_type text;
  v_proof text;
  v_order jsonb;
  v_order_id uuid;
  v_coupon_id uuid;
  v_customer_name text;
  v_phone text;
  v_address text;
begin
  v_payment_method := lower(btrim(coalesce(p_payment_method, '')));
  if v_payment_method not in ('cash', 'kuraimi', 'network') then
    raise exception 'طريقة الدفع غير صالحة';
  end if;

  v_customer_name := btrim(coalesce(p_customer_name, ''));
  if length(v_customer_name) < 3 or length(v_customer_name) > 50 or v_customer_name !~ '^[\u0600-\u06FFa-zA-Z\s]+$' then
    raise exception 'اسم العميل غير صحيح';
  end if;

  v_phone := btrim(coalesce(p_phone_number, ''));
  if v_phone !~ '^(77|73|71|70)[0-9]{7}$' then
    raise exception 'رقم الهاتف غير صحيح';
  end if;

  v_address := btrim(coalesce(p_address, ''));
  if length(v_address) < 10 or length(v_address) > 200 then
    raise exception 'العنوان غير صحيح';
  end if;

  v_proof_type := nullif(btrim(coalesce(p_payment_proof_type, '')), '');
  v_proof := nullif(btrim(coalesce(p_payment_proof, '')), '');

  if v_payment_method = 'cash' then
    if v_proof_type is not null or v_proof is not null then
      raise exception 'لا يسمح بإثبات دفع للدفع النقدي';
    end if;
  else
    if v_payment_method in ('kuraimi', 'network') then
      if v_proof_type is null or v_proof is null then
        raise exception 'إثبات الدفع مطلوب لطرق الدفع غير النقدية';
      end if;
      if v_proof_type not in ('image', 'ref_number') then
        raise exception 'نوع إثبات الدفع غير صالح';
      end if;
    end if;
  end if;

  if p_coupon_code is not null and length(btrim(p_coupon_code)) > 0 then
    select c.id
    into v_coupon_id
    from public.coupons c
    where lower(c.code) = lower(btrim(p_coupon_code))
      and c.is_active = true
    for update;
  end if;

  v_order := public.create_order_secure(
    p_items,
    p_delivery_zone_id,
    v_payment_method,
    p_notes,
    v_address,
    p_location,
    v_customer_name,
    v_phone,
    p_is_scheduled,
    p_scheduled_at,
    p_coupon_code,
    p_points_redeemed_value
  );

  v_order_id := (v_order->>'id')::uuid;

  if v_payment_method in ('kuraimi', 'network') then
    update public.orders
    set data = jsonb_set(
      jsonb_set(data, '{paymentProofType}', to_jsonb(v_proof_type), true),
      '{paymentProof}',
      to_jsonb(p_payment_proof),
      true
    )
    where id = v_order_id;

    v_order := jsonb_set(
      jsonb_set(v_order, '{paymentProofType}', to_jsonb(v_proof_type), true),
      '{paymentProof}',
      to_jsonb(p_payment_proof),
      true
    );
  end if;

  return v_order;
end;
$$;

revoke all on function public.create_order_secure_with_payment_proof(
  jsonb,
  uuid,
  text,
  text,
  text,
  jsonb,
  text,
  text,
  boolean,
  timestamptz,
  text,
  numeric,
  text,
  text
) from public;
grant execute on function public.create_order_secure_with_payment_proof(
  jsonb,
  uuid,
  text,
  text,
  text,
  jsonb,
  text,
  text,
  boolean,
  timestamptz,
  text,
  numeric,
  text,
  text
) to authenticated;
