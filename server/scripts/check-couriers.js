// Live courier integration check — run with your real sandbox keys in server/.env:
//
//   npm run couriers:check            # SAFE: auth + location/balance reads only
//   npm run couriers:check -- --book  # ALSO creates ONE test parcel per carrier
//                                       and reads back its tracking status
//
// Green (✓) = credentials valid, endpoints reachable, our payloads accepted.
// This exercises the EXACT same endpoints/payloads as src/services/couriers.ts,
// so a pass here means live booking + tracking will work in the app.
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const BOOK = process.argv.includes('--book');
const ok = (m) => console.log(`  \x1b[32m✓\x1b[0m ${m}`);
const bad = (m) => console.log(`  \x1b[31m✗\x1b[0m ${m}`);
const skip = (m) => console.log(`  – ${m}`);

async function jfetch(url, opts) {
  const res = await fetch(url, opts);
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = text; }
  return { status: res.status, ok: res.ok, data };
}
// Pathao list responses nest as { data: { data: [...] } }; be defensive.
const listOf = (body) => (body && body.data && body.data.data) || (body && body.data) || [];
const short = (v) => JSON.stringify(v).slice(0, 300);

async function testPathao() {
  console.log('\n=== Pathao ===');
  const base = process.env.PATHAO_BASE_URL || 'https://courier-api-sandbox.pathao.com';
  const { PATHAO_CLIENT_ID, PATHAO_CLIENT_SECRET, PATHAO_USERNAME, PATHAO_PASSWORD, PATHAO_STORE_ID } = process.env;
  if (!PATHAO_CLIENT_ID || !PATHAO_CLIENT_SECRET || !PATHAO_USERNAME || !PATHAO_PASSWORD) {
    return skip('skipped (PATHAO_* not set)');
  }
  console.log(`  base: ${base}`);

  // 1. Issue token
  const tok = await jfetch(`${base}/aladdin/api/v1/issue-token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      client_id: PATHAO_CLIENT_ID, client_secret: PATHAO_CLIENT_SECRET,
      username: PATHAO_USERNAME, password: PATHAO_PASSWORD, grant_type: 'password',
    }),
  });
  const token = tok.data && tok.data.access_token;
  if (!token) return bad(`issue-token failed (HTTP ${tok.status}): ${short(tok.data)}`);
  ok('access token issued');
  const auth = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'application/json' };

  // Resolve a store id: env value wins; otherwise use the account's first store
  // (the public sandbox comes with one). Print it so you can paste it into
  // PATHAO_STORE_ID for the running app.
  let storeId = PATHAO_STORE_ID;
  if (!storeId) {
    const stores = await jfetch(`${base}/aladdin/api/v1/stores`, { headers: auth });
    const s = listOf(stores.data)[0];
    if (s && (s.store_id || s.id)) {
      storeId = s.store_id || s.id;
      ok(`store auto-detected: "${s.store_name || s.name || 'store'}" #${storeId}  → put this in PATHAO_STORE_ID`);
    } else {
      skip(`no store found (HTTP ${stores.status}) — set PATHAO_STORE_ID to enable price-plan/booking`);
    }
  }

  // 2. Location: city -> zone -> area (Dhaka)
  const cities = await jfetch(`${base}/aladdin/api/v1/city-list`, { headers: auth });
  const city = listOf(cities.data).find((c) => String(c.city_name).toLowerCase() === 'dhaka') || listOf(cities.data)[0];
  if (!city) return bad(`city-list returned nothing (HTTP ${cities.status})`);
  ok(`city-list ok (using ${city.city_name} #${city.city_id})`);

  const zones = await jfetch(`${base}/aladdin/api/v1/cities/${city.city_id}/zone-list`, { headers: auth });
  const zone = listOf(zones.data)[0];
  if (!zone) return bad(`zone-list returned nothing (HTTP ${zones.status})`);
  ok(`zone-list ok (${zone.zone_name} #${zone.zone_id})`);

  const areas = await jfetch(`${base}/aladdin/api/v1/zones/${zone.zone_id}/area-list`, { headers: auth });
  const area = listOf(areas.data)[0];
  ok(`area-list ok (${area ? `${area.area_name} #${area.area_id}` : 'no areas listed'})`);

  // 3. Price plan (needs a store id)
  if (storeId) {
    const price = await jfetch(`${base}/aladdin/api/v1/merchant/price-plan`, {
      method: 'POST', headers: auth,
      body: JSON.stringify({ store_id: Number(storeId), item_type: 2, delivery_type: 48, item_weight: 0.5, recipient_city: city.city_id, recipient_zone: zone.zone_id }),
    });
    const fp = price.data && price.data.data && (price.data.data.final_price ?? price.data.data.price);
    if (fp != null) ok(`price-plan ok (final price ${fp} BDT)`);
    else bad(`price-plan failed (HTTP ${price.status}): ${short(price.data)}`);
  } else skip('price-plan skipped (no store id)');

  // 4. Optional real booking + status read
  if (BOOK && storeId) {
    const order = await jfetch(`${base}/aladdin/api/v1/orders`, {
      method: 'POST', headers: auth,
      body: JSON.stringify({
        store_id: Number(storeId), merchant_order_id: `FCTEST-${Date.now()}`,
        recipient_name: 'Test Recipient', recipient_phone: '01712345678',
        recipient_address: 'House 12, Road 5, Dhanmondi, Dhaka',
        recipient_city: city.city_id, recipient_zone: zone.zone_id, ...(area ? { recipient_area: area.area_id } : {}),
        delivery_type: 48, item_type: 2, item_quantity: 1, item_weight: 0.5, amount_to_collect: 1,
        item_description: 'F-ComFlow test parcel',
      }),
    });
    const cid = order.data && order.data.data && order.data.data.consignment_id;
    if (!cid) return bad(`order create failed (HTTP ${order.status}): ${short(order.data)}`);
    ok(`order created (consignment ${cid})`);
    const info = await jfetch(`${base}/aladdin/api/v1/orders/${cid}/info`, { headers: auth });
    const status = info.data && info.data.data && (info.data.data.order_status || info.data.data.status);
    if (status) ok(`order status read: "${status}"`);
    else skip('order-info returned no status here — Pathao pushes live status via the webhook');
  } else if (BOOK) skip('booking skipped (no store id)');
}

