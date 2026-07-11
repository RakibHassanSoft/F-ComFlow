// Telegram Bot API integration — the friendliest channel of all:
// no App Review, no business verification, completely free.
//
// Connect flow (see channel.routes.ts POST /connect/telegram):
//   merchant pastes the token from @BotFather -> we verify it with getMe ->
//   we call setWebhook so Telegram pushes updates to
//   {PUBLIC_API_URL}/api/telegram/webhook/{botId}  with a secret header.
//
// This file is the PUBLIC webhook that receives those updates.
import { Router } from 'express';
import { ingestInbound } from '../services/channels';

const router = Router();

// POST /api/telegram/webhook/:botId
router.post('/webhook/:botId', (req, res) => {
  // We registered the webhook with a secret_token — Telegram echoes it back
  // in this header on every update. Wrong/missing secret -> reject.
  const secret = process.env.META_VERIFY_TOKEN || '';
  if (secret && req.headers['x-telegram-bot-api-secret-token'] !== secret) {
    return res.sendStatus(403);
  }

  res.sendStatus(200); // ACK fast, process after

  const msg = req.body?.message;
  if (!msg?.text || !msg.chat?.id) return; // ignore joins, stickers, etc.

  const name = [msg.from?.first_name, msg.from?.last_name].filter(Boolean).join(' ')
    || msg.from?.username || 'Telegram user';

  ingestInbound({
    channelExternalId: String(req.params.botId), // routes to the right tenant
    channelType: 'TELEGRAM',
    senderExternalId: String(msg.chat.id), // chat id is what we reply to
    senderName: name,
    text: msg.text,
  }).catch((e) => console.error('[telegram] ingest failed:', e.message));
});

export default router;
