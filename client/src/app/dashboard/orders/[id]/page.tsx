// Order detail — where Phases 4, 5, 6 and 7 all meet:
// - state machine actions (confirm / cancel / return)          Phase 4
// - courier rate comparison + booking + status sync + label    Phase 5
// - QR invoice + sandbox payment + settlement                  Phase 6
// - risk banner + one-click advance payment request            Phase 7
'use client';
import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, ShieldAlert, Truck, Printer, QrCode, RefreshCw, Send, StickyNote, Receipt } from 'lucide-react';
import { api } from '@/lib/api';
import { getSocket } from '@/lib/socket';
import { money, fullDate } from '@/lib/format';
import { Badge, Button, Card, Loading, Modal, PageHeader } from '@/components/ui';
import { QrMock } from '@/components/QrMock';
import { useSession } from '@/lib/session';

interface OrderItem {
  id: string; quantity: number; unitPrice: string; subtotal: string;
  product: { id: string; name: string; sku: string; imageUrl: string | null };
}
interface OrderDetail {
  id: string; orderNumber: number; status: string; paymentStatus: string;
  customerName: string; phone: string; address: string; district: string;
  totalAmount: string; deliveryFee: string; returnReason: string | null;
  courierName: string | null; trackingCode: string | null; courierStatus: string | null;
  riskScore: number | null; riskLevel: string | null; createdAt: string;
  items: OrderItem[];
  events: { id: string; type: string; note: string; createdAt: string }[];
  invoices: { id: string; type: string; status: string; amount: string; transactionId: string | null }[];
}

const RETURN_REASONS = [
  'Customer refused delivery', 'Wrong/incomplete address', 'Customer unreachable',
  'Damaged in transit', 'Customer changed mind', 'Other',
];
interface Quote { courier: string; price: number; etaDays: number; available: boolean }

