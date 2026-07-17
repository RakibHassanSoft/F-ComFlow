// Real Messenger/Instagram/WhatsApp integration. Inbound: normalize + route
// Meta webhooks to the right tenant. Outbound: send replies via Graph v21.0.
import { prisma } from '../lib/prisma';
import { emitToTenant } from '../lib/socket';
import { GRAPH } from '../lib/graph';
import { isWithinBusinessHours } from '../lib/time';

const TELEGRAM_API = 'https://api.telegram.org';
const VIBER_API = 'https://chatapi.viber.com/pa';

export type ChannelType =
  | 'MESSENGER' | 'INSTAGRAM' | 'WHATSAPP'   // Meta family
  | 'TELEGRAM' | 'VIBER'                     // bot APIs (no approval needed!)
  | 'WEBCHAT'                                // widget on the merchant's website
  | 'EMAIL';

// ---------------------------------------------------------------- INBOUND

// One normalized inbound message, whatever platform it came from.
export interface InboundMessage {
  channelExternalId: string; // Page ID / IG ID / phone_number_id -> finds the tenant
  channelType: ChannelType;
  senderExternalId: string;  // PSID / IGSID / customer's WhatsApp number
  senderName: string | null; // WhatsApp gives this; Messenger needs a lookup
  text: string;
  // Platform's own message id — used to ignore Meta's duplicate/retried webhooks
  externalId?: string | null;
  // Click-to-Messenger / click-to-WhatsApp ads: which ad brought this customer
  adId?: string | null;
  adTitle?: string | null;
}

// normalizeWebhook + ad-referral parsing live in a prisma-free module so
// they can be unit-tested in isolation; re-exported for existing importers.
export { normalizeWebhook } from './webhook-normalize';

// Persist one inbound message: find the tenant, upsert customer +
// conversation, store the message, broadcast live to the dashboard.
export async function ingestInbound(m: InboundMessage): Promise<void> {
  // Which merchant owns this Page / IG account / WhatsApp number?
  const connection = await prisma.channelConnection.findFirst({
    where: { externalId: m.channelExternalId, type: m.channelType },
  });
  if (!connection) {
    console.warn(`[channels] webhook for unconnected channel ${m.channelType}:${m.channelExternalId} — ignored`);
    return;
  }
  const tenantId = connection.tenantId;

  // Idempotency: Meta retries webhooks, so the same message can arrive twice.
  // If we've already stored this platform message id for this tenant, skip it.
  if (m.externalId) {
    const seen = await prisma.message.findFirst({
      where: { tenantId, externalId: m.externalId },
      select: { id: true },
    });
    if (seen) {
      console.log(`[channels] duplicate webhook ignored (${m.channelType} msg ${m.externalId})`);
      return;
    }
  }

  // Customer: match by their platform ID within this tenant
  let customer = await prisma.customer.findFirst({
    where: { tenantId, externalId: m.senderExternalId },
  });
  if (!customer) {
    // Messenger/Instagram don't include the name in the webhook — look it up
    let name = m.senderName;
    if (!name && (m.channelType === 'MESSENGER' || m.channelType === 'INSTAGRAM')) {
      name = await fetchMessengerName(m.senderExternalId, connection.accessToken);
    }
    customer = await prisma.customer.create({
      data: {
        tenantId,
        name: name || `${m.channelType.toLowerCase()} customer`,
        externalId: m.senderExternalId,
        phone: m.channelType === 'WHATSAPP' ? m.senderExternalId : null,
      },
    });
  }

  // Conversation: one open thread per customer per channel
  let conversation = await prisma.conversation.findFirst({
    where: { tenantId, customerId: customer.id, channel: m.channelType },
  });
  if (!conversation) {
    conversation = await prisma.conversation.create({
      data: {
        tenantId,
        customerId: customer.id,
        channel: m.channelType,
        unreadCount: 0,
        adId: m.adId ?? null,     // ad attribution sticks to the conversation,
        adTitle: m.adTitle ?? null, // so every order from it traces to the ad
      },
      include: { customer: true },
    });
    emitToTenant(tenantId, 'conversation:new', conversation);
  } else if (m.adId && !conversation.adId) {
    // Existing thread, first time we learn the ad — record it
    conversation = await prisma.conversation.update({
      where: { id: conversation.id },
      data: { adId: m.adId, adTitle: m.adTitle ?? null },
      include: { customer: true },
    });
  }

  const message = await prisma.message.create({
    data: { tenantId, conversationId: conversation.id, direction: 'INBOUND', text: m.text, externalId: m.externalId ?? null },
  });
  await prisma.conversation.update({
    where: { id: conversation.id },
    data: { lastMessageAt: new Date(), unreadCount: { increment: 1 } },
  });

  // Live to the merchant's dashboard — same event the simulator uses,
  // so the whole UI works identically for real and simulated messages.
  emitToTenant(tenantId, 'message:new', { conversationId: conversation.id, message });

  // Out-of-hours auto-reply: if the tenant set an away message + business hours
  // and we're outside them, reply once (throttled to at most once every 6h per
  // thread so we never spam a customer who sends several messages).
  await maybeSendAwayReply(tenantId, conversation.id, m.channelType, m.senderExternalId);
}

