-- Fix encryption key storage permission issue by using a private table instead of database settings

-- 1. Create a private schema for secure storage if it doesn't exist
CREATE SCHEMA IF NOT EXISTS private;
-- 2. Create a table to store the encryption key securely
CREATE TABLE IF NOT EXISTS private.keys (
    key_name text PRIMARY KEY,
    key_value text NOT NULL,
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now()
);
-- 3. Secure the table (revoke access from public)
REVOKE ALL ON SCHEMA private FROM public;
REVOKE ALL ON TABLE private.keys FROM public;
-- Allow service_role (backend) and postgres (admin) to access
GRANT USAGE ON SCHEMA private TO service_role, postgres;
GRANT SELECT, INSERT, UPDATE ON TABLE private.keys TO service_role, postgres;
-- 4. Insert the encryption key (Skipped in migration to prevent overwrite)
-- The key must be inserted manually or via a separate secure script.
-- This block checks if a key exists and raises a warning if not.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM private.keys WHERE key_name = 'app.encryption_key') THEN
    RAISE WARNING 'Encryption key not found in private.keys! Please insert it manually.';
  END IF;
END $$;
ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS phone_encrypted bytea,
  ADD COLUMN IF NOT EXISTS address_encrypted bytea;
-- 5. Update encrypt_text function to read from private.keys
CREATE OR REPLACE FUNCTION public.encrypt_text(p_text text)
RETURNS BYTEA
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = extensions, public
AS $$
DECLARE
  v_key text;
BEGIN
  -- Fetch key from secure table
  SELECT key_value INTO v_key FROM private.keys WHERE key_name = 'app.encryption_key';
  IF v_key IS NULL OR v_key = '' THEN
    RAISE EXCEPTION 'Encryption key not configured';
  END IF;

  IF p_text IS NULL OR p_text = '' THEN 
    RETURN NULL;
  END IF;

  RETURN extensions.pgp_sym_encrypt(p_text, v_key);
END;
$$;
-- Fixing the function logic properly (idempotent override)
CREATE OR REPLACE FUNCTION public.encrypt_text(p_text text)
RETURNS BYTEA
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = extensions, public
AS $$
DECLARE
  v_key text;
BEGIN
  SELECT key_value INTO v_key FROM private.keys WHERE key_name = 'app.encryption_key';
  IF v_key IS NULL OR v_key = '' THEN
    RAISE EXCEPTION 'Encryption key not configured';
  END IF;
  IF p_text IS NULL OR p_text = '' THEN 
    RETURN NULL;
  END IF;
  RETURN extensions.pgp_sym_encrypt(p_text, v_key);
END;
$$;
-- 6. Update decrypt_text function to read from private.keys
CREATE OR REPLACE FUNCTION public.decrypt_text(p_encrypted BYTEA)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = extensions, public
AS $$
DECLARE
  v_key text;
BEGIN
  SELECT key_value INTO v_key FROM private.keys WHERE key_name = 'app.encryption_key';
  IF v_key IS NULL OR v_key = '' THEN
    RAISE EXCEPTION 'Encryption key not configured';
  END IF;

  IF p_encrypted IS NULL THEN 
    RETURN NULL;
  END IF;

  -- Try decrypting
  BEGIN
    RETURN extensions.pgp_sym_decrypt(p_encrypted, v_key);
  EXCEPTION WHEN OTHERS THEN
    RETURN NULL; -- Return null if decryption fails (wrong key)
  END;
END;
$$;
-- 7. Migrate existing data (Encrypt plain text data if any remains)
-- Note: This assumes data is currently NOT encrypted or we are re-encrypting.
-- If re-encrypting from old key, we need a separate block.
-- For now, we assume we are setting up fresh or fixing the key.

DO $$
DECLARE
  v_key text;
BEGIN
  SELECT key_value INTO v_key FROM private.keys WHERE key_name = 'app.encryption_key';
  
  IF v_key IS NOT NULL AND v_key != '' THEN
    -- Update Address
    UPDATE public.customers
    SET address_encrypted = extensions.pgp_sym_encrypt(data->>'address', v_key)
    WHERE (data->>'address') IS NOT NULL 
      AND (data->>'address') != ''
      AND address_encrypted IS NULL;

    -- Update Phone
    UPDATE public.customers
    SET phone_encrypted = extensions.pgp_sym_encrypt(phone_number, v_key)
    WHERE phone_number IS NOT NULL 
      AND phone_number != ''
      AND phone_encrypted IS NULL;
  END IF;
END $$;
