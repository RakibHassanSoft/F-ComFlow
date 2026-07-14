// Public storefront ("fcom.com/<slug>").
//
// Business model (as specified):
//   - 500 BDT one-time store setup fee, paid via SSLCOMMERZ
//   - 10 BDT per listed product, no recurring fees
//   - the store is link-only marketing: no public directory anywhere
//
// TWO routers live here:
//   storeRouter  (authed,  /api/store)  — the merchant manages their store
//   shopRouter   (public,  /api/shop)   — customers browse + order + fee callbacks
import { Router } from 'express';
import { prisma } from '../lib/prisma';
import { requireAuth } from '../middleware/auth';
import { rateLimit } from '../middleware/rateLimit';
import { ApiError } from '../lib/errors';
import { emitToTenant } from '../lib/socket';
import { isSslczEnabled, createSslczSession, validateSslczPayment } from '../services/sslcommerz';
import { config } from '../config';

export const SETUP_FEE = 500;   // BDT, one-time
export const LISTING_FEE = 10;  // BDT per listed product, charged once

const RESERVED_SLUGS = ['api', 'dashboard', 'login', 'register', 'pay', 's', 'admin', 'www', 'shop', 'store'];

// ---------- helpers ----------

async function billingFor(tenantId: string) {
  const unbilled = await prisma.product.count({
    where: { tenantId, listedInStore: true, listingCharged: false },
  });
  return { setupFee: SETUP_FEE, listingFee: LISTING_FEE, unbilledListings: unbilled, listingFeeDue: unbilled * LISTING_FEE };
}

// Apply a successful platform payment (setup fee or listing fees)
async function applyStorePayment(storeId: string, purpose: string, txnId: string) {
  const store = await prisma.store.findUnique({ where: { id: storeId } });
  if (!store) throw new Error('Unknown store');
  if (purpose === 'SETUP') {
    await prisma.store.update({ where: { id: store.id }, data: { setupPaid: true, setupTxnId: txnId, published: true } });
  } else {
    await prisma.product.updateMany({
      where: { tenantId: store.tenantId, listedInStore: true, listingCharged: false },
      data: { listingCharged: true },
    });
  }
  emitToTenant(store.tenantId, 'store:updated', { purpose });
  return store;
}

// =====================================================================
// MERCHANT SIDE (authed) — mounted at /api/store
// =====================================================================
export const storeRouter = Router();
storeRouter.use(requireAuth);

// GET /api/store — my store + billing + listable products
storeRouter.get('/', async (req, res, next) => {
  try {
    const store = await prisma.store.findUnique({ where: { tenantId: req.tenantId } });
    const products = await prisma.product.findMany({
      where: { tenantId: req.tenantId },
      select: { id: true, name: true, sku: true, price: true, discountPrice: true, imageUrl: true, images: true, stockQuantity: true, listedInStore: true, listingCharged: true },
      orderBy: { name: 'asc' },
    });
    res.json({
      store,
      products,
      billing: await billingFor(req.tenantId),
      sslczEnabled: isSslczEnabled(),
      storeBaseUrl: `${config.clientUrl}/s`,
    });
  } catch (err) { next(err); }
});

// POST /api/store — claim a slug and create the (unpaid) store
storeRouter.post('/', async (req, res, next) => {
  try {
    const existing = await prisma.store.findUnique({ where: { tenantId: req.tenantId } });
    if (existing) throw new ApiError(409, 'You already have a store');

    const slug = String(req.body.slug || '').toLowerCase().trim();
    const name = String(req.body.name || '').trim();
    const description = String(req.body.description || '').trim() || null;
    if (!/^[a-z0-9](?:[a-z0-9-]{1,28})[a-z0-9]$/.test(slug)) {
      throw new ApiError(400, 'Slug must be 3-30 characters: lowercase letters, numbers and hyphens');
    }
    if (RESERVED_SLUGS.includes(slug)) throw new ApiError(422, 'That address is reserved — pick another');
    if (!name) throw new ApiError(400, 'Store name is required');

    const taken = await prisma.store.findUnique({ where: { slug } });
    if (taken) throw new ApiError(409, 'That address is already taken — pick another');

    const store = await prisma.store.create({
      data: { tenantId: req.tenantId, slug, name, description },
    });
    res.status(201).json(store);
  } catch (err) { next(err); }
});

// PATCH /api/store — update details / pause / resume
storeRouter.patch('/', async (req, res, next) => {
  try {
    const store = await prisma.store.findUnique({ where: { tenantId: req.tenantId } });
    if (!store) throw new ApiError(404, 'No store yet');
    const data: Record<string, unknown> = {};
    if (req.body.name !== undefined) data.name = String(req.body.name).trim() || store.name;
    if (req.body.description !== undefined) data.description = String(req.body.description).trim() || null;
    if (req.body.published !== undefined) {
      if (req.body.published && !store.setupPaid) throw new ApiError(422, 'Pay the setup fee first to publish the store');
      data.published = Boolean(req.body.published);
    }
    const updated = await prisma.store.update({ where: { id: store.id }, data });
    res.json(updated);
  } catch (err) { next(err); }
});

