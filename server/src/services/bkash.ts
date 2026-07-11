// bKash Tokenized Checkout (sandbox by default) — env-gated, exactly like the
// courier adapters: credentials present -> real bKash checkout; absent -> the
// existing mock "Simulate payment" flow stays the only path, nothing breaks.
//
//   BKASH_BASE_URL    (default: bKash's public sandbox)
//   BKASH_APP_KEY / BKASH_APP_SECRET / BKASH_USERNAME / BKASH_PASSWORD
//
// Flow (per bKash's Tokenized Checkout docs):
//   1. grant token   POST /tokenized/checkout/token/grant
//   2. create        POST /tokenized/checkout/create   -> bkashURL (customer pays there)
//   3. bKash redirects to our callback with paymentID&status
//   4. execute       POST /tokenized/checkout/execute  -> trxID = settlement proof
import { config } from '../config';

const DEFAULT_BASE = 'https://tokenized.sandbox.bka.sh/v1.2.0-beta';

function base() { return process.env.BKASH_BASE_URL || DEFAULT_BASE; }

export function isBkashEnabled(): boolean {
  return Boolean(
    process.env.BKASH_APP_KEY && process.env.BKASH_APP_SECRET &&
    process.env.BKASH_USERNAME && process.env.BKASH_PASSWORD
  );
}

// ---- token grant (cached until shortly before expiry) ----
let cached: { token: string; expiresAt: number } | null = null;

async function getToken(): Promise<string> {
  if (cached && Date.now() < cached.expiresAt) return cached.token;
  const res = await fetch(`${base()}/tokenized/checkout/token/grant`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      username: process.env.BKASH_USERNAME || '',
      password: process.env.BKASH_PASSWORD || '',
    },
    body: JSON.stringify({
      app_key: process.env.BKASH_APP_KEY,
      app_secret: process.env.BKASH_APP_SECRET,
    }),
    signal: AbortSignal.timeout(12_000),
  });
  const data: any = await res.json().catch(() => ({}));
  if (!data.id_token) throw new Error(data.statusMessage || 'bKash token grant failed');
  cached = { token: data.id_token, expiresAt: Date.now() + ((Number(data.expires_in) || 3600) - 60) * 1000 };
  return cached.token;
}

async function api(path: string, body: unknown): Promise<any> {
  const token = await getToken();
  const res = await fetch(`${base()}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      Authorization: token,
      'X-App-Key': process.env.BKASH_APP_KEY || '',
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  });
  const data: any = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.statusMessage || `bKash API ${res.status}`);
  return data;
}

// Step 2: create the payment session; the customer completes it on bkashURL.
export async function createBkashPayment(invoiceId: string, amount: number, orderNumber: number): Promise<string> {
  const publicApi = process.env.PUBLIC_API_URL || `http://localhost:${config.port}`;
  const data = await api('/tokenized/checkout/create', {
    mode: '0011', // tokenized checkout (URL based)
    payerReference: String(orderNumber),
    callbackURL: `${publicApi}/api/pay/${invoiceId}/bkash/callback`,
    amount: amount.toFixed(2),
    currency: 'BDT',
    intent: 'sale',
    merchantInvoiceNumber: invoiceId,
  });
  if (data.statusCode !== '0000' || !data.bkashURL) {
    throw new Error(data.statusMessage || 'bKash create payment failed');
  }
  return String(data.bkashURL);
}

// Step 4: execute after the customer approved. Returns bKash's trxID — that is
// the transactionId we settle with (idempotency guaranteed by settlePayment).
export async function executeBkashPayment(paymentID: string): Promise<string> {
  const data = await api('/tokenized/checkout/execute', { paymentID });
  if (data.statusCode !== '0000' || !data.trxID) {
    throw new Error(data.statusMessage || 'bKash execute failed');
  }
  return String(data.trxID);
}