const AWAY_THROTTLE_MS = 6 * 60 * 60 * 1000;

async function maybeSendAwayReply(
  tenantId: string,
  conversationId: string,
  channelType: ChannelType,
  senderExternalId: string
): Promise<void> {
  try {
    const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
    if (!tenant?.awayMessage) return;
    if (isWithinBusinessHours(new Date(), tenant.businessHourStart, tenant.businessHourEnd)) return;

    const conversation = await prisma.conversation.findUnique({ where: { id: conversationId } });
    if (!conversation) return;
    if (conversation.lastAutoReplyAt && Date.now() - conversation.lastAutoReplyAt.getTime() < AWAY_THROTTLE_MS) {
      return; // already auto-replied recently
    }

    const reply = await prisma.message.create({
      data: { tenantId, conversationId, direction: 'OUTBOUND', text: tenant.awayMessage },
    });
    await prisma.conversation.update({
      where: { id: conversationId },
      data: { lastAutoReplyAt: new Date(), lastMessageAt: new Date() },
    });
    emitToTenant(tenantId, 'message:new', { conversationId, message: reply });
    await sendOutbound(tenantId, channelType, senderExternalId, tenant.awayMessage);
  } catch (e) {
    console.warn('[channels] away auto-reply failed:', (e as Error).message);
  }
}

// Best-effort name lookup for Messenger senders (PSID -> first/last name)
async function fetchMessengerName(psid: string, pageToken: string): Promise<string | null> {
  try {
    const res = await fetch(
      `${GRAPH}/${psid}?fields=first_name,last_name&access_token=${encodeURIComponent(pageToken)}`,
      { signal: AbortSignal.timeout(5_000) }
    );
    if (!res.ok) return null;
    const data: any = await res.json();
    const name = [data.first_name, data.last_name].filter(Boolean).join(' ');
    return name || null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------- OUTBOUND

// Send a merchant's reply back to the customer's app.
// Returns a short status string that the inbox stores in logs; a delivery
// failure must never block saving the reply locally.
export async function sendOutbound(
  tenantId: string,
  channelType: ChannelType,
  customerExternalId: string,
  text: string
): Promise<{ delivered: boolean; detail: string }> {
  const connection = await prisma.channelConnection.findFirst({
    where: { tenantId, type: channelType },
  });
  if (!connection) {
    return { delivered: false, detail: 'no channel connected — reply saved locally only' };
  }

  try {
    // ---- Telegram: bot API, needs no approval ----
    if (channelType === 'TELEGRAM') {
      const res = await fetch(`${TELEGRAM_API}/bot${connection.accessToken}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: customerExternalId, text }),
        signal: AbortSignal.timeout(10_000),
      });
      const data: any = await res.json().catch(() => ({}));
      if (!data.ok) return { delivered: false, detail: data.description || `HTTP ${res.status}` };
      return { delivered: true, detail: 'delivered via Telegram' };
    }

    // ---- Viber: bot API ----
    if (channelType === 'VIBER') {
      const res = await fetch(`${VIBER_API}/send_message`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Viber-Auth-Token': connection.accessToken },
        body: JSON.stringify({
          receiver: customerExternalId,
          type: 'text',
          text,
          sender: { name: (connection.label || 'Shop').slice(0, 28) },
        }),
        signal: AbortSignal.timeout(10_000),
      });
      const data: any = await res.json().catch(() => ({}));
      if (data.status !== 0) return { delivered: false, detail: data.status_message || `HTTP ${res.status}` };
      return { delivered: true, detail: 'delivered via Viber' };
    }

    // ---- Website widget: the visitor's browser polls our API, so the reply
    // is already "delivered" the moment it's saved. Nothing to send. ----
    if (channelType === 'WEBCHAT') {
      return { delivered: true, detail: 'visible in the website chat widget' };
    }

    // ---- Email: SMTP via nodemailer (SMTP_* in server/.env) ----
    if (channelType === 'EMAIL') {
      if (!process.env.SMTP_HOST) {
        return { delivered: false, detail: 'SMTP_HOST not set in server/.env — reply saved locally only' };
      }
      const nodemailer = await import('nodemailer');
      const transport = nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: Number(process.env.SMTP_PORT) || 587,
        secure: Number(process.env.SMTP_PORT) === 465,
        auth: process.env.SMTP_USER
          ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
          : undefined,
      });
      await transport.sendMail({
        from: process.env.SMTP_FROM || connection.externalId,
        to: customerExternalId,
        subject: `Reply from ${connection.label || 'our shop'}`,
        text,
      });
      return { delivered: true, detail: 'delivered via email' };
    }

    // ---- Meta family (Messenger / Instagram / WhatsApp) ----
    let res: Response;
    if (channelType === 'WHATSAPP') {
      res = await fetch(`${GRAPH}/${connection.externalId}/messages`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${connection.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          recipient_type: 'individual',
          to: customerExternalId,
          type: 'text',
          text: { body: text },
        }),
        signal: AbortSignal.timeout(10_000),
      });
    } else {
      // Messenger and Instagram both use the Page's /me/messages endpoint
      res = await fetch(
        `${GRAPH}/me/messages?access_token=${encodeURIComponent(connection.accessToken)}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            recipient: { id: customerExternalId },
            messaging_type: 'RESPONSE',
            message: { text },
          }),
          signal: AbortSignal.timeout(10_000),
        }
      );
    }

    if (!res.ok) {
      const err: any = await res.json().catch(() => ({}));
      const detail = err?.error?.message || `HTTP ${res.status}`;
      console.warn(`[channels] send failed (${channelType}): ${detail}`);
      return { delivered: false, detail };
    }
    return { delivered: true, detail: 'delivered via ' + channelType };
  } catch (e) {
    const detail = (e as Error).message;
    console.warn(`[channels] send error (${channelType}): ${detail}`);
    return { delivered: false, detail };
  }
}

