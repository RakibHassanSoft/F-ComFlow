// Channel connections — merchants connect their real social accounts.
//
// TWO ways to connect (both end in the same ChannelConnection row):
//  1. ONE-CLICK OAUTH (the friendly way):
//     - Facebook/Instagram: the client opens the Facebook Login popup, the
//       merchant picks their Page, we exchange tokens server-side, save the
//       connection AND auto-subscribe the Page to our webhook.
//     - WhatsApp: Meta's "Embedded Signup" popup returns a code + the new
//       phone_number_id; we exchange the code for a token and save.
//  2. MANUAL (advanced/dev): paste an ID + token directly.
import { Router } from 'express';
import { prisma } from '../lib/prisma';
import { requireAuth } from '../middleware/auth';
import { ApiError } from '../lib/errors';
import { testConnection } from '../services/channels';
import { GRAPH, graph } from '../lib/graph';

const router = Router();
router.use(requireAuth);

const TYPES = ['MESSENGER', 'INSTAGRAM', 'WHATSAPP', 'TELEGRAM', 'VIBER', 'WEBCHAT', 'EMAIL'] as const;

// Public URL of THIS API — Telegram/Viber need it to deliver webhooks.
// Locally: your ngrok https URL. Deployed: your API domain.
const publicApiUrl = () => process.env.PUBLIC_API_URL || '';

// ---------------------------------------------------------------- list

// GET /api/channels — this tenant's connections (token never sent back whole)
router.get('/', async (req, res, next) => {
  try {
    const list = await prisma.channelConnection.findMany({
      where: { tenantId: req.tenantId },
      orderBy: { createdAt: 'asc' },
    });
    res.json(
      list.map((c: any) => ({
        id: c.id,
        type: c.type,
        externalId: c.externalId,
        label: c.label,
        tokenPreview: c.accessToken.slice(0, 6) + '…' + c.accessToken.slice(-4),
        createdAt: c.createdAt,
      }))
    );
  } catch (err) { next(err); }
});

// ------------------------------------------------- one-click: Facebook

// POST /api/channels/oauth/facebook/pages  { userToken }
// Step 1 after the Facebook Login popup: exchange the short-lived user token
// for a long-lived one, then list the merchant's Pages (+ linked Instagram).
router.post('/oauth/facebook/pages', async (req, res, next) => {
  try {
    const { userToken } = req.body;
    if (!userToken) throw new ApiError(400, 'userToken is required');
    const appId = process.env.META_APP_ID;
    const appSecret = process.env.META_APP_SECRET;
    if (!appId || !appSecret) {
      throw new ApiError(422, 'META_APP_ID / META_APP_SECRET not set in server/.env — see docs/CONNECT_CHANNELS.md');
    }

    // Short-lived -> long-lived user token (so Page tokens don't expire in an hour)
    const ll = await graph(
      `oauth/access_token?grant_type=fb_exchange_token&client_id=${appId}` +
      `&client_secret=${appSecret}&fb_exchange_token=${encodeURIComponent(userToken)}`
    );

    // The merchant's Pages, each with its own Page access token + linked IG
    const accounts = await graph(
      `me/accounts?fields=id,name,access_token,instagram_business_account{id,username}` +
      `&access_token=${encodeURIComponent(ll.access_token)}`
    );

    const pages = (accounts.data ?? []).map((p: any) => ({
      id: p.id,
      name: p.name,
      igId: p.instagram_business_account?.id ?? null,
      igUsername: p.instagram_business_account?.username ?? null,
    }));
    if (pages.length === 0) throw new ApiError(422, 'No Facebook Pages found on this account (you must be a Page admin)');

    // The long-lived token goes back to the merchant's own browser only,
    // and only to be posted straight back in step 2.
    res.json({ pages, longLivedToken: ll.access_token });
  } catch (err) { next(err); }
});

