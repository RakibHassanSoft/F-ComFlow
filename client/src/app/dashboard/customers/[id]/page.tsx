// Customer profile — stats, order history and chat threads.
'use client';
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, User, MessageSquare, ShoppingBag } from 'lucide-react';
import { api } from '@/lib/api';
import { money, timeAgo, fullDate } from '@/lib/format';
import { Badge, Card, Loading, PageHeader } from '@/components/ui';

interface Detail {
  customer: { id: string; name: string; phone: string | null; externalId: string | null; createdAt: string };
  stats: { totalOrders: number; returnRate: number; totalSpent: number; lifetimeValue: number };
  orders: {
    id: string; orderNumber: number; status: string; paymentStatus: string;
    totalAmount: string; createdAt: string;
    items: { id: string; quantity: number; product: { name: string } }[];
  }[];
  conversations: { id: string; channel: string; lastMessageAt: string; preview: string }[];
}

export default function CustomerDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [data, setData] = useState<Detail | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api.get(`/customers/${id}`).then(setData).catch((e) => setError(e.message));
  }, [id]);

  if (error) return <p className="rounded-lg bg-red-50 px-4 py-2.5 text-sm text-red-600">{error}</p>;
  if (!data) return <Loading />;

  const { customer, stats, orders, conversations } = data;
  const cards = [
    { label: 'Orders', value: String(stats.totalOrders) },
    { label: 'Return rate', value: `${stats.returnRate}%`, danger: stats.returnRate > 30 },
    { label: 'Paid so far', value: money(stats.totalSpent) },
    { label: 'Lifetime order value', value: money(stats.lifetimeValue) },
  ];

  return (
    <div className="max-w-5xl">
      <Link href="/dashboard/customers" className="mb-4 inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-800">
        <ArrowLeft size={15} /> All customers
      </Link>

      <PageHeader
        title={customer.name}
        subtitle={`${customer.phone || 'No phone yet'} · customer since ${fullDate(customer.createdAt)}`}
        action={
          <div className="flex h-11 w-11 items-center justify-center rounded-full bg-slate-100 text-slate-500">
            <User size={20} />
          </div>
        }
      />

      {/* Lifetime stats */}
      <div className="mb-6 grid grid-cols-2 gap-4 xl:grid-cols-4">
        {cards.map((c) => (
          <Card key={c.label} className="p-5">
            <p className={`text-2xl font-bold tracking-tight ${c.danger ? 'text-red-600' : ''}`}>{c.value}</p>
            <p className="mt-0.5 text-sm text-slate-500">{c.label}</p>
          </Card>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-5">
        {/* Order history */}
        <Card className="overflow-x-auto lg:col-span-3">
          <h2 className="flex items-center gap-2 px-5 pt-5 font-semibold"><ShoppingBag size={16} /> Orders</h2>
          {orders.length === 0 ? (
            <p className="px-5 py-8 text-sm text-slate-400">No orders yet.</p>
          ) : (
            <table className="mt-3 w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 text-left text-xs uppercase tracking-wide text-slate-400">
                  <th className="px-5 py-2.5">Order</th>
                  <th className="px-5 py-2.5">Items</th>
                  <th className="px-5 py-2.5 text-right">Total</th>
                  <th className="px-5 py-2.5">Status</th>
                  <th className="px-5 py-2.5">When</th>
                </tr>
              </thead>
              <tbody>
                {orders.map((o) => (
                  <tr key={o.id} className="border-b border-slate-50 transition hover:bg-slate-50/60">
                    <td className="px-5 py-3">
                      <Link href={`/dashboard/orders/${o.id}`} className="font-semibold text-indigo-600 hover:underline">
                        #{o.orderNumber}
                      </Link>
                    </td>
                    <td className="max-w-[220px] truncate px-5 py-3 text-slate-600">
                      {o.items.map((it) => `${it.product.name} × ${it.quantity}`).join(', ')}
                    </td>
                    <td className="px-5 py-3 text-right font-medium">{money(o.totalAmount)}</td>
                    <td className="px-5 py-3"><Badge label={o.status} /></td>
                    <td className="px-5 py-3 text-slate-400">{timeAgo(o.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>

        {/* Conversations */}
        <Card className="p-5 lg:col-span-2">
          <h2 className="flex items-center gap-2 font-semibold"><MessageSquare size={16} /> Conversations</h2>
          {conversations.length === 0 ? (
            <p className="py-8 text-sm text-slate-400">No conversations yet.</p>
          ) : (
            <div className="mt-4 space-y-2">
              {conversations.map((c) => (
                <Link key={c.id} href="/dashboard/inbox"
                  className="block rounded-lg border border-slate-200 p-3 transition hover:bg-slate-50">
                  <div className="flex items-center justify-between gap-2">
                    <Badge label={c.channel} />
                    <span className="text-xs text-slate-400">{timeAgo(c.lastMessageAt)}</span>
                  </div>
                  <p className="mt-1.5 truncate text-sm text-slate-600">{c.preview || '…'}</p>
                </Link>
              ))}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
