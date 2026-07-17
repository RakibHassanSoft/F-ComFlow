// Machine webhooks (no login): external store stock sync (Shopify/Woo) and
// courier status pushes. Protected by an optional shared token.
import { Router } from 'express';
import { prisma } from '../lib/prisma';
import { ApiError } from '../lib/errors';
import { emitToTenant } from '../lib/socket';
import { canonicalStatus } from '../services/couriers';
import { applyTrackingUpdate } from '../services/tracker';

const router = Router();

// ---------------------------------------------------------------- couriers
// POST /api/webhooks/courier/pathao — Pathao pushes order status changes
// here the moment they happen (configure the webhook + secret in the Pathao
// merchant panel). The dashboard updates live over Socket.io — the exact
// status the courier reports is what the merchant sees, instantly.
router.post('/courier/pathao', async (req, res, next) => {
  try {
    // Pathao sends your integration secret with every webhook — verify it,
    // and echo it back in the response header as their spec requires.
    const secret = process.env.PATHAO_WEBHOOK_SECRET;
    if (secret) {
      const got = req.headers['x-pathao-signature'];
      if (got !== secret) throw new ApiError(403, 'Invalid Pathao webhook signature');
      res.setHeader('X-Pathao-Merchant-Webhook-Integration-Secret', secret);
    }

    // Pathao's real webhook carries the status in `event` (e.g. "order.delivered",
    // "order.in-transit", "order.returned"); older/test payloads may use
    // `order_status`. The handshake event ("webhook_integration") and any ping
    // carry no consignment_id — just 202 them (the secret header above is what
    // Pathao's handshake actually checks).
    const { consignment_id, order_status, event } = req.body || {};
    if (!consignment_id || event === 'webhook_integration') {
      return res.status(202).json({ ok: true });
    }

    const statusText = event || order_status;
    const order = await prisma.order.findFirst({
      where: { trackingCode: String(consignment_id), courierName: 'Pathao' },
    });
    if (order && statusText) {
      await applyTrackingUpdate(order.id, canonicalStatus(String(statusText)));
    }

    res.status(202).json({ ok: true });
  } catch (err) { next(err); }
});

// POST /api/webhooks/courier/redx?token=<REDX_WEBHOOK_TOKEN>
// RedX pushes parcel status changes here. RedX puts credentials in the query
// string (see their webhook docs), so we verify ?token= against our env value.
// Payload: { tracking_number, status, message_en, invoice_number, ... }.
router.post('/courier/redx', async (req, res, next) => {
  try {
    const expected = process.env.REDX_WEBHOOK_TOKEN;
    if (expected && req.query.token !== expected) {
      throw new ApiError(403, 'Invalid RedX webhook token');
    }
    const { tracking_number, status, message_en } = req.body || {};
    if (!tracking_number) return res.status(200).json({ ok: true }); // ping/test

    const order = await prisma.order.findFirst({
      where: { trackingCode: String(tracking_number), courierName: 'RedX' },
    });
    const raw = status || message_en;
    if (order && raw) {
      await applyTrackingUpdate(order.id, canonicalStatus(String(raw)));
    }
    res.status(200).json({ ok: true });
  } catch (err) { next(err); }
});

// POST /api/webhooks/store/:tenantId/order
// Body: { sku: "TSH-001", quantity: 2, source: "shopify" }
router.post('/store/:tenantId/order', async (req, res, next) => {
  try {
    // Shared-secret check (skipped when no token is configured — demo mode)
    const expected = process.env.STORE_WEBHOOK_TOKEN;
    if (expected && req.headers['x-webhook-token'] !== expected) {
      throw new ApiError(401, 'Invalid webhook token');
    }

    const { tenantId } = req.params;
    const { sku, quantity, source } = req.body;
    const qty = Number(quantity) || 1;
    if (!sku) throw new ApiError(400, 'sku is required');

    const product = await prisma.product.findFirst({ where: { tenantId, sku } });
    if (!product) throw new ApiError(404, 'Unknown SKU for this tenant');

    // Atomic conditional decrement — same anti-double-sell guarantee
    const result = await prisma.product.updateMany({
      where: { id: product.id, tenantId, stockQuantity: { gte: qty } },
      data: { stockQuantity: { decrement: qty } },
    });
    if (result.count === 0) {
      throw new ApiError(409, `Not enough stock for ${sku} (external order rejected)`);
    }

    const updated = await prisma.product.findFirst({ where: { id: product.id, tenantId } });

    // Low-stock alert fires here too — one per threshold crossing
    if (updated && updated.stockQuantity <= updated.reorderThreshold && !updated.lowStockAlerted) {
      await prisma.product.update({ where: { id: updated.id }, data: { lowStockAlerted: true } });
      emitToTenant(tenantId, 'alert:lowstock', {
        productName: updated.name,
        stockQuantity: updated.stockQuantity,
      });
    }

    // OUTBOUND sync: real integration pushes the new quantity back to every
    // OTHER connected store here (Shopify Admin API / Woo REST API).
    console.log(`[store-sync] ${source || 'external'} order: ${sku} -${qty} -> stock now ${updated?.stockQuantity}`);
    emitToTenant(tenantId, 'inventory:synced', { sku, stockQuantity: updated?.stockQuantity });

    res.json({ ok: true, sku, stockQuantity: updated?.stockQuantity });
  } catch (err) { next(err); }
});

export default router;