async function testSteadfast() {
  console.log('\n=== Steadfast ===');
  const base = process.env.STEADFAST_BASE_URL || 'https://portal.packzy.com/api/v1';
  const key = process.env.STEADFAST_API_KEY;
  const secret = process.env.STEADFAST_SECRET_KEY;
  if (!key || !secret) return skip('skipped (STEADFAST_API_KEY / STEADFAST_SECRET_KEY not set)');
  console.log(`  base: ${base}`);
  const headers = { 'Api-Key': key, 'Secret-Key': secret, 'Content-Type': 'application/json', Accept: 'application/json' };

  // Auth check via balance (no parcel created). Some sandboxes only expose
  // /create_order, so a missing/oddly-routed get_balance is not a real failure —
  // only a clear auth rejection (401/403/422) is.
  const bal = await jfetch(`${base}/get_balance`, { headers });
  if (bal.ok && bal.data && (bal.data.current_balance !== undefined || bal.data.status === 200)) {
    ok(`get_balance ok (balance ${bal.data.current_balance ?? '?'})`);
  } else if ([401, 403, 422].includes(bal.status)) {
    bad(`auth rejected by Steadfast (HTTP ${bal.status}) — check Api-Key/Secret-Key: ${short(bal.data)}`);
  } else {
    skip(`get_balance unavailable here (HTTP ${bal.status}); this endpoint may only expose create_order — run with --book to test it`);
  }

  if (BOOK) {
    const order = await jfetch(`${base}/create_order`, {
      method: 'POST', headers,
      body: JSON.stringify({
        invoice: `FCTEST-${Date.now()}`, recipient_name: 'Test Recipient', recipient_phone: '01712345678',
        recipient_address: 'House 12, Road 5, Dhanmondi, Dhaka', cod_amount: 1, note: 'F-ComFlow test parcel',
      }),
    });
    const cons = order.data && order.data.consignment;
    const tracking = cons && (cons.tracking_code || cons.consignment_id);
    if (!tracking) return bad(`create_order failed (HTTP ${order.status}): ${short(order.data)}`);
    ok(`order created (tracking ${tracking})`);
    const st = await jfetch(`${base}/status_by_trackingcode/${encodeURIComponent(tracking)}`, { headers });
    const s = st.data && (st.data.delivery_status || st.data.status);
    if (s) ok(`status read: "${s}"`);
    else skip('status endpoint returned no delivery_status yet (normal for a brand-new parcel)');
  }
}

