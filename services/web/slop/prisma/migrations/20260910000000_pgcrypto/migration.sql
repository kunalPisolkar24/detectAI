-- Ensure gen_random_uuid() is available on fresh Postgres/Aurora instances.
-- Floci's image ships pg_catalog.gen_random_uuid internally; stock Postgres/Aurora
-- requires the pgcrypto extension. Probe the function, not the extension row, so
-- this is a safe no-op on Floci and installs on fresh Aurora.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'pg_catalog' AND p.proname = 'gen_random_uuid'
  ) THEN
    CREATE EXTENSION IF NOT EXISTS "pgcrypto";
  END IF;
END $$;
