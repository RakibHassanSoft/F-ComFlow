// Live tracking updates — ONE function applies a courier status to an order,
// no matter where the status came from:
//   - the Pathao webhook (instant push)
//   - the background poller (this file, runs every few minutes)
//   - the manual "Sync status" button
// Every change writes the timeline event AND broadcasts over Socket.io, so
// the Shipping page and order page update on screen without a refresh.
import { prisma, basePrisma, setTenantGuc } from '../lib/prisma';
import { emitToTenant } from '../lib/socket';
import { COURIER_JOURNEY, getAdapter } from './couriers';

// Apply a new courier status to an order. Returns the updated order,
// or null if nothing changed (dedupe: the same status twice is a no-op).
export async function applyTrackingUpdate(orderId: string, newStatus: string) {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: { items: true },
  });
  if (!order || !order.trackingCode) return null;
  if (order.courierStatus === newStatus) return null; // no change
  if (order.status !== 'DISPATCHED') return null;      // journey already over

  const delivered = newStatus === 'Delivered';
  const returned = newStatus === 'Returned';

  const updated = await basePrisma.$transaction(async (tx: any) => {
    await setTenantGuc(tx, order.tenantId); // RLS: scope this transaction to the order's tenant
    // A returned parcel puts every line's units back in stock
    if (returned) {
      for (const item of order.items) {
        await tx.product.updateMany({
          where: { id: item.productId, tenantId: order.tenantId },
          data: { stockQuantity: { increment: item.quantity } },
        });
      }
    }
    return tx.order.update({
      where: { id: order.id },
      data: {
        courierStatus: newStatus,
        ...(delivered ? { status: 'DELIVERED' } : {}),
        ...(returned ? { status: 'RETURNED', returnReason: 'Courier return' } : {}),
        events: {
          create: {
            tenantId: order.tenantId,
            type: delivered ? 'DELIVERED' : returned ? 'RETURNED' : 'COURIER_UPDATE',
            note: `${order.courierName}: ${newStatus}`,
          },
        },
      },
      include: { items: { include: { product: true } } },
    });
  });

  // THE live part: every open dashboard of this tenant updates instantly
  emitToTenant(order.tenantId, 'order:updated', updated);
  return updated;
}

// Advance a MOCK shipment one step (used when the carrier has no live API)
export async function advanceMockShipment(orderId: string) {
  const order = await prisma.order.findUnique({ where: { id: orderId } });
  if (!order?.courierStatus) return null;
  const idx = COURIER_JOURNEY.indexOf(order.courierStatus);
  if (idx < 0 || idx >= COURIER_JOURNEY.length - 1) return null;
  return applyTrackingUpdate(orderId, COURIER_JOURNEY[idx + 1]);
}

// Pull the latest status for one order from its carrier (live mode only).
export async function syncOrderTracking(orderId: string): Promise<{ updated: boolean; live: boolean }> {
  const order = await prisma.order.findUnique({ where: { id: orderId } });
  if (!order?.trackingCode || !order.courierName) return { updated: false, live: false };

  const adapter = getAdapter(order.courierName);
  if (!adapter?.isLive()) return { updated: false, live: false };

  const status = await adapter.track(order.trackingCode);
  if (!status) return { updated: false, live: true };
  const result = await applyTrackingUpdate(orderId, status);
  return { updated: Boolean(result), live: true };
}

// The background poller: every dispatched shipment on a LIVE carrier gets
// its status pulled automatically. Started from index.ts.
export function startTrackingPoller() {
  const interval = Number(process.env.COURIER_POLL_MS) || 3 * 60 * 1000; // default 3 min
  setInterval(async () => {
    try {
      const dispatched = await prisma.order.findMany({
        where: { status: 'DISPATCHED', trackingCode: { not: null } },
        take: 100,
      });
      for (const order of dispatched) {
        const adapter = order.courierName ? getAdapter(order.courierName) : undefined;
        if (!adapter?.isLive()) continue; // mock shipments stay manual
        try {
          await syncOrderTracking(order.id);
        } catch (e) {
          console.warn(`[tracker] poll failed for #${order.orderNumber}:`, (e as Error).message);
        }
      }
    } catch (e) {
      console.warn('[tracker] poll cycle failed:', (e as Error).message);
    }
  }, interval);
  console.log(`📦 Tracking poller running (every ${Math.round(interval / 1000)}s for live carriers)`);
}
