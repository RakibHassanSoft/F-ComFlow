// Tests for the webhook normalizer: ad attribution across Messenger, Instagram
// and WhatsApp, plus the platform message-id used for de-duplication.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeWebhook } from '../services/webhook-normalize';

test('Messenger: click-to-Messenger ad referral is captured', () => {
  const out = normalizeWebhook({
    object: 'page',
    entry: [{
      id: 'PAGE_1',
      messaging: [{
        sender: { id: 'PSID_1' },
        message: {
          mid: 'mid.abc',
          text: 'Hi, is this in stock?',
          referral: { ad_id: '120210000000', ads_context_data: { ad_title: 'Eid Sale' } },
        },
      }],
    }],
  });
  assert.equal(out.length, 1);
  assert.equal(out[0].channelType, 'MESSENGER');
  assert.equal(out[0].channelExternalId, 'PAGE_1');
  assert.equal(out[0].adId, '120210000000');
  assert.equal(out[0].adTitle, 'Eid Sale');
  assert.equal(out[0].externalId, 'mid.abc'); // used for idempotency
});

test('Instagram: click-to-Direct ad referral is captured (same shape as Messenger)', () => {
  const out = normalizeWebhook({
    object: 'instagram',
    entry: [{
      id: 'IG_1',
      messaging: [{
        sender: { id: 'IGSID_1' },
        message: { mid: 'ig.mid.1', text: 'dam koto?', referral: { ad_id: '999', ads_context_data: { ad_title: 'New Arrivals' } } },
      }],
    }],
  });
  assert.equal(out.length, 1);
  assert.equal(out[0].channelType, 'INSTAGRAM');
  assert.equal(out[0].adId, '999');
  assert.equal(out[0].adTitle, 'New Arrivals');
});

test('WhatsApp: click-to-WhatsApp ad referral uses source_id + headline', () => {
  const out = normalizeWebhook({
    object: 'whatsapp_business_account',
    entry: [{
      changes: [{
        value: {
          metadata: { phone_number_id: 'PN_1' },
          contacts: [{ wa_id: '8801700000000', profile: { name: 'Rahim' } }],
          messages: [{
            id: 'wamid.xyz',
            from: '8801700000000',
            type: 'text',
            text: { body: 'ami nibo' },
            referral: { source_id: '555', headline: 'Free Delivery' },
          }],
        },
      }],
    }],
  });
  assert.equal(out.length, 1);
  assert.equal(out[0].channelType, 'WHATSAPP');
  assert.equal(out[0].senderName, 'Rahim');
  assert.equal(out[0].adId, '555');
  assert.equal(out[0].adTitle, 'Free Delivery');
  assert.equal(out[0].externalId, 'wamid.xyz');
});

test('non-ad message has null adId but still carries a message id', () => {
  const out = normalizeWebhook({
    object: 'page',
    entry: [{ id: 'P', messaging: [{ sender: { id: 'S' }, message: { mid: 'm1', text: 'hello' } }] }],
  });
  assert.equal(out[0].adId, null);
  assert.equal(out[0].adTitle, null);
  assert.equal(out[0].externalId, 'm1');
});

test('echoes and non-text events are ignored', () => {
  const out = normalizeWebhook({
    object: 'page',
    entry: [{
      id: 'P',
      messaging: [
        { sender: { id: 'S' }, message: { is_echo: true, text: 'our reply' } },
        { sender: { id: 'S' }, message: { attachments: [{ type: 'image' }] } },
      ],
    }],
  });
  assert.equal(out.length, 0);
});
