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

// GET /api/customers/export.csv — the whole directory as a spreadsheet.
// NOTE: registered before /:id so "export.csv" is never treated as an id.
router.get('/export.csv', async (req, res, next) => {
  try {
    const customers = await prisma.customer.findMany({
      where: { tenantId: req.tenantId },
      orderBy: { createdAt: 'desc' },
    });
    const orders = await prisma.order.findMany({
      where: { tenantId: req.tenantId, customerId: { not: null } },
      select: { customerId: true, status: true, paymentStatus: true, totalAmount: true },
    });
    const stats = new Map<string, { total: number; returned: number; finished: number; spent: number }>();
    for (const o of orders) {
      const s = stats.get(o.customerId!) || { total: 0, returned: 0, finished: 0, spent: 0 };
      s.total += 1;
      if (o.status === 'RETURNED') { s.returned += 1; s.finished += 1; }
      if (o.status === 'DELIVERED') s.finished += 1;
      if (o.paymentStatus === 'PAID') s.spent += Number(o.totalAmount);
      stats.set(o.customerId!, s);
    }
    const esc = (v: unknown) => {
      const str = String(v ?? '');
      return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
    };
    const rows = [
      'Name,Phone,Joined,Orders,Return rate (%),Total spent (BDT)',
      ...customers.map((c: any) => {
        const s = stats.get(c.id) || { total: 0, returned: 0, finished: 0, spent: 0 };
        return [
          c.name, c.phone || '', c.createdAt.toISOString().slice(0, 10),
          s.total, s.finished ? Math.round((s.returned / s.finished) * 100) : 0, s.spent.toFixed(2),
        ].map(esc).join(',');
      }),
    ];
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename=customers.csv');
    res.send(rows.join('\n'));
  } catch (err) { next(err); }
});

// GET /api/customers/:id — one customer's full profile: order history,
// conversations, and rolled-up lifetime stats. Powers the detail page.
router.get('/:id', async (req, res, next) => {
  try {
    const customer = await prisma.customer.findFirst({
      where: { id: req.params.id, tenantId: req.tenantId },
      include: {
        conversations: {
          orderBy: { lastMessageAt: 'desc' },
          include: { messages: { orderBy: { createdAt: 'desc' }, take: 1 } },
        },
      },
    });
    if (!customer) return res.status(404).json({ error: 'Customer not found' });

    const orders = await prisma.order.findMany({
      where: { tenantId: req.tenantId, customerId: customer.id },
      orderBy: { createdAt: 'desc' },
      include: { items: { include: { product: true } } },
    });

    const finished = orders.filter((o: any) => o.status === 'DELIVERED' || o.status === 'RETURNED');
    const returned = finished.filter((o: any) => o.status === 'RETURNED').length;
    const totalSpent = orders
      .filter((o: any) => o.paymentStatus === 'PAID')
      .reduce((s: number, o: any) => s + Number(o.totalAmount), 0);

    res.json({
      customer: {
        id: customer.id, name: customer.name, phone: customer.phone,
        externalId: customer.externalId, createdAt: customer.createdAt,
      },
      stats: {
        totalOrders: orders.length,
        returnRate: finished.length ? Math.round((returned / finished.length) * 100) : 0,
        totalSpent,
        lifetimeValue: orders.reduce((s: number, o: any) => s + Number(o.totalAmount), 0),
      },
      orders,
      conversations: customer.conversations.map((c: any) => ({
        id: c.id, channel: c.channel, lastMessageAt: c.lastMessageAt,
        preview: c.messages[0]?.text || '',
      })),
    });
  } catch (err) { next(err); }
});

export default router;
