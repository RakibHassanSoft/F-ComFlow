// Phase 6: Payments, Bangla QR & the settlement ledger.
// Financial code gets the strictest correctness bar:
//  - amounts handled as exact 2-decimal values, never floating garbage
//  - the settlement is ONE atomic transaction (order + ledger together)
//  - the webhook is idempotent: the same transactionId can never settle twice
// The payment provider is a mock of the SSLCOMMERZ sandbox; the webhook
// endpoint has the same shape a real IPN handler would.
import { Router } from 'express';
import { prisma } from '../lib/prisma';
import { requireAuth, requireOwner } from '../middleware/auth';
import { ApiError } from '../lib/errors';
import { emitToTenant } from '../lib/socket';
import { settlePayment, round2 } from '../services/payments';

const router = Router();
router.use(requireAuth);

// POST /api/payments/invoices  { orderId, type: "FULL" | "ADVANCE" }
// ADVANCE = 20% booking fee for high-risk COD orders (Phase 7 uses this).
router.post('/invoices', async (req, res, next) => {
  try {
    const { orderId, type } = req.body;
    const order = await prisma.order.findFirst({
      where: { id: orderId, tenantId: req.tenantId },
      include: { invoices: true },
    });
    if (!order) throw new ApiError(404, 'Order not found');
    if (order.paymentStatus === 'PAID') throw new ApiError(422, 'Order is already fully paid');
    if (order.invoices.some((i: { status: string }) => i.status === 'PENDING')) {
      throw new ApiError(409, 'This order already has a pending invoice');
    }

    const alreadyPaid = order.invoices
      .filter((i: { status: string }) => i.status === 'PAID')
      .reduce((sum: number, i: { amount: unknown }) => sum + Number(i.amount), 0);

    const amount =
      type === 'ADVANCE'
        ? round2(Number(order.totalAmount) * 0.2) // 20% booking fee
        : round2(Number(order.totalAmount) - alreadyPaid); // remaining balance

    if (amount <= 0) throw new ApiError(422, 'Nothing left to invoice');

    const invoice = await prisma.invoice.create({
      data: { tenantId: req.tenantId, orderId: order.id, type: type === 'ADVANCE' ? 'ADVANCE' : 'FULL', amount },
    });

    await prisma.orderEvent.create({
      data: {
        tenantId: req.tenantId,
        orderId: order.id,
        type: 'INVOICE_CREATED',
        note: `${invoice.type === 'ADVANCE' ? 'Advance payment' : 'Full payment'} invoice created — ৳${amount.toFixed(2)} (Bangla QR)`,
      },
    });

    res.status(201).json(invoice);
  } catch (err) { next(err); }
});

// GET /api/payments/invoices — every invoice across all orders (newest first).
// Powers the Invoices page: one place to see what's pending vs paid.
router.get('/invoices', async (req, res, next) => {
  try {
    const invoices = await prisma.invoice.findMany({
      where: { tenantId: req.tenantId },
      include: { order: { select: { id: true, orderNumber: true, customerName: true, status: true } } },
      orderBy: { createdAt: 'desc' },
    });
    res.json(invoices);
  } catch (err) { next(err); }
});

// GET /api/payments/invoices/:id — data for the QR invoice page
router.get('/invoices/:id', async (req, res, next) => {
  try {
    const invoice = await prisma.invoice.findFirst({
      where: { id: req.params.id, tenantId: req.tenantId },
      include: { order: { include: { items: { include: { product: true } } } } },
    });
    if (!invoice) throw new ApiError(404, 'Invoice not found');
    res.json(invoice);
  } catch (err) { next(err); }
});

// POST /api/payments/webhook — the (mock) SSLCOMMERZ IPN endpoint.
// Real version also validates the IPN signature before processing.
router.post('/webhook', async (req, res, next) => {
  try {
    const { invoiceId, transactionId } = req.body;
    if (!invoiceId || !transactionId) throw new ApiError(400, 'invoiceId and transactionId required');

    const result = await settlePayment(req.tenantId, invoiceId, transactionId);
    emitToTenant(req.tenantId, 'payment:settled', { invoiceId });
    res.json({ ok: true, duplicate: result.duplicate });
  } catch (err) { next(err); }
});

// POST /api/payments/invoices/:id/pay — DEMO: "customer scans the QR and pays
// with the sandbox wallet". Generates a transaction id and fires the webhook logic.
router.post('/invoices/:id/pay', async (req, res, next) => {
  try {
    const transactionId = `SSLCZ-${Date.now()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
    const result = await settlePayment(req.tenantId, req.params.id, transactionId);
    emitToTenant(req.tenantId, 'payment:settled', { invoiceId: req.params.id });
    res.json({ ok: true, transactionId, duplicate: result.duplicate });
  } catch (err) { next(err); }
});

// GET /api/payments/ledger?from=2026-01-01&to=2026-01-31 — settlement list +
// running balance. Optional from/to filter (inclusive, by settlement date).
// OWNER only: the money view is not for agents.
router.get('/ledger', requireOwner, async (req, res, next) => {
  try {
    const from = req.query.from ? new Date(String(req.query.from)) : null;
    const to = req.query.to ? new Date(`${String(req.query.to)}T23:59:59.999`) : null;
    const createdAt = {
      ...(from && !isNaN(from.getTime()) ? { gte: from } : {}),
      ...(to && !isNaN(to.getTime()) ? { lte: to } : {}),
    };
    const entries = await prisma.ledgerEntry.findMany({
      where: { tenantId: req.tenantId, ...(Object.keys(createdAt).length ? { createdAt } : {}) },
      include: { order: true },
      orderBy: { createdAt: 'asc' },
    });
    let balance = 0;
    const withBalance = entries.map((e: any) => {
      balance = round2(balance + Number(e.net));
      return { ...e, runningBalance: balance };
    });
    res.json(withBalance.reverse()); // newest first for the UI
  } catch (err) { next(err); }
});

// GET /api/payments/ledger/export — CSV download (OWNER only)
router.get('/ledger/export', requireOwner, async (req, res, next) => {
  try {
    const entries = await prisma.ledgerEntry.findMany({
      where: { tenantId: req.tenantId },
      include: { order: true },
      orderBy: { createdAt: 'asc' },
    });
    const rows = [
      'Date,Order,Gross (BDT),Fee (BDT),VAT (BDT),Net (BDT)',
      ...entries.map((e: any) =>
        [e.createdAt.toISOString().slice(0, 10), `#${e.order.orderNumber}`, e.gross, e.fee, e.vat, e.net].join(',')
      ),
    ];
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename=ledger.csv');
    res.send(rows.join('\n'));
  } catch (err) { next(err); }
});

export default router;
