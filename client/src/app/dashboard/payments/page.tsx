// Phase 6: Payments — the settlement ledger with running balance,
// per-payment fee breakdown (1% MDR + 15% VAT on the fee), a date-range
// filter with period totals, and CSV export.
'use client';
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Wallet, Download } from 'lucide-react';
import { api, API_BASE } from '@/lib/api';
import { money, fullDate } from '@/lib/format';
import { getSocket } from '@/lib/socket';
import { Button, Card, EmptyState, Loading, PageHeader } from '@/components/ui';

interface Entry {
  id: string; gross: string; fee: string; vat: string; net: string;
  runningBalance: number; createdAt: string;
  order: { id: string; orderNumber: number };
}

export default function PaymentsPage() {
  const [entries, setEntries] = useState<Entry[] | null>(null);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  const load = useCallback(() => {
    const params = new URLSearchParams();
    if (from) params.set('from', from);
    if (to) params.set('to', to);
    const qs = params.toString();
    return api.get(`/payments/ledger${qs ? `?${qs}` : ''}`).then(setEntries).catch(console.error);
  }, [from, to]);

  useEffect(() => {
    load();
    // New settlements appear live
    const socket = getSocket();
    socket.on('payment:settled', load);
    return () => { socket.off('payment:settled', load); };
  }, [load]);

  if (!entries) return <Loading />;

  const filtered = Boolean(from || to);
  const balance = entries.length > 0 ? entries[0].runningBalance : 0;
  const totals = entries.reduce(
    (t, e) => ({
      gross: t.gross + Number(e.gross),
      fee: t.fee + Number(e.fee),
      vat: t.vat + Number(e.vat),
      net: t.net + Number(e.net),
    }),
    { gross: 0, fee: 0, vat: 0, net: 0 }
  );

  return (
    <div>
      <PageHeader
        title="Payments & Ledger"
        subtitle="Every settled payment, always consistent with your orders."
        action={
          <a href={`${API_BASE}/payments/ledger/export`}>
            <Button variant="secondary"><Download size={15} /> Export CSV</Button>
          </a>
        }
      />

      {/* Balance card */}
      <Card className="mb-5 bg-gradient-to-br from-indigo-600 to-indigo-800 p-6 text-white">
        <p className="text-sm text-indigo-200">
          {filtered ? 'Net settled in the selected period' : 'Available balance (net of fees & VAT)'}
        </p>
        <p className="mt-1 text-4xl font-bold tracking-tight">{money(filtered ? totals.net : balance)}</p>
        <p className="mt-2 text-xs text-indigo-200">{entries.length} settlement{entries.length !== 1 ? 's' : ''} · MDR 1% + VAT 15% on fee</p>
      </Card>

      {/* Date-range filter */}
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <label className="text-xs font-medium text-slate-500">
          From
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)}
            className="mt-1 block rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100" />
        </label>
        <label className="text-xs font-medium text-slate-500">
          To
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)}
            className="mt-1 block rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100" />
        </label>
        {filtered && (
          <button onClick={() => { setFrom(''); setTo(''); }} className="pb-2 text-xs text-indigo-600 hover:underline">
            Clear filter
          </button>
        )}
      </div>

      {entries.length === 0 ? (
        <Card>
          <EmptyState icon={<Wallet size={22} />} title={filtered ? 'No settlements in this period' : 'No settlements yet'}
            hint={filtered ? 'Widen the date range or clear the filter.' : 'Create a QR invoice on an order and simulate the customer payment.'} />
        </Card>
      ) : (
        <Card className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 text-left text-xs uppercase tracking-wide text-slate-400">
                <th className="px-5 py-3">Date</th>
                <th className="px-5 py-3">Order</th>
                <th className="px-5 py-3 text-right">Gross</th>
                <th className="px-5 py-3 text-right">Fee (1%)</th>
                <th className="px-5 py-3 text-right">VAT (15%)</th>
                <th className="px-5 py-3 text-right">Net</th>
                <th className="px-5 py-3 text-right">Balance</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => (
                <tr key={e.id} className="border-b border-slate-50 transition hover:bg-slate-50/60">
                  <td className="px-5 py-3 text-slate-500">{fullDate(e.createdAt)}</td>
                  <td className="px-5 py-3">
                    <Link href={`/dashboard/orders/${e.order.id}`} className="font-semibold text-indigo-600 hover:underline">
                      #{e.order.orderNumber}
                    </Link>
                  </td>
                  <td className="px-5 py-3 text-right font-medium">{money(e.gross)}</td>
                  <td className="px-5 py-3 text-right text-slate-500">−{money(e.fee)}</td>
                  <td className="px-5 py-3 text-right text-slate-500">−{money(e.vat)}</td>
                  <td className="px-5 py-3 text-right font-semibold text-emerald-600">{money(e.net)}</td>
                  <td className="px-5 py-3 text-right font-medium">{money(e.runningBalance)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-slate-200 bg-slate-50/60 font-semibold">
                <td className="px-5 py-3 text-xs uppercase tracking-wide text-slate-500" colSpan={2}>
                  {filtered ? 'Period totals' : 'Totals'} · {entries.length} settlement{entries.length !== 1 ? 's' : ''}
                </td>
                <td className="px-5 py-3 text-right">{money(totals.gross)}</td>
                <td className="px-5 py-3 text-right text-slate-500">−{money(totals.fee)}</td>
                <td className="px-5 py-3 text-right text-slate-500">−{money(totals.vat)}</td>
                <td className="px-5 py-3 text-right text-emerald-600">{money(totals.net)}</td>
                <td className="px-5 py-3" />
              </tr>
            </tfoot>
          </table>
        </Card>
      )}
    </div>
  );
}
