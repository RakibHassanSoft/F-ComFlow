// Dashboard overview numbers + tenant settings.
import { Router } from 'express';
import { prisma } from '../lib/prisma';
import { requireAuth } from '../middleware/auth';
import { ApiError } from '../lib/errors';

const router = Router();
router.use(requireAuth);

// GET /api/stats — the cards on the dashboard home page
router.get('/', async (req, res, next) => {
  try {
    const tenantId = req.tenantId;
    const [conversations, unread, orders, products, ledger] = await Promise.all([
      prisma.conversation.count({ where: { tenantId } }),
      prisma.conversation.aggregate({ where: { tenantId }, _sum: { unreadCount: true } }),
      prisma.order.groupBy({ by: ['status'], where: { tenantId }, _count: true }),
      prisma.product.findMany({ where: { tenantId } }),
      prisma.ledgerEntry.aggregate({ where: { tenantId }, _sum: { net: true } }),
    ]);

    const orderCounts: Record<string, number> = {};
    for (const g of orders as { status: string; _count: number }[]) orderCounts[g.status] = g._count;

    res.json({
      conversations,
      unreadMessages: unread._sum.unreadCount || 0,
      orders: orderCounts,
      totalOrders: Object.values(orderCounts).reduce((a, b) => a + b, 0),
      lowStockProducts: products.filter((p: { stockQuantity: number; reorderThreshold: number }) => p.stockQuantity <= p.reorderThreshold).length,
      totalProducts: products.length,
      ledgerBalance: Number(ledger._sum.net || 0),
    });
  } catch (err) { next(err); }
});

// GET /api/stats/daily — a short summary of the last 24h (orders, revenue,
// best-performing ad). Great for a morning briefing / scheduled message.
router.get('/daily', async (req, res, next) => {
  try {
    const end = new Date();
    const start = new Date(end.getTime() - 24 * 60 * 60 * 1000);
    const orders = await prisma.order.findMany({
      where: { tenantId: req.tenantId, createdAt: { gte: start, lte: end }, status: { not: 'CANCELLED' } },
      include: { conversation: true },
    });
    const revenue = orders.reduce((sum: number, o: any) => sum + Number(o.totalAmount), 0);

    const byAd = new Map<string, number>();
    for (const o of orders) {
      const title = o.conversation?.adTitle;
      if (title) byAd.set(title, (byAd.get(title) || 0) + Number(o.totalAmount));
    }
    let topAd: { title: string; revenue: number } | null = null;
    for (const [title, rev] of byAd) {
      if (!topAd || rev > topAd.revenue) topAd = { title, revenue: rev };
    }

    res.json({ periodStart: start, periodEnd: end, orders: orders.length, revenue, topAd });
  } catch (err) { next(err); }
});

// GET /api/stats/analytics?days=30 — revenue/order aggregates for the
// Analytics page: by day, by product, by district. Cancelled orders excluded.
router.get('/analytics', async (req, res, next) => {
  try {
    const days = Math.min(365, Math.max(1, Number(req.query.days) || 30));
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    start.setDate(start.getDate() - (days - 1));

    const orders = await prisma.order.findMany({
      where: { tenantId: req.tenantId, createdAt: { gte: start }, status: { not: 'CANCELLED' } },
      include: { product: { select: { name: true } } },
      orderBy: { createdAt: 'asc' },
    });

    // By day (every day in range present, even if zero — makes clean charts)
    const byDayMap = new Map<string, { revenue: number; orders: number }>();
    for (let i = 0; i < days; i++) {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      byDayMap.set(d.toISOString().slice(0, 10), { revenue: 0, orders: 0 });
    }
    const byProductMap = new Map<string, { revenue: number; quantity: number; orders: number }>();
    const byDistrictMap = new Map<string, { revenue: number; orders: number }>();

    for (const o of orders) {
      const amount = Number(o.totalAmount);
      const day = o.createdAt.toISOString().slice(0, 10);
      const dayEntry = byDayMap.get(day);
      if (dayEntry) { dayEntry.revenue += amount; dayEntry.orders += 1; }

      const p = byProductMap.get(o.product.name) || { revenue: 0, quantity: 0, orders: 0 };
      p.revenue += amount; p.quantity += o.quantity; p.orders += 1;
      byProductMap.set(o.product.name, p);

      const d = byDistrictMap.get(o.district) || { revenue: 0, orders: 0 };
      d.revenue += amount; d.orders += 1;
      byDistrictMap.set(o.district, d);
    }

    const totalRevenue = orders.reduce((s: number, o: any) => s + Number(o.totalAmount), 0);
    const finished = orders.filter((o: any) => o.status === 'DELIVERED' || o.status === 'RETURNED');
    const returned = finished.filter((o: any) => o.status === 'RETURNED').length;

    res.json({
      days,
      totalOrders: orders.length,
      totalRevenue,
      avgOrderValue: orders.length ? totalRevenue / orders.length : 0,
      returnRate: finished.length ? Math.round((returned / finished.length) * 100) : 0,
      byDay: [...byDayMap].map(([date, v]) => ({ date, ...v })),
      byProduct: [...byProductMap].map(([name, v]) => ({ name, ...v })).sort((a, b) => b.revenue - a.revenue),
      byDistrict: [...byDistrictMap].map(([district, v]) => ({ district, ...v })).sort((a, b) => b.revenue - a.revenue),
    });
  } catch (err) { next(err); }
});

