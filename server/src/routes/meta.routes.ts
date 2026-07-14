// The PUBLIC Meta webhook endpoint — one URL serves Messenger, Instagram
// AND WhatsApp (you subscribe all three products to it in the Meta app).
//
//   GET  /api/meta/webhook   Meta's one-time verification handshake
//   POST /api/meta/webhook   signed event notifications
//
// Security (exactly per Meta's docs):
//  - GET: echo hub.challenge only if hub.verify_token matches META_VERIFY_TOKEN
//  - POST: recompute HMAC-SHA256 of the RAW body with META_APP_SECRET and
//    compare (timing-safe) against the X-Hub-Signature-256 header.
//    Invalid/missing signature -> 403, event never processed.
//  - Always answer 200 fast; processing happens after the response so Meta
//    never retries because we were slow.
import { Router } from 'express';
import crypto from 'crypto';
import { normalizeWebhook, ingestInbound } from '../services/channels';
import { isQueueEnabled, enqueueWebhook } from '../lib/queue';

const router = Router();

// ---- GET: subscription verification handshake ----
router.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token && token === process.env.META_VERIFY_TOKEN) {
    console.log('[meta] webhook verified ✅');
    return res.status(200).send(String(challenge));
  }
  return res.sendStatus(403);
});

// ---- signature check on the raw payload ----
function isValidSignature(req: any): boolean {
  const secret = process.env.META_APP_SECRET;
  if (!secret) {
    console.warn('[meta] META_APP_SECRET not set — rejecting webhook');
    return false;
  }
  const header = req.headers['x-hub-signature-256'];
  const raw: Buffer | undefined = req.rawBody; // captured in index.ts
  if (!header || typeof header !== 'string' || !raw) return false;

  const expected = 'sha256=' + crypto.createHmac('sha256', secret).update(raw).digest('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(header), Buffer.from(expected));
  } catch {
    return false; // length mismatch etc.
  }
}

// ---- POST: event notifications ----
router.post('/webhook', (req, res) => {
  if (!isValidSignature(req)) {
    console.warn('[meta] invalid webhook signature — rejected');
    return res.sendStatus(403);
  }

  // Acknowledge INSTANTLY (Meta requires a fast 200), then process.
  res.sendStatus(200);

  // Durable path: hand the raw payload to Redis and let the background worker
  // (see index.ts) do the heavy lifting. Falls back to inline processing when
  // no Redis is configured, so behaviour is unchanged without it.
  if (isQueueEnabled()) {
    enqueueWebhook('meta', req.body).catch((e) => console.error('[meta] enqueue failed:', e.message));
    return;
  }

  const messages = normalizeWebhook(req.body);
  for (const m of messages) {
    ingestInbound(m).catch((e) => console.error('[meta] ingest failed:', e.message));
  }
});

export default router;
