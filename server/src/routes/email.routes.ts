// Email channel — inbound webhook (public).
//
// How inbound email reaches us: email providers with "inbound parse"
// (Mailgun Routes, SendGrid Inbound Parse, CloudMailin, Postmark) accept
// mail for your support address and POST it as JSON to a URL. Point them at:
//   POST /api/email/inbound
// with header  x-email-token: EMAIL_WEBHOOK_TOKEN   (from server/.env)
//
// Body (normalized): { to, from, fromName?, subject?, text }
// Outbound replies go through SMTP (see channels.ts sendOutbound EMAIL case).
import { Router } from 'express';
import { prisma } from '../lib/prisma';
import { ingestInbound } from '../services/channels';
import { ApiError } from '../lib/errors';

const router = Router();

router.post('/inbound', async (req, res, next) => {
  try {
    // Shared-secret check (skip only if no token configured — dev mode)
    const expected = process.env.EMAIL_WEBHOOK_TOKEN;
    if (expected && req.headers['x-email-token'] !== expected) {
      throw new ApiError(401, 'Invalid email webhook token');
    }

    const { to, from, fromName, subject, text } = req.body;
    if (!to || !from || !text) throw new ApiError(400, 'to, from and text are required');

    // Which merchant owns this support address?
    const address = String(to).toLowerCase().trim();
    const connection = await prisma.channelConnection.findFirst({
      where: { type: 'EMAIL', externalId: address },
    });
    if (!connection) throw new ApiError(404, `No store registered for ${address}`);

    await ingestInbound({
      channelExternalId: address,
      channelType: 'EMAIL',
      senderExternalId: String(from).toLowerCase().trim(),
      senderName: fromName || String(from),
      text: subject ? `[${subject}]\n${text}` : String(text),
    });

    res.json({ ok: true });
  } catch (err) { next(err); }
});

export default router;
