// Meta Messenger integration check.
//
//   npm run meta:check                                   # env presence + setup guidance
//   node scripts/check-meta.js <PAGE_ACCESS_TOKEN>       # validate a Page token (GET /me)
//   node scripts/check-meta.js <PAGE_ACCESS_TOKEN> <PSID># also send a test message to that PSID
//
// This exercises the SAME Graph calls the app uses (channels.ts): GET /me to
// validate a token, and POST /me/messages (Send API) to deliver a message.
// A real PAGE_ACCESS_TOKEN comes from your Meta app (Messenger ▸ Generate token).
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const GRAPH = 'https://graph.facebook.com/v21.0';
const ok = (m) => console.log(`  \x1b[32m✓\x1b[0m ${m}`);
const bad = (m) => console.log(`  \x1b[31m✗\x1b[0m ${m}`);
const skip = (m) => console.log(`  – ${m}`);
const short = (v) => JSON.stringify(v).slice(0, 300);

async function jfetch(url, opts) {
  const res = await fetch(url, opts);
  const text = await res.text();
  let data; try { data = JSON.parse(text); } catch { data = text; }
  return { status: res.status, ok: res.ok, data };
}

const pageToken = process.argv[2];
const recipientPsid = process.argv[3];

(async () => {
  console.log('\nF-ComFlow Meta Messenger check\n');

  // 1. Env that the SERVER needs (app-level, one-time)
  console.log('=== Server config (server/.env) ===');
  const appId = process.env.META_APP_ID;
  const appSecret = process.env.META_APP_SECRET;
  const verify = process.env.META_VERIFY_TOKEN;
  const publicUrl = process.env.PUBLIC_API_URL || '';
  appId ? ok(`META_APP_ID set (${appId})`) : bad('META_APP_ID not set — needed for one-click connect + signature checks');
  appSecret ? ok('META_APP_SECRET set') : bad('META_APP_SECRET not set — needed to verify webhook signatures');
  verify ? ok(`META_VERIFY_TOKEN set ("${verify}") — paste this SAME value in the Meta app webhook config`) : bad('META_VERIFY_TOKEN not set');
  if (publicUrl) ok(`Webhook URL: ${publicUrl}/api/meta/webhook`);
  else skip('PUBLIC_API_URL not set — set it to your public HTTPS URL so Meta can deliver webhooks');

  // 2. Validate a Page access token, if provided
  console.log('\n=== Page access token ===');
  if (!pageToken) {
    skip('no token passed. Run:  node scripts/check-meta.js <PAGE_ACCESS_TOKEN> [PSID]');
    console.log('\nGet a token: Meta app ▸ Messenger ▸ Settings ▸ Generate token for your Page.');
  } else {
    const me = await jfetch(`${GRAPH}/me?fields=id,name&access_token=${encodeURIComponent(pageToken)}`);
    if (me.ok && me.data && me.data.id) {
      ok(`token valid — Page "${me.data.name}" (id ${me.data.id})`);

      // 3. Optionally send a test message via the Send API
      if (recipientPsid) {
        console.log('\n=== Send API (POST /me/messages) ===');
        const send = await jfetch(`${GRAPH}/me/messages?access_token=${encodeURIComponent(pageToken)}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            recipient: { id: recipientPsid },
            messaging_type: 'RESPONSE',
            message: { text: 'F-ComFlow test message ✅' },
          }),
        });
        if (send.ok && send.data && send.data.message_id) ok(`message sent (message_id ${send.data.message_id})`);
        else bad(`send failed (HTTP ${send.status}): ${short(send.data)}`);
        console.log('  Note: you can only message a PSID that has messaged your Page within the last 24h.');
      } else {
        skip('no PSID passed — add one to also test the Send API (a PSID that messaged your Page recently)');
      }
    } else {
      bad(`token rejected (HTTP ${me.status}): ${short(me.data)}`);
    }
  }

  console.log('\nReminder: real inbound messages need a PUBLIC HTTPS webhook subscribed in the Meta app,');
  console.log('and strangers’ messages require Meta App Review. Your own admin/test accounts work immediately.');
})().catch((e) => {
  console.error(`\nFatal: ${e.message}`);
  console.error('If this is a network/proxy issue, graph.facebook.com may be unreachable from here.');
  process.exit(1);
});
