// PUBLIC customer payment link (no auth) — the advance-fee link a merchant
// sends a customer in chat opens a page that calls these. Tenant is derived
// from the invoice itself, so a customer never needs an account.
import { Router } from 'express';
import { prisma } from '../lib/prisma';
import { ApiError } from '../lib/errors';
import { emitToTenant } from '../lib/socket';
import { settlePayment } from '../services/payments';
import { isBkashEnabled, createBkashPayment, executeBkashPayment } from '../services/bkash';
import { isSslczEnabled, createSslczSession, validateSslczPayment } from '../services/sslcommerz';
import { config } from '../config';

const router = Router();

// GET /api/pay/:invoiceId — minimal public info to render the pay page
router.get('/:invoiceId', async (req, res, next) => {
  try {
    const invoice = await prisma.invoice.findUnique({
      where: { id: req.params.invoiceId },
      include: { order: { include: { items: { include: { product: true } } } }, tenant: true },
    });
    if (!invoice) throw new ApiError(404, 'Payment link not found');
    const names = invoice.order.items.map((i: any) => `${i.product.name} × ${i.quantity}`);
    res.json({
      invoiceId: invoice.id,
      businessName: invoice.tenant.businessName,
      orderNumber: invoice.order.orderNumber,
      productName: names.length > 2 ? `${names.slice(0, 2).join(', ')} +${names.length - 2} more` : names.join(', '),
      type: invoice.type,
      amount: Number(invoice.amount),
      status: invoice.status,
      bkashEnabled: isBkashEnabled(), // the pay page shows a real bKash button when true
      sslczEnabled: isSslczEnabled(), // ...and a card/mobile-banking button when true
    });
  } catch (err) { next(err); }
});

// POST /api/pay/:invoiceId/sslcommerz — start a REAL SSLCOMMERZ (sandbox)
// hosted checkout. Responds with the GatewayPageURL to redirect the customer to.
router.post('/:invoiceId/sslcommerz', async (req, res, next) => {
  try {
    if (!isSslczEnabled()) throw new ApiError(422, 'SSLCOMMERZ is not configured on this server');
    const invoice = await prisma.invoice.findUnique({
      where: { id: req.params.invoiceId },
      include: { order: { include: { items: { include: { product: true } } } } },
    });
    if (!invoice) throw new ApiError(404, 'Payment link not found');
    if (invoice.status === 'PAID') throw new ApiError(422, 'This invoice is already paid');
    if (invoice.order.status === 'CANCELLED') throw new ApiError(422, 'Order was cancelled');

    const gatewayURL = await createSslczSession({
      id: invoice.id,
      amount: Number(invoice.amount),
      orderNumber: invoice.order.orderNumber,
      customerName: invoice.order.customerName,
      phone: invoice.order.phone,
      address: invoice.order.address,
      district: invoice.order.district,
      productName: invoice.order.items.map((i: any) => i.product.name).join(', '),
    });
    res.json({ gatewayURL });
  } catch (err) { next(err); }
});

// POST /api/pay/:invoiceId/sslcz/callback — SSLCOMMERZ posts the customer's
// browser back here after the hosted page. We re-validate the val_id with the
// gateway (never trust the redirect alone), settle idempotently, then send the
// customer back to the pay page with a result flag.
router.post('/:invoiceId/sslcz/callback', async (req, res) => {
  const payPage = `${config.clientUrl}/pay/${req.params.invoiceId}`;
  try {
    const outcome = String(req.query.outcome || '');
    if (outcome === 'failed' || outcome === 'cancelled') {
      return res.redirect(`${payPage}?gateway=${outcome}`);
    }
    const valId = req.body?.val_id;
    if (!valId || req.body?.status !== 'VALID') {
      return res.redirect(`${payPage}?gateway=failed`);
    }
    const invoice = await prisma.invoice.findUnique({ where: { id: req.params.invoiceId } });
    if (!invoice) return res.redirect(`${payPage}?gateway=failed`);

    // Server-to-server validation: signature-of-truth is SSLCOMMERZ, not the browser
    const tranId = await validateSslczPayment(String(valId), Number(invoice.amount));
    await settlePayment(invoice.tenantId, invoice.id, tranId);
    emitToTenant(invoice.tenantId, 'payment:settled', { invoiceId: invoice.id });
    res.redirect(`${payPage}?gateway=success`);
  } catch (e) {
    console.warn('[sslcz] callback failed:', (e as Error).message);
    res.redirect(`${payPage}?gateway=failed`);
  }
});

// POST /api/pay/:invoiceId/bkash — start a REAL bKash (sandbox) checkout.
// Responds with the bkashURL the customer's browser should be sent to.
router.post('/:invoiceId/bkash', async (req, res, next) => {
  try {
    if (!isBkashEnabled()) throw new ApiError(422, 'bKash is not configured on this server');
    const invoice = await prisma.invoice.findUnique({
      where: { id: req.params.invoiceId },
      include: { order: true },
    });
    if (!invoice) throw new ApiError(404, 'Payment link not found');
    if (invoice.status === 'PAID') throw new ApiError(422, 'This invoice is already paid');
    if (invoice.order.status === 'CANCELLED') throw new ApiError(422, 'Order was cancelled');

    const bkashURL = await createBkashPayment(invoice.id, Number(invoice.amount), invoice.order.orderNumber);
    res.json({ bkashURL });
  } catch (err) { next(err); }
});

// GET /api/pay/:invoiceId/bkash/callback — bKash redirects the customer here
// after the wallet screen. On success we execute + settle (idempotent), then
// send the customer back to the pay page with a result flag.
router.get('/:invoiceId/bkash/callback', async (req, res) => {
  const payPage = `${config.clientUrl}/pay/${req.params.invoiceId}`;
  try {
    const { paymentID, status } = req.query as { paymentID?: string; status?: string };
    if (status !== 'success' || !paymentID) {
      return res.redirect(`${payPage}?bkash=${status === 'cancel' ? 'cancelled' : 'failed'}`);
    }
    const trxID = await executeBkashPayment(String(paymentID));
    const invoice = await prisma.invoice.findUnique({ where: { id: req.params.invoiceId } });
    if (!invoice) return res.redirect(`${payPage}?bkash=failed`);

    await settlePayment(invoice.tenantId, invoice.id, trxID);
    emitToTenant(invoice.tenantId, 'payment:settled', { invoiceId: invoice.id });
    res.redirect(`${payPage}?bkash=success`);
  } catch (e) {
    console.warn('[bkash] callback failed:', (e as Error).message);
    res.redirect(`${payPage}?bkash=failed`);
  }
});

// POST /api/pay/:invoiceId — DEMO settle (mock wallet). Real version redirects
// to SSLCOMMERZ/bKash and settles via their IPN webhook instead.
router.post('/:invoiceId', async (req, res, next) => {
  try {
    const invoice = await prisma.invoice.findUnique({ where: { id: req.params.invoiceId } });
    if (!invoice) throw new ApiError(404, 'Payment link not found');
    const transactionId = `PAYLINK-${Date.now()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
    const result = await settlePayment(invoice.tenantId, invoice.id, transactionId);
    emitToTenant(invoice.tenantId, 'payment:settled', { invoiceId: invoice.id });
    res.json({ ok: true, transactionId, duplicate: result.duplicate });
  } catch (err) { next(err); }
});

export default router;
