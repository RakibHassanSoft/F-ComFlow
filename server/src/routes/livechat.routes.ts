// Website chat widget — public send/poll endpoints + the embeddable widget.js.
import { Router } from 'express';
import cors from 'cors';
import { prisma } from '../lib/prisma';
import { emitToTenant } from '../lib/socket';
import { ApiError } from '../lib/errors';

const router = Router();
router.use(cors({ origin: true })); // widget runs on any merchant website

// Find (or create) the visitor's customer + conversation for this tenant
async function getThread(tenantId: string, visitorId: string, visitorName?: string) {
  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
  if (!tenant) throw new ApiError(404, 'Unknown store');

  let customer = await prisma.customer.findFirst({
    where: { tenantId, externalId: visitorId },
  });
  if (!customer) {
    customer = await prisma.customer.create({
      data: { tenantId, name: visitorName || 'Website visitor', externalId: visitorId },
    });
  }

  let conversation = await prisma.conversation.findFirst({
    where: { tenantId, customerId: customer.id, channel: 'WEBCHAT' },
  });
  if (!conversation) {
    conversation = await prisma.conversation.create({
      data: { tenantId, customerId: customer.id, channel: 'WEBCHAT', unreadCount: 0 },
      include: { customer: true },
    });
    emitToTenant(tenantId, 'conversation:new', conversation);
  }
  return conversation;
}

// Visitor sends a message
router.post('/:tenantId/messages', async (req, res, next) => {
  try {
    const { visitorId, visitorName, text } = req.body;
    if (!visitorId || !text?.trim()) throw new ApiError(400, 'visitorId and text are required');

    const conversation = await getThread(req.params.tenantId, String(visitorId), visitorName);
    const message = await prisma.message.create({
      data: {
        tenantId: req.params.tenantId,
        conversationId: conversation.id,
        direction: 'INBOUND',
        text: String(text).slice(0, 2000),
      },
    });
    await prisma.conversation.update({
      where: { id: conversation.id },
      data: { lastMessageAt: new Date(), unreadCount: { increment: 1 } },
    });
    emitToTenant(req.params.tenantId, 'message:new', { conversationId: conversation.id, message });
    res.status(201).json({ ok: true });
  } catch (err) { next(err); }
});

// Visitor polls the thread (both directions, so refreshes keep history)
router.get('/:tenantId/messages', async (req, res, next) => {
  try {
    const visitorId = String(req.query.visitorId || '');
    if (!visitorId) throw new ApiError(400, 'visitorId is required');

    const customer = await prisma.customer.findFirst({
      where: { tenantId: req.params.tenantId, externalId: visitorId },
    });
    if (!customer) return res.json([]);

    const conversation = await prisma.conversation.findFirst({
      where: { tenantId: req.params.tenantId, customerId: customer.id, channel: 'WEBCHAT' },
    });
    if (!conversation) return res.json([]);

    const messages = await prisma.message.findMany({
      where: { conversationId: conversation.id },
      orderBy: { createdAt: 'asc' },
      take: 100,
    });
    res.json(messages.map((m: any) => ({ id: m.id, direction: m.direction, text: m.text })));
  } catch (err) { next(err); }
});

// The embeddable widget script — plain JavaScript, no dependencies.
router.get('/widget.js', (_req, res) => {
  res.type('application/javascript').send(WIDGET_JS);
});

const WIDGET_JS = `
(function () {
  var script = document.currentScript;
  var TENANT = script.getAttribute('data-tenant');
  var API = script.src.replace(/\\/api\\/livechat\\/widget\\.js.*/, '');
  if (!TENANT) { console.warn('[fcomflow] missing data-tenant'); return; }

  // A stable anonymous id per browser
  var VISITOR = localStorage.getItem('fcf_visitor');
  if (!VISITOR) { VISITOR = 'web_' + Math.random().toString(36).slice(2, 12); localStorage.setItem('fcf_visitor', VISITOR); }

  // ---- styles ----
  var css = '#fcf-bubble{position:fixed;bottom:20px;right:20px;width:56px;height:56px;border-radius:50%;background:#4f46e5;color:#fff;border:none;cursor:pointer;font-size:24px;box-shadow:0 8px 24px rgba(0,0,0,.25);z-index:99998}' +
    '#fcf-panel{position:fixed;bottom:88px;right:20px;width:320px;height:420px;background:#fff;border-radius:16px;box-shadow:0 12px 40px rgba(0,0,0,.25);display:none;flex-direction:column;overflow:hidden;z-index:99999;font-family:system-ui,sans-serif}' +
    '#fcf-head{background:#4f46e5;color:#fff;padding:14px 16px;font-weight:700;font-size:14px}' +
    '#fcf-msgs{flex:1;overflow-y:auto;padding:12px;background:#f8fafc;display:flex;flex-direction:column;gap:6px}' +
    '.fcf-m{max-width:80%;padding:8px 12px;border-radius:14px;font-size:13px;line-height:1.4}' +
    '.fcf-in{align-self:flex-end;background:#4f46e5;color:#fff;border-bottom-right-radius:4px}' +
    '.fcf-out{align-self:flex-start;background:#fff;border:1px solid #e2e8f0;border-bottom-left-radius:4px}' +
    '#fcf-form{display:flex;gap:6px;padding:10px;border-top:1px solid #e2e8f0}' +
    '#fcf-input{flex:1;border:1px solid #cbd5e1;border-radius:10px;padding:8px 12px;font-size:13px;outline:none}' +
    '#fcf-send{background:#4f46e5;color:#fff;border:none;border-radius:10px;padding:8px 14px;font-size:13px;cursor:pointer}';
  var style = document.createElement('style'); style.textContent = css; document.head.appendChild(style);

  // ---- elements ----
  var bubble = document.createElement('button'); bubble.id = 'fcf-bubble'; bubble.textContent = '💬';
  var panel = document.createElement('div'); panel.id = 'fcf-panel';
  panel.innerHTML = '<div id="fcf-head">Chat with us</div><div id="fcf-msgs"></div>' +
    '<form id="fcf-form"><input id="fcf-input" placeholder="Type a message…"><button id="fcf-send" type="submit">Send</button></form>';
  document.body.appendChild(bubble); document.body.appendChild(panel);

  var open = false;
  bubble.onclick = function () { open = !open; panel.style.display = open ? 'flex' : 'none'; if (open) load(); };

  var msgs = panel.querySelector('#fcf-msgs');
  function render(list) {
    msgs.innerHTML = '';
    list.forEach(function (m) {
      var d = document.createElement('div');
      // visitor's own messages are INBOUND (into the shop) -> right side
      d.className = 'fcf-m ' + (m.direction === 'INBOUND' ? 'fcf-in' : 'fcf-out');
      d.textContent = m.text;
      msgs.appendChild(d);
    });
    msgs.scrollTop = msgs.scrollHeight;
  }

  function load() {
    fetch(API + '/api/livechat/' + TENANT + '/messages?visitorId=' + VISITOR)
      .then(function (r) { return r.json(); }).then(render).catch(function () {});
  }
  setInterval(function () { if (open) load(); }, 3000); // poll every 3s while open

  panel.querySelector('#fcf-form').addEventListener('submit', function (e) {
    e.preventDefault();
    var input = panel.querySelector('#fcf-input');
    var text = input.value.trim(); if (!text) return;
    input.value = '';
    fetch(API + '/api/livechat/' + TENANT + '/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ visitorId: VISITOR, text: text })
    }).then(load);
  });
})();
`;

export default router;
