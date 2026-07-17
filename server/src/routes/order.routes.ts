// Order lifecycle — atomic per-item stock reservation, a state machine
// (DRAFT→CONFIRMED→DISPATCHED→DELIVERED, or CANCELLED/RETURNED), and a COD
// risk score on confirm.
import { Router } from 'express';
import { prisma, basePrisma, setTenantGuc } from '../lib/prisma';
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

const ITEMS_INCLUDE = { items: { include: { product: true } } } as const;

// Helper: fetch an order (with items), 404 if it belongs to another tenant
async function getOwnOrder(tenantId: string, id: string) {
  const order = await prisma.order.findFirst({
    where: { id, tenantId },
    include: ITEMS_INCLUDE,
  });
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
      include: ITEMS_INCLUDE,
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
      include: ITEMS_INCLUDE,
      orderBy: { createdAt: 'asc' },
    });
    const esc = (v: unknown) => {
      const str = String(v ?? '');
      return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
    };
    const header = 'Order,Date,Status,Payment,Customer,Phone,District,Items,Qty,Delivery (BDT),Total (BDT),Risk';
    const lines = orders.map((o: any) => [
      o.orderNumber,
      o.createdAt.toISOString().slice(0, 10),
      o.status,
      o.paymentStatus,
      o.customerName,
      o.phone,
      o.district,
      o.items.map((i: any) => `${i.product.name} x${i.quantity}`).join('; '),
      o.items.reduce((s: number, i: any) => s + i.quantity, 0),
      Number(o.deliveryFee).toFixed(2),
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
        ...ITEMS_INCLUDE,
        events: { orderBy: { createdAt: 'asc' } },
        invoices: { orderBy: { createdAt: 'desc' } },
      },
    });
    if (!order) throw new ApiError(404, 'Order not found');
    res.json(order);
  } catch (err) { next(err); }
});

// POST /api/orders — create a DRAFT order (from the AI parser or manual entry).
// Body: { customerName, phone, address, district, items: [{ productId, quantity }],
//         deliveryFee?, conversationId?, customerId? }
// Legacy single-product bodies ({ productId, quantity }) are still accepted.
router.post('/', async (req, res, next) => {
  try {
    const { customerName, phone, address, district, conversationId, customerId } = req.body;

    // Normalize: accept either items[] or the legacy single productId/quantity
    let items: { productId: string; quantity: number }[] = Array.isArray(req.body.items)
      ? req.body.items
      : req.body.productId
        ? [{ productId: req.body.productId, quantity: req.body.quantity }]
        : [];
    items = items
      .map((i) => ({ productId: String(i.productId || ''), quantity: Math.floor(Number(i.quantity) || 1) }))
      .filter((i) => i.productId);

    // invalid values are impossible to save
    if (!customerName || !address || !district) {
      throw new ApiError(400, 'customerName, address and district are required');
    }
    if (items.length === 0) throw new ApiError(400, 'At least one product is required');
    if (items.some((i) => i.quantity < 1)) throw new ApiError(400, 'Quantity must be at least 1');
    if (!/^01[3-9]\d{8}$/.test(phone || '')) {
      throw new ApiError(400, 'Phone must be a valid 11-digit Bangladeshi number (01XXXXXXXXX)');
    }

    // Merge duplicate product lines (2× same product = one line, qty summed)
    const merged = new Map<string, number>();
    for (const i of items) merged.set(i.productId, (merged.get(i.productId) || 0) + i.quantity);

    const products = await prisma.product.findMany({
      where: { id: { in: [...merged.keys()] }, tenantId: req.tenantId },
    });
    if (products.length !== merged.size) throw new ApiError(404, 'One or more products not found');

    const lines = products.map((p: any) => {
      const quantity = merged.get(p.id)!;
      // Discounted products sell at their sale price
      const unit = p.discountPrice != null ? Number(p.discountPrice) : Number(p.price);
      return { tenantId: req.tenantId, productId: p.id, quantity, unitPrice: unit, subtotal: unit * quantity };
    });
    const itemsTotal = lines.reduce((s: number, l: any) => s + l.subtotal, 0);
    const deliveryFee = Math.max(0, Number(req.body.deliveryFee) || 0);

    // Human-friendly order number, unique per tenant
    const count = await prisma.order.count({ where: { tenantId: req.tenantId } });

    const order = await prisma.order.create({
      data: {
        tenantId: req.tenantId,
        orderNumber: 1001 + count,
        customerName,
        phone,
        address,
        district,
        deliveryFee,
        totalAmount: itemsTotal + deliveryFee,
        items: { create: lines },
        conversationId: conversationId || null,
        customerId: customerId || null,
        events: { create: { tenantId: req.tenantId, type: 'CREATED', note: `Draft order created — ${lines.length} item line(s)` } },
      },
      include: ITEMS_INCLUDE,
    });
    res.status(201).json(order);
  } catch (err) { next(err); }
});