// POST /api/channels/oauth/facebook/connect
// { longLivedToken, pageId, connectInstagram }
// Step 2: save the chosen Page (and its Instagram), and auto-subscribe the
// Page to our webhook so messages start flowing with zero dashboard work.
router.post('/oauth/facebook/connect', async (req, res, next) => {
  try {
    const { longLivedToken, pageId, connectInstagram } = req.body;
    if (!longLivedToken || !pageId) throw new ApiError(400, 'longLivedToken and pageId are required');

    const accounts = await graph(
      `me/accounts?fields=id,name,access_token,instagram_business_account{id,username}` +
      `&access_token=${encodeURIComponent(longLivedToken)}`
    );
    const page = (accounts.data ?? []).find((p: any) => p.id === pageId);
    if (!page) throw new ApiError(404, 'That Page was not found on your account');

    // Auto-subscribe the Page to the app's webhook (messages field).
    // This replaces the manual "subscribe" step in the Meta dashboard.
    try {
      await fetch(
        `${GRAPH}/${page.id}/subscribed_apps?subscribed_fields=messages` +
        `&access_token=${encodeURIComponent(page.access_token)}`,
        { method: 'POST', signal: AbortSignal.timeout(10_000) }
      );
    } catch { /* non-fatal: can also be done in the dashboard */ }

    const saved: any[] = [];
    const upsert = async (type: 'MESSENGER' | 'INSTAGRAM', externalId: string, label: string) => {
      const existing = await prisma.channelConnection.findFirst({
        where: { tenantId: req.tenantId, type, externalId },
      });
      const row = existing
        ? await prisma.channelConnection.update({
            where: { id: existing.id },
            data: { accessToken: page.access_token, label },
          })
        : await prisma.channelConnection.create({
            data: { tenantId: req.tenantId, type, externalId, accessToken: page.access_token, label },
          });
      saved.push({ type: row.type, label: row.label });
    };

    await upsert('MESSENGER', page.id, page.name);
    if (connectInstagram && page.instagram_business_account?.id) {
      await upsert('INSTAGRAM', page.instagram_business_account.id, '@' + (page.instagram_business_account.username || 'instagram'));
    }

    res.status(201).json({ ok: true, saved });
  } catch (err: any) {
    if (err?.code === 'P2002') return next(new ApiError(409, 'That Page is already connected to another store'));
    next(err);
  }
});

// ------------------------------------------------- one-click: WhatsApp

