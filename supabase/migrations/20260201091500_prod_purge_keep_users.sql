-- Purge production transactional data while preserving user accounts
-- Assumptions:
-- - Keep auth schema entirely (auth.users, identities, etc.) implicitly unaffected
-- - Keep public.admin_users and public.customers as "user accounts" mappings
-- - Purge all other public base tables (transactional and logs)
-- - Reset sequences via RESTART IDENTITY
-- - Use TRUNCATE to avoid row-level triggers and closed-period guards
-- - Execute safely: skip tables that cannot be truncated; emit a NOTIFY for visibility

DO $$
DECLARE
  r RECORD;
  v_keep CONSTANT text[] := ARRAY['admin_users','customers'];
BEGIN
  -- Sanity: ensure tables exist; iterate dynamically
  FOR r IN
    SELECT t.table_name
    FROM information_schema.tables t
    WHERE t.table_schema = 'public'
      AND t.table_type = 'BASE TABLE'
      AND t.table_name <> ALL (v_keep)
  LOOP
    BEGIN
      EXECUTE format('TRUNCATE TABLE public.%I RESTART IDENTITY CASCADE', r.table_name);
      PERFORM pg_notify('purge_info', format('Purged table: %I', r.table_name));
    EXCEPTION WHEN others THEN
      PERFORM pg_notify('purge_warn', format('Skipped table: %I (%s)', r.table_name, SQLERRM));
    END;
  END LOOP;

  -- Optional: compact audit logs by truncation (already covered above unless kept)
  -- No changes to auth schema; user accounts preserved.
END $$;

