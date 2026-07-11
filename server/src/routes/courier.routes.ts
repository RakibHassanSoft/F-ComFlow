// Phase 5: Rate comparison, booking (idempotent), and status sync.
// Quotes and bookings go to the REAL carrier APIs when credentials exist
// (see services/couriers.ts); otherwise the mocks keep the demo alive.
import { Router } from 'express';
import { prisma } from '../lib/prisma';
import { requireAuth } from '../middleware/auth';
import { ApiError } from '../lib/errors';
import { compareRates, getAdapter, COURIER_JOURNEY } from '../services/couriers';
import { syncOrderTracking, advanceMockShipment } from '../services/tracker';
import { emitToTenant } from '../lib/socket';

const router = Router();
router.use(requireAuth);

// GET /api/couriers/rates?orderId=... — normalized quotes from all carriers
router.get('/rates', async (req, res, next) => {
  try {
    const order = await prisma.order.findFirst({
      where: { id: String(req.query.orderId), tenantId: req.tenantId },
    });
    if (!order) throw new ApiError(404, 'Order not found');

    const codAmount = order.paymentStatus === 'PAID' ? 0 : Number(order.totalAmount);
    const quotes = await compareRates(order.district, 0.5, codAmount); // assume 0.5kg parcels
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
    });
    if (!order) throw new ApiError(404, 'Order not found');
    if (order.status !== 'CONFIRMED') throw new ApiError(422, 'Only CONFIRMED orders can be booked');
    if (order.trackingCode) throw new ApiError(409, 'This order is already booked'); // idempotency

    const adapter = getAdapter(courier);
    if (!adapter) throw new ApiError(400, 'Unknown courier');

    const { trackingCode } = await adapter.book({
      orderNumber: order.orderNumber,
      customerName: order.customerName,
      phone: order.phone,
      address: order.address,
      district: order.district,
      codAmount: order.paymentStatus === 'PAID' ? 0 : Number(order.totalAmount),
      quantity: order.quantity,
      weightKg: 0.5,
    });

    const updated = await prisma.order.update({
      where: { id: order.id },
      data: {
        status: 'DISPATCHED',
        courierName: adapter.name,
        trackingCode,
        courierStatus: COURIER_JOURNEY[0],
        events: {
          create: [
            {
              tenantId: req.tenantId,
              type: 'DISPATCHED',
              note: `Booked with ${adapter.name}${adapter.isLive() ? ' (live API)' : ' (sandbox)'} — tracking ${trackingCode}`,
            },
            {
              tenantId: req.tenantId,
              type: 'SMS_SENT',
              note: `SMS to ${order.phone}: "Your order #${order.orderNumber} is on the way via ${adapter.name}. Track: ${trackingCode}"`,
            },
          ],
        },
      },
      include: { product: true },
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
      include: { product: true },
    });
    res.json(fresh);
  } catch (err) { next(err); }
});

export default router;
