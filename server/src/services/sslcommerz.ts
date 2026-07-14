// SSLCOMMERZ hosted checkout (sandbox by default) — Bangladesh's most common
// gateway: one hosted page covers cards, bKash, Nagad, Rocket and net banking.
// Env-gated like every other integration: credentials present -> real gateway,
// absent -> the mock "Simulate payment" flow remains the only path.
//
//   SSLCZ_STORE_ID / SSLCZ_STORE_PASSWD   (free sandbox: developer.sslcommerz.com)
//   SSLCZ_BASE_URL                        (default: the public sandbox)
//
// Flow (per SSLCOMMERZ docs):
//   1. create session  POST /gwprocess/v4/api.php  -> GatewayPageURL
//   2. customer pays on the hosted page
//   3. SSLCOMMERZ POSTs the customer back to our success/fail/cancel URL
//   4. we NEVER trust that redirect — we re-validate the val_id against
//      /validator/api/validationserverAPI.php before settling.
import { config } from '../config';

const DEFAULT_BASE = 'https://sandbox.sslcommerz.com';

function base() { return process.env.SSLCZ_BASE_URL || DEFAULT_BASE; }

export function isSslczEnabled(): boolean {
  return Boolean(process.env.SSLCZ_STORE_ID && process.env.SSLCZ_STORE_PASSWD);
}

// Step 1: create the payment session; customer completes it on GatewayPageURL.
export async function createSslczSession(invoice: {
  id: string; amount: number; orderNumber: number;
  customerName: string; phone: string; address: string; district: string;
  productName: string;
}): Promise<string> {
  const publicApi = process.env.PUBLIC_API_URL || `http://localhost:${config.port}`;
  const cb = `${publicApi}/api/pay/${invoice.id}/sslcz/callback`;

  const body = new URLSearchParams({
    store_id: process.env.SSLCZ_STORE_ID || '',
    store_passwd: process.env.SSLCZ_STORE_PASSWD || '',
    total_amount: invoice.amount.toFixed(2),
    currency: 'BDT',
    // Unique per attempt (SSLCOMMERZ requires it); the invoice id travels in the URL
    tran_id: `FC${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`.toUpperCase(),
    success_url: cb,
    fail_url: `${cb}?outcome=failed`,
    cancel_url: `${cb}?outcome=cancelled`,
    cus_name: invoice.customerName,
    cus_email: 'customer@fcomflow.local', // gateway requires one; chat customers rarely have email
    cus_add1: invoice.address,
    cus_city: invoice.district,
    cus_country: 'Bangladesh',
    cus_phone: invoice.phone,
    shipping_method: 'NO',
    product_name: invoice.productName.slice(0, 250) || `Order #${invoice.orderNumber}`,
    product_category: 'F-Commerce',
    product_profile: 'general',
  });

  const res = await fetch(`${base()}/gwprocess/v4/api.php`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
    signal: AbortSignal.timeout(15_000),
  });
  const data: any = await res.json().catch(() => ({}));
  if (data.status !== 'SUCCESS' || !data.GatewayPageURL) {
    throw new Error(data.failedreason || 'SSLCOMMERZ session creation failed');
  }
  return String(data.GatewayPageURL);
}

// Step 4: validate a completed payment server-side. Returns the gateway's
// transaction reference only if SSLCOMMERZ itself confirms it as VALID and
// the paid amount matches what we asked for.
export async function validateSslczPayment(valId: string, expectedAmount: number): Promise<string> {
  const params = new URLSearchParams({
    val_id: valId,
    store_id: process.env.SSLCZ_STORE_ID || '',
    store_passwd: process.env.SSLCZ_STORE_PASSWD || '',
    format: 'json',
  });
  const res = await fetch(`${base()}/validator/api/validationserverAPI.php?${params.toString()}`, {
    signal: AbortSignal.timeout(15_000),
  });
  const data: any = await res.json().catch(() => ({}));

  if (data.status !== 'VALID' && data.status !== 'VALIDATED') {
    throw new Error(`SSLCOMMERZ validation returned ${data.status || 'no status'}`);
  }
  if (Math.abs(Number(data.amount) - expectedAmount) > 0.01) {
    throw new Error(`Amount mismatch: expected ${expectedAmount}, gateway says ${data.amount}`);
  }
  return String(data.bank_tran_id || data.tran_id || valId);
}
