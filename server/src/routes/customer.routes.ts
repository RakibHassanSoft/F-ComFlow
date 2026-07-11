// Customer directory — every customer with their order history rolled up
// (order count, return rate, total spent, last activity). The same aggregate
// logic the inbox side-panel uses, across the whole customer base.
import { Router } from 'express';
import { prisma } from '../lib/prisma';
import { requireAuth } from '../middleware/auth';

const router = Router();
router.use(requireAuth);

// GET /api/customers?q=karim — directory list, most recently seen first
router.get('/', async (req, res, next) => {
  try {
    const q = String(req.query.q || '').trim();
    const customers = await prisma.customer.findMany({
      where: {
        tenantId: req.tenantId,
        ...(q
          ? {
              OR: [
                { name: { contains: q, mode: 'insensitive' as const } },
                { phone: { contains: q } },
              ],
            }
          : {}),
      },
      include: { conversations: { select: { channel: true, lastMessageAt: true } } },
      orderBy: { createdAt: 'desc' },
    });

    // Roll up order stats per customer in one query
    const orders = await prisma.order.findMany({
      where: { tenantId: req.tenantId, customerId: { not: null } },
      select: { customerId: true, status: true, paymentStatus: true, totalAmount: true, createdAt: true },
    });
    const statsByCustomer = new Map<string, {
      totalOrders: number; delivered: number; returned: number; totalSpent: number; lastOrderAt: Date | null;
    }>();
    for (const o of orders) {
      const s = statsByCustomer.get(o.customerId!) || { totalOrders: 0, delivered: 0, returned: 0, totalSpent: 0, lastOrderAt: null };
      s.totalOrders += 1;
      if (o.status === 'DELIVERED') s.delivered += 1;
      if (o.status === 'RETURNED') s.returned += 1;
      if (o.paymentStatus === 'PAID') s.totalSpent += Number(o.totalAmount);
      if (!s.lastOrderAt || o.createdAt > s.lastOrderAt) s.lastOrderAt = o.createdAt;
      statsByCustomer.set(o.customerId!, s);
    }

    res.json(customers.map((c: any) => {
      const s = statsByCustomer.get(c.id) || { totalOrders: 0, delivered: 0, returned: 0, totalSpent: 0, lastOrderAt: null };
      const finished = s.delivered + s.returned;
      const lastConversationAt = c.conversations.reduce(
        (latest: Date | null, cv: { lastMessageAt: Date }) =>
          !latest || cv.lastMessageAt > latest ? cv.lastMessageAt : latest,
        null as Date | null
      );
      return {
        id: c.id,
        name: c.name,
        phone: c.phone,
        channels: [...new Set(c.conversations.map((cv: { channel: string }) => cv.channel))],
        createdAt: c.createdAt,
        totalOrders: s.totalOrders,
        returnRate: finished ? Math.round((s.returned / finished) * 100) : 0,
        totalSpent: s.totalSpent,
        lastSeenAt: s.lastOrderAt && (!lastConversationAt || s.lastOrderAt > lastConversationAt)
          ? s.lastOrderAt
          : lastConversationAt || c.createdAt,
      };
    }));
  } catch (err) { next(err); }
});

export default router;
