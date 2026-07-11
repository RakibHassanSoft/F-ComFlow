// Phase 4: Order lifecycle — the transactional heart of F-ComFlow.
// Phase 7 hooks in here too: every confirmation gets a COD risk score.
//
// State machine:  DRAFT -> CONFIRMED -> DISPATCHED -> DELIVERED
//                     \-> CANCELLED       \-> RETURNED
// Illegal jumps (e.g. DRAFT -> DELIVERED) are rejected with 4xx.
import { Router } from 'express';
import { prisma } from '../lib/prisma';
import { requireAuth } from '../middleware/auth';
import { ApiError } from '../lib/errors';
import { scoreOrder } from '../services/riskScorer';
import { emitToTenant } from '../lib/socket';
import { notifyOrderStatus, sendToOrderCustomer } from '../services/notifications';
import { config } from '../config';

const router = Router();
router.use(requireAuth);

type OrderStatus = 'DRAFT' | 'CONFIRMED' | 'DISPATCHED' | 'DELIVERED' | 'RETURNED' | 'CANCELLED';

// Which transitions are allowed, enforced server-side
const ALLOWED: Record<OrderStatus, OrderStatus[]> = {
  DRAFT: ['CONFIRMED', 'CANCELLED'],
  CONFIRMED: ['DISPATCHED', 'CANCELLED'],
  DISPATCHED: ['DELIVERED', 'RETURNED'],
  DELIVERED: [],
  RETURNED: [],
  CANCELLED: [],
};

function assertTransition(from: OrderStatus, to: OrderStatus) {
  if (!ALLOWED[from].includes(to)) {
    throw new ApiError(422, `Cannot move an order from ${from} to ${to}`);
  }
}

// Helper: fetch an order, 404 if it belongs to another tenant
async function getOwnOrder(tenantId: string, id: string) {
  const order = await prisma.order.findFirst({ where: { id, tenantId } });
  if (!order) throw new ApiError(404, 'Order not found');
  return order;
}

// GET /api/orders?status=CONFIRMED&q=karim — filterable, searchable list.
// q matches customer name (case-insensitive), phone, tracking code, or the
// exact order number.
router.get('/', async (req, res, next) => {
  try {
    const status = req.query.status as OrderStatus | undefined;
    const q = String(req.query.q || '').trim();
    const search = q
      ? {
          OR: [
            { customerName: { contains: q, mode: 'insensitive' as const } },
            { phone: { contains: q } },
            { trackingCode: { contains: q, mode: 'insensitive' as const } },
            ...(/^\d+$/.test(q) ? [{ orderNumber: Number(q) }] : []),
          ],
        }
      : {};
    const orders = await prisma.order.findMany({
      where: { tenantId: req.tenantId, ...(status ? { status } : {}), ...search },
      include: { product: true },
      orderBy: { createdAt: 'desc' },
    });
    res.json(orders);
  } catch (err) { next(err); }
});

// GET /api/orders/export.csv — download all orders as a spreadsheet
router.get('/export.csv', async (req, res, next) => {
  try {
    const orders = await prisma.order.findMany({
      where: { tenantId: req.tenantId },
      include: { product: true },
      orderBy: { createdAt: 'asc' },
    });
    const esc = (v: unknown) => {
      const str = String(v ?? '');
      return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
    };
    const header = 'Order,Date,Status,Payment,Customer,Phone,District,Product,Qty,Total (BDT),Risk';
    const lines = orders.map((o: any) => [
      o.orderNumber,
      o.createdAt.toISOString().slice(0, 10),
      o.status,
      o.paymentStatus,
      o.customerName,
      o.phone,
      o.district,
      o.product?.name ?? '',
      o.quantity,
      Number(o.totalAmount).toFixed(2),
      o.riskLevel ?? '',
    ].map(esc).join(','));
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename=orders.csv');
    res.send([header, ...lines].join('\n'));
  } catch (err) { next(err); }
});

// GET /api/orders/:id — detail with full timeline
router.get('/:id', async (req, res, next) => {
  try {
    const order = await prisma.order.findFirst({
      where: { id: req.params.id, tenantId: req.tenantId },
      include: {
        product: true,
        events: { orderBy: { createdAt: 'asc' } },
        invoices: { orderBy: { createdAt: 'desc' } },
      },
    });
    if (!order) throw new ApiError(404, 'Order not found');
    res.json(order);
  } catch (err) { next(err); }
});