export default function OrderDetailPage() {
  const { id } = useParams<{ id: string }>();
  const session = useSession();
  const [order, setOrder] = useState<OrderDetail | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(''); // which action is running

  // Courier booking modal (Phase 5)
  const [quotes, setQuotes] = useState<Quote[] | null>(null);
  const [showBooking, setShowBooking] = useState(false);

  // Invoice modal (Phase 6)
  const [invoice, setInvoice] = useState<OrderDetail['invoices'][0] | null>(null);

  const load = useCallback(() => {
    api.get(`/orders/${id}`).then(setOrder).catch((e) => setError(e.message));
  }, [id]);

  useEffect(() => { load(); }, [load]);

  // LIVE: when the courier reports a new status (webhook/poller), this very
  // order refreshes on screen — timeline and status badge included.
  useEffect(() => {
    const socket = getSocket();
    const onUpdate = (o: { id: string }) => { if (o.id === id) load(); };
    socket.on('order:updated', onUpdate);
    return () => { socket.off('order:updated', onUpdate); };
  }, [id, load]);

  // Wrap every action: show loading, surface errors, then reload the order
  async function run(name: string, fn: () => Promise<unknown>) {
    setBusy(name);
    setError('');
    try { await fn(); load(); }
    catch (e: any) { setError(e.message); }
    finally { setBusy(''); }
  }

  const confirm = () => run('confirm', () => api.post(`/orders/${id}/confirm`));
  const cancel = () => run('cancel', () => api.post(`/orders/${id}/cancel`));
  const syncCourier = () => run('sync', () => api.post(`/couriers/sync/${id}`));

  // Return with a reason — the reason feeds the Analytics page
  const [showReturn, setShowReturn] = useState(false);
  const [returnReason, setReturnReason] = useState(RETURN_REASONS[0]);
  const markReturned = () =>
    run('return', async () => {
      await api.post(`/orders/${id}/return`, { reason: returnReason });
      setShowReturn(false);
    });

  async function openBooking() {
    setShowBooking(true);
    setQuotes(null);
    try { setQuotes(await api.get(`/couriers/rates?orderId=${id}`)); }
    catch (e: any) { setError(e.message); setShowBooking(false); }
  }
  const book = (courier: string) =>
    run('book', async () => {
      await api.post('/couriers/book', { orderId: id, courier });
      setShowBooking(false);
    });

  const createInvoice = (type: 'FULL' | 'ADVANCE') =>
    run('invoice', async () => {
      const inv = await api.post('/payments/invoices', { orderId: id, type });
      setInvoice(inv);
    });

  // Send the customer a 20% advance pay-link straight into their chat thread.
  const [advanceLink, setAdvanceLink] = useState('');
  const sendAdvanceLink = () =>
    run('advlink', async () => {
      const r = await api.post(`/orders/${id}/request-advance`);
      setAdvanceLink(r.payUrl);
    });

  const payInvoice = (invoiceId: string) =>
    run('pay', async () => {
      await api.post(`/payments/invoices/${invoiceId}/pay`);
      setInvoice(null);
    });

  // Internal notes: saved to the order's timeline (visible to your team only)
  const [note, setNote] = useState('');
  const addNote = () =>
    run('note', async () => {
      await api.post(`/orders/${id}/note`, { note });
      setNote('');
    });

  if (!order) return <Loading />;

  const isHighRisk = order.riskScore != null && order.riskScore >= session.tenant.riskThreshold;
  const hasAdvance = order.invoices.some((i) => i.type === 'ADVANCE');
  const pendingInvoice = order.invoices.find((i) => i.status === 'PENDING');

  return (
    <div className="max-w-4xl">
      <Link href="/dashboard/orders" className="mb-4 inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-800">
        <ArrowLeft size={15} /> All orders
      </Link>

      <PageHeader
        title={`Order #${order.orderNumber}`}
        subtitle={`Placed ${fullDate(order.createdAt)}`}
        action={
          <div className="flex items-center gap-2">
            <Badge label={order.status} />
            <Badge label={order.paymentStatus} />
          </div>
        }
      />

      {error && <p className="mb-4 rounded-lg bg-red-50 px-4 py-2.5 text-sm text-red-600">{error}</p>}

      {/* ---------- Phase 7: high-risk banner ---------- */}
      {isHighRisk && order.status === 'CONFIRMED' && (
        <Card className="mb-4 border-red-200 bg-red-50/60 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <ShieldAlert size={20} className="text-red-500" />
              <div>
                <p className="font-semibold text-red-800">High COD risk: {order.riskScore}%</p>
                <p className="text-sm text-red-600">Collect a 20% advance before dispatching to protect against a failed delivery.</p>
              </div>
            </div>
            {!hasAdvance && (
              <div className="flex flex-wrap gap-2">
                <Button variant="danger" onClick={() => createInvoice('ADVANCE')} loading={busy === 'invoice'}>
                  <QrCode size={15} /> Show QR advance
                </Button>
                <Button variant="danger" onClick={sendAdvanceLink} loading={busy === 'advlink'}>
                  <Send size={15} /> Send pay link in chat
                </Button>
              </div>
            )}
          </div>
          {advanceLink && (
            <p className="mt-3 rounded-lg bg-white/70 px-3 py-2 text-sm text-emerald-700">
              Pay link sent to the customer in chat: <span className="break-all font-medium">{advanceLink}</span>
            </p>
          )}
        </Card>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        {/* ---------- Customer & product ---------- */}
        <Card className="p-5">
          <h2 className="mb-3 font-semibold">Delivery details</h2>
          <dl className="space-y-2 text-sm">
            <div><dt className="text-slate-400">Customer</dt><dd className="font-medium">{order.customerName}</dd></div>
            <div><dt className="text-slate-400">Phone</dt><dd className="font-medium">{order.phone}</dd></div>
            <div><dt className="text-slate-400">Address</dt><dd className="font-medium">{order.address}, {order.district}</dd></div>
          </dl>

          {/* Line items */}
          <div className="mt-4 space-y-2 border-t border-slate-100 pt-3">
            {order.items.map((it) => (
              <div key={it.id} className="flex items-center gap-3 text-sm">
                {it.product.imageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={it.product.imageUrl} alt="" className="h-9 w-9 rounded-lg border border-slate-200 object-cover" />
                ) : (
                  <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-slate-100 text-xs text-slate-400">📦</div>
                )}
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{it.product.name} <span className="text-slate-400">× {it.quantity}</span></p>
                  <p className="text-xs text-slate-400">{it.product.sku} · {money(it.unitPrice)} each</p>
                </div>
                <span className="font-medium">{money(it.subtotal)}</span>
              </div>
            ))}
            {Number(order.deliveryFee) > 0 && (
              <div className="flex items-center justify-between text-sm text-slate-500">
                <span>Delivery fee ({order.courierName || 'courier'})</span>
                <span>{money(order.deliveryFee)}</span>
              </div>
            )}
            <div className="flex items-center justify-between border-t border-slate-100 pt-2">
              <span className="text-sm text-slate-400">Total</span>
              <span className="text-base font-bold">{money(order.totalAmount)}</span>
            </div>
            {order.riskScore != null && (
              <div className="flex items-center justify-between text-sm">
                <span className="text-slate-400">COD risk</span>
                <span className="flex items-center gap-2 font-medium"><Badge label={order.riskLevel || ''} /> {order.riskScore}%</span>
              </div>
            )}
            {order.returnReason && (
              <div className="rounded-lg bg-orange-50 px-3 py-2 text-sm text-orange-700">
                Return reason: {order.returnReason}
              </div>
            )}
          </div>
        </Card>

        {/* ---------- Actions ---------- */}
        <Card className="p-5">
          <h2 className="mb-3 font-semibold">Actions</h2>
          <div className="flex flex-wrap gap-2">
            {order.status === 'DRAFT' && (
              <Button onClick={confirm} loading={busy === 'confirm'}>Confirm order (reserve stock)</Button>
            )}
            {order.status === 'CONFIRMED' && (
              <Button onClick={openBooking}><Truck size={15} /> Book courier</Button>
            )}
            {order.status === 'DISPATCHED' && (
              <>
                <Button variant="secondary" onClick={syncCourier} loading={busy === 'sync'}>
                  <RefreshCw size={15} /> Sync courier status
                </Button>
                <Link href={`/dashboard/orders/${order.id}/label`}>
                  <Button variant="secondary"><Printer size={15} /> Print label</Button>
                </Link>
                <Button variant="danger" onClick={() => setShowReturn(true)}>Mark returned</Button>
              </>
            )}
            {['DRAFT', 'CONFIRMED'].includes(order.status) && (
              <Button variant="danger" onClick={cancel} loading={busy === 'cancel'}>Cancel order</Button>
            )}
            {order.paymentStatus !== 'PAID' && !pendingInvoice && order.status !== 'CANCELLED' && (
              <Button variant="success" onClick={() => createInvoice('FULL')} loading={busy === 'invoice'}>
                <QrCode size={15} /> Create QR invoice
              </Button>
            )}
            {pendingInvoice && (
              <Button variant="success" onClick={() => setInvoice(pendingInvoice)}>
                <QrCode size={15} /> Show pending invoice
              </Button>
            )}
            {order.paymentStatus !== 'UNPAID' && (
              <Link href={`/dashboard/orders/${order.id}/receipt`}>
                <Button variant="secondary"><Receipt size={15} /> Print receipt</Button>
              </Link>
            )}
          </div>

          {order.trackingCode && (
            <div className="mt-4 rounded-lg bg-slate-50 p-3 text-sm">
              <p><b>{order.courierName}</b> · {order.trackingCode}</p>
              <p className="mt-0.5 text-slate-500">Latest: {order.courierStatus}</p>
            </div>
          )}
        </Card>
      </div>

      {/* ---------- Timeline ---------- */}
      <Card className="mt-4 p-5">
        <h2 className="mb-4 font-semibold">Timeline</h2>
        <ol className="relative space-y-4 border-l border-slate-200 pl-5">
          {order.events.map((e) => (
            <li key={e.id} className="relative">
              <span className={`absolute -left-[26px] top-1.5 h-2.5 w-2.5 rounded-full ring-4
                ${e.type === 'NOTE' ? 'bg-amber-400 ring-amber-50' : 'bg-indigo-500 ring-indigo-50'}`} />
              <p className="text-sm font-medium">
                {e.type === 'NOTE' && <span className="mr-1.5 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700">NOTE</span>}
                {e.note}
              </p>
              <p className="text-xs text-slate-400">{fullDate(e.createdAt)}</p>
            </li>
          ))}
        </ol>

        {/* Add an internal note (goes on the timeline, team-only) */}
        <form
          onSubmit={(e) => { e.preventDefault(); if (note.trim()) addNote(); }}
          className="mt-5 flex gap-2 border-t border-slate-100 pt-4"
        >
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Add an internal note (e.g. customer asked to deliver after 5pm)…"
            maxLength={1000}
            className="flex-1 rounded-xl border border-slate-300 px-4 py-2.5 text-sm outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
          />
          <Button type="submit" variant="secondary" loading={busy === 'note'} disabled={!note.trim()}>
            <StickyNote size={15} /> Add note
          </Button>
        </form>
      </Card>

      {/* ---------- Phase 5: rate comparison modal ---------- */}
      <Modal title="Compare courier rates" open={showBooking} onClose={() => setShowBooking(false)}>
        {!quotes ? (
          <Loading />
        ) : (
          <div className="space-y-2">
            {quotes.map((q) => (
              <div key={q.courier}
                className={`flex items-center justify-between rounded-xl border p-4 ${q.available ? 'border-slate-200' : 'border-slate-100 opacity-50'}`}>
                <div>
                  <p className="font-semibold">{q.courier}</p>
                  <p className="text-sm text-slate-500">
                    {q.available ? `${money(q.price)} · ~${q.etaDays} day${q.etaDays > 1 ? 's' : ''}` : 'Service unavailable'}
                  </p>
                </div>
                <Button disabled={!q.available} loading={busy === 'book'} onClick={() => book(q.courier)}>Book</Button>
              </div>
            ))}
            <p className="pt-1 text-xs text-slate-400">
              Double-clicking Book is safe — the server allows exactly one consignment per order.
            </p>
          </div>
        )}
      </Modal>

      {/* ---------- Return with reason ---------- */}
      <Modal title="Mark order as returned" open={showReturn} onClose={() => setShowReturn(false)}>
        <div className="space-y-3">
          <p className="text-sm text-slate-500">
            Stock goes back automatically. The reason feeds your Analytics so you can see <i>why</i> parcels come back.
          </p>
          <label className="block">
            <span className="mb-1 block text-sm font-medium text-slate-700">Reason</span>
            <select
              value={returnReason}
              onChange={(e) => setReturnReason(e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-indigo-400"
            >
              {RETURN_REASONS.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
          </label>
          <Button variant="danger" className="w-full" onClick={markReturned} loading={busy === 'return'}>
            Confirm return
          </Button>
        </div>
      </Modal>

      {/* ---------- Phase 6: QR invoice modal ---------- */}
      <Modal title="Bangla QR invoice (sandbox)" open={!!invoice} onClose={() => setInvoice(null)}>
        {invoice && (
          <div className="space-y-4 text-center">
            <p className="text-sm text-slate-500">
              {invoice.type === 'ADVANCE' ? '20% advance booking fee' : 'Full payment'} for order #{order.orderNumber}
            </p>
            <p className="text-3xl font-bold">{money(invoice.amount)}</p>
            <div className="flex justify-center rounded-2xl border border-slate-200 p-4">
              <QrMock seed={invoice.id} />
            </div>
            <p className="text-xs text-slate-400">Customer scans with any Bangla QR wallet (bKash, Nagad, bank apps)</p>
            <Button variant="success" className="w-full" loading={busy === 'pay'} onClick={() => payInvoice(invoice.id)}>
              Simulate customer payment
            </Button>
            <p className="text-xs text-slate-400">
              This fires the payment webhook: order marked paid + ledger entry, atomically and exactly once.
            </p>
          </div>
        )}
      </Modal>
    </div>
  );
}
