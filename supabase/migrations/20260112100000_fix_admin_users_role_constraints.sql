DO $$
DECLARE
  v_constraint_name text;
BEGIN
  IF to_regclass('public.admin_users') IS NULL THEN
    RETURN;
  END IF;

  FOR v_constraint_name IN
    SELECT c.conname
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public'
      AND t.relname = 'admin_users'
      AND c.contype = 'c'
      AND EXISTS (
        SELECT 1
        FROM unnest(c.conkey) k
        JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = k
        WHERE a.attname = 'role'
      )
  LOOP
    EXECUTE format('ALTER TABLE public.admin_users DROP CONSTRAINT IF EXISTS %I', v_constraint_name);
  END LOOP;

  BEGIN
    ALTER TABLE public.admin_users
      ADD CONSTRAINT admin_users_role_check
      CHECK (role IN ('owner','manager','employee','cashier','delivery'));
  EXCEPTION
    WHEN duplicate_object THEN NULL;
  END;
END $$;