// POST /api/orders — create a DRAFT order (from the AI parser or manual entry)
router.post('/', async (req, res, next) => {
  try {
    const { customerName, phone, address, district, productId, quantity, conversationId, customerId } = req.body;

    // Phase 3 exit gate: invalid values are impossible to save
    if (!customerName || !address || !district || !productId) {
      throw new ApiError(400, 'customerName, address, district and productId are required');
    }
    if (!/^01[3-9]\d{8}$/.test(phone || '')) {
      throw new ApiError(400, 'Phone must be a valid 11-digit Bangladeshi number (01XXXXXXXXX)');
    }
    const qty = Number(quantity) || 1;
    if (qty < 1) throw new ApiError(400, 'Quantity must be at least 1');

    const product = await prisma.product.findFirst({
      where: { id: productId, tenantId: req.tenantId },
    });
    if (!product) throw new ApiError(404, 'Product not found');

    // Human-friendly order number, unique per tenant
    const count = await prisma.order.count({ where: { tenantId: req.tenantId } });
    const total = Number(product.price) * qty;

    const order = await prisma.order.create({
      data: {
        tenantId: req.tenantId,
        orderNumber: 1001 + count,
        customerName,
        phone,
        address,
        district,
        productId,
        quantity: qty,
        unitPrice: product.price,
        totalAmount: total,
        conversationId: conversationId || null,
        customerId: customerId || null,
        events: { create: { tenantId: req.tenantId, type: 'CREATED', note: 'Draft order created' } },
      },
      include: { product: true },
    });
    res.status(201).json(order);
  } catch (err) { next(err); }
});

// POST /api/orders/:id/confirm — THE critical path.
// Stock decrement is atomic: `updateMany` with `stockQuantity >= qty` in the
// WHERE clause means two simultaneous confirmations of the last unit can
// never both succeed — the database allows exactly one through.
router.post('/:id/confirm', async (req, res, next) => {
  try {
    const order = await getOwnOrder(req.tenantId, req.params.id);
    assertTransition(order.status, 'CONFIRMED');

    // Phase 7: score the order BEFORE dispatch (graceful: never blocks on failure)
    let risk = null;
    try {
      risk = await scoreOrder(req.tenantId, order);
    } catch {
      /* risk service down -> order proceeds with "score unavailable" */
    }

    const updated = await prisma.$transaction(async (tx: any) => {
      // Atomic conditional decrement — the whole double-selling fix in 5 lines
      const result = await tx.product.updateMany({
        where: { id: order.productId, tenantId: req.tenantId, stockQuantity: { gte: order.quantity } },
        data: { stockQuantity: { decrement: order.quantity } },
      });
      if (result.count === 0) {
        throw new ApiError(409, 'Not enough stock — someone may have just bought the last unit');
      }

      return tx.order.update({
        where: { id: order.id },
        data: {
          status: 'CONFIRMED',
          riskScore: risk?.score ?? null,
          riskLevel: risk?.level ?? null,
          events: {
            create: [
              { tenantId: req.tenantId, type: 'CONFIRMED', note: `Order confirmed — ${order.quantity} unit(s) reserved from stock` },
              {
                tenantId: req.tenantId,
                type: 'RISK_SCORED',
                note: risk
                  ? `COD risk: ${risk.score}% (${risk.level})${risk.factors.length ? ' — ' + risk.factors.join('; ') : ''}`
                  : 'Risk score unavailable — proceeding without it',
              },
            ],
          },
        },
        include: { product: true },
      });
    });

    // Phase 4: low-stock alert — exactly one per threshold crossing
    const product = await prisma.product.findFirst({ where: { id: order.productId, tenantId: req.tenantId } });
    if (product && product.stockQuantity <= product.reorderThreshold && !product.lowStockAlerted) {
      await prisma.product.update({ where: { id: product.id }, data: { lowStockAlerted: true } });
      emitToTenant(req.tenantId, 'alert:lowstock', {
        productName: product.name,
        stockQuantity: product.stockQuantity,
      });
    }

    void notifyOrderStatus(updated, 'CONFIRMED');
    res.json(updated);
  } catch (err) { next(err); }
});

