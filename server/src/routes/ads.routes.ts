// Ads — two features, one page:
//
// 1. AD → ORDER ATTRIBUTION (works with ZERO Meta permissions):
//    click-to-Messenger/WhatsApp ads tag incoming chats with the ad id
//    (captured by our webhook). We join that against conversations and
//    orders in OUR OWN database — something Meta's Ads Manager can't show:
//    "this ad produced N conversations, M orders, ৳X revenue, Y% high-risk".
//
// 2. LIVE CAMPAIGNS (Meta Marketing API, needs ads_read / ads_management):
//    the merchant connects their ad account once; we list campaigns with
//    spend/impressions/clicks and allow pause/resume from the dashboard.
import { Router } from 'express';
import { prisma } from '../lib/prisma';
import { requireAuth } from '../middleware/auth';
import { ApiError } from '../lib/errors';
import { graph } from '../lib/graph';

const router = Router();
router.use(requireAuth);

// ---------------------------------------------------------------- attribution

// GET /api/ads/summary — the ad-ROI table, computed mostly from our own DB.
// Conversations/orders/revenue always come from us; when an ad account is
// connected we also pull each ad's spend from Meta so we can show real ROI
// (revenue ÷ spend) — the number Meta's own Ads Manager can't give per order.
router.get('/summary', async (req, res, next) => {
  try {
    const conversations = await prisma.conversation.findMany({
      where: { tenantId: req.tenantId, adId: { not: null } },
      include: { orders: true },
    });

    // Group by ad
    const byAd = new Map<string, {
      adId: string; adTitle: string;
      conversations: number; orders: number; revenue: number; highRisk: number;
    }>();

    for (const c of conversations) {
      const key = c.adId as string;
      const row = byAd.get(key) ?? {
        adId: key, adTitle: c.adTitle || key,
        conversations: 0, orders: 0, revenue: 0, highRisk: 0,
      };
      row.conversations++;
      for (const o of c.orders) {
        if (o.status === 'CANCELLED') continue;
        row.orders++;
        row.revenue += Number(o.totalAmount);
        if (o.riskLevel === 'HIGH') row.highRisk++;
      }
      byAd.set(key, row);
    }

    // Best-effort spend per ad (last 30 days) from the connected account.
    // Never fatal: demo ad ids won't match real ones, so spend is just null.
    const spendByAd = new Map<string, number>();
    const tenant = await prisma.tenant.findUnique({ where: { id: req.tenantId } });
    if (tenant?.adsToken && tenant.adsAccountId) {
      try {
        const insights = await graph(
          `${tenant.adsAccountId}/insights?level=ad&fields=ad_id,spend` +
          `&date_preset=last_30d&limit=500`,
          { token: tenant.adsToken }
        );
        for (const r of insights.data ?? []) {
          spendByAd.set(String(r.ad_id), Number(r.spend || 0));
        }
      } catch { /* spend is best-effort — keep the table working without it */ }
    }

    const rows = [...byAd.values()]
      .map((r) => {
        const spend = spendByAd.has(r.adId) ? spendByAd.get(r.adId)! : null;
        return {
          ...r,
          spend,
          costPerOrder: spend != null && r.orders > 0 ? spend / r.orders : null,
          roi: spend != null && spend > 0 ? r.revenue / spend : null,
        };
      })
      .sort((a, b) => b.revenue - a.revenue);
    res.json(rows);
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------- ad account connect

// GET /api/ads/status — is an ad account connected?
router.get('/status', async (req, res, next) => {
  try {
    const tenant = await prisma.tenant.findUnique({ where: { id: req.tenantId } });
    res.json({
      connected: Boolean(tenant?.adsToken && tenant?.adsAccountId),
      accountId: tenant?.adsAccountId ?? null,
      accountName: tenant?.adsAccountName ?? null,
    });
  } catch (err) { next(err); }
});

// POST /api/ads/oauth/accounts  { userToken }
// After the FB popup (scope: ads_read,ads_management): exchange for a
// long-lived token and list the merchant's ad accounts to pick from.
router.post('/oauth/accounts', async (req, res, next) => {
  try {
    const { userToken } = req.body;
    if (!userToken) throw new ApiError(400, 'userToken is required');
    const appId = process.env.META_APP_ID;
    const appSecret = process.env.META_APP_SECRET;
    if (!appId || !appSecret) {
      throw new ApiError(422, 'META_APP_ID / META_APP_SECRET not set in server/.env');
    }

    // Short-lived -> long-lived token (token is already in the query string here)
    const ll = await graph(
      `oauth/access_token?grant_type=fb_exchange_token&client_id=${appId}` +
      `&client_secret=${appSecret}&fb_exchange_token=${encodeURIComponent(userToken)}`
    );
    const longLived = ll.access_token;
    if (!longLived) throw new ApiError(422, ll?.error?.message || 'Token exchange with Meta failed');

    const accounts = await graph('me/adaccounts?fields=id,name,account_status,currency', { token: longLived });
    const list = (accounts.data ?? []).map((a: any) => ({ id: a.id, name: a.name, currency: a.currency }));
    if (list.length === 0) throw new ApiError(422, 'No ad accounts found on this Facebook account');

    res.json({ accounts: list, longLivedToken: longLived });
  } catch (err) { next(err); }
});

// POST /api/ads/oauth/connect  { longLivedToken, accountId, accountName }
router.post('/oauth/connect', async (req, res, next) => {
  try {
    const { longLivedToken, accountId, accountName } = req.body;
    if (!longLivedToken || !accountId) throw new ApiError(400, 'longLivedToken and accountId are required');

    // Verify the token can actually read this account before saving
    await graph(`${accountId}?fields=id,name`, { token: longLivedToken });

    await prisma.tenant.update({
      where: { id: req.tenantId },
      data: { adsToken: longLivedToken, adsAccountId: accountId, adsAccountName: accountName || accountId },
    });
    res.json({ ok: true, accountId, accountName });
  } catch (err) { next(err); }
});

router.post('/disconnect', async (req, res, next) => {
  try {
    await prisma.tenant.update({
      where: { id: req.tenantId },
      data: { adsToken: null, adsAccountId: null, adsAccountName: null },
    });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------- live campaigns

// GET /api/ads/campaigns — campaigns + spend/impressions/clicks (last 30 days)
router.get('/campaigns', async (req, res, next) => {
  try {
    const tenant = await prisma.tenant.findUnique({ where: { id: req.tenantId } });
    if (!tenant?.adsToken || !tenant.adsAccountId) {
      throw new ApiError(422, 'No ad account connected yet');
    }

    const data = await graph(
      `${tenant.adsAccountId}/campaigns?fields=id,name,effective_status,daily_budget,` +
      `insights.date_preset(last_30d){spend,impressions,clicks}&limit=25`,
      { token: tenant.adsToken }
    );

    const campaigns = (data.data ?? []).map((c: any) => {
      const ins = c.insights?.data?.[0] ?? {};
      return {
        id: c.id,
        name: c.name,
        status: c.effective_status,
        dailyBudget: c.daily_budget ? Number(c.daily_budget) / 100 : null,
        spend: Number(ins.spend || 0),
        impressions: Number(ins.impressions || 0),
        clicks: Number(ins.clicks || 0),
      };
    });
    res.json(campaigns);
  } catch (err) { next(err); }
});

// POST /api/ads/campaigns/:id/status  { status: "ACTIVE" | "PAUSED" }
router.post('/campaigns/:id/status', async (req, res, next) => {
  try {
    const { status } = req.body;
    if (!['ACTIVE', 'PAUSED'].includes(status)) throw new ApiError(400, 'status must be ACTIVE or PAUSED');

    const tenant = await prisma.tenant.findUnique({ where: { id: req.tenantId } });
    if (!tenant?.adsToken) throw new ApiError(422, 'No ad account connected yet');

    await graph(`${req.params.id}`, { token: tenant.adsToken, method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: `status=${status}` });
    res.json({ ok: true, status });
  } catch (err) { next(err); }
});

export default router;
