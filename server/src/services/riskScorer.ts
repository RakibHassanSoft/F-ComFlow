// Phase 7: COD Risk Predictor.
//
// The Node API gathers the raw facts (it owns the database), then:
//   1. If AI_SERVICE_URL is set -> the FastAPI service scores them with the
//      trained ML model (ai/models/risk_model_v1.joblib).
//   2. Otherwise, or if the service is down -> a transparent weighted-rule
//      score (see risk-rules.ts), so confirmation is NEVER blocked by an outage.
import { prisma } from '../lib/prisma';
import { config } from '../config';
import { scoreLocally, type RawFacts, type RiskResult } from './risk-rules';

export type { RiskResult } from './risk-rules';

// ---------- Step 1: gather facts from the database ----------
async function gatherFacts(
  tenantId: string,
  order: { phone: string; address: string; district: string; customerId?: string | null }
): Promise<RawFacts> {
  let returnRate = 0;
  let pastOrders = 0;

  if (order.customerId) {
    const past = await prisma.order.findMany({
      where: { tenantId, customerId: order.customerId, status: { in: ['DELIVERED', 'RETURNED'] } },
    });
    pastOrders = past.length;
    if (pastOrders > 0) {
      returnRate = past.filter((o: { status: string }) => o.status === 'RETURNED').length / pastOrders;
    }
  }

  return {
    phoneValid: /^01[3-9]\d{8}$/.test(order.phone),
    address: order.address || '',
    district: order.district,
    returnRate,
    pastOrders,
  };
}

// ---------- Step 2a: score via the FastAPI ML service ----------
async function scoreViaService(facts: RawFacts): Promise<RiskResult> {
  const res = await fetch(`${config.aiServiceUrl}/api/v1/ai/risk-score`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(facts),
    signal: AbortSignal.timeout(5_000),
  });
  if (!res.ok) throw new Error(`AI service responded ${res.status}`);
  return (await res.json()) as RiskResult;
}

// ---------- Entry point used by order confirmation ----------
export async function scoreOrder(
  tenantId: string,
  order: { phone: string; address: string; district: string; customerId?: string | null }
): Promise<RiskResult> {
  const facts = await gatherFacts(tenantId, order);

  if (config.aiServiceUrl) {
    try {
      return await scoreViaService(facts);
    } catch (err) {
      console.warn('[risk] service unreachable, using local scorer:', (err as Error).message);
    }
  }
  return scoreLocally(facts);
}
