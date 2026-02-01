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
    p_payment_proof text default null,
    p_order_source text default 'online'
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
  if v_payment_method not in ('cash', 'kuraimi', 'network', 'mixed', 'unknown') then
     -- 'mixed' and 'unknown' are allowed for in_store
     if p_order_source = 'online' then
        raise exception 'طريقة الدفع غير صالحة';
     end if;
  end if;

  v_customer_name := btrim(coalesce(p_customer_name, ''));
  if length(v_customer_name) < 2 then
    if p_order_source = 'in_store' then
       v_customer_name := 'زبون حضوري';
    else
       raise exception 'اسم العميل قصير جداً';
    end if;
  end if;

  v_phone := btrim(coalesce(p_phone_number, ''));
  
  -- Validation Logic for Phone
  if length(v_phone) > 0 then
      -- If provided, must look like a phone number (relaxed)
      -- Allow 7x or 05x or just digits 9+ length
      if v_phone !~ '^[0-9+]{9,15}$' and v_phone !~ '^(77|73|71|70)[0-9]{7}$' then
          -- Keep strict Yemen check if it looks short, otherwise allow international?
          -- For now, let's just enforce the previous strict check ONLY if it matches the length of local mobile
          -- Or just allow it if it's in_store?
          if p_order_source = 'online' and v_phone !~ '^(77|73|71|70)[0-9]{7}$' then
             raise exception 'رقم الهاتف غير صحيح';
          end if;
      end if;
  else
      -- Empty phone
      if p_order_source = 'online' then
         raise exception 'رقم الهاتف مطلوب للطلبات الإلكترونية';
      end if;
  end if;

  v_address := btrim(coalesce(p_address, ''));
  if length(v_address) < 2 then
     if p_order_source = 'in_store' then
        v_address := 'داخل المحل';
     else
        raise exception 'العنوان قصير جداً';
     end if;
  end if;

  v_proof_type := nullif(btrim(coalesce(p_payment_proof_type, '')), '');
  v_proof := nullif(btrim(coalesce(p_payment_proof, '')), '');

  if v_payment_method = 'cash' then
    if v_proof_type is not null or v_proof is not null then
      -- In store cash might have reference? No.
      null; 
    end if;
  else
    if v_payment_method in ('kuraimi', 'network') and p_order_source = 'online' then
      if v_proof_type is null or v_proof is null then
        raise exception 'إثبات الدفع مطلوب لطرق الدفع غير النقدية';
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

  -- Create the order using core function (defaults to online)
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

  -- Post-Creation Updates
  
  -- 1. Update Order Source if not online
  if p_order_source <> 'online' then
      update public.orders
      set data = jsonb_set(data, '{orderSource}', to_jsonb(p_order_source), true),
          order_source = p_order_source -- if column exists, usually mapped from data
      where id = v_order_id;
      
      v_order := jsonb_set(v_order, '{orderSource}', to_jsonb(p_order_source), true);
  end if;

  -- 2. Update Payment Proof info if needed
  if v_proof_type is not null then
    update public.orders
    set data = jsonb_set(
      jsonb_set(data, '{paymentProofType}', to_jsonb(v_proof_type), true),
      '{paymentProof}',
      to_jsonb(v_proof),
      true
    )
    where id = v_order_id;

    v_order := jsonb_set(
      jsonb_set(v_order, '{paymentProofType}', to_jsonb(v_proof_type), true),
      '{paymentProof}',
      to_jsonb(v_proof),
      true
    );
  end if;

  return v_order;
end;
$$;
