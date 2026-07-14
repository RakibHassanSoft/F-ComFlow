// Automated ad-performance analysis + recommendations.
//
// The unique angle (same as the attribution table): we know each campaign's
// Meta spend AND the orders/revenue its ads actually produced in OUR inbox. So
// we can judge campaigns on real ROI, not just clicks, and suggest a concrete,
// one-click action for each: SCALE (raise budget), PAUSE, TRIM (lower budget),
// or FIX (creative issue). Nothing is applied automatically — the merchant
// clicks Apply, which calls the pause/budget endpoints.
import { graph } from '../lib/graph';

export interface AttributionAgg { orders: number; revenue: number; highRisk: number; }

export interface AdRecommendation {
  campaignId: string;
  campaignName: string;
  status: string;
  action: 'SCALE' | 'PAUSE' | 'TRIM' | 'FIX' | 'KEEP';
  severity: 'high' | 'medium' | 'low';
  reasons: string[];
  // The concrete change the "Apply" button performs (null = advisory only).
  apply: null | { type: 'STATUS'; status: 'PAUSED' } | { type: 'BUDGET'; dailyBudget: number };
  metrics: {
    spend: number; revenue: number; orders: number; roi: number | null;
    ctr: number | null; costPerOrder: number | null; highRiskRate: number | null;
    dailyBudget: number | null; impressions: number; clicks: number;
  };
}

export interface AdsAnalysis {
  totals: { spend: number; revenue: number; orders: number; roi: number | null };
  summary: string;
  recommendations: AdRecommendation[];
}

const MIN_SPEND = 300;       // BDT — below this we don't judge (too little data)
const GOOD_ROI = 2;          // scale winners at/above this
const BREAK_EVEN = 1;        // revenue == spend
const LOW_CTR = 0.005;       // 0.5% — creative likely not resonating

function round(n: number) { return Math.round(n); }

