// Phase 2 + 3: Unified Inbox.
// Left: conversation list (channel, unread badge, last message)
// Middle: thread view with reply box, quick-replies, send-product, live socket,
//         plus the "Extract Order with AI" button (Phase 3).
// Right: customer info panel (past orders, return rate).
'use client';
import { useEffect, useState, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { MessageSquare, Sparkles, Send, UserCheck, Radio, Zap, Package, User } from 'lucide-react';
import { api } from '@/lib/api';
import { getSocket } from '@/lib/socket';
import { timeAgo, money } from '@/lib/format';
import { Badge, Button, Card, EmptyState, Field, Modal, PageHeader } from '@/components/ui';
import { useSession } from '@/lib/session';

interface Customer { id: string; name: string }
interface Message { id: string; direction: 'INBOUND' | 'OUTBOUND'; text: string; createdAt: string }
interface Conversation {
  id: string; channel: string; unreadCount: number; lastMessageAt: string;
  assignedTo: string | null; customer: Customer; messages?: Message[];
}
interface Parsed {
  customerName: string | null; phone: string | null; address: string | null;
  district: string | null; productId: string | null; productName: string | null;
  quantity: number; lowConfidence: Record<string, boolean>;
}
interface Template { id: string; title: string; body: string }
interface Product { id: string; name: string; price: string }
interface CustomerInfo {
  customer: { id: string; name: string; phone: string | null };
  stats: { totalOrders: number; deliveredOrReturned: number; returnRate: number; totalSpent: number };
  orders: { id: string; orderNumber: number; status: string; totalAmount: string; product: { name: string } }[];
}

export default function InboxPage() {
  const session = useSession();
  const router = useRouter();
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selected, setSelected] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [reply, setReply] = useState('');
  const [simulating, setSimulating] = useState(false);

  // AI parse state (Phase 3)
  const [parsing, setParsing] = useState(false);
  const [parsed, setParsed] = useState<Parsed | null>(null);
  const [parseError, setParseError] = useState('');
  const [creating, setCreating] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  // New features
  const [templates, setTemplates] = useState<Template[]>([]);
  const [showTemplates, setShowTemplates] = useState(false);
  const [products, setProducts] = useState<Product[]>([]);
  const [showProducts, setShowProducts] = useState(false);
  const [customerInfo, setCustomerInfo] = useState<CustomerInfo | null>(null);

  const loadConversations = useCallback(() => {
    api.get('/inbox/conversations').then(setConversations).catch(console.error);
  }, []);

  useEffect(() => { loadConversations(); }, [loadConversations]);

  // Load quick-reply templates + products once (used by the compose bar)
  useEffect(() => {
    api.get('/templates').then(setTemplates).catch(() => {});
    api.get('/products').then(setProducts).catch(() => {});
  }, []);

  // Live updates: new messages & conversations arrive over the socket
  useEffect(() => {
    const socket = getSocket();
    const onMessage = (data: { conversationId: string; message: Message }) => {
      setMessages((prev) =>
        selected && data.conversationId === selected.id ? [...prev, data.message] : prev
      );
      loadConversations();
    };
    const onConversation = () => loadConversations();
    socket.on('message:new', onMessage);
    socket.on('conversation:new', onConversation);
    socket.on('conversation:assigned', onConversation);
    return () => {
      socket.off('message:new', onMessage);
      socket.off('conversation:new', onConversation);
      socket.off('conversation:assigned', onConversation);
    };
  }, [selected, loadConversations]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  async function openConversation(c: Conversation) {
    setSelected(c);
    setParsed(null);
    setParseError('');
    setCustomerInfo(null);
    const data = await api.get(`/inbox/conversations/${c.id}/messages`);
    setMessages(data.messages);
    loadConversations(); // refresh unread badges
    api.get(`/inbox/conversations/${c.id}/customer`).then(setCustomerInfo).catch(() => {});
  }

  // Quick-reply variables: {customer}, {shop}, {agent} filled at insert time,
  // using the first name for a natural chat tone.
  function fillTemplate(body: string): string {
    return body
      .replace(/\{customer\}/gi, selected?.customer.name.split(' ')[0] || 'there')
      .replace(/\{shop\}/gi, session.tenant.businessName)
      .replace(/\{agent\}/gi, session.user.name.split(' ')[0]);
  }

  async function sendReply(e: React.FormEvent) {
    e.preventDefault();
    if (!reply.trim() || !selected) return;
    const text = reply;
    setReply('');
    await api.post(`/inbox/conversations/${selected.id}/reply`, { text });
  }

  async function sendProduct(productId: string) {
    if (!selected) return;
    setShowProducts(false);
    await api.post(`/inbox/conversations/${selected.id}/send-product`, { productId });
  }

  // DEMO: stands in for a real Meta/WhatsApp webhook
  async function simulate() {
    setSimulating(true);
    try { await api.post('/inbox/simulate'); } finally { setSimulating(false); }
  }

  async function assignToMe() {
    if (!selected) return;
    const updated = await api.post(`/inbox/conversations/${selected.id}/assign`);
    setSelected({ ...selected, assignedTo: updated.assignedTo });
  }

  // Phase 3: one click -> AI reads the chat -> editable draft order form
  async function extractOrder() {
    if (!selected) return;
    setParsing(true);
    setParseError('');
    try {
      const result = await api.post('/ai/parse-order', { conversationId: selected.id });
      setParsed(result);
    } catch (err: any) {
      setParseError(err.message); // graceful failure: readable error, manual entry still possible
    } finally {
      setParsing(false);
    }
  }

  async function createDraftOrder() {
    if (!parsed || !selected) return;
    setCreating(true);
    try {
      const order = await api.post('/orders', {
        customerName: parsed.customerName,
        phone: parsed.phone,
        address: parsed.address,
        district: parsed.district,
        productId: parsed.productId,
        quantity: parsed.quantity,
        conversationId: selected.id,
        customerId: selected.customer.id,
      });
      router.push(`/dashboard/orders/${order.id}`);
    } catch (err: any) {
      setParseError(err.message);
      setCreating(false);
    }
  }

  return (
    <div>
      <PageHeader
        title="Unified Inbox"
        subtitle="Messenger, Instagram and WhatsApp — one place."
        action={
          <Button onClick={simulate} loading={simulating} variant="secondary">
            <Radio size={15} /> Simulate incoming message
          </Button>
        }
      />

      <div className="flex flex-col gap-4 lg:h-[calc(100vh-180px)] lg:flex-row">
        {/* ---------- Conversation list ---------- */}
        <Card className="max-h-60 w-full shrink-0 overflow-y-auto lg:max-h-none lg:w-72">
          {conversations.length === 0 ? (
            <EmptyState icon={<MessageSquare size={22} />} title="No conversations yet"
              hint='Press "Simulate incoming message" to receive a customer chat.' />
          ) : (
            conversations.map((c) => (
              <button
                key={c.id}
                onClick={() => openConversation(c)}
                className={`block w-full border-b border-slate-100 px-4 py-3 text-left transition hover:bg-slate-50
                  ${selected?.id === c.id ? 'bg-indigo-50/60' : ''}`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate font-medium">{c.customer.name}</span>
                  <span className="shrink-0 text-xs text-slate-400">{timeAgo(c.lastMessageAt)}</span>
                </div>
                <div className="mt-1 flex items-center justify-between gap-2">
                  <p className="truncate text-sm text-slate-500">{c.messages?.[0]?.text || '…'}</p>
                  {c.unreadCount > 0 && (
                    <span className="flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-indigo-600 px-1.5 text-[11px] font-bold text-white">
                      {c.unreadCount}
                    </span>
                  )}
                </div>
                <div className="mt-1.5"><Badge label={c.channel} /></div>
              </button>
            ))
          )}
        </Card>

        {/* ---------- Thread ---------- */}
        <Card className="flex min-h-[440px] flex-1 flex-col overflow-hidden">
          {!selected ? (
            <EmptyState icon={<MessageSquare size={22} />} title="Select a conversation"
              hint="Pick a chat on the left to read and reply." />
          ) : (
            <>
              {/* Thread header */}
              <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3">
                <div>
                  <p className="font-semibold">{selected.customer.name}</p>
                  <div className="mt-0.5 flex items-center gap-2">
                    <Badge label={selected.channel} />
                    {selected.assignedTo && (
                      <span className="text-xs text-slate-500">
                        {selected.assignedTo === session.user.id ? 'Assigned to you' : 'Assigned to a teammate'}
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex gap-2">
                  {!selected.assignedTo && (
                    <Button variant="secondary" onClick={assignToMe}><UserCheck size={15} /> Claim</Button>
                  )}
                  <Button onClick={extractOrder} loading={parsing}>
                    <Sparkles size={15} /> {parsing ? 'AI is reading the chat…' : 'Extract Order'}
                  </Button>
                </div>
              </div>

              {/* Messages */}
              <div className="flex-1 space-y-2.5 overflow-y-auto bg-slate-50/60 p-5">
                {messages.map((m) => (
                  <div key={m.id} className={`flex ${m.direction === 'OUTBOUND' ? 'justify-end' : 'justify-start'}`}>
                    <div className={`max-w-[70%] whitespace-pre-wrap rounded-2xl px-4 py-2.5 text-sm shadow-sm
                      ${m.direction === 'OUTBOUND'
                        ? 'rounded-br-md bg-indigo-600 text-white'
                        : 'rounded-bl-md border border-slate-200 bg-white'}`}>
                      {m.text}
                    </div>
                  </div>
                ))}
                <div ref={bottomRef} />
              </div>

              {parseError && (
                <p className="border-t border-red-100 bg-red-50 px-5 py-2 text-sm text-red-600">{parseError}</p>
              )}

              {/* Quick actions */}
              <div className="flex items-center gap-2 border-t border-slate-100 px-4 pt-3">
                <Button variant="secondary" onClick={() => setShowTemplates(true)}>
                  <Zap size={14} /> Quick reply
                </Button>
                <Button variant="secondary" onClick={() => setShowProducts(true)}>
                  <Package size={14} /> Send product
                </Button>
              </div>

              {/* Reply box */}
              <form onSubmit={sendReply} className="flex gap-2 p-4 pt-2">
                <input
                  value={reply}
                  onChange={(e) => setReply(e.target.value)}
                  placeholder="Type a reply…"
                  className="flex-1 rounded-xl border border-slate-300 px-4 py-2.5 text-sm outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
                />
                <Button type="submit"><Send size={15} /> Send</Button>
              </form>
            </>
          )}
        </Card>

        {/* ---------- Customer panel ---------- */}
        {selected && (
          <Card className="hidden w-72 shrink-0 overflow-y-auto p-5 lg:block">
            <div className="mb-4 flex items-center gap-2">
              <div className="flex h-9 w-9 items-center justify-center rounded-full bg-slate-100 text-slate-500">
                <User size={18} />
              </div>
              <div className="min-w-0">
                <p className="truncate font-semibold">{selected.customer.name}</p>
                {customerInfo?.customer.phone && <p className="truncate text-xs text-slate-400">{customerInfo.customer.phone}</p>}
              </div>
            </div>

            {!customerInfo ? (
              <p className="text-sm text-slate-400">Loading…</p>
            ) : (
              <>
                <div className="grid grid-cols-2 gap-2 text-center">
                  <div className="rounded-lg bg-slate-50 p-2">
                    <p className="text-lg font-bold">{customerInfo.stats.totalOrders}</p>
                    <p className="text-xs text-slate-500">Orders</p>
                  </div>
                  <div className="rounded-lg bg-slate-50 p-2">
                    <p className={`text-lg font-bold ${customerInfo.stats.returnRate > 30 ? 'text-red-600' : ''}`}>{customerInfo.stats.returnRate}%</p>
                    <p className="text-xs text-slate-500">Return rate</p>
                  </div>
                </div>
                <p className="mt-2 text-center text-sm text-slate-500">Spent {money(customerInfo.stats.totalSpent)}</p>

                <h3 className="mb-2 mt-5 text-xs font-semibold uppercase tracking-wide text-slate-400">Recent orders</h3>
                {customerInfo.orders.length === 0 ? (
                  <p className="text-sm text-slate-400">No orders yet.</p>
                ) : (
                  <div className="space-y-2">
                    {customerInfo.orders.slice(0, 6).map((o) => (
                      <Link key={o.id} href={`/dashboard/orders/${o.id}`} className="block rounded-lg border border-slate-200 p-2.5 text-sm hover:bg-slate-50">
                        <div className="flex items-center justify-between">
                          <span className="font-medium text-indigo-600">#{o.orderNumber}</span>
                          <Badge label={o.status} />
                        </div>
                        <p className="mt-1 truncate text-xs text-slate-500">{o.product.name} · {money(o.totalAmount)}</p>
                      </Link>
                    ))}
                  </div>
                )}
              </>
            )}
          </Card>
        )}
      </div>

      {/* ---------- Quick-reply picker ---------- */}
      <Modal title="Quick replies" open={showTemplates} onClose={() => setShowTemplates(false)}>
        {templates.length === 0 ? (
          <p className="text-sm text-slate-500">
            No templates yet. Add some in <Link href="/dashboard/settings" className="text-indigo-600 hover:underline">Settings</Link>.
          </p>
        ) : (
          <div className="space-y-2">
            {templates.map((t) => (
              <button key={t.id}
                onClick={() => { setReply((r) => (r ? r + ' ' : '') + fillTemplate(t.body)); setShowTemplates(false); }}
                className="block w-full rounded-lg border border-slate-200 p-3 text-left hover:bg-slate-50">
                <p className="text-sm font-semibold">{t.title}</p>
                <p className="truncate text-sm text-slate-500">{t.body}</p>
              </button>
            ))}
            <p className="pt-1 text-xs text-slate-400">
              Variables are filled automatically: {'{customer}'} → customer&apos;s name, {'{shop}'} → your business name, {'{agent}'} → your name.
            </p>
          </div>
        )}
      </Modal>

      {/* ---------- Send-product picker ---------- */}
      <Modal title="Send a product" open={showProducts} onClose={() => setShowProducts(false)}>
        {products.length === 0 ? (
          <p className="text-sm text-slate-500">
            No products yet. Add them in <Link href="/dashboard/inventory" className="text-indigo-600 hover:underline">Inventory</Link>.
          </p>
        ) : (
          <div className="space-y-2">
            {products.map((p) => (
              <button key={p.id} onClick={() => sendProduct(p.id)}
                className="flex w-full items-center justify-between rounded-lg border border-slate-200 p-3 text-left hover:bg-slate-50">
                <span className="text-sm font-medium">{p.name}</span>
                <span className="text-sm text-slate-500">{money(p.price)}</span>
              </button>
            ))}
          </div>
        )}
      </Modal>

      {/* ---------- Phase 3: editable draft-order form ---------- */}
      <Modal title="✨ AI-extracted draft order" open={!!parsed} onClose={() => setParsed(null)}>
        {parsed && (
          <div className="space-y-3">
            <p className="text-sm text-slate-500">
              Review before saving — highlighted fields are ones the AI wasn&apos;t sure about.
            </p>
            <Field label="Customer name" value={parsed.customerName || ''}
              onChange={(v) => setParsed({ ...parsed, customerName: v })}
              warn={!parsed.customerName} />
            <Field label="Phone (01XXXXXXXXX)" value={parsed.phone || ''}
              onChange={(v) => setParsed({ ...parsed, phone: v })}
              warn={!!parsed.lowConfidence.phone} />
            <Field label="Address" value={parsed.address || ''}
              onChange={(v) => setParsed({ ...parsed, address: v })}
              warn={!!parsed.lowConfidence.address} />
            <Field label="District" value={parsed.district || ''}
              onChange={(v) => setParsed({ ...parsed, district: v })}
              warn={!!parsed.lowConfidence.district} />
            <div className="rounded-lg bg-slate-50 px-3 py-2 text-sm">
              <b>Product:</b> {parsed.productName || <span className="text-amber-600">not matched — add products in Inventory first</span>}
            </div>
            <Field label="Quantity" type="number" value={String(parsed.quantity)}
              onChange={(v) => setParsed({ ...parsed, quantity: Number(v) || 1 })}
              warn={!!parsed.lowConfidence.quantity} />
            <Button onClick={createDraftOrder} loading={creating} disabled={!parsed.productId} className="w-full">
              Create draft order
            </Button>
          </div>
        )}
      </Modal>
    </div>
  );
}
