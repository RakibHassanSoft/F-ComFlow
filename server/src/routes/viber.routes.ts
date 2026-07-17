// Viber bot webhook (public). Events are HMAC-verified with the bot token.
import { Router } from 'express';
import crypto from 'crypto';
import { prisma } from '../lib/prisma';
import { ingestInbound } from '../services/channels';

const router = Router();

// POST /api/viber/webhook/:accountId
router.post('/webhook/:accountId', async (req: any, res) => {
  // Find the connection so we know which bot token signs these events
  const connection = await prisma.channelConnection.findFirst({
    where: { type: 'VIBER', externalId: req.params.accountId },
  });
  if (!connection) return res.sendStatus(404);

  // Signature check with the bot token over the raw body
  const signature = req.headers['x-viber-content-signature'];
  const expected = crypto.createHmac('sha256', connection.accessToken)
    .update(req.rawBody || Buffer.from(''))
    .digest('hex');
  if (!signature || signature !== expected) {
    console.warn('[viber] invalid signature — rejected');
    return res.sendStatus(403);
  }

  res.sendStatus(200);

  const event = req.body;
  if (event?.event !== 'message' || event.message?.type !== 'text') return;

  ingestInbound({
    channelExternalId: String(req.params.accountId),
    channelType: 'VIBER',
    senderExternalId: String(event.sender.id),
    senderName: event.sender.name || 'Viber user',
    text: event.message.text,
  }).catch((e) => console.error('[viber] ingest failed:', e.message));
});

export default router;