// Build the analysis for one tenant's connected ad account.
export async function analyzeAds(
  tenant: { adsToken: string; adsAccountId: string },
  attributionByAd: Map<string, AttributionAgg>,
): Promise<AdsAnalysis> {
  // 1. Campaigns + their last-30-day insights
  const campaignData = await graph(
    `${tenant.adsAccountId}/campaigns?fields=id,name,effective_status,daily_budget,` +
    `insights.date_preset(last_30d){spend,impressions,clicks}&limit=50`,
    { token: tenant.adsToken },
  );

  // 2. ad -> campaign map, so we can roll our per-ad orders up to the campaign
  const adMap = await graph(
    `${tenant.adsAccountId}/ads?fields=id,campaign_id&limit=500`,
    { token: tenant.adsToken },
  );
  const adToCampaign = new Map<string, string>();
  for (const a of adMap.data ?? []) adToCampaign.set(String(a.id), String(a.campaign_id));

  // Roll attributed orders/revenue up to campaign level
  const byCampaign = new Map<string, AttributionAgg>();
  for (const [adId, agg] of attributionByAd) {
    const cid = adToCampaign.get(adId);
    if (!cid) continue;
    const row = byCampaign.get(cid) ?? { orders: 0, revenue: 0, highRisk: 0 };
    row.orders += agg.orders; row.revenue += agg.revenue; row.highRisk += agg.highRisk;
    byCampaign.set(cid, row);
  }

  const recommendations: AdRecommendation[] = [];
  let totalSpend = 0, totalRevenue = 0, totalOrders = 0;

  for (const c of campaignData.data ?? []) {
    const ins = c.insights?.data?.[0] ?? {};
    const spend = Number(ins.spend || 0);
    const impressions = Number(ins.impressions || 0);
    const clicks = Number(ins.clicks || 0);
    const dailyBudget = c.daily_budget ? Number(c.daily_budget) / 100 : null;
    const attr = byCampaign.get(String(c.id)) ?? { orders: 0, revenue: 0, highRisk: 0 };
    const { orders, revenue, highRisk } = attr;

    totalSpend += spend; totalRevenue += revenue; totalOrders += orders;

    const roi = spend > 0 ? revenue / spend : null;
    const ctr = impressions > 0 ? clicks / impressions : null;
    const costPerOrder = orders > 0 ? spend / orders : null;
    const highRiskRate = orders > 0 ? highRisk / orders : null;

    const status = String(c.effective_status);
    const active = status === 'ACTIVE';
    const metrics = { spend, revenue, orders, roi, ctr, costPerOrder, highRiskRate, dailyBudget, impressions, clicks };

    let action: AdRecommendation['action'] = 'KEEP';
    let severity: AdRecommendation['severity'] = 'low';
    let apply: AdRecommendation['apply'] = null;
    const reasons: string[] = [];

    if (active && spend >= MIN_SPEND && orders === 0) {
      action = 'PAUSE'; severity = 'high'; apply = { type: 'STATUS', status: 'PAUSED' };
      reasons.push(`Spent ${round(spend)} BDT with no orders traced to it in your inbox — review before pausing.`);
    } else if (active && spend >= MIN_SPEND && roi != null && roi < 0.8) {
      action = 'PAUSE'; severity = 'high'; apply = { type: 'STATUS', status: 'PAUSED' };
      reasons.push(`Losing money: ${roi.toFixed(1)}× ROI (${round(revenue)} back on ${round(spend)} BDT spend).`);
    } else if (active && roi != null && roi >= GOOD_ROI && orders >= 2 && dailyBudget != null) {
      action = 'SCALE'; severity = 'medium';
      const next = Math.max(round(dailyBudget * 1.3), dailyBudget + 1);
      apply = { type: 'BUDGET', dailyBudget: next };
      reasons.push(`Strong performer: ${roi.toFixed(1)}× ROI on ${orders} orders. Raise daily budget ${round(dailyBudget)} → ${next} BDT.`);
    } else if (active && spend >= MIN_SPEND && roi != null && roi >= 0.8 && roi < 1.2 && dailyBudget != null) {
      action = 'TRIM'; severity = 'low';
      const next = Math.max(round(dailyBudget * 0.7), 1);
      apply = { type: 'BUDGET', dailyBudget: next };
      reasons.push(`Barely breaking even (${roi.toFixed(1)}×). Trim budget ${round(dailyBudget)} → ${next} BDT and watch.`);
    } else if (active && impressions >= 500 && ctr != null && ctr < LOW_CTR) {
      action = 'FIX'; severity = 'low';
      reasons.push(`Low click-through (${(ctr * 100).toFixed(2)}%) — the creative/audience may not be resonating.`);
    }

    // Extra advisory flag (doesn't change the action, adds context)
    if (orders >= 2 && highRiskRate != null && highRiskRate > 0.5) {
      reasons.push(`${round(highRiskRate * 100)}% of its orders are high COD-risk — returns may erode the ROI shown.`);
      if (severity === 'low') severity = 'medium';
    }

    if (action !== 'KEEP') {
      recommendations.push({ campaignId: String(c.id), campaignName: String(c.name), status, action, severity, reasons, apply, metrics });
    }
  }

  // Order: high severity first, then by spend at stake
  const rank = { high: 0, medium: 1, low: 2 };
  recommendations.sort((a, b) => rank[a.severity] - rank[b.severity] || b.metrics.spend - a.metrics.spend);

  const overallRoi = totalSpend > 0 ? totalRevenue / totalSpend : null;
  const summary = buildSummary(recommendations, totalSpend, totalRevenue, overallRoi, (campaignData.data ?? []).length);

  return {
    totals: { spend: round(totalSpend), revenue: round(totalRevenue), orders: totalOrders, roi: overallRoi },
    summary,
    recommendations,
  };
}

function buildSummary(
  recs: AdRecommendation[], spend: number, revenue: number, roi: number | null, campaignCount: number,
): string {
  const pause = recs.filter((r) => r.action === 'PAUSE').length;
  const scale = recs.filter((r) => r.action === 'SCALE').length;
  const trim = recs.filter((r) => r.action === 'TRIM').length;
  const fix = recs.filter((r) => r.action === 'FIX').length;

  const parts: string[] = [];
  parts.push(`Analyzed ${campaignCount} campaign${campaignCount === 1 ? '' : 's'} — ${round(spend)} BDT spend, ${round(revenue)} BDT attributed revenue${roi != null ? ` (${roi.toFixed(1)}× overall ROI)` : ''}.`);
  if (pause) parts.push(`${pause} draining budget — pause suggested.`);
  if (scale) parts.push(`${scale} clearly profitable — scale ${scale === 1 ? 'it' : 'them'} up.`);
  if (trim) parts.push(`${trim} only breaking even — trim to protect margin.`);
  if (fix) parts.push(`${fix} with weak click-through — refresh the creative.`);
  if (!recs.length) parts.push('Everything looks healthy — no changes needed right now.');
  return parts.join(' ');
}