// POST /api/channels/oauth/whatsapp/connect
// { code, phoneNumberId, wabaId }  — from Meta's Embedded Signup popup.
router.post('/oauth/whatsapp/connect', async (req, res, next) => {
  try {
    const { code, phoneNumberId, wabaId } = req.body;
    if (!code || !phoneNumberId) throw new ApiError(400, 'code and phoneNumberId are required');
    const appId = process.env.META_APP_ID;
    const appSecret = process.env.META_APP_SECRET;
    if (!appId || !appSecret) {
      throw new ApiError(422, 'META_APP_ID / META_APP_SECRET not set in server/.env — see docs/CONNECT_CHANNELS.md');
    }

    // Exchange the signup code for a business access token
    const tok = await graph(
      `oauth/access_token?client_id=${appId}&client_secret=${appSecret}&code=${encodeURIComponent(code)}`
    );

    // Subscribe our app to the merchant's WhatsApp Business Account webhooks
    if (wabaId) {
      try {
        await fetch(`${GRAPH}/${wabaId}/subscribed_apps`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${tok.access_token}` },
          signal: AbortSignal.timeout(10_000),
        });
      } catch { /* non-fatal */ }
    }

    // Confirm the number is real and get a friendly label
    const check = await testConnection('WHATSAPP', phoneNumberId, tok.access_token);
    if (!check.ok) throw new ApiError(422, `WhatsApp number check failed: ${check.detail}`);

    const existing = await prisma.channelConnection.findFirst({
      where: { tenantId: req.tenantId, type: 'WHATSAPP', externalId: phoneNumberId },
    });
    const row = existing
      ? await prisma.channelConnection.update({
          where: { id: existing.id },
          data: { accessToken: tok.access_token, label: check.detail },
        })
      : await prisma.channelConnection.create({
          data: { tenantId: req.tenantId, type: 'WHATSAPP', externalId: phoneNumberId, accessToken: tok.access_token, label: check.detail },
        });

    res.status(201).json({ ok: true, saved: [{ type: 'WHATSAPP', label: row.label }] });
  } catch (err: any) {
    if (err?.code === 'P2002') return next(new ApiError(409, 'That number is already connected to another store'));
    next(err);
  }
});

// ------------------------------------------------- one-click: Telegram
// POST /api/channels/connect/telegram  { botToken }
// The merchant creates a bot with @BotFather (2 minutes, free, no approval)
// and pastes its token. We verify it, register the webhook, done.
router.post('/connect/telegram', async (req, res, next) => {
  try {
    const { botToken } = req.body;
    if (!botToken?.includes(':')) throw new ApiError(400, 'Paste the bot token from @BotFather (looks like 123456:ABC-…)');

    const check = await testConnection('TELEGRAM', '', botToken.trim());
    if (!check.ok) throw new ApiError(422, `Telegram rejected the token: ${check.detail}`);

    const botId = botToken.split(':')[0];

    // Register the webhook so Telegram pushes messages to us
    let webhookNote = '';
    if (publicApiUrl()) {
      const hook = await fetch(`https://api.telegram.org/bot${botToken.trim()}/setWebhook`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: `${publicApiUrl()}/api/telegram/webhook/${botId}`,
          secret_token: process.env.META_VERIFY_TOKEN || undefined,
          allowed_updates: ['message'],
        }),
        signal: AbortSignal.timeout(10_000),
      });
      const hookData: any = await hook.json().catch(() => ({}));
      if (!hookData.ok) webhookNote = ` (webhook setup failed: ${hookData.description})`;
    } else {
      webhookNote = ' (set PUBLIC_API_URL in server/.env so Telegram can reach your webhook)';
    }

    const existing = await prisma.channelConnection.findFirst({
      where: { tenantId: req.tenantId, type: 'TELEGRAM', externalId: botId },
    });
    const row = existing
      ? await prisma.channelConnection.update({
          where: { id: existing.id },
          data: { accessToken: botToken.trim(), label: check.detail },
        })
      : await prisma.channelConnection.create({
          data: { tenantId: req.tenantId, type: 'TELEGRAM', externalId: botId, accessToken: botToken.trim(), label: check.detail },
        });

    res.status(201).json({ ok: true, saved: [{ type: 'TELEGRAM', label: row.label + webhookNote }] });
  } catch (err: any) {
    if (err?.code === 'P2002') return next(new ApiError(409, 'That bot is already connected to another store'));
    next(err);
  }
});

// ------------------------------------------------- one-click: Viber
// POST /api/channels/connect/viber  { authToken }
router.post('/connect/viber', async (req, res, next) => {
  try {
    const { authToken } = req.body;
    if (!authToken?.trim()) throw new ApiError(400, 'Paste the bot token from partners.viber.com');

    // Verify + get the bot's account id (used to route inbound webhooks)
    const info = await fetch('https://chatapi.viber.com/pa/get_account_info', {
      method: 'POST',
      headers: { 'X-Viber-Auth-Token': authToken.trim() },
      signal: AbortSignal.timeout(10_000),
    });
    const data: any = await info.json().catch(() => ({}));
    if (data.status !== 0) throw new ApiError(422, `Viber rejected the token: ${data.status_message || 'error'}`);

    let webhookNote = '';
    if (publicApiUrl()) {
      const hook = await fetch('https://chatapi.viber.com/pa/set_webhook', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Viber-Auth-Token': authToken.trim() },
        body: JSON.stringify({
          url: `${publicApiUrl()}/api/viber/webhook/${data.id}`,
          event_types: ['message'],
        }),
        signal: AbortSignal.timeout(10_000),
      });
      const hookData: any = await hook.json().catch(() => ({}));
      if (hookData.status !== 0) webhookNote = ` (webhook setup failed: ${hookData.status_message})`;
    } else {
      webhookNote = ' (set PUBLIC_API_URL in server/.env so Viber can reach your webhook)';
    }

    const existing = await prisma.channelConnection.findFirst({
      where: { tenantId: req.tenantId, type: 'VIBER', externalId: String(data.id) },
    });
    const row = existing
      ? await prisma.channelConnection.update({
          where: { id: existing.id },
          data: { accessToken: authToken.trim(), label: data.name || 'Viber bot' },
        })
      : await prisma.channelConnection.create({
          data: { tenantId: req.tenantId, type: 'VIBER', externalId: String(data.id), accessToken: authToken.trim(), label: data.name || 'Viber bot' },
        });

    res.status(201).json({ ok: true, saved: [{ type: 'VIBER', label: row.label + webhookNote }] });
  } catch (err: any) {
    if (err?.code === 'P2002') return next(new ApiError(409, 'That Viber bot is already connected to another store'));
    next(err);
  }
});

