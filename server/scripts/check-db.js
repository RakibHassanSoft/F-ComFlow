// Database connectivity + health check.
//
//   npm run db:check                                  -> uses DATABASE_URL from .env
//   npm run db:check -- "postgresql://...?sslmode=require"   -> checks a specific URL
//
// Reports: connection, server version, schema state (tables), and seed state.
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const urlArg = process.argv[2];
const url = urlArg || process.env.DATABASE_URL;
if (!url) {
  console.error('✗ No database URL. Pass one as an argument or set DATABASE_URL in server/.env');
  process.exit(1);
}

// Render's external URLs require SSL — warn if it's missing.
const isRemote = !/localhost|127\.0\.0\.1/.test(url);
if (isRemote && !/sslmode=/.test(url)) {
  console.warn('⚠ Remote URL without sslmode — appending ?sslmode=require for you.');
}
const finalUrl = isRemote && !/sslmode=/.test(url) ? url + (url.includes('?') ? '&' : '?') + 'sslmode=require' : url;

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient({ datasources: { db: { url: finalUrl } } });

const EXPECTED_TABLES = ['Tenant', 'User', 'Customer', 'ChannelConnection', 'Conversation',
  'Message', 'Template', 'Product', 'Order', 'OrderEvent', 'Invoice', 'LedgerEntry'];

(async () => {
  const host = finalUrl.replace(/^.*@/, '').replace(/\/.*$/, '');
  console.log(`\nChecking database at ${host} …\n`);

  // 1. Connectivity + server version
  const t0 = Date.now();
  const [{ version }] = await prisma.$queryRawUnsafe('SELECT version()');
  console.log(`✓ Connected in ${Date.now() - t0}ms`);
  console.log(`✓ ${version.split(' on ')[0]}`);

  // 2. Schema state
  const tables = (await prisma.$queryRawUnsafe(
    `SELECT tablename FROM pg_tables WHERE schemaname = 'public'`
  )).map((r) => r.tablename);
  const missing = EXPECTED_TABLES.filter((t) => !tables.includes(t));

  if (tables.length === 0) {
    console.log('\n✗ No tables yet — the schema has not been pushed.');
    console.log('  Fix:  npx prisma db push   (with DATABASE_URL pointing at this database)');
  } else if (missing.length > 0) {
    console.log(`\n⚠ Schema incomplete — missing: ${missing.join(', ')}`);
    console.log('  Fix:  npx prisma db push');
  } else {
    console.log(`✓ Schema OK — all ${EXPECTED_TABLES.length} tables present`);

    // 3. Seed state (only meaningful once the schema exists)
    const [tenants, users, products, orders] = await Promise.all([
      prisma.tenant.count(), prisma.user.count(), prisma.product.count(), prisma.order.count(),
    ]);
    console.log(`✓ Data: ${tenants} tenant(s), ${users} user(s), ${products} product(s), ${orders} order(s)`);
    if (tenants === 0) {
      console.log('\n⚠ Empty database — for demo data run:  npm run db:seed');
    } else {
      const demo = await prisma.user.findUnique({ where: { email: 'demo@fcomflow.com' } });
      if (demo) console.log('✓ Demo login ready: demo@fcomflow.com / demo1234');
    }

    // 4. Write round-trip (create + delete a throwaway row)
    const probe = await prisma.tenant.create({ data: { businessName: '__dbcheck__' } });
    await prisma.tenant.delete({ where: { id: probe.id } });
    console.log('✓ Write/delete round-trip OK');
  }

  console.log('\nDatabase check complete ✅\n');
  await prisma.$disconnect();
})().catch(async (e) => {
  console.error(`\n✗ Database check FAILED: ${e.message.split('\n').pop()}\n`);
  console.error('Common causes: wrong password, database asleep (Render free tier),');
  console.error('missing ?sslmode=require on external Render URLs, or IP restrictions.');
  await prisma.$disconnect().catch(() => {});
  process.exit(1);
});