// POST /api/store/products/:id/toggle — list/unlist a product on the storefront.
// First listing of a product adds a one-time 10 BDT fee to the bill.
storeRouter.post('/products/:id/toggle', async (req, res, next) => {
  try {
    const store = await prisma.store.findUnique({ where: { tenantId: req.tenantId } });
    if (!store) throw new ApiError(404, 'Create your store first');
    const product = await prisma.product.findFirst({ where: { id: req.params.id, tenantId: req.tenantId } });
    if (!product) throw new ApiError(404, 'Product not found');

    const updated = await prisma.product.update({
      where: { id: product.id },
      data: { listedInStore: !product.listedInStore },
    });
    res.json({ product: updated, billing: await billingFor(req.tenantId) });
  } catch (err) { next(err); }
});

// POST /api/store/checkout { purpose: "SETUP" | "LISTING" }
// Creates a REAL SSLCOMMERZ session for the platform fee.
storeRouter.post('/checkout', async (req, res, next) => {
  try {
    if (!isSslczEnabled()) throw new ApiError(422, 'SSLCOMMERZ is not configured on this server');
    const store = await prisma.store.findUnique({ where: { tenantId: req.tenantId } });
    if (!store) throw new ApiError(404, 'Create your store first');

    const purpose = req.body.purpose === 'LISTING' ? 'LISTING' : 'SETUP';
    let amount = SETUP_FEE;
    if (purpose === 'SETUP') {
      if (store.setupPaid) throw new ApiError(422, 'Setup fee is already paid');
    } else {
      const billing = await billingFor(req.tenantId);
      amount = billing.listingFeeDue;
      if (amount <= 0) throw new ApiError(422, 'No listing fees due');
    }

    const user = await prisma.user.findFirst({ where: { id: req.userId, tenantId: req.tenantId } });
    const gatewayURL = await createSslczSession({
      id: store.id, // callback carries the store id
      amount,
      orderNumber: 0,
      customerName: user?.name || 'Merchant',
      phone: '01700000000',
      address: store.name,
      district: 'Dhaka',
      productName: purpose === 'SETUP' ? 'F-ComFlow store setup fee' : 'F-ComFlow product listing fees',
      callbackPath: `/api/shop/billing/${store.id}/callback?purpose=${purpose}`,
    });
    res.json({ gatewayURL, amount });
  } catch (err) { next(err); }
});

// POST /api/store/simulate-payment { purpose } — DEMO fallback (like the mock
// wallet): applies the fee without the gateway. Clearly labelled in the UI.
storeRouter.post('/simulate-payment', async (req, res, next) => {
  try {
    const store = await prisma.store.findUnique({ where: { tenantId: req.tenantId } });
    if (!store) throw new ApiError(404, 'Create your store first');
    const purpose = req.body.purpose === 'LISTING' ? 'LISTING' : 'SETUP';
    await applyStorePayment(store.id, purpose, `SIM-${Date.now()}`);
    res.json({ ok: true, billing: await billingFor(req.tenantId) });
  } catch (err) { next(err); }
});

// =====================================================================
// PUBLIC SIDE — mounted at /api/shop (no auth: customers + gateway callbacks)
// =====================================================================
export const shopRouter = Router();

// Storefront payload shared by the two GET routes
const PUBLIC_PRODUCT_SELECT = {
  id: true, name: true, price: true, discountPrice: true,
  imageUrl: true, images: true, stockQuantity: true,
} as const;

async function publicStore(slug: string) {
  const store = await prisma.store.findUnique({ where: { slug: String(slug).toLowerCase() } });
  if (!store || !store.setupPaid || !store.published) return null;
  return store;
}

// GET /api/shop/:slug — the storefront: store info + listed products
shopRouter.get('/:slug', async (req, res, next) => {
  try {
    const store = await publicStore(req.params.slug);
    if (!store) throw new ApiError(404, 'Store not found');
    const products = await prisma.product.findMany({
      where: { tenantId: store.tenantId, listedInStore: true },
      select: PUBLIC_PRODUCT_SELECT,
      orderBy: { name: 'asc' },
    });
    res.json({
      slug: store.slug, name: store.name, description: store.description,
      products,
      sslczEnabled: isSslczEnabled(),
    });
  } catch (err) { next(err); }
});

// GET /api/shop/:slug/products/:productId — one product's page
shopRouter.get('/:slug/products/:productId', async (req, res, next) => {
  try {
    const store = await publicStore(req.params.slug);
    if (!store) throw new ApiError(404, 'Store not found');
    const product = await prisma.product.findFirst({
      where: { id: req.params.productId, tenantId: store.tenantId, listedInStore: true },
      select: PUBLIC_PRODUCT_SELECT,
    });
    if (!product) throw new ApiError(404, 'Product not found');
    res.json({ store: { slug: store.slug, name: store.name }, product, sslczEnabled: isSslczEnabled() });
  } catch (err) { next(err); }
});