// ------------------------------------------------- webchat + email
// POST /api/channels/connect/webchat — enables the website widget (no creds)
router.post('/connect/webchat', async (req, res, next) => {
  try {
    const externalId = `webchat-${req.tenantId}`; // unique per store
    const existing = await prisma.channelConnection.findFirst({
      where: { tenantId: req.tenantId, type: 'WEBCHAT' },
    });
    const row = existing || await prisma.channelConnection.create({
      data: { tenantId: req.tenantId, type: 'WEBCHAT', externalId, accessToken: '-', label: 'Website chat widget' },
    });
    res.status(201).json({ ok: true, saved: [{ type: 'WEBCHAT', label: row.label }], tenantId: req.tenantId });
  } catch (err) { next(err); }
});

// POST /api/channels/connect/email  { address }
router.post('/connect/email', async (req, res, next) => {
  try {
    const address = String(req.body.address || '').toLowerCase().trim();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(address)) throw new ApiError(400, 'Enter a valid support email address');

    const check = await testConnection('EMAIL', address, '');
    const existing = await prisma.channelConnection.findFirst({
      where: { tenantId: req.tenantId, type: 'EMAIL', externalId: address },
    });
    const row = existing || await prisma.channelConnection.create({
      data: { tenantId: req.tenantId, type: 'EMAIL', externalId: address, accessToken: '-', label: address },
    });
    res.status(201).json({ ok: true, saved: [{ type: 'EMAIL', label: check.detail || row.label }] });
  } catch (err: any) {
    if (err?.code === 'P2002') return next(new ApiError(409, 'That address is already connected to another store'));
    next(err);
  }
});

// ---------------------------------------------------------------- manual

// POST /api/channels — manual connect (advanced/dev fallback)
router.post('/', async (req, res, next) => {
  try {
    const { type, externalId, accessToken, label } = req.body;
    if (!TYPES.includes(type)) throw new ApiError(400, 'type must be MESSENGER, INSTAGRAM or WHATSAPP');
    if (!externalId?.trim() || !accessToken?.trim()) {
      throw new ApiError(400, 'externalId and accessToken are required');
    }

    const check = await testConnection(type, externalId.trim(), accessToken.trim());
    if (!check.ok) throw new ApiError(422, `Meta rejected these credentials: ${check.detail}`);

    const connection = await prisma.channelConnection.create({
      data: {
        tenantId: req.tenantId,
        type,
        externalId: externalId.trim(),
        accessToken: accessToken.trim(),
        label: label?.trim() || check.detail,
      },
    });
    res.status(201).json({ id: connection.id, type, externalId: connection.externalId, label: connection.label, verified: check.detail });
  } catch (err: any) {
    if (err?.code === 'P2002') return next(new ApiError(409, 'That Page/number is already connected'));
    next(err);
  }
});

// POST /api/channels/:id/test — re-check saved credentials against Meta
router.post('/:id/test', async (req, res, next) => {
  try {
    const c = await prisma.channelConnection.findFirst({
      where: { id: req.params.id, tenantId: req.tenantId },
    });
    if (!c) throw new ApiError(404, 'Connection not found');
    res.json(await testConnection(c.type, c.externalId, c.accessToken));
  } catch (err) { next(err); }
});

// POST /api/channels/:id/disconnect
router.post('/:id/disconnect', async (req, res, next) => {
  try {
    const c = await prisma.channelConnection.findFirst({
      where: { id: req.params.id, tenantId: req.tenantId },
    });
    if (!c) throw new ApiError(404, 'Connection not found');
    await prisma.channelConnection.delete({ where: { id: c.id } });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

export default router;
