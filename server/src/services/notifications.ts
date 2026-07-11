// Customer-facing automatic messages: order status updates, product pitches,
// and the out-of-hours away reply. Pure formatters live here (unit-tested);
// the send helpers persist a message + push it out through the real channel.
import { prisma } from '../lib/prisma';
import { emitToTenant } from '../lib/socket';
import { sendOutbound, type ChannelType } from './channels';
import { orderStatusMessage as _fmtStatus } from './message-format';

// ---------- pure formatters (no DB, easily testable) ----------

export { orderStatusMessage, productPitch } from './message-format';
export { isWithinBusinessHours } from '../lib/time';

// ---------- send helpers (persist + deliver) ----------

// Post a message to the customer of a given order: find their chat thread,
// store it as an OUTBOUND message, push it live to the dashboard, and deliver
// it through the real channel if the customer has a platform id.
// Best-effort: any failure is swallowed (never breaks the caller). Returns the
// conversation id it posted to, or null if there was no thread to reach.
export async function sendToOrderCustomer(order: {
  tenantId: string; customerId?: string | null; conversationId?: string | null;
}, text: string): Promise<string | null> {
  try {
    let conversation = order.conversationId
      ? await prisma.conversation.findFirst({ where: { id: order.conversationId, tenantId: order.tenantId }, include: { customer: true } })
      : null;
    if (!conversation && order.customerId) {
      conversation = await prisma.conversation.findFirst({
        where: { tenantId: order.tenantId, customerId: order.customerId },
        orderBy: { lastMessageAt: 'desc' },
        include: { customer: true },
      });
    }
    if (!conversation) return null;

    const message = await prisma.message.create({
      data: { tenantId: order.tenantId, conversationId: conversation.id, direction: 'OUTBOUND', text },
    });
    await prisma.conversation.update({ where: { id: conversation.id }, data: { lastMessageAt: new Date() } });
    emitToTenant(order.tenantId, 'message:new', { conversationId: conversation.id, message });

    if (conversation.customer?.externalId) {
      await sendOutbound(order.tenantId, conversation.channel as ChannelType, conversation.customer.externalId, text);
    }
    return conversation.id;
  } catch (e) {
    console.warn('[notify] send to customer failed:', (e as Error).message);
    return null;
  }
}

// Notify the customer that their order changed status (respects the tenant's
// autoStatusMessages toggle). Best-effort.
export async function notifyOrderStatus(order: {
  id: string; tenantId: string; orderNumber: number;
  customerId?: string | null; conversationId?: string | null;
}, status: string): Promise<void> {
  const tenant = await prisma.tenant.findUnique({ where: { id: order.tenantId } });
  if (!tenant?.autoStatusMessages) return;
  const text = _fmtStatus(order.orderNumber, status);
  if (!text) return;
  await sendToOrderCustomer(order, text);
}
