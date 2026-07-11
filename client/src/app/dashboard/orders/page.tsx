// Phase 4: Orders dashboard — filterable, searchable list with status & risk
// badges, plus bulk confirm/cancel over the selected rows.
'use client';
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { ShoppingBag, Download, Search, CheckCircle2, XCircle } from 'lucide-react';
import { api, API_BASE } from '@/lib/api';
import { money, timeAgo } from '@/lib/format';
import { Badge, Button, Card, EmptyState, Loading, PageHeader } from '@/components/ui';

interface Order {
  id: string; orderNumber: number; status: string; paymentStatus: string;
  customerName: string; district: string; quantity: number; totalAmount: string;
  riskScore: number | null; riskLevel: string | null; createdAt: string;
  product: { name: string };
}

const FILTERS = ['ALL', 'DRAFT', 'CONFIRMED', 'DISPATCHED', 'DELIVERED', 'RETURNED', 'CANCELLED'];

export default function OrdersPage() {
  const [orders, setOrders] = useState<Order[] | null>(null);
  const [filter, setFilter] = useState('ALL');
  const [q, setQ] = useState('');
  const [search, setSearch] = useState(''); // debounced value actually sent
  const [exporting, setExporting] = useState(false);

  // Bulk selection
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState('');
  const [bulkResult, setBulkResult] = useState('');

  // Debounce the search box so we don't query on every keystroke
  useEffect(() => {
    const t = setTimeout(() => setSearch(q.trim()), 300);
    return () => clearTimeout(t);
  }, [q]);

  const load = useCallback(() => {
    const params = new URLSearchParams();
    if (filter !== 'ALL') params.set('status', filter);
    if (search) params.set('q', search);
    const qs = params.toString();
    api.get(`/orders${qs ? `?${qs}` : ''}`).then(setOrders).catch(console.error);
  }, [filter, search]);

  useEffect(() => { setSelected(new Set()); load(); }, [load]);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  // Bulk actions reuse the existing per-order endpoints — the server's state
  // machine still rejects any illegal transition individually.
  async function bulk(action: 'confirm' | 'cancel') {
    if (selected.size === 0) return;
    setBulkBusy(action);
    setBulkResult('');
    let ok = 0, failed = 0;
    for (const id of Array.from(selected)) {
      try { await api.post(`/orders/${id}/${action}`); ok++; }
      catch { failed++; }
    }
    setBulkResult(`${action === 'confirm' ? 'Confirmed' : 'Cancelled'} ${ok} order${ok !== 1 ? 's' : ''}${failed ? `, ${failed} skipped (not allowed from their current status)` : ''}.`);
    setBulkBusy('');
    setSelected(new Set());
    load();
  }

  // Download the CSV through an authenticated fetch (cookies), then save it.
  async function exportCsv() {
    setExporting(true);
    try {
      const res = await fetch(`${API_BASE}/orders/export.csv`, { credentials: 'include' });
      if (!res.ok) throw new Error('Export failed');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'orders.csv';
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      console.error(e);
    } finally { setExporting(false); }
  }

  const allVisible = orders ?? [];
  const allChecked = allVisible.length > 0 && allVisible.every((o) => selected.has(o.id));

  return (
    <div>
      <PageHeader
        title="Orders"
        subtitle="Every order, from draft to delivered."
        action={
          <Button variant="secondary" onClick={exportCsv} loading={exporting}>
            <Download size={15} /> Export CSV
          </Button>
        }
      />

      {/* Status filter tabs + search */}
      <div className="mb-4 flex flex-wrap items-center gap-1.5">
        {FILTERS.map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`rounded-full px-3.5 py-1.5 text-xs font-semibold transition
              ${filter === f ? 'bg-slate-900 text-white' : 'bg-white text-slate-600 hover:bg-slate-100'}`}
          >
            {f}
          </button>
        ))}
        <div className="relative ml-auto">
          <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search name, phone, tracking, #…"
            className="w-64 rounded-full border border-slate-300 bg-white py-1.5 pl-8 pr-3 text-xs outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
          />
        </div>
      </div>

      {/* Bulk action bar */}
      {selected.size > 0 && (
        <div className="mb-3 flex flex-wrap items-center gap-2 rounded-xl border border-indigo-200 bg-indigo-50/60 px-4 py-2.5">
          <span className="text-sm font-medium text-indigo-800">{selected.size} selected</span>
          <Button variant="secondary" onClick={() => bulk('confirm')} loading={bulkBusy === 'confirm'}>
            <CheckCircle2 size={14} /> Confirm selected
          </Button>
          <Button variant="danger" onClick={() => bulk('cancel')} loading={bulkBusy === 'cancel'}>
            <XCircle size={14} /> Cancel selected
          </Button>
          <button onClick={() => setSelected(new Set())} className="ml-auto text-xs text-slate-500 hover:underline">
            Clear selection
          </button>
        </div>
      )}
      {bulkResult && <p className="mb-3 rounded-lg bg-emerald-50 px-4 py-2 text-sm text-emerald-700">{bulkResult}</p>}

      {!orders ? (
        <Loading />
      ) : orders.length === 0 ? (
        <Card>
          <EmptyState icon={<ShoppingBag size={22} />} title={search ? 'No orders match your search' : 'No orders here'}
            hint={search ? 'Try a different name, phone number or tracking code.' : 'Extract an order from an inbox conversation to get started.'} />
        </Card>
      ) : (
        <Card className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 text-left text-xs uppercase tracking-wide text-slate-400">
                <th className="px-4 py-3">
                  <input
                    type="checkbox"
                    checked={allChecked}
                    onChange={() => setSelected(allChecked ? new Set() : new Set(allVisible.map((o) => o.id)))}
                    className="h-4 w-4 accent-indigo-600"
                  />
                </th>
                <th className="px-5 py-3">Order</th>
                <th className="px-5 py-3">Customer</th>
                <th className="px-5 py-3">Product</th>
                <th className="px-5 py-3">Total</th>
                <th className="px-5 py-3">Status</th>
                <th className="px-5 py-3">Payment</th>
                <th className="px-5 py-3">Risk</th>
                <th className="px-5 py-3">Created</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((o) => (
                <tr key={o.id} className="border-b border-slate-50 transition hover:bg-slate-50/60">
                  <td className="px-4 py-3">
                    <input
                      type="checkbox"
                      checked={selected.has(o.id)}
                      onChange={() => toggle(o.id)}
                      className="h-4 w-4 accent-indigo-600"
                    />
                  </td>
                  <td className="px-5 py-3">
                    <Link href={`/dashboard/orders/${o.id}`} className="font-semibold text-indigo-600 hover:underline">
                      #{o.orderNumber}
                    </Link>
                  </td>
                  <td className="px-5 py-3">
                    <p className="font-medium">{o.customerName}</p>
                    <p className="text-xs text-slate-400">{o.district}</p>
                  </td>
                  <td className="px-5 py-3">{o.product.name} × {o.quantity}</td>
                  <td className="px-5 py-3 font-medium">{money(o.totalAmount)}</td>
                  <td className="px-5 py-3"><Badge label={o.status} /></td>
                  <td className="px-5 py-3"><Badge label={o.paymentStatus} /></td>
                  <td className="px-5 py-3">
                    {o.riskScore != null ? (
                      <span className="flex items-center gap-1.5">
                        <Badge label={o.riskLevel || ''} />
                        <span className="text-xs text-slate-500">{o.riskScore}%</span>
                      </span>
                    ) : (
                      <span className="text-xs text-slate-300">—</span>
                    )}
                  </td>
                  <td className="px-5 py-3 text-slate-400">{timeAgo(o.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}
