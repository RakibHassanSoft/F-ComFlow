// Phase 3: AI endpoints — parse a conversation into a draft order.
// Includes the per-tenant daily quota from the guide (controls API cost).
import { Router } from 'express';
import { prisma } from '../lib/prisma';
import { requireAuth } from '../middleware/auth';
import { parseOrderFromChat } from '../services/aiParser';
import { ApiError } from '../lib/errors';

const router = Router();
router.use(requireAuth);

// --- Per-tenant daily AI quota (in-memory; Redis in production) ---
const DAILY_QUOTA = 200;
const usage = new Map<string, { count: number; day: string }>();

function checkQuota(tenantId: string) {
  const today = new Date().toDateString();
  const entry = usage.get(tenantId);
  if (!entry || entry.day !== today) {
    usage.set(tenantId, { count: 1, day: today });
    return;
  }
  entry.count++;
  if (entry.count > DAILY_QUOTA) {
    throw new ApiError(429, `Daily AI quota reached (${DAILY_QUOTA} calls). Try again tomorrow.`);
  }
}

// POST /api/ai/parse-order  { conversationId }
// Returns extracted fields + confidence flags. NEVER crashes on bad input —
// failure modes return a structured error the UI can show (Phase 3 exit gate).
router.post('/parse-order', async (req, res, next) => {
  try {
    checkQuota(req.tenantId);

    const { conversationId } = req.body;
    const conversation = await prisma.conversation.findFirst({
      where: { id: conversationId, tenantId: req.tenantId },
      include: { customer: true, messages: { orderBy: { createdAt: 'asc' } } },
    });
    if (!conversation) throw new ApiError(404, 'Conversation not found');

    // Only what the CUSTOMER said goes to the parser
    const chatText = conversation.messages
      .filter((m: { direction: string }) => m.direction === 'INBOUND')
      .map((m: { text: string }) => m.text)
      .join('\n');

    if (!chatText.trim()) {
      throw new ApiError(422, 'No customer messages to parse — ask the customer for order details first.');
    }

    // Simulate real AI latency so the UI's loading state is honest (~0.8s)
    await new Promise((r) => setTimeout(r, 800));

    const parsed = await parseOrderFromChat(req.tenantId, chatText, conversation.customer.name);
    res.json(parsed);
  } catch (err) { next(err); }
});

export default router;
