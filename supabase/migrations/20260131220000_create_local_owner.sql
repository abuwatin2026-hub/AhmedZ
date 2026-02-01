-- Migration: Create Local Owner User
-- Description: Inserts a default owner user for local development if it doesn't exist.

DO $$
DECLARE
  v_user_id uuid;
  v_encrypted_pw text;
  v_company_id uuid;
  v_branch_id uuid;
  v_warehouse_id uuid;
BEGIN
  -- 1. Check if user already exists
  SELECT id INTO v_user_id FROM auth.users WHERE email = 'owner@azta.com';

  IF v_user_id IS NULL THEN
    -- 2. Create Auth User (Password: Owner@123)
    -- Note: This hash is a standard bcrypt hash for 'Owner@123'
    v_encrypted_pw := '$2a$10$w.2Z0pQLu.6.i.6.i.6.i.6.i.6.i.6.i.6.i.6.i.6.i.6.i.6.i.6.i'; -- Placeholder hash, usually we rely on Supabase Auth or pgcrypto if available.
    -- Better approach for local dev: Use pgcrypto's crypt function if available, or a known hash.
    -- Let's use a known hash for 'Owner@123' generated via Supabase or bcrypt online.
    -- Hash for 'Owner@123': $2a$10$r.2Z0pQLu.6.i.6.i.6.i.6.i.6.i.6.i.6.i.6.i.6.i.6.i.6.i.6.i (Invalid example)
    
    -- Using pgcrypto to generate hash on the fly is safer if extension is enabled.
    -- Extension pgcrypto is enabled in 20251227000000_init.sql
    
    v_encrypted_pw := crypt('Owner@123', gen_salt('bf'));
    
    INSERT INTO auth.users (
      instance_id,
      id,
      aud,
      role,
      email,
      encrypted_password,
      email_confirmed_at,
      raw_app_meta_data,
      raw_user_meta_data,
      created_at,
      updated_at,
      confirmation_token,
      recovery_token,
      email_change_token_new,
      email_change,
      reauthentication_token,
      phone,
      phone_change,
      phone_change_token,
      email_change_token_current
    ) VALUES (
      '00000000-0000-0000-0000-000000000000',
      gen_random_uuid(),
      'authenticated',
      'authenticated',
      'owner@azta.com',
      v_encrypted_pw,
      now(),
      '{"provider": "email", "providers": ["email"]}',
      '{"full_name": "Owner User"}',
      now(),
      now(),
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      ''
    ) RETURNING id INTO v_user_id;

    -- Clean install: لا ننشئ شركة/فرع/مخزن افتراضي
    v_company_id := null;
    v_branch_id := null;
    v_warehouse_id := null;

    -- 4. Create Admin User Record
    INSERT INTO public.admin_users (
      auth_user_id,
      username,
      full_name,
      email,
      role,
      permissions,
      is_active,
      company_id,
      branch_id,
      warehouse_id
    ) VALUES (
      v_user_id,
      'owner',
      'Owner User',
      'owner@azta.com',
      'owner',
      NULL, -- Owner has all permissions implicitly or via RLS
      true,
      v_company_id,
      v_branch_id,
      v_warehouse_id
    );
    
    RAISE NOTICE 'Created owner user: owner@azta.com / Owner@123';
  ELSE
    RAISE NOTICE 'Owner user already exists: owner@azta.com';
  END IF;
END $$;
