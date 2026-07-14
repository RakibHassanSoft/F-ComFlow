// Phase 2: Unified inbox API.
// Every query filters by req.tenantId — the tenant-isolation rule.
import { Router } from 'express';
import { prisma } from '../lib/prisma';
import { requireAuth } from '../middleware/auth';
import { emitToTenant } from '../lib/socket';
import { simulateIncomingConversation } from '../services/simulator';
import { sendOutbound } from '../services/channels';
import { ApiError } from '../lib/errors';
import { productPitch } from '../services/notifications';

const router = Router();
router.use(requireAuth); // everything below needs a logged-in user

// GET /api/inbox/conversations — list, newest activity first
router.get('/conversations', async (req, res, next) => {
  try {
    const conversations = await prisma.conversation.findMany({
      where: { tenantId: req.tenantId },
      include: {
        customer: true,
        messages: { orderBy: { createdAt: 'desc' }, take: 1 }, // preview = last message
      },
      orderBy: { lastMessageAt: 'desc' },
    });
    res.json(conversations);
  } catch (err) { next(err); }
});

// GET /api/inbox/conversations/:id/messages — full thread
router.get('/conversations/:id/messages', async (req, res, next) => {
  try {
    const conversation = await prisma.conversation.findFirst({
      where: { id: req.params.id, tenantId: req.tenantId }, // 404 if it belongs to another tenant
      include: { customer: true },
    });
    if (!conversation) throw new ApiError(404, 'Conversation not found');

    const messages = await prisma.message.findMany({
      where: { conversationId: conversation.id, tenantId: req.tenantId },
      orderBy: { createdAt: 'asc' },
    });

    // Opening a thread marks it read
    await prisma.conversation.update({ where: { id: conversation.id }, data: { unreadCount: 0 } });
    res.json({ conversation, messages });
  } catch (err) { next(err); }
});

// POST /api/inbox/conversations/:id/reply — merchant sends a message.
// Saved + broadcast locally ALWAYS; then, if the customer came in through a
// real connected channel, the reply is also sent out via the Graph/WhatsApp
// API. A delivery failure never loses the reply.
router.post('/conversations/:id/reply', async (req, res, next) => {
  try {
    const { text } = req.body;
    if (!text?.trim()) throw new ApiError(400, 'Message text is required');

    const conversation = await prisma.conversation.findFirst({
      where: { id: req.params.id, tenantId: req.tenantId },
      include: { customer: true },
    });
    if (!conversation) throw new ApiError(404, 'Conversation not found');

    const message = await prisma.message.create({
      data: { tenantId: req.tenantId, conversationId: conversation.id, direction: 'OUTBOUND', text: text.trim() },
    });
    await prisma.conversation.update({
      where: { id: conversation.id },
      data: { lastMessageAt: new Date() },
    });

    // Both agents of the same tenant see the reply instantly
    emitToTenant(req.tenantId, 'message:new', { conversationId: conversation.id, message });

    // Real customers (they have a platform ID) also get the reply on their app
    let delivery: { delivered: boolean; detail: string } | null = null;
    if (conversation.customer.externalId) {
      delivery = await sendOutbound(
        req.tenantId,
        conversation.channel,
        conversation.customer.externalId,
        text.trim()
      );
    }

    res.status(201).json({ ...message, delivery });
  } catch (err) { next(err); }
});

// POST /api/inbox/conversations/:id/assign — claim a conversation
// so two agents don't answer the same customer.
router.post('/conversations/:id/assign', async (req, res, next) => {
  try {
    const conversation = await prisma.conversation.findFirst({
      where: { id: req.params.id, tenantId: req.tenantId },
    });
    if (!conversation) throw new ApiError(404, 'Conversation not found');
    if (conversation.assignedTo && conversation.assignedTo !== req.userId) {
      throw new ApiError(409, 'Already assigned to another agent');
    }

    const updated = await prisma.conversation.update({
      where: { id: conversation.id },
      data: { assignedTo: req.userId },
    });
    emitToTenant(req.tenantId, 'conversation:assigned', updated);
    res.json(updated);
  } catch (err) { next(err); }
});

// GET /api/inbox/conversations/:id/customer — profile + order history shown
// next to the chat, so the agent knows who they're talking to at a glance.
router.get('/conversations/:id/customer', async (req, res, next) => {
  try {
    const conversation = await prisma.conversation.findFirst({
      where: { id: req.params.id, tenantId: req.tenantId },
      include: { customer: true },
    });
    if (!conversation) throw new ApiError(404, 'Conversation not found');

    const orders = conversation.customerId
      ? await prisma.order.findMany({
          where: { tenantId: req.tenantId, customerId: conversation.customerId },
          orderBy: { createdAt: 'desc' },
          include: { items: { include: { product: true } } },
        })
      : [];

    const finished = orders.filter((o: any) => o.status === 'DELIVERED' || o.status === 'RETURNED');
    const returned = finished.filter((o: any) => o.status === 'RETURNED').length;
    const totalSpent = orders
      .filter((o: any) => o.paymentStatus === 'PAID')
      .reduce((s: number, o: any) => s + Number(o.totalAmount), 0);

    res.json({
      customer: conversation.customer,
      stats: {
        totalOrders: orders.length,
        deliveredOrReturned: finished.length,
        returnRate: finished.length ? Math.round((returned / finished.length) * 100) : 0,
        totalSpent,
      },
      orders,
    });
  } catch (err) { next(err); }
});

// POST /api/inbox/conversations/:id/send-product  { productId, quantity? }
// One-click: drop a product's name + price into the chat.
router.post('/conversations/:id/send-product', async (req, res, next) => {
  try {
    const { productId, quantity } = req.body;
    const conversation = await prisma.conversation.findFirst({
      where: { id: req.params.id, tenantId: req.tenantId },
      include: { customer: true },
    });
    if (!conversation) throw new ApiError(404, 'Conversation not found');

    const product = await prisma.product.findFirst({ where: { id: productId, tenantId: req.tenantId } });
    if (!product) throw new ApiError(404, 'Product not found');

    const text = productPitch(product.name, Number(product.price), Number(quantity) || undefined);
    const message = await prisma.message.create({
      data: { tenantId: req.tenantId, conversationId: conversation.id, direction: 'OUTBOUND', text },
    });
    await prisma.conversation.update({ where: { id: conversation.id }, data: { lastMessageAt: new Date() } });
    emitToTenant(req.tenantId, 'message:new', { conversationId: conversation.id, message });

    let delivery: { delivered: boolean; detail: string } | null = null;
    if (conversation.customer.externalId) {
      delivery = await sendOutbound(req.tenantId, conversation.channel, conversation.customer.externalId, text);
    }
    res.status(201).json({ ...message, delivery });
  } catch (err) { next(err); }
});

// POST /api/inbox/simulate — DEMO: generate an incoming customer conversation.
// Stands in for the Meta/WhatsApp webhook -> queue -> worker pipeline.
router.post('/simulate', async (req, res, next) => {
  try {
    const conversation = await simulateIncomingConversation(req.tenantId);
    res.status(201).json(conversation);
  } catch (err) { next(err); }
});

export default router;