// Quick credential check used by the Settings "Test" button and on connect.
export async function testConnection(type: ChannelType, externalId: string, accessToken: string) {
  try {
    // Telegram: getMe confirms the bot token and returns its username
    if (type === 'TELEGRAM') {
      const res = await fetch(`${TELEGRAM_API}/bot${accessToken}/getMe`, { signal: AbortSignal.timeout(8_000) });
      const data: any = await res.json().catch(() => ({}));
      if (!data.ok) return { ok: false, detail: data.description || `HTTP ${res.status}` };
      return { ok: true, detail: '@' + data.result.username };
    }

    // Viber: get_account_info confirms the bot token
    if (type === 'VIBER') {
      const res = await fetch(`${VIBER_API}/get_account_info`, {
        method: 'POST',
        headers: { 'X-Viber-Auth-Token': accessToken },
        signal: AbortSignal.timeout(8_000),
      });
      const data: any = await res.json().catch(() => ({}));
      if (data.status !== 0) return { ok: false, detail: data.status_message || `HTTP ${res.status}` };
      return { ok: true, detail: data.name || 'Viber bot' };
    }

    // Webchat: nothing external to verify
    if (type === 'WEBCHAT') return { ok: true, detail: 'Website chat widget' };

    // Email: the address itself; outbound needs SMTP configured
    if (type === 'EMAIL') {
      return {
        ok: true,
        detail: process.env.SMTP_HOST
          ? externalId
          : `${externalId} (outbound needs SMTP_* in server/.env)`,
      };
    }

    // Meta family
    const url =
      type === 'WHATSAPP'
        ? `${GRAPH}/${externalId}?fields=display_phone_number,verified_name`
        : `${GRAPH}/me?fields=id,name&access_token=${encodeURIComponent(accessToken)}`;
    const res = await fetch(url, {
      headers: type === 'WHATSAPP' ? { Authorization: `Bearer ${accessToken}` } : {},
      signal: AbortSignal.timeout(8_000),
    });
    const data: any = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, detail: data?.error?.message || `HTTP ${res.status}` };
    return { ok: true, detail: data.name || data.verified_name || data.display_phone_number || 'connected' };
  } catch (e) {
    return { ok: false, detail: (e as Error).message };
  }
}
