-- Fix dependency issues by dropping the view first, then recreating it with the new function signature

-- 1. Drop the dependent view
DROP VIEW IF EXISTS public.customers_decrypted;
-- 2. Drop the old conflicting functions
DROP FUNCTION IF EXISTS public.encrypt_text(text, text);
DROP FUNCTION IF EXISTS public.decrypt_text(bytea, text);
-- 3. Recreate the view using the NEW single-parameter decrypt_text function
CREATE OR REPLACE VIEW public.customers_decrypted AS
SELECT 
  c.auth_user_id,
  c.full_name,
  c.phone_number,
  public.decrypt_text(c.phone_encrypted) as phone_decrypted,
  c.email,
  c.auth_provider,
  c.password_salt,
  c.password_hash,
  c.referral_code,
  c.referred_by,
  c.loyalty_points,
  c.loyalty_tier,
  c.total_spent,
  c.first_order_discount_applied,
  c.avatar_url,
  c.data || jsonb_build_object(
    'address_decrypted', public.decrypt_text(c.address_encrypted),
    'address_encrypted', CASE WHEN c.address_encrypted IS NOT NULL THEN true ELSE false END
  ) as data_with_decrypted,
  c.created_at,
  c.updated_at
FROM public.customers c
WHERE public.is_admin();
-- 4. Secure the view again
ALTER VIEW public.customers_decrypted SET (security_invoker = true);
GRANT SELECT ON public.customers_decrypted TO authenticated;
-- 5. Final Verification Query
SELECT 
  auth_user_id,
  phone_number AS "original_phone",
  CASE WHEN phone_encrypted IS NOT NULL THEN '✅ مشفر' ELSE '❌ غير مشفر' END AS "status",
  public.decrypt_text(phone_encrypted) AS "decrypted_test"
FROM public.customers
LIMIT 5;