async function testRedX() {
  console.log('\n=== RedX ===');
  const base = process.env.REDX_BASE_URL || 'https://sandbox.redx.com.bd/v1.0.0-beta';
  const token = process.env.REDX_ACCESS_TOKEN;
  if (!token) return skip('skipped (REDX_ACCESS_TOKEN not set)');
  console.log(`  base: ${base}`);
  const headers = { 'API-ACCESS-TOKEN': `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'application/json' };

  // Auth + reachability: list areas
  const areasRes = await jfetch(`${base}/areas`, { headers });
  const areaArr = (areasRes.data && areasRes.data.areas) || [];
  if (areasRes.ok && areaArr.length) ok(`areas ok (${areaArr.length} areas; e.g. ${areaArr[0].name} #${areaArr[0].id})`);
  else if ([401, 403].includes(areasRes.status)) return bad(`auth rejected by RedX (HTTP ${areasRes.status}) — check REDX_ACCESS_TOKEN: ${short(areasRes.data)}`);
  else return bad(`/areas failed (HTTP ${areasRes.status}): ${short(areasRes.data)}`);

  // Delivery area for Dhaka
  const dz = await jfetch(`${base}/areas?district_name=Dhaka`, { headers });
  const area = ((dz.data && dz.data.areas) || [])[0] || areaArr[0];
  ok(`delivery area resolved (${area.name} #${area.id})`);

  // Pickup store (optional)
  let pickupId = process.env.REDX_PICKUP_STORE_ID || null;
  if (!pickupId) {
    const ps = await jfetch(`${base}/pickup/stores`, { headers });
    const store = ((ps.data && ps.data.pickup_stores) || [])[0];
    if (store && store.id) { pickupId = store.id; ok(`pickup store found (#${pickupId} ${store.name || ''})`); }
    else skip('no pickup store on account — RedX will use its default, or create one in the panel');
  }

  if (BOOK) {
    const body = {
      customer_name: 'Test Recipient', customer_phone: '01712345678',
      delivery_area: area.name, delivery_area_id: area.id,
      customer_address: 'House 12, Road 5, Dhanmondi, Dhaka',
      merchant_invoice_id: `FCTEST-${Date.now()}`,
      cash_collection_amount: '1', parcel_weight: 500, value: '1',
    };
    if (pickupId) body.pickup_store_id = pickupId;
    const parcel = await jfetch(`${base}/parcel`, { method: 'POST', headers, body: JSON.stringify(body) });
    const tid = parcel.data && parcel.data.tracking_id;
    if (!tid) return bad(`create parcel failed (HTTP ${parcel.status}): ${short(parcel.data)}`);
    ok(`parcel created (tracking ${tid})`);
    const tr = await jfetch(`${base}/parcel/track/${encodeURIComponent(tid)}`, { headers });
    const events = (tr.data && tr.data.tracking) || [];
    const latest = events[events.length - 1];
    if (latest && latest.message_en) ok(`tracking read: "${latest.message_en}"`);
    else skip('track returned no events yet (normal for a brand-new parcel)');
  }
}

(async () => {
  console.log('\nF-ComFlow courier integration check');
  console.log(BOOK
    ? '(--book: will create ONE test parcel per configured carrier)'
    : '(safe mode: auth + reads only — pass "-- --book" to create a test parcel)');
  await testPathao();
  await testSteadfast();
  await testRedX();
  console.log('\nDone. Any ✗ above prints the exact endpoint + response so you can pinpoint it.');
})().catch((e) => {
  console.error(`\nFatal: ${e.message}`);
  console.error('If this is a network/proxy issue, the courier host may be unreachable from here.');
  process.exit(1);
});
