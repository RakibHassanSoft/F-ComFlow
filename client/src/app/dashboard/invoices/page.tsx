// Invoices — all payment requests, filterable by status.
'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { FileText } from 'lucide-react';
import { api } from '@/lib/api';
import { money, fullDate } from '@/lib/format';
import { getSocket } from '@/lib/socket';
import { Badge, Card, EmptyState, Loading, PageHeader } from '@/components/ui';

interface InvoiceRow {
  id: string; type: 'FULL' | 'ADVANCE'; status: 'PENDING' | 'PAID';
  amount: string; transactionId: string | null; createdAt: string; paidAt: string | null;
  order: { id: string; orderNumber: number; customerName: string; status: string };
}

const FILTERS = ['ALL', 'PENDING', 'PAID'] as const;

export default function InvoicesPage() {
  const [invoices, setInvoices] = useState<InvoiceRow[] | null>(null);
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>('ALL');

  const load = () => api.get('/payments/invoices').then(setInvoices).catch(console.error);

  useEffect(() => {
    load();
    const socket = getSocket();
    socket.on('payment:settled', load); // paid invoices flip live
    return () => { socket.off('payment:settled', load); };
  }, []);

  if (!invoices) return <Loading />;

  const shown = invoices.filter((i) => filter === 'ALL' || i.status === filter);
  const pending = invoices.filter((i) => i.status === 'PENDING').reduce((s, i) => s + Number(i.amount), 0);
  const collected = invoices.filter((i) => i.status === 'PAID').reduce((s, i) => s + Number(i.amount), 0);

  return (
    <div>
      <PageHeader
        title="Invoices"
        subtitle="Every payment request — QR, bKash and advance links — in one place."
        action={
          <div className="flex gap-1.5">
            {FILTERS.map((f) => (
              <button key={f} onClick={() => setFilter(f)}
                className={`rounded-full px-3.5 py-1.5 text-xs font-semibold transition
                  ${filter === f ? 'bg-slate-900 text-white' : 'bg-white text-slate-600 hover:bg-slate-100'}`}>
                {f}
              </button>
            ))}
          </div>
        }
      />

      <div className="mb-5 grid grid-cols-2 gap-4 max-w-xl">
        <Card className="p-5">
          <p className="text-2xl font-bold tracking-tight text-amber-600">{money(pending)}</p>
          <p className="mt-0.5 text-sm text-slate-500">Awaiting payment</p>
        </Card>
        <Card className="p-5">
          <p className="text-2xl font-bold tracking-tight text-emerald-600">{money(collected)}</p>
          <p className="mt-0.5 text-sm text-slate-500">Collected</p>
        </Card>
      </div>

      {shown.length === 0 ? (
        <Card>
          <EmptyState icon={<FileText size={22} />} title="No invoices here"
            hint="Create a QR invoice from any order page and it will appear in this list." />
        </Card>
      ) : (
        <Card className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 text-left text-xs uppercase tracking-wide text-slate-400">
                <th className="px-5 py-3">Created</th>
                <th className="px-5 py-3">Order</th>
                <th className="px-5 py-3">Customer</th>
                <th className="px-5 py-3">Type</th>
                <th className="px-5 py-3 text-right">Amount</th>
                <th className="px-5 py-3">Status</th>
                <th className="px-5 py-3">Transaction</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((i) => (
                <tr key={i.id} className="border-b border-slate-50 transition hover:bg-slate-50/60">
                  <td className="px-5 py-3 text-slate-500">{fullDate(i.createdAt)}</td>
                  <td className="px-5 py-3">
                    <Link href={`/dashboard/orders/${i.order.id}`} className="font-semibold text-indigo-600 hover:underline">
                      #{i.order.orderNumber}
                    </Link>
                  </td>
                  <td className="px-5 py-3">{i.order.customerName}</td>
                  <td className="px-5 py-3">
                    <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${i.type === 'ADVANCE' ? 'bg-amber-50 text-amber-700' : 'bg-slate-100 text-slate-600'}`}>
                      {i.type === 'ADVANCE' ? '20% ADVANCE' : 'FULL'}
                    </span>
                  </td>
                  <td className="px-5 py-3 text-right font-medium">{money(i.amount)}</td>
                  <td className="px-5 py-3"><Badge label={i.status} /></td>
                  <td className="px-5 py-3 font-mono text-xs text-slate-400">{i.transactionId || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}
