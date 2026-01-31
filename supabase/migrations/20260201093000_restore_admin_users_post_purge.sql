-- Restore admin_users mappings for all existing Auth users after purge
-- Strategy: Insert missing admin_users rows with default role 'owner'
-- Rationale: Ensure immediate access; owner can later adjust roles/permissions

DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT u.id, u.email, coalesce(u.raw_user_meta_data->>'full_name','') as full_name
    FROM auth.users u
    WHERE NOT EXISTS (
      SELECT 1 FROM public.admin_users au WHERE au.auth_user_id = u.id
    )
  LOOP
    BEGIN
      INSERT INTO public.admin_users(auth_user_id, username, full_name, email, role, is_active)
      VALUES (
        r.id,
        coalesce(split_part(lower(coalesce(r.email, r.id::text)), '@', 1), r.id::text),
        nullif(r.full_name,''),
        r.email,
        'owner',
        true
      );
      PERFORM pg_notify('admin_init', format('Restored admin user for %s', r.email));
    EXCEPTION WHEN others THEN
      PERFORM pg_notify('admin_init_warn', format('Failed to restore admin for %s (%s)', r.email, SQLERRM));
    END;
  END LOOP;
END $$;
