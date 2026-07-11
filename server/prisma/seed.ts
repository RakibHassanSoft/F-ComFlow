// Phase 7: Demo tenant with believable seeded data.
// Run with: npm run db:seed
// Login afterwards with  demo@fcomflow.com / demo1234
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  // Wipe in dependency order so the seed is repeatable
  await prisma.ledgerEntry.deleteMany();
  await prisma.invoice.deleteMany();
  await prisma.orderEvent.deleteMany();
  await prisma.order.deleteMany();
  await prisma.message.deleteMany();
  await prisma.conversation.deleteMany();
  await prisma.customer.deleteMany();
  await prisma.product.deleteMany();
  await prisma.user.deleteMany();
  await prisma.tenant.deleteMany();

  const tenant = await prisma.tenant.create({
    data: {
      businessName: 'Dhaka Trends BD',
      users: {
        create: {
          name: 'Demo Merchant',
          email: 'demo@fcomflow.com',
          passwordHash: await bcrypt.hash('demo1234', 10),
          role: 'OWNER',
        },
      },
    },
  });
  const tenantId = tenant.id;

  // --- Products ---
  const productData = [
    { sku: 'TSH-001', name: 'Premium T-Shirt', price: 550, stockQuantity: 40, reorderThreshold: 10 },
    { sku: 'PNJ-002', name: 'Cotton Panjabi', price: 1450, stockQuantity: 18, reorderThreshold: 5 },
    { sku: 'SRE-003', name: 'Jamdani Saree', price: 3200, stockQuantity: 7, reorderThreshold: 3 },
    { sku: 'WAL-004', name: 'Leather Wallet', price: 850, stockQuantity: 25, reorderThreshold: 8 },
    { sku: 'WCH-005', name: 'Classic Watch', price: 2100, stockQuantity: 2, reorderThreshold: 5 }, // already low!
    { sku: 'BAG-006', name: 'Canvas Backpack', price: 1250, stockQuantity: 15, reorderThreshold: 5 },
  ];
  const products = [];
  for (const p of productData) {
    products.push(await prisma.product.create({ data: { ...p, tenantId } }));
  }

  // --- A conversation ready for the AI-parser demo ---
  const customer1 = await prisma.customer.create({ data: { tenantId, name: 'Karima Akter' } });
  const convo1 = await prisma.conversation.create({
    data: {
      tenantId, customerId: customer1.id, channel: 'MESSENGER', unreadCount: 3,
      // Came from a click-to-Messenger ad — shows on the Ads page
      adId: 'ad-23851002', adTitle: 'Premium Panjabi | Free Dhaka Delivery',
    },
  });
  const chat1 = [
    { direction: 'INBOUND' as const, text: 'Assalamu alaikum, Cotton Panjabi ta ki stock e ache?' },
    { direction: 'OUTBOUND' as const, text: 'Wa alaikum assalam! Ji ache. Price 1450 taka, free delivery Dhaka te 😊' },
    { direction: 'INBOUND' as const, text: 'Ok 2 ta nibo. Amar number 01712345678' },
    { direction: 'INBOUND' as const, text: 'Address: House 12, Road 5, Dhanmondi, Dhaka' },
  ];
  for (const m of chat1) {
    await prisma.message.create({ data: { tenantId, conversationId: convo1.id, ...m } });
  }

  // --- A WhatsApp conversation ---
  const customer2 = await prisma.customer.create({ data: { tenantId, name: 'Tanvir Ahmed' } });
  const convo2 = await prisma.conversation.create({
    data: { tenantId, customerId: customer2.id, channel: 'WHATSAPP', unreadCount: 2 },
  });
  const chat2 = [
    { direction: 'INBOUND' as const, text: 'Hi! Jamdani Saree er details din please' },
    { direction: 'OUTBOUND' as const, text: 'Hello! Original Jamdani, 3200 taka. Ship all over Bangladesh 🇧🇩' },
    { direction: 'INBOUND' as const, text: '1 ta lagbe. My phone 01898765432. Deliver to Village: Char Kaua, Thana: Sadar, Barishal' },
  ];
  for (const m of chat2) {
    await prisma.message.create({ data: { tenantId, conversationId: convo2.id, ...m } });
  }

  // --- Orders in various states for a full-looking dashboard ---
  const customer3 = await prisma.customer.create({ data: { tenantId, name: 'Sajid Hasan', phone: '01911223344' } });

  // Delivered + paid order (with ledger entry)
  const order1 = await prisma.order.create({
    data: {
      tenantId, orderNumber: 1001, status: 'DELIVERED', paymentStatus: 'PAID',
      customerName: 'Sajid Hasan', phone: '01911223344',
      address: 'Flat 3B, GEC Circle, Nasirabad', district: 'Chattogram',
      productId: products[0].id, quantity: 2, unitPrice: 550, totalAmount: 1100,
      customerId: customer3.id, riskScore: 22, riskLevel: 'LOW',
      courierName: 'Pathao', trackingCode: 'PTH-1001-DEMO01', courierStatus: 'Delivered',
      events: {
        create: [
          { tenantId, type: 'CREATED', note: 'Draft order created' },
          { tenantId, type: 'CONFIRMED', note: 'Order confirmed — 2 unit(s) reserved from stock' },
          { tenantId, type: 'RISK_SCORED', note: 'COD risk: 22% (LOW)' },
          { tenantId, type: 'DISPATCHED', note: 'Booked with Pathao — tracking PTH-1001-DEMO01' },
          { tenantId, type: 'PAYMENT', note: 'Payment received: ৳1100.00 — fee ৳11.00 + VAT ৳1.65, net ৳1087.35' },
          { tenantId, type: 'DELIVERED', note: 'Package delivered to customer' },
        ],
      },
    },
  });
  const inv1 = await prisma.invoice.create({
    data: {
      tenantId, orderId: order1.id, type: 'FULL', status: 'PAID',
      amount: 1100, transactionId: 'SSLCZ-DEMO-0001', paidAt: new Date(),
    },
  });
  await prisma.ledgerEntry.create({
    data: { tenantId, orderId: order1.id, invoiceId: inv1.id, gross: 1100, fee: 11, vat: 1.65, net: 1087.35 },
  });

  // Confirmed order waiting for courier booking
  await prisma.order.create({
    data: {
      tenantId, orderNumber: 1002, status: 'CONFIRMED', paymentStatus: 'UNPAID',
      customerName: 'Nusrat Jahan', phone: '01655667788',
      address: 'House 45, Zindabazar Point', district: 'Sylhet',
      productId: products[3].id, quantity: 1, unitPrice: 850, totalAmount: 850,
      riskScore: 41, riskLevel: 'MEDIUM',
      events: {
        create: [
          { tenantId, type: 'CREATED', note: 'Draft order created' },
          { tenantId, type: 'CONFIRMED', note: 'Order confirmed — 1 unit(s) reserved from stock' },
          { tenantId, type: 'RISK_SCORED', note: 'COD risk: 41% (MEDIUM) — New customer — no delivery history' },
        ],
      },
    },
  });

  // High-risk confirmed order — shows the advance-payment banner (Phase 7)
  await prisma.order.create({
    data: {
      tenantId, orderNumber: 1003, status: 'CONFIRMED', paymentStatus: 'UNPAID',
      customerName: 'Mitu Rani', phone: '01344556677',
      address: 'College para', district: 'Rangpur',
      productId: products[4].id, quantity: 1, unitPrice: 2100, totalAmount: 2100,
      riskScore: 72, riskLevel: 'HIGH',
      events: {
        create: [
          { tenantId, type: 'CREATED', note: 'Draft order created' },
          { tenantId, type: 'CONFIRMED', note: 'Order confirmed — 1 unit(s) reserved from stock' },
          { tenantId, type: 'RISK_SCORED', note: 'COD risk: 72% (HIGH) — Address looks incomplete; New customer — no delivery history; Rangpur has a higher COD return rate' },
        ],
      },
    },
  });

  console.log('✅ Seed complete!');
  console.log('   Login: demo@fcomflow.com / demo1234');
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
