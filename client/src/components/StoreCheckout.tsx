// Shared checkout used by both the storefront and the single-product page.
// Collects the customer's delivery details, lets them pick Cash on Delivery or
// pay online, and posts the order to the public shop API. For COD it shows an
// optional "scan to prepay" QR (the merchant still gets a normal COD order).
'use client';
import { useState } from 'react';
import { CheckCircle2, Banknote, CreditCard } from 'lucide-react';
import { api } from '@/lib/api';
import { money } from '@/lib/format';
import { PayQr } from './PayQr';

export interface CheckoutLine { productId: string; name: string; unitPrice: number; quantity: number; }

export function StoreCheckout({
  slug, lines, sslczEnabled, onPlaced,
}: {
  slug: string;
  lines: CheckoutLine[];
  sslczEnabled: boolean;
  onPlaced?: () => void;
}) {
  const [customerName, setCustomerName] = useState('');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');
  const [district, setDistrict] = useState('');
  const [method, setMethod] = useState<'cod' | 'online'>('cod');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState<{ orderNumber: number; payUrl?: string } | null>(null);

  const total = lines.reduce((s, l) => s + l.unitPrice * l.quantity, 0);

  async function placeOrder() {
    setError('');
    if (lines.length === 0) { setError('Your cart is empty'); return; }
    if (!customerName.trim() || !address.trim() || !district.trim()) { setError('Please fill in name, address and district'); return; }
    if (!/^01[3-9]\d{8}$/.test(phone)) { setError('Enter a valid 11-digit phone (01XXXXXXXXX)'); return; }
    setBusy(true);
    try {
      const res = await api.post(`/shop/${slug}/order`, {
        customerName, phone, address, district,
        payOnline: method === 'online',
        items: lines.map((l) => ({ productId: l.productId, quantity: l.quantity })),
      });
      if (method === 'online' && res.payUrl) {
        window.location.href = res.payUrl; // hosted pay page (SSLCommerz / bKash / QR)
        return;
      }
      setDone({ orderNumber: res.orderNumber, payUrl: res.payUrl });
      onPlaced?.();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <div className="rounded-2xl border border-emerald-200 bg-emerald-50/60 p-6 text-center">
        <CheckCircle2 className="mx-auto mb-2 text-emerald-600" size={34} />
        <h3 className="text-lg font-semibold text-emerald-900">Order placed!</h3>
        <p className="mt-1 text-sm text-emerald-800">
          Your order number is <b>#{done.orderNumber}</b>. The seller will contact you to confirm delivery.
        </p>
        {done.payUrl && (
          <div className="mt-5 flex flex-col items-center gap-2 border-t border-emerald-200 pt-5">
            <p className="text-sm font-medium text-slate-700">Prefer to pay now? Scan to prepay {money(total)}</p>
            <PayQr value={done.payUrl} />
            <a href={done.payUrl} className="text-sm font-medium text-indigo-600 hover:underline">or open the payment page →</a>
            <p className="text-xs text-slate-500">Otherwise, just pay cash on delivery.</p>
          </div>
        )}
      </div>
    );
  }

  const inputCls = 'w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100';

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <h3 className="mb-3 font-semibold">Checkout</h3>

      <div className="mb-4 space-y-1 border-b border-slate-100 pb-3 text-sm">
        {lines.map((l) => (
          <div key={l.productId} className="flex justify-between">
            <span className="text-slate-600">{l.name} × {l.quantity}</span>
            <span>{money(l.unitPrice * l.quantity)}</span>
          </div>
        ))}
        <div className="flex justify-between pt-1 font-semibold">
          <span>Total</span><span>{money(total)}</span>
        </div>
      </div>

      <div className="space-y-2.5">
        <input className={inputCls} placeholder="Your name" value={customerName} onChange={(e) => setCustomerName(e.target.value)} />
        <input className={inputCls} placeholder="Phone (01XXXXXXXXX)" value={phone} onChange={(e) => setPhone(e.target.value)} />
        <input className={inputCls} placeholder="Delivery address" value={address} onChange={(e) => setAddress(e.target.value)} />
        <input className={inputCls} placeholder="District (e.g. Dhaka)" value={district} onChange={(e) => setDistrict(e.target.value)} />
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2">
        <button
          onClick={() => setMethod('cod')}
          className={`flex items-center justify-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium transition
            ${method === 'cod' ? 'border-indigo-500 bg-indigo-50 text-indigo-700' : 'border-slate-300 text-slate-600 hover:bg-slate-50'}`}
        >
          <Banknote size={16} /> Cash on delivery
        </button>
        <button
          onClick={() => setMethod('online')}
          disabled={!sslczEnabled}
          title={sslczEnabled ? '' : 'Online payment not enabled for this store'}
          className={`flex items-center justify-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium transition disabled:opacity-40
            ${method === 'online' ? 'border-indigo-500 bg-indigo-50 text-indigo-700' : 'border-slate-300 text-slate-600 hover:bg-slate-50'}`}
        >
          <CreditCard size={16} /> Pay online
        </button>
      </div>

      {error && <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>}

      <button
        onClick={placeOrder}
        disabled={busy}
        className="mt-4 w-full rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-indigo-700 disabled:opacity-50"
      >
        {busy ? 'Placing order…' : method === 'online' ? `Pay ${money(total)} online` : `Place order · ${money(total)}`}
      </button>
    </div>
  );
}
