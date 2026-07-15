// Customer directory — everyone who ever messaged or ordered, with their
// order history rolled up. Rows link to the full customer profile page.
'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Users, Search, Download } from 'lucide-react';
import { api, API_BASE } from '@/lib/api';
import { money, timeAgo } from '@/lib/format';
import { Badge, Button, Card, EmptyState, Loading, PageHeader } from '@/components/ui';

interface CustomerRow {
  id: string;
  name: string;
  phone: string | null;
  channels: string[];
  totalOrders: number;
  returnRate: number;
  totalSpent: number;
  lastSeenAt: string;
}

export default function CustomersPage() {
  const [customers, setCustomers] = useState<CustomerRow[] | null>(null);
  const [q, setQ] = useState('');
  const [search, setSearch] = useState('');
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setSearch(q.trim()), 300);
    return () => clearTimeout(t);
  }, [q]);

  useEffect(() => {
    api.get(`/customers${search ? `?q=${encodeURIComponent(search)}` : ''}`)
      .then(setCustomers)
      .catch(console.error);
  }, [search]);

  async function exportCsv() {
    setExporting(true);
    try {
      const res = await fetch(`${API_BASE}/customers/export.csv`, { credentials: 'include' });
      if (!res.ok) throw new Error('Export failed');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'customers.csv';
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      console.error(e);
    } finally { setExporting(false); }
  }

  return (
    <div>
      <PageHeader
        title="Customers"
        subtitle="Everyone who has messaged or ordered from your shop."
        action={
          <div className="flex items-center gap-2">
            <div className="relative">
              <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search name or phone…"
                className="w-64 rounded-full border border-slate-300 bg-white py-1.5 pl-8 pr-3 text-xs outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
              />
            </div>
            <Button variant="secondary" onClick={exportCsv} loading={exporting}>
              <Download size={15} /> Export CSV
            </Button>
          </div>
        }
      />

      {!customers ? (
        <Loading />
      ) : customers.length === 0 ? (
        <Card>
          <EmptyState icon={<Users size={22} />} title={search ? 'No customers match' : 'No customers yet'}
            hint={search ? 'Try a different name or phone number.' : 'Customers appear here as soon as they message you or place an order.'} />
        </Card>
      ) : (
        <Card className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 text-left text-xs uppercase tracking-wide text-slate-400">
                <th className="px-5 py-3">Customer</th>
                <th className="px-5 py-3">Channels</th>
                <th className="px-5 py-3 text-right">Orders</th>
                <th className="px-5 py-3 text-right">Return rate</th>
                <th className="px-5 py-3 text-right">Total spent</th>
                <th className="px-5 py-3">Last seen</th>
              </tr>
            </thead>
            <tbody>
              {customers.map((c) => (
                <tr key={c.id} className="border-b border-slate-50 transition hover:bg-slate-50/60">
                  <td className="px-5 py-3">
                    <Link href={`/dashboard/customers/${c.id}`} className="font-medium text-indigo-600 hover:underline">
                      {c.name}
                    </Link>
                    <p className="text-xs text-slate-400">{c.phone || 'no phone yet'}</p>
                  </td>
                  <td className="px-5 py-3">
                    <span className="flex flex-wrap gap-1">
                      {c.channels.length > 0
                        ? c.channels.map((ch) => <Badge key={ch} label={ch} />)
                        : <span className="text-xs text-slate-300">—</span>}
                    </span>
                  </td>
                  <td className="px-5 py-3 text-right font-medium">{c.totalOrders}</td>
                  <td className="px-5 py-3 text-right">
                    <span className={c.returnRate > 30 ? 'font-semibold text-red-600' : 'text-slate-500'}>
                      {c.returnRate}%
                    </span>
                  </td>
                  <td className="px-5 py-3 text-right font-medium">{money(c.totalSpent)}</td>
                  <td className="px-5 py-3 text-slate-400">{timeAgo(c.lastSeenAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}
