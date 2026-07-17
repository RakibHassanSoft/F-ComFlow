// Public pay page — no login, hits /api/pay. Real gateway shown when configured.
'use client';
import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { api } from '@/lib/api';
import { money } from '@/lib/format';

interface PayInfo {
  invoiceId: string;
  businessName: string;
  orderNumber: number;
  productName: string;
  type: 'FULL' | 'ADVANCE';
  amount: number;
  status: 'PENDING' | 'PAID';
  bkashEnabled?: boolean;
  sslczEnabled?: boolean;
}

export default function PayPage() {
  const { invoiceId } = useParams<{ invoiceId: string }>();
  const [info, setInfo] = useState<PayInfo | null>(null);
  const [error, setError] = useState('');
  const [paying, setPaying] = useState(false);
  const [paid, setPaid] = useState(false);

  const load = useCallback(() => {
    api.get(`/pay/${invoiceId}`).then((d) => { setInfo(d); if (d.status === 'PAID') setPaid(true); })
      .catch((e) => setError(e.message));
  }, [invoiceId]);

  useEffect(() => { load(); }, [load]);

  // Gateways redirect back with ?bkash=… or ?gateway=… = success|failed|cancelled
  // (read client-side to avoid the useSearchParams/Suspense requirement at build time)
  useEffect(() => {
    const qs = new URLSearchParams(window.location.search);
    const result = qs.get('bkash') || qs.get('gateway');
    if (result === 'failed') setError('Payment failed — please try again.');
    if (result === 'cancelled') setError('Payment was cancelled.');
  }, []);

  async function pay() {
    setPaying(true);
    setError('');
    try {
      await api.post(`/pay/${invoiceId}`);
      setPaid(true);
    } catch (e: any) {
      setError(e.message);
    } finally { setPaying(false); }
  }

  // Real bKash checkout: the server creates the payment session and we send
  // the customer's browser to bKash's hosted wallet screen.
  async function payWithBkash() {
    setPaying(true);
    setError('');
    try {
      const { bkashURL } = await api.post(`/pay/${invoiceId}/bkash`);
      window.location.href = bkashURL;
    } catch (e: any) {
      setError(e.message);
      setPaying(false);
    }
  }

  // Real SSLCOMMERZ hosted checkout: one page covers cards, bKash, Nagad,
  // Rocket and net banking. Server creates the session, we redirect.
  async function payWithSslcz() {
    setPaying(true);
    setError('');
    try {
      const { gatewayURL } = await api.post(`/pay/${invoiceId}/sslcommerz`);
      window.location.href = gatewayURL;
    } catch (e: any) {
      setError(e.message);
      setPaying(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-100 p-4">
      <div className="w-full max-w-sm rounded-2xl bg-white p-8 shadow-lg">
        {error && !info ? (
          <p className="text-center text-sm text-red-600">{error}</p>
        ) : !info ? (
          <p className="text-center text-sm text-slate-400">Loading…</p>
        ) : paid ? (
          <div className="text-center">
            <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-emerald-100 text-2xl">✓</div>
            <h1 className="text-lg font-bold">Payment received</h1>
            <p className="mt-1 text-sm text-slate-500">
              Thank you! Your {info.type === 'ADVANCE' ? 'advance for' : 'payment for'} order #{info.orderNumber} at {info.businessName} is confirmed.
            </p>
          </div>
        ) : (
          <div className="text-center">
            <p className="text-sm text-slate-500">{info.businessName}</p>
            <h1 className="mt-1 text-lg font-bold">Order #{info.orderNumber}</h1>
            <p className="mt-1 text-sm text-slate-500">{info.productName}</p>
            <p className="my-6 text-4xl font-bold tracking-tight">{money(info.amount)}</p>
            <p className="mb-4 text-xs text-slate-400">
              {info.type === 'ADVANCE' ? '20% advance booking fee' : 'Full payment'}
            </p>
            {error && <p className="mb-3 text-sm text-red-600">{error}</p>}
            {info.sslczEnabled && (
              <button
                onClick={payWithSslcz}
                disabled={paying}
                className="mb-2 w-full rounded-lg bg-emerald-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-emerald-700 disabled:opacity-50"
              >
                {paying ? 'Opening gateway…' : 'Pay with Card / bKash / Nagad (SSLCOMMERZ)'}
              </button>
            )}
            {info.bkashEnabled && (
              <button
                onClick={payWithBkash}
                disabled={paying}
                className="mb-2 w-full rounded-lg bg-pink-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-pink-700 disabled:opacity-50"
              >
                {paying ? 'Opening bKash…' : `Pay with bKash`}
              </button>
            )}
            {!info.sslczEnabled && !info.bkashEnabled && (
              <button
                onClick={pay}
                disabled={paying}
                className="w-full rounded-lg bg-indigo-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-indigo-700 disabled:opacity-50"
              >
                {paying ? 'Processing…' : `Pay ${money(info.amount)}`}
              </button>
            )}
            <p className="mt-3 text-xs text-slate-400">
              {info.sslczEnabled || info.bkashEnabled
                ? 'You’ll be taken to a secure payment page to complete your payment.'
                : 'No payment gateway is configured yet — this marks the order paid for testing.'}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
