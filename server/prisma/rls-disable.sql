-- Roll back F-ComFlow Row-Level Security (see rls.sql).
-- Run this, then set RLS_ENABLED=false, to return to app-level scoping only.
--   psql "$DATABASE_URL" -f prisma/rls-disable.sql

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'User','Customer','ChannelConnection','Conversation','Message','Template',
    'Product','Store','Order','OrderItem','OrderEvent','Invoice','LedgerEntry'
  ]
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I;', t);
    EXECUTE format('ALTER TABLE %I NO FORCE ROW LEVEL SECURITY;', t);
    EXECUTE format('ALTER TABLE %I DISABLE  ROW LEVEL SECURITY;', t);
  END LOOP;
END $$;
