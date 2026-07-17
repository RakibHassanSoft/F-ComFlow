// Message simulator — generates fake Banglish chats for demos/testing.
import { prisma } from '../lib/prisma';
import { emitToTenant } from '../lib/socket';

type Channel = 'MESSENGER' | 'INSTAGRAM' | 'WHATSAPP';

const NAMES = ['Rahim Uddin', 'Karima Akter', 'Sajid Hasan', 'Nusrat Jahan', 'Tanvir Ahmed', 'Mitu Rani', 'Fahim Chowdhury', 'Sadia Islam'];

const PHONES = ['01712345678', '01898765432', '01911223344', '01655667788', '01344556677', '01755443322'];

const ADDRESSES = [
  { address: 'House 12, Road 5, Dhanmondi', district: 'Dhaka' },
  { address: 'Flat 3B, GEC Circle, Nasirabad', district: 'Chattogram' },
  { address: 'Village: Char Kaua, Thana: Sadar', district: 'Barishal' },
  { address: 'House 45, Zindabazar Point', district: 'Sylhet' },
  { address: 'Shib bari more, Sonadanga', district: 'Khulna' },
  { address: 'College para, Station road', district: 'Rangpur' },
];

// {product} and {qty} get filled from the tenant's real catalog
const CHAT_SCRIPTS = [
  ['Assalamu alaikum, {product} ta ki stock e ache?', 'Dam koto vaia?', 'Ok {qty} ta nibo. Amar number {phone}. Address: {address}, {district}'],
  ['Hi! I want to order {product}', 'Please send {qty} pcs', 'My phone {phone}, deliver to {address}, {district}'],
  ['{product} er picture dekhe valo laglo', '{qty} ta lagbe. Cash on delivery hobe?', 'Number: {phone}. Thikana: {address}, {district}'],
  ['Vaia {product} ki original?', 'Thik ache, {qty} ta pathan. {phone} e call diyen', 'Address dilam: {address}, {district}'],
];

const CHANNELS: Channel[] = ['MESSENGER', 'INSTAGRAM', 'WHATSAPP'];

// Demo click-to-ad pool: ~60% of simulated chats carry one of these so the
// Ads attribution page has data. Defined once at module scope, not per call.
const FAKE_ADS = [
  { id: 'ad-23851001', title: 'Eid Collection — 20% OFF 🎉' },
  { id: 'ad-23851002', title: 'Premium Panjabi | Free Dhaka Delivery' },
  { id: 'ad-23851003', title: 'New Arrivals — Order on Messenger' },
];

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

// Create a full simulated conversation (customer + messages) for a tenant.
// Returns the conversation so the API can respond with it.
export async function simulateIncomingConversation(tenantId: string) {
  // Use a real product from this tenant so the AI parser can match it later
  const products: { name: string }[] = await prisma.product.findMany({ where: { tenantId } });
  const productName = products.length > 0 ? pick(products).name : 'Premium T-Shirt';

  const name = pick(NAMES);
  const phone = pick(PHONES);
  const location = pick(ADDRESSES);
  const qty = Math.floor(Math.random() * 3) + 1;
  const channel = pick(CHANNELS);
  const script = pick(CHAT_SCRIPTS);

  const customer = await prisma.customer.create({
    data: { tenantId, name, phone: null }, // phone is only known once the AI extracts it
  });

  // Roughly 60% of f-commerce chats start from a click-to-ad; attach one so the
  // Ads attribution page (Messenger/Instagram/WhatsApp) always has demo data.
  const ad = Math.random() < 0.6 ? FAKE_ADS[Math.floor(Math.random() * FAKE_ADS.length)] : null;

  const conversation = await prisma.conversation.create({
    data: {
      tenantId, customerId: customer.id, channel, unreadCount: script.length,
      adId: ad?.id ?? null, adTitle: ad?.title ?? null,
    },
    include: { customer: true },
  });

  // Insert each line of the script as an inbound message
  for (const line of script) {
    const text = line
      .replace('{product}', productName)
      .replace('{qty}', String(qty))
      .replace('{phone}', phone)
      .replace('{address}', location.address)
      .replace('{district}', location.district);

    const message = await prisma.message.create({
      data: { tenantId, conversationId: conversation.id, direction: 'INBOUND', text },
    });
    // Phase 2 exit gate: message appears live on the dashboard — no refresh
    emitToTenant(tenantId, 'message:new', { conversationId: conversation.id, message });
  }

  await prisma.conversation.update({
    where: { id: conversation.id },
    data: { lastMessageAt: new Date() },
  });

  emitToTenant(tenantId, 'conversation:new', conversation);
  return conversation;
}
