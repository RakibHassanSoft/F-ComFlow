// Pure webhook parsing (no DB/side effects). Re-exported by channels.ts.
import type { ChannelType, InboundMessage } from './channels';

// Ad-referral shapes differ per surface — pull whichever fields are present so
// Messenger, Instagram AND WhatsApp all attribute to the ad that drove the chat:
//   Messenger click-to-Messenger:  referral.ad_id      + ads_context_data.ad_title
//   Instagram  click-to-Direct:    referral.ad_id      + ads_context_data.ad_title
//                                  (may also carry referral.ref / source_id)
//   WhatsApp   click-to-WhatsApp:  referral.source_id  + referral.headline
export function readAdReferral(referral: any): { adId: string | null; adTitle: string | null } {
  if (!referral) return { adId: null, adTitle: null };
  const adId = referral.ad_id ?? referral.source_id ?? null;
  const adTitle =
    referral.ads_context_data?.ad_title ?? referral.headline ?? referral.ref ?? null;
  return { adId: adId ? String(adId) : null, adTitle: adTitle ? String(adTitle) : null };
}

// Parse a verified Meta webhook body into normalized messages.
// Returns [] for events we don't handle (delivery receipts, echoes, etc.).
export function normalizeWebhook(body: any): InboundMessage[] {
  const out: InboundMessage[] = [];

  // Messenger + Instagram share one shape: entry[].messaging[]
  if (body.object === 'page' || body.object === 'instagram') {
    const type: ChannelType = body.object === 'page' ? 'MESSENGER' : 'INSTAGRAM';
    for (const entry of body.entry ?? []) {
      for (const event of entry.messaging ?? []) {
        if (!event.message?.text) continue;      // ignore attachments-only for now
        if (event.message.is_echo) continue;     // ignore our own outbound echoes
        // Ad referral can ride on the message, the event, or a postback.
        // Same handling for Messenger AND Instagram (both use this shape).
        const referral = event.message?.referral || event.referral || event.postback?.referral;
        const ad = readAdReferral(referral);
        out.push({
          channelExternalId: String(entry.id),
          channelType: type,
          senderExternalId: String(event.sender.id),
          senderName: null,
          text: event.message.text,
          externalId: event.message.mid ? String(event.message.mid) : null,
          adId: ad.adId,
          adTitle: ad.adTitle,
        });
      }
    }
  }

  // WhatsApp Cloud API: entry[].changes[].value.messages[]
  if (body.object === 'whatsapp_business_account') {
    for (const entry of body.entry ?? []) {
      for (const change of entry.changes ?? []) {
        const value = change.value;
        if (!value?.messages) continue; // statuses/read-receipts have no .messages
        for (const msg of value.messages) {
          if (msg.type !== 'text' || !msg.text?.body) continue;
          const contact = (value.contacts ?? []).find((c: any) => c.wa_id === msg.from);
          out.push({
            channelExternalId: String(value.metadata.phone_number_id),
            channelType: 'WHATSAPP',
            senderExternalId: String(msg.from),
            senderName: contact?.profile?.name ?? null,
            text: msg.text.body,
            externalId: msg.id ? String(msg.id) : null,
            // Click-to-WhatsApp ads attach a referral with the ad id
            ...readAdReferral(msg.referral),
          });
        }
      }
    }
  }

  return out;
}