// POST /api/orders/:id/confirm — THE critical path.
// Each line's stock decrement is atomic (`updateMany` with stockQuantity >= qty
// in the WHERE). All lines run inside ONE transaction: any line without stock
// throws, and Postgres rolls back every earlier decrement — all-or-nothing.
router.post('/:id/confirm', async (req, res, next) => {
  try {
    const order = await getOwnOrder(req.tenantId, req.params.id);
    assertTransition(order.status, 'CONFIRMED');

    // score the order BEFORE dispatch (never blocks on failure)
    let risk = null;
    try {
      risk = await scoreOrder(req.tenantId, order);
    } catch {
      /* risk service down -> order proceeds with "score unavailable" */
    }

    const totalUnits = order.items.reduce((s: number, i: any) => s + i.quantity, 0);

    const updated = await basePrisma.$transaction(async (tx: any) => {
      await setTenantGuc(tx, req.tenantId); // RLS: scope this transaction
      for (const item of order.items) {
        const result = await tx.product.updateMany({
          where: { id: item.productId, tenantId: req.tenantId, stockQuantity: { gte: item.quantity } },
          data: { stockQuantity: { decrement: item.quantity } },
        });
        if (result.count === 0) {
          throw new ApiError(409, `Not enough stock of ${item.product.name} — someone may have just bought the last unit`);
        }
      }

      return tx.order.update({
        where: { id: order.id },
        data: {
          status: 'CONFIRMED',
          riskScore: risk?.score ?? null,
          riskLevel: risk?.level ?? null,
          events: {
            create: [
              { tenantId: req.tenantId, type: 'CONFIRMED', note: `Order confirmed — ${totalUnits} unit(s) across ${order.items.length} line(s) reserved from stock` },
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
        include: ITEMS_INCLUDE,
      });
    });

    // low-stock alert — exactly one per threshold crossing, per product
    const fresh = await prisma.product.findMany({
      where: { id: { in: order.items.map((i: any) => i.productId) }, tenantId: req.tenantId },
    });
    for (const product of fresh) {
      if (product.stockQuantity <= product.reorderThreshold && !product.lowStockAlerted) {
        await prisma.product.update({ where: { id: product.id }, data: { lowStockAlerted: true } });
        emitToTenant(req.tenantId, 'alert:lowstock', {
          productName: product.name,
          stockQuantity: product.stockQuantity,
        });
      }
    }

    void notifyOrderStatus(updated, 'CONFIRMED');
    res.json(updated);
  } catch (err) { next(err); }
});

// Shared logic for cancel & return: move status + put every line back in stock
async function restockAndTransition(
  tenantId: string,
  orderId: string,
  to: 'CANCELLED' | 'RETURNED',
  reason?: string
) {
  const order = await getOwnOrder(tenantId, orderId);
  assertTransition(order.status, to);

  // Only give stock back if it was actually reserved (i.e. past DRAFT)
  const wasReserved = order.status !== 'DRAFT';
  const totalUnits = order.items.reduce((s: number, i: any) => s + i.quantity, 0);

  return basePrisma.$transaction(async (tx: any) => {
    await setTenantGuc(tx, tenantId); // RLS: scope this transaction
    if (wasReserved) {
      for (const item of order.items) {
        await tx.product.updateMany({
          where: { id: item.productId, tenantId },
          data: { stockQuantity: { increment: item.quantity } },
        });
      }
    }
    return tx.order.update({
      where: { id: order.id },
      data: {
        status: to,
        ...(to === 'RETURNED' && reason ? { returnReason: reason } : {}),
        events: {
          create: {
            tenantId,
            type: to,
            note: (wasReserved
              ? `Order ${to.toLowerCase()} — ${totalUnits} unit(s) returned to stock`
              : `Order ${to.toLowerCase()}`) + (reason ? ` · Reason: ${reason}` : ''),
          },
        },
      },
      include: ITEMS_INCLUDE,
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

// POST /api/orders/:id/return  { reason? } — reason feeds the Analytics page
router.post('/:id/return', async (req, res, next) => {
  try {
    const reason = String(req.body?.reason || '').trim().slice(0, 200) || undefined;
    const updated = await restockAndTransition(req.tenantId, req.params.id, 'RETURNED', reason);
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
      include: ITEMS_INCLUDE,
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
