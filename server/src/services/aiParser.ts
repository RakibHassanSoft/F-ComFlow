// AI order parser — calls the FastAPI service (Gemini) when AI_SERVICE_URL is
// set, else a built-in rule engine. Always returns the same shape.
import { prisma } from '../lib/prisma';
import { findDistrict } from '../data/districts';
import { config } from '../config';

export interface ParsedOrder {
  customerName: string | null;
  phone: string | null;
  address: string | null;
  district: string | null;
  productId: string | null;
  productName: string | null;
  quantity: number;
  // true = the parser is unsure; the UI highlights these fields for review
  lowConfidence: { [field: string]: boolean };
  engine?: string; // which engine answered: "gemini" | "rules" | "local"
}

// Bengali numerals -> English (customers often type ০১৭...)
function normalizeDigits(text: string): string {
  const bn = '০১২৩৪৫৬৭৮৯';
  return text.replace(/[০-৯]/g, (d) => String(bn.indexOf(d)));
}

// ---------- Engine 2: built-in rules (no dependencies, always works) ----------
async function parseLocally(
  tenantId: string,
  chatText: string,
  customerName: string | null
): Promise<ParsedOrder> {
  const text = normalizeDigits(chatText);
  const lowConfidence: { [field: string]: boolean } = {};

  // Phone: valid Bangladeshi mobile = 11 digits starting 013-019
  const phoneMatch = text.replace(/[\s-]/g, '').match(/01[3-9]\d{8}/);
  const phone = phoneMatch ? phoneMatch[0] : null;
  if (!phone) lowConfidence.phone = true;

  // District: match against the official 64-district list (+ variants)
  const district = findDistrict(text);
  if (!district) lowConfidence.district = true;

  // Product: match the tenant's own catalog names inside the chat
  const products: { id: string; name: string }[] = await prisma.product.findMany({
    where: { tenantId },
  });
  let matched: { id: string; name: string } | null = null;
  for (const p of products) {
    if (text.toLowerCase().includes(p.name.toLowerCase())) {
      matched = { id: p.id, name: p.name };
      break;
    }
  }
  if (!matched) lowConfidence.product = true;

  // Quantity: "2 ta", "3 pcs", "2 pieces" ... default 1
  const qtyMatch = text.match(/(\d+)\s*(ta|pcs|pieces?|kg|টা)/i);
  const quantity = qtyMatch ? Math.max(1, parseInt(qtyMatch[1], 10)) : 1;
  if (!qtyMatch) lowConfidence.quantity = true;

  // Address: the line that mentions address keywords, minus the phone
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  const addressLine = lines.find((l) =>
    /address|thikana|house|flat|road|village|thana|para|more|point|bari|deliver to/i.test(l)
  );
  let address: string | null = null;
  if (addressLine) {
    address = addressLine
      .replace(/.*?(address|thikana|deliver to)\s*(dilam)?:?\s*/i, '')
      .replace(/01[3-9]\d{8}/g, '')
      .replace(/^[\s,.-]+|[\s,.-]+$/g, '');
  }
  if (!address) lowConfidence.address = true;

  return {
    customerName,
    phone,
    address,
    district,
    productId: matched?.id ?? null,
    productName: matched?.name ?? null,
    quantity,
    lowConfidence,
    engine: 'local',
  };
}

// ---------- Engine 1: the FastAPI AI service ----------
async function parseViaService(
  tenantId: string,
  chatText: string,
  customerName: string | null
): Promise<ParsedOrder> {
  const products = await prisma.product.findMany({
    where: { tenantId },
    select: { id: true, name: true },
  });

  const res = await fetch(`${config.aiServiceUrl}/api/v1/ai/parse-order`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chatText, customerName, products }),
    signal: AbortSignal.timeout(12_000), // Gemini can take a few seconds
  });
  if (!res.ok) throw new Error(`AI service responded ${res.status}`);
  return (await res.json()) as ParsedOrder;
}

// ---------- Entry point used by the route ----------
export async function parseOrderFromChat(
  tenantId: string,
  chatText: string,
  customerName: string | null
): Promise<ParsedOrder> {
  if (config.aiServiceUrl) {
    try {
      return await parseViaService(tenantId, chatText, customerName);
    } catch (err) {
      console.warn('[ai] service unreachable, using local parser:', (err as Error).message);
    }
  }
  return parseLocally(tenantId, chatText, customerName);
}
