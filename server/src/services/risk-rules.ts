// Pure COD-risk rule engine — no database, no network — so it can be unit
// tested in isolation. riskScorer.ts gathers DB facts, then calls this (or the
// ML service) to produce the score.
import { DISTRICT_RISK, DEFAULT_DISTRICT_RISK, DISTRICTS } from '../data/districts';

export interface RiskResult {
  score: number; // 0–100
  level: 'LOW' | 'MEDIUM' | 'HIGH';
  factors: string[]; // human-readable explanation shown in the UI
  engine?: string; // "ml" | "rules" | "local"
}

export interface RawFacts {
  phoneValid: boolean;
  address: string;
  district: string;
  returnRate: number; // customer's past return rate, 0–1
  pastOrders: number; // completed past orders (delivered + returned)
}

// Local weighted-rule score (fallback when the ML service is off/unreachable).
export function scoreLocally(facts: RawFacts): RiskResult {
  const factors: string[] = [];
  let risk = 0; // accumulate 0–1, convert to 0–100 at the end

  // Feature 1: phone validity (25%) — wrong phone = failed delivery
  if (!facts.phoneValid) {
    risk += 0.25;
    factors.push('Phone number format is invalid');
  }

  // Feature 2: address completeness (30%)
  let addressScore = 0; // 0 = complete, 1 = useless
  if (facts.address.length < 10) addressScore = 1;
  else if (facts.address.length < 25) addressScore = 0.5;
  if (!/\d/.test(facts.address)) addressScore = Math.max(addressScore, 0.5);
  if (addressScore > 0) factors.push('Address looks incomplete');
  risk += 0.3 * addressScore;

  // Feature 3: customer history (25%)
  if (facts.pastOrders > 0) {
    risk += 0.25 * facts.returnRate;
    if (facts.returnRate > 0.3) {
      factors.push(`Customer returned ${Math.round(facts.returnRate * 100)}% of past orders`);
    }
  } else {
    risk += 0.25 * 0.5; // new customer = unknown = medium risk
    factors.push('New customer — no delivery history');
  }

  // Feature 4: regional risk (20%)
  const districtRisk = DISTRICTS.includes(facts.district)
    ? DISTRICT_RISK[facts.district] ?? DEFAULT_DISTRICT_RISK
    : 1;
  risk += 0.2 * districtRisk;
  if (districtRisk >= DEFAULT_DISTRICT_RISK) {
    factors.push(`${facts.district} has a higher COD return rate`);
  }

  const score = Math.round(Math.min(1, risk) * 100);
  const level = score >= 60 ? 'HIGH' : score >= 35 ? 'MEDIUM' : 'LOW';
  return { score, level, factors, engine: 'local' };
}
