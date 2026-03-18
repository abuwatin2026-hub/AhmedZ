-- ================================================================
-- Direct customer registration — bypasses Supabase email rate limit
-- Inserts directly into auth.users + auth.identities + customers
-- NOTE: confirmed_at (auth.users) and email (auth.identities) are
--       GENERATED ALWAYS columns — do NOT include in INSERT
-- ================================================================

create or replace function public.register_customer_direct(
  p_username text,
  p_password text,
  p_phone text default null,
  p_referral_code text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth, extensions
as $$
declare
  v_username text;
  v_email text;
  v_hash text;
  v_user_id uuid;
  v_now timestamptz := now();
  v_referral text;
  v_phone_e164 text;
  v_my_referral text;
  v_existing_id uuid;
begin
  -- 1. Normalize username
  v_username := lower(trim(regexp_replace(p_username, '\s+', '', 'g')));
  if length(v_username) < 3 then raise exception 'username_too_short'; end if;
  if length(v_username) > 30 then raise exception 'username_too_long'; end if;

  -- 2. Generate the fake email (base64url of sha256 — matches frontend sha256Base64Url)
  v_email := 'u_' || rtrim(
    replace(replace(encode(extensions.digest(v_username, 'sha256'), 'base64'), '+', '-'), '/', '_'),
    '='
  ) || '@aztapp.com';

  -- 3. Check if user already exists (auth + customers)
  select id into v_existing_id from auth.users where email = v_email limit 1;
  if v_existing_id is not null then raise exception 'user_already_registered'; end if;

  perform 1 from public.customers where data->>'loginIdentifier' = v_username limit 1;
  if found then raise exception 'user_already_registered'; end if;

  -- 4. Hash password with bcrypt cost 10 (matches GoTrue default)
  v_hash := extensions.crypt(p_password, extensions.gen_salt('bf', 10));

  -- 5. Generate user ID
  v_user_id := extensions.gen_random_uuid();

  -- 6. Generate unique referral code
  v_my_referral := upper(substr(encode(extensions.gen_random_uuid()::text::bytea, 'hex'), 1, 6));

  -- 7. Normalize phone (Yemen format)
  v_phone_e164 := null;
  if p_phone is not null and trim(p_phone) <> '' then
    declare v_digits text := regexp_replace(trim(p_phone), '[^\d]', '', 'g');
    begin
      if v_digits ~ '^\d{9}$' and v_digits ~ '^7' then v_phone_e164 := '+967' || v_digits;
      elsif v_digits ~ '^967\d{9}$' then v_phone_e164 := '+' || v_digits;
      elsif v_digits ~ '^\d{8,15}$' then v_phone_e164 := '+' || v_digits;
      end if;
    end;
  end if;

  -- 8. Normalize referral code
  v_referral := null;
  if p_referral_code is not null and trim(p_referral_code) <> '' then
    v_referral := upper(trim(p_referral_code));
  end if;

  -- 9. Insert into auth.users (confirmed_at is GENERATED ALWAYS — omitted)
  insert into auth.users (
    id, instance_id, aud, role, email, encrypted_password,
    email_confirmed_at, confirmation_sent_at,
    confirmation_token, recovery_token,
    email_change_token_new, email_change_token_current,
    email_change, email_change_confirm_status,
    phone_change, phone_change_token,
    reauthentication_token,
    raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at,
    is_sso_user, is_anonymous
  ) values (
    v_user_id, '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', v_email, v_hash,
    v_now, v_now,
    '', '',    -- confirmation_token, recovery_token
    '', '',    -- email_change_token_new, email_change_token_current
    '', 0,     -- email_change, email_change_confirm_status
    '', '',    -- phone_change, phone_change_token
    '',        -- reauthentication_token
    jsonb_build_object('provider', 'email', 'providers', array['email']),
    jsonb_build_object('username', v_username),
    v_now, v_now,
    false, false
  );

  -- 10. Insert into auth.identities (email is GENERATED ALWAYS — omitted)
  insert into auth.identities (
    id, user_id, provider_id, provider, identity_data,
    last_sign_in_at, created_at, updated_at
  ) values (
    v_user_id, v_user_id, v_user_id::text, 'email',
    jsonb_build_object('sub', v_user_id::text, 'email', v_email, 'email_verified', true, 'phone_verified', false),
    v_now, v_now, v_now
  );

  -- 11. Insert into public.customers
  insert into public.customers (
    auth_user_id, full_name, phone_number, email, auth_provider,
    referral_code, referred_by, loyalty_points, loyalty_tier,
    total_spent, first_order_discount_applied, data
  ) values (
    v_user_id, v_username, v_phone_e164, null, 'password',
    v_my_referral, v_referral, 0, 'regular', 0, false,
    jsonb_build_object(
      'id', v_user_id, 'fullName', v_username,
      'phoneNumber', v_phone_e164, 'loginIdentifier', v_username,
      'authProvider', 'password', 'requirePasskey', false,
      'loyaltyPoints', 0, 'loyaltyTier', 'regular',
      'totalSpent', 0, 'referralCode', v_my_referral,
      'referredBy', v_referral, 'firstOrderDiscountApplied', false,
      'createdAt', v_now
    )
  );

  return jsonb_build_object('success', true, 'user_id', v_user_id, 'email', v_email, 'username', v_username);

exception when unique_violation then
  raise exception 'user_already_registered';
end;
$$;

-- Grant to anon so unauthenticated users can register
grant execute on function public.register_customer_direct(text, text, text, text)
  to anon, authenticated;

notify pgrst, 'reload schema';