// POST /api/shop/:slug/order — a customer places an order from the storefront.
// COD -> order lands as DRAFT in the merchant's dashboard.
// payOnline -> same order + a FULL invoice; customer is sent to the pay page
// (which offers SSLCOMMERZ / bKash / QR).
shopRouter.post('/:slug/order', rateLimit(20, 60_000), async (req, res, next) => {
  try {
    const store = await publicStore(req.params.slug);
    if (!store) throw new ApiError(404, 'Store not found');
    const tenantId = store.tenantId;

    const { customerName, phone, address, district, payOnline } = req.body;
    let items: { productId: string; quantity: number }[] = Array.isArray(req.body.items) ? req.body.items : [];
    items = items
      .map((i) => ({ productId: String(i.productId || ''), quantity: Math.min(50, Math.max(1, Math.floor(Number(i.quantity) || 1))) }))
      .filter((i) => i.productId);

    if (!customerName || !address || !district) throw new ApiError(400, 'Name, address and district are required');
    if (!/^01[3-9]\d{8}$/.test(phone || '')) throw new ApiError(400, 'Phone must be a valid 11-digit number (01XXXXXXXXX)');
    if (items.length === 0) throw new ApiError(400, 'Pick at least one product');

    const products = await prisma.product.findMany({
      where: { id: { in: items.map((i) => i.productId) }, tenantId, listedInStore: true },
    });
    if (products.length !== items.length) throw new ApiError(404, 'A product in your cart is no longer available');

    const lines = items.map((i) => {
      const p: any = products.find((x: any) => x.id === i.productId)!;
      const unit = p.discountPrice != null ? Number(p.discountPrice) : Number(p.price);
      return { tenantId, productId: p.id, quantity: i.quantity, unitPrice: unit, subtotal: unit * i.quantity };
    });
    const total = lines.reduce((s, l) => s + l.subtotal, 0);

    const count = await prisma.order.count({ where: { tenantId } });
    const order = await prisma.order.create({
      data: {
        tenantId,
        orderNumber: 1001 + count,
        customerName: String(customerName).slice(0, 80),
        phone,
        address: String(address).slice(0, 200),
        district: String(district).slice(0, 40),
        totalAmount: total,
        source: 'STORE',
        items: { create: lines },
        events: {
          create: {
            tenantId, type: 'CREATED',
            note: `Order placed on your storefront (${store.slug}) — ${payOnline ? 'customer chose to pay online' : 'cash on delivery'}`,
          },
        },
      },
    });
    emitToTenant(tenantId, 'order:updated', order);

    // Pay online -> full invoice; the existing public pay page handles the rest
    if (payOnline) {
      const invoice = await prisma.invoice.create({
        data: { tenantId, orderId: order.id, type: 'FULL', amount: total },
      });
      return res.status(201).json({
        orderNumber: order.orderNumber,
        invoiceId: invoice.id,
        payUrl: `${config.clientUrl}/pay/${invoice.id}`,
      });
    }

    // COD -> the order is cash-on-delivery, but we still mint a FULL invoice so
    // the customer can OPTIONALLY prepay (a QR to this pay page is shown on the
    // confirmation screen). If they never pay it, it simply stays unpaid COD.
    const codInvoice = await prisma.invoice.create({
      data: { tenantId, orderId: order.id, type: 'FULL', amount: total },
    });
    res.status(201).json({
      orderNumber: order.orderNumber,
      invoiceId: codInvoice.id,
      payUrl: `${config.clientUrl}/pay/${codInvoice.id}`,
    });
  } catch (err) { next(err); }
});

// POST /api/shop/billing/:storeId/callback — SSLCOMMERZ posts the merchant's
// browser back here after paying a platform fee (setup / listings).
// Same rule as customer payments: re-validate with the gateway, never trust
// the redirect alone.
shopRouter.post('/billing/:storeId/callback', async (req, res) => {
  const back = `${config.clientUrl}/dashboard/store`;
  try {
    const purpose = req.query.purpose === 'LISTING' ? 'LISTING' : 'SETUP';
    const outcome = String(req.query.outcome || '');
    if (outcome === 'failed' || outcome === 'cancelled') return res.redirect(`${back}?billing=${outcome}`);

    const valId = req.body?.val_id;
    if (!valId || req.body?.status !== 'VALID') return res.redirect(`${back}?billing=failed`);

    const store = await prisma.store.findUnique({ where: { id: req.params.storeId } });
    if (!store) return res.redirect(`${back}?billing=failed`);

    const expected = purpose === 'SETUP'
      ? SETUP_FEE
      : (await billingFor(store.tenantId)).listingFeeDue;
    const txnId = await validateSslczPayment(String(valId), expected);
    await applyStorePayment(store.id, purpose, txnId);
    res.redirect(`${back}?billing=success`);
  } catch (e) {
    console.warn('[store] billing callback failed:', (e as Error).message);
    res.redirect(`${back}?billing=failed`);
  }
});
