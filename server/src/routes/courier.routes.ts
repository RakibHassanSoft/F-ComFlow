// Courier rates, booking (idempotent) and status sync. Real APIs when keys are set.
import { Router } from 'express';
import { prisma } from '../lib/prisma';
import { requireAuth } from '../middleware/auth';
import { ApiError } from '../lib/errors';
import { compareRates, getAdapter, COURIER_JOURNEY } from '../services/couriers';
import { syncOrderTracking, advanceMockShipment } from '../services/tracker';
import { emitToTenant } from '../lib/socket';

const router = Router();
router.use(requireAuth);

// Rough parcel weight: 0.5kg per unit across all line items
function parcelWeight(items: { quantity: number }[]): number {
  return Math.max(0.5, items.reduce((s, i) => s + i.quantity, 0) * 0.5);
}

// GET /api/couriers/rates?orderId=... — normalized quotes from all carriers
router.get('/rates', async (req, res, next) => {
  try {
    const order = await prisma.order.findFirst({
      where: { id: String(req.query.orderId), tenantId: req.tenantId },
      include: { items: true },
    });
    if (!order) throw new ApiError(404, 'Order not found');

    const codAmount = order.paymentStatus === 'PAID' ? 0 : Number(order.totalAmount);
    const quotes = await compareRates(order.district, parcelWeight(order.items), codAmount);
    res.json(quotes);
  } catch (err) { next(err); }
});

// POST /api/couriers/book  { orderId, courier }
// Idempotency guard: an existing tracking code means double-clicking Book
// can never create a second consignment (Phase 5 exit gate).
router.post('/book', async (req, res, next) => {
  try {
    const { orderId, courier } = req.body;
    const order = await prisma.order.findFirst({
      where: { id: orderId, tenantId: req.tenantId },
      include: { items: true },
    });
    if (!order) throw new ApiError(404, 'Order not found');
    if (order.status !== 'CONFIRMED') throw new ApiError(422, 'Only CONFIRMED orders can be booked');
    if (order.trackingCode) throw new ApiError(409, 'This order is already booked'); // idempotency

    const adapter = getAdapter(courier);
    if (!adapter) throw new ApiError(400, 'Unknown courier');

    const weightKg = parcelWeight(order.items);
    const totalUnits = order.items.reduce((s: number, i: any) => s + i.quantity, 0);
    const itemsTotal = order.items.reduce((s: number, i: any) => s + Number(i.subtotal), 0);

    // Delivery fee: the carrier's quoted price is added to the order total —
    // but only while the order is still UNPAID (never change an amount the
    // customer already paid against).
    let deliveryFee = Number(order.deliveryFee);
    if (order.paymentStatus === 'UNPAID') {
      try {
        const quote = await adapter.getQuote(order.district, weightKg, itemsTotal);
        if (quote.available && quote.price > 0) deliveryFee = quote.price;
      } catch { /* quote failed -> keep existing fee */ }
    }
    const newTotal = order.paymentStatus === 'UNPAID' ? itemsTotal + deliveryFee : Number(order.totalAmount);

    const { trackingCode } = await adapter.book({
      orderNumber: order.orderNumber,
      customerName: order.customerName,
      phone: order.phone,
      address: order.address,
      district: order.district,
      codAmount: order.paymentStatus === 'PAID' ? 0 : newTotal,
      quantity: totalUnits,
      weightKg,
    });

    const updated = await prisma.order.update({
      where: { id: order.id },
      data: {
        status: 'DISPATCHED',
        courierName: adapter.name,
        trackingCode,
        courierStatus: COURIER_JOURNEY[0],
        deliveryFee,
        totalAmount: newTotal,
        events: {
          create: [
            {
              tenantId: req.tenantId,
              type: 'DISPATCHED',
              note: `Booked with ${adapter.name}${adapter.isLive() ? ' (live API)' : ' (sandbox)'} — tracking ${trackingCode}`
                + (deliveryFee > 0 ? ` · delivery fee ৳${deliveryFee.toFixed(2)} added to total` : ''),
            },
            {
              tenantId: req.tenantId,
              type: 'SMS_SENT',
              note: `SMS to ${order.phone}: "Your order #${order.orderNumber} is on the way via ${adapter.name}. Track: ${trackingCode}"`,
            },
          ],
        },
      },
      include: { items: { include: { product: true } } },
    });

    emitToTenant(req.tenantId, 'order:updated', updated);
    res.json(updated);
  } catch (err) { next(err); }
});

// POST /api/couriers/sync/:orderId — pull the latest carrier status NOW.
// Live carrier -> real tracking API. Mock carrier -> advance one step.
router.post('/sync/:orderId', async (req, res, next) => {
  try {
    const order = await prisma.order.findFirst({
      where: { id: req.params.orderId, tenantId: req.tenantId },
    });
    if (!order) throw new ApiError(404, 'Order not found');
    if (!order.trackingCode || !order.courierStatus) throw new ApiError(422, 'Order has no shipment to sync');

    const result = await syncOrderTracking(order.id);
    if (!result.live) {
      await advanceMockShipment(order.id); // demo mode: simulate the next hop
    }

    const fresh = await prisma.order.findFirst({
      where: { id: order.id, tenantId: req.tenantId },
      include: { items: { include: { product: true } } },
    });
    res.json(fresh);
  } catch (err) { next(err); }
});

export default router;
