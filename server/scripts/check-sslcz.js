// SSLCOMMERZ gateway health check — creates a REAL sandbox checkout session
// with your credentials, exactly the way the pay page does.
//
//   npm run sslcz:check
//
// Green result = credentials valid + gateway reachable + our payload accepted.
// Open the printed GatewayPageURL in a browser to see the hosted payment page.
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const BASE = process.env.SSLCZ_BASE_URL || 'https://sandbox.sslcommerz.com';
const ID = process.env.SSLCZ_STORE_ID;
const PW = process.env.SSLCZ_STORE_PASSWD;

if (!ID || !PW) {
  console.error('✗ SSLCZ_STORE_ID / SSLCZ_STORE_PASSWD not set in server/.env');
  process.exit(1);
}

(async () => {
  console.log(`\nTesting SSLCOMMERZ at ${BASE}`);
  console.log(`Store ID: ${ID}\n`);

  const tranId = `FCTEST${Date.now().toString(36).toUpperCase()}`;
  const publicApi = process.env.PUBLIC_API_URL || 'http://localhost:4000';
  const cb = `${publicApi}/api/pay/SELFTEST/sslcz/callback`;

  const body = new URLSearchParams({
    store_id: ID,
    store_passwd: PW,
    total_amount: '420.00',
    currency: 'BDT',
    tran_id: tranId,
    success_url: cb,
    fail_url: `${cb}?outcome=failed`,
    cancel_url: `${cb}?outcome=cancelled`,
    cus_name: 'Self Test',
    cus_email: 'customer@fcomflow.local',
    cus_add1: 'House 12, Dhanmondi',
    cus_city: 'Dhaka',
    cus_country: 'Bangladesh',
    cus_phone: '01712345678',
    shipping_method: 'NO',
    product_name: 'Gateway self-test',
    product_category: 'F-Commerce',
    product_profile: 'general',
  });

  const t0 = Date.now();
  const res = await fetch(`${BASE}/gwprocess/v4/api.php`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  const data = await res.json().catch(() => ({}));

  if (data.status !== 'SUCCESS' || !data.GatewayPageURL) {
    console.error(`✗ Gateway REJECTED the session (${Date.now() - t0}ms)`);
    console.error(`  status: ${data.status || res.status}`);
    console.error(`  reason: ${data.failedreason || 'no reason given'}`);
    console.error('\nUsual causes: typo in store id/password, or the sandbox store is inactive.');
    process.exit(1);
  }

  console.log(`✓ Session created in ${Date.now() - t0}ms  (tran_id ${tranId})`);
  console.log(`✓ Store credentials accepted`);
  console.log(`✓ Available gateways: ${(data.gw && [data.gw.visa && 'cards', data.gw.mobilebanking && 'mobile banking', data.gw.internetbanking && 'net banking'].filter(Boolean).join(', ')) || 'listed on the hosted page'}`);
  console.log(`\n✓ Hosted checkout URL (open in a browser to see the payment page):\n  ${data.GatewayPageURL}`);
  console.log('\nSSLCOMMERZ gateway check PASSED ✅');
  console.log('\nFull end-to-end test: start the app, create a QR invoice on any order,');
  console.log('open its pay link, click the SSLCOMMERZ button, and pay with the test');
  console.log('card 4111 1111 1111 1111 (any future expiry, any CVV, OTP 111111 or as shown).');
})().catch((e) => {
  console.error(`\n✗ Request failed: ${e.message}`);
  console.error('Check your internet connection, or set SSLCZ_BASE_URL if you use a proxy.');
  process.exit(1);
});