// POST /api/stats/daily/email — email the last-24h briefing to the logged-in
// user. Needs SMTP_* configured in server/.env (same transport as the email
// channel); returns 422 with a clear message when it isn't.
router.post('/daily/email', async (req, res, next) => {
  try {
    if (!process.env.SMTP_HOST) {
      throw new ApiError(422, 'SMTP is not configured — set SMTP_HOST (and friends) in server/.env first');
    }
    const user = await prisma.user.findFirst({ where: { id: req.userId, tenantId: req.tenantId } });
    if (!user) throw new ApiError(404, 'User not found');
    const tenant = await prisma.tenant.findUnique({ where: { id: req.tenantId } });

    const end = new Date();
    const start = new Date(end.getTime() - 24 * 60 * 60 * 1000);
    const orders = await prisma.order.findMany({
      where: { tenantId: req.tenantId, createdAt: { gte: start, lte: end }, status: { not: 'CANCELLED' } },
      include: { product: { select: { name: true } } },
    });
    const revenue = orders.reduce((s: number, o: any) => s + Number(o.totalAmount), 0);
    const lowStock = await prisma.product.findMany({ where: { tenantId: req.tenantId } });
    const lowNames = lowStock
      .filter((p: { stockQuantity: number; reorderThreshold: number }) => p.stockQuantity <= p.reorderThreshold)
      .map((p: { name: string; stockQuantity: number }) => `${p.name} (${p.stockQuantity} left)`);

    const lines = [
      `Daily briefing for ${tenant?.businessName || 'your shop'}`,
      '',
      `New orders (24h): ${orders.length}`,
      `Revenue (24h): BDT ${revenue.toFixed(2)}`,
      ...(orders.length
        ? ['', 'Orders:', ...orders.map((o: any) => `  #${o.orderNumber} — ${o.customerName} — ${o.product.name} × ${o.quantity} — BDT ${Number(o.totalAmount).toFixed(2)} (${o.status})`)]
        : []),
      ...(lowNames.length ? ['', `Low stock: ${lowNames.join(', ')}`] : []),
      '',
      '— F-ComFlow',
    ];

    const nodemailer = await import('nodemailer');
    const transport = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT) || 587,
      secure: Number(process.env.SMTP_PORT) === 465,
      auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
    });
    await transport.sendMail({
      from: process.env.SMTP_FROM || process.env.SMTP_USER || 'briefing@fcomflow.local',
      to: user.email,
      subject: `Daily briefing — ${orders.length} orders, BDT ${revenue.toFixed(2)}`,
      text: lines.join('\n'),
    });

    res.json({ ok: true, sentTo: user.email });
  } catch (err) { next(err); }
});

// GET /api/stats/settings — current tenant preferences (to populate the form)
router.get('/settings', async (req, res, next) => {
  try {
    const tenant = await prisma.tenant.findUnique({ where: { id: req.tenantId } });
    if (!tenant) throw new ApiError(404, 'Tenant not found');
    res.json({
      riskThreshold: tenant.riskThreshold,
      autoStatusMessages: tenant.autoStatusMessages,
      awayMessage: tenant.awayMessage,
      businessHourStart: tenant.businessHourStart,
      businessHourEnd: tenant.businessHourEnd,
    });
  } catch (err) { next(err); }
});

// PATCH /api/stats/settings — tenant preferences. Every field is optional;
// only the ones sent are updated (risk threshold, auto-status messages,
// business hours + away message for the out-of-hours auto-reply).
router.patch('/settings', async (req, res, next) => {
  try {
    const data: Record<string, unknown> = {};

    if (req.body.riskThreshold !== undefined) {
      const value = Number(req.body.riskThreshold);
      if (isNaN(value) || value < 0 || value > 100) {
        throw new ApiError(400, 'riskThreshold must be between 0 and 100');
      }
      data.riskThreshold = value;
    }
    if (req.body.autoStatusMessages !== undefined) {
      data.autoStatusMessages = Boolean(req.body.autoStatusMessages);
    }
    if (req.body.awayMessage !== undefined) {
      const msg = String(req.body.awayMessage).trim();
      data.awayMessage = msg || null;
    }
    for (const field of ['businessHourStart', 'businessHourEnd'] as const) {
      if (req.body[field] !== undefined) {
        if (req.body[field] === null || req.body[field] === '') { data[field] = null; continue; }
        const h = Number(req.body[field]);
        if (isNaN(h) || h < 0 || h > 23) throw new ApiError(400, `${field} must be an hour 0-23`);
        data[field] = h;
      }
    }
    if (Object.keys(data).length === 0) throw new ApiError(400, 'No settings provided');

    const tenant = await prisma.tenant.update({ where: { id: req.tenantId }, data });
    res.json({
      riskThreshold: tenant.riskThreshold,
      autoStatusMessages: tenant.autoStatusMessages,
      awayMessage: tenant.awayMessage,
      businessHourStart: tenant.businessHourStart,
      businessHourEnd: tenant.businessHourEnd,
    });
  } catch (err) { next(err); }
});

export default router;
