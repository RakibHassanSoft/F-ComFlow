-- F-ComFlow — PostgreSQL Row-Level Security (tenant isolation at the DB layer).
-- Implements the report's §4.1 / §7.4: cross-tenant leaks are blocked by the
-- database itself, not only by application WHERE clauses.
--
-- APPLY ORDER (important — FORCE RLS also affects the app/owner role):
--   1. create schema:   npx prisma db push   (or migrate)
--   2. seed demo data:  npm run db:seed       (seed uses no tenant context)
--   3. apply policies:  psql "$DATABASE_URL" -f prisma/rls.sql
--   4. turn it on:      set RLS_ENABLED=true and restart the API
-- To re-seed later, first roll back (rls-disable.sql), seed, then re-apply.
-- ROLL BACK:
--   psql "$DATABASE_URL" -f prisma/rls-disable.sql
--
-- HOW IT WORKS
--   Each policy lets a row through only when the request's tenant GUC
--   (app.current_tenant) matches the row's "tenantId". The app sets that GUC on
--   every query (see server/src/lib/prisma.ts). The sentinel value '*' means
--   "bypass" and is used for public + system work (login, storefront lookups,
--   webhook routing, seeding), which legitimately resolve rows by unique keys.
--
-- NOTE: FORCE makes the table owner (the role the app connects as) subject to
-- RLS too — that is what makes the isolation real. DDL (migrations) is not
-- affected; only SELECT/INSERT/UPDATE/DELETE are.

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'User','Customer','ChannelConnection','Conversation','Message','Template',
    'Product','Store','Order','OrderItem','OrderEvent','Invoice','LedgerEntry'
  ]
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY;', t);
    EXECUTE format('ALTER TABLE %I FORCE  ROW LEVEL SECURITY;', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I;', t);
    EXECUTE format($f$
      CREATE POLICY tenant_isolation ON %I
      USING (
        current_setting('app.current_tenant', true) = '*'
        OR "tenantId" = current_setting('app.current_tenant', true)
      )
      WITH CHECK (
        current_setting('app.current_tenant', true) = '*'
        OR "tenantId" = current_setting('app.current_tenant', true)
      );
    $f$, t);
  END LOOP;
END $$;
