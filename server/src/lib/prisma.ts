// Prisma client + optional PostgreSQL Row-Level Security (tenant isolation at
// the database layer — the report's §4.1 / §7.4).
//
// RLS_ENABLED=false (default): `prisma` is a plain client and NOTHING here
// changes behaviour — the app runs exactly as before.
//
// RLS_ENABLED=true: every model query is transparently wrapped so it first sets
// a per-connection tenant GUC (`app.current_tenant`). The policies in
// prisma/rls.sql then let a query see only rows whose tenantId matches. Requests
// outside an authenticated user (login, public storefront, webhook routing,
// seeding) carry no tenant and run under the '*' bypass sentinel.
//
// IMPORTANT: interactive $transaction() blocks must use `basePrisma` (the
// unextended client) and call setTenantGuc() as their first statement — see the
// four call sites in payments/orders/tracker.
import { PrismaClient } from '@prisma/client';
import { AsyncLocalStorage } from 'node:async_hooks';

const RLS_ENABLED = process.env.RLS_ENABLED === 'true';
const BYPASS = '*';

// Per-request tenant context. requireAuth populates it (see middleware/auth.ts).
export const tenantContext = new AsyncLocalStorage<{ tenantId: string }>();

function currentTenant(): string {
  return tenantContext.getStore()?.tenantId ?? BYPASS;
}

// The raw, unextended client. Used for interactive transactions and any code
// that manages the tenant GUC itself.
export const basePrisma = new PrismaClient();

// Set the tenant GUC inside an interactive transaction so RLS applies to every
// statement in it. No-op when RLS is disabled.
export async function setTenantGuc(tx: any, tenantId: string): Promise<void> {
  if (!RLS_ENABLED) return;
  await tx.$executeRaw`SELECT set_config('app.current_tenant', ${tenantId}, true)`;
}

function buildRlsClient(): PrismaClient {
  // `extended` is referenced inside the hook, which only runs at query time —
  // by then it is assigned (same pattern as Prisma's RLS docs example). It is
  // typed `any` to break the self-reference in its own initializer.
  let extended: any;
  extended = basePrisma.$extends({
    query: {
      $allModels: {
        async $allOperations({ args, query }): Promise<any> {
          const tenant = currentTenant();
          // set_config + the real query run in ONE transaction, i.e. on the
          // SAME connection, so the GUC is visible to the policy check.
          // ($executeRaw is a client method, not a model op, so it is NOT
          // intercepted here — no recursion.)
          const [, result] = await extended.$transaction([
            extended.$executeRaw`SELECT set_config('app.current_tenant', ${tenant}, true)`,
            query(args),
          ]);
          return result;
        },
      },
    },
  });
  return extended as PrismaClient;
}

// The default client the whole app imports.
export const prisma: PrismaClient = RLS_ENABLED ? buildRlsClient() : basePrisma;