// Shared logic for cancel & return: move status + put units back in stock
async function restockAndTransition(tenantId: string, orderId: string, to: 'CANCELLED' | 'RETURNED') {
  const order = await getOwnOrder(tenantId, orderId);
  assertTransition(order.status, to);

  // Only give stock back if it was actually reserved (i.e. past DRAFT)
  const wasReserved = order.status !== 'DRAFT';

  return prisma.$transaction(async (tx: any) => {
    if (wasReserved) {
      await tx.product.updateMany({
        where: { id: order.productId, tenantId },
        data: { stockQuantity: { increment: order.quantity } },
      });
    }
    return tx.order.update({
      where: { id: order.id },
      data: {
        status: to,
        events: {
          create: {
            tenantId,
            type: to,
            note: wasReserved
              ? `Order ${to.toLowerCase()} — ${order.quantity} unit(s) returned to stock`
              : `Order ${to.toLowerCase()}`,
          },
        },
      },
      include: { product: true },
    });
  });
}

router.post('/:id/cancel', async (req, res, next) => {
  try {
    const updated = await restockAndTransition(req.tenantId, req.params.id, 'CANCELLED');
    void notifyOrderStatus(updated, 'CANCELLED');
    res.json(updated);
  } catch (err) { next(err); }
});

router.post('/:id/return', async (req, res, next) => {
  try {
    const updated = await restockAndTransition(req.tenantId, req.params.id, 'RETURNED');
    void notifyOrderStatus(updated, 'RETURNED');
    res.json(updated);
  } catch (err) { next(err); }
});

router.post('/:id/deliver', async (req, res, next) => {
  try {
    const order = await getOwnOrder(req.tenantId, req.params.id);
    assertTransition(order.status, 'DELIVERED');
    const updated = await prisma.order.update({
      where: { id: order.id },
      data: {
        status: 'DELIVERED',
        events: { create: { tenantId: req.tenantId, type: 'DELIVERED', note: 'Package delivered to customer' } },
      },
      include: { product: true },
    });
    void notifyOrderStatus(updated, 'DELIVERED');
    res.json(updated);
  } catch (err) { next(err); }
});

// POST /api/orders/:id/note  { note } — free-text internal note, stored on the
// order's timeline (OrderEvent type NOTE) so it prints alongside every event.
router.post('/:id/note', async (req, res, next) => {
  try {
    const note = String(req.body?.note || '').trim();
    if (!note) throw new ApiError(400, 'Note text is required');
    if (note.length > 1000) throw new ApiError(400, 'Note is too long (max 1000 characters)');

    const order = await getOwnOrder(req.tenantId, req.params.id);
    const event = await prisma.orderEvent.create({
      data: { tenantId: req.tenantId, orderId: order.id, type: 'NOTE', note },
    });
    res.status(201).json(event);
  } catch (err) { next(err); }
});

// POST /api/orders/:id/request-advance — create a 20% booking-fee invoice for a
// (usually high-risk) COD order and send the customer a pay link in the chat.
router.post('/:id/request-advance', async (req, res, next) => {
  try {
    const order = await prisma.order.findFirst({
      where: { id: req.params.id, tenantId: req.tenantId },
      include: { invoices: true },
    });
    if (!order) throw new ApiError(404, 'Order not found');
    if (order.status === 'CANCELLED') throw new ApiError(422, 'Order is cancelled');
    if (order.paymentStatus === 'PAID') throw new ApiError(422, 'Order is already fully paid');
    if (order.invoices.some((i: { status: string }) => i.status === 'PENDING')) {
      throw new ApiError(409, 'This order already has a pending invoice');
    }

    const amount = Math.round(Number(order.totalAmount) * 0.2 * 100) / 100; // 20% booking fee
    if (amount <= 0) throw new ApiError(422, 'Nothing to invoice');

    const invoice = await prisma.invoice.create({
      data: { tenantId: req.tenantId, orderId: order.id, type: 'ADVANCE', amount },
    });
    await prisma.orderEvent.create({
      data: {
        tenantId: req.tenantId,
        orderId: order.id,
        type: 'INVOICE_CREATED',
        note: `Advance payment link sent — ৳${amount.toFixed(2)}`,
      },
    });

    const payUrl = `${config.clientUrl}/pay/${invoice.id}`;
    const text = `To confirm order #${order.orderNumber}, please pay a ৳${amount.toFixed(0)} advance here: ${payUrl}`;
    const conversationId = await sendToOrderCustomer(order, text);

    res.status(201).json({ invoiceId: invoice.id, amount, payUrl, messagedConversationId: conversationId });
  } catch (err) { next(err); }
});

export default router;
