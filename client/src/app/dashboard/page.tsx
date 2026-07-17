// Dashboard overview — key numbers at a glance.
'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { MessageSquare, ShoppingBag, Package, Wallet, ArrowRight, Mail } from 'lucide-react';
import { api } from '@/lib/api';
import { money } from '@/lib/format';
import { Button, Card, PageHeader, Loading, Badge } from '@/components/ui';
import { useSession } from '@/lib/session';

interface Stats {
  conversations: number;
  unreadMessages: number;
  orders: Record<string, number>;
  totalOrders: number;
  lowStockProducts: number;
  totalProducts: number;
  ledgerBalance: number;
}
interface Daily {
  orders: number;
  revenue: number;
  topAd: { title: string; revenue: number } | null;
}

export default function OverviewPage() {
  const session = useSession();
  const [stats, setStats] = useState<Stats | null>(null);
  const [daily, setDaily] = useState<Daily | null>(null);
  const [mailing, setMailing] = useState(false);
  const [mailMsg, setMailMsg] = useState('');

  useEffect(() => {
    api.get('/stats').then(setStats).catch(console.error);
    api.get('/stats/daily').then(setDaily).catch(console.error);
  }, []);

  // Email the last-24h briefing to the logged-in user (needs SMTP configured)
  async function emailBriefing() {
    setMailing(true);
    setMailMsg('');
    try {
      const r = await api.post('/stats/daily/email');
      setMailMsg(`Sent to ${r.sentTo} ✓`);
    } catch (e: any) {
      setMailMsg(e.message);
    } finally {
      setMailing(false);
      setTimeout(() => setMailMsg(''), 6000);
    }
  }

  if (!stats) return <Loading />;

  const cards = [
    { label: 'Conversations', value: stats.conversations, sub: `${stats.unreadMessages} unread`, icon: MessageSquare, href: '/dashboard/inbox', color: 'bg-blue-50 text-blue-600' },
    { label: 'Orders', value: stats.totalOrders, sub: `${stats.orders.CONFIRMED || 0} awaiting dispatch`, icon: ShoppingBag, href: '/dashboard/orders', color: 'bg-indigo-50 text-indigo-600' },
    { label: 'Products', value: stats.totalProducts, sub: `${stats.lowStockProducts} low on stock`, icon: Package, href: '/dashboard/inventory', color: 'bg-amber-50 text-amber-600' },
    { label: 'Ledger balance', value: money(stats.ledgerBalance), sub: 'net of fees & VAT', icon: Wallet, href: '/dashboard/payments', color: 'bg-emerald-50 text-emerald-600' },
  ];

  return (
    <div>
      <PageHeader
        title={`Welcome back, ${session.user.name.split(' ')[0]}`}
        subtitle={`Here's what's happening at ${session.tenant.businessName} today.`}
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {cards.map(({ label, value, sub, icon: Icon, href, color }) => (
          <Link key={label} href={href}>
            <Card className="group p-5 transition hover:shadow-md">
              <div className={`mb-4 inline-flex h-10 w-10 items-center justify-center rounded-xl ${color}`}>
                <Icon size={19} />
              </div>
              <p className="text-2xl font-bold tracking-tight">{value}</p>
              <p className="mt-0.5 text-sm text-slate-500">{label} · {sub}</p>
              <p className="mt-3 flex items-center gap-1 text-xs font-medium text-indigo-600 opacity-0 transition group-hover:opacity-100">
                Open <ArrowRight size={12} />
              </p>
            </Card>
          </Link>
        ))}
      </div>

      {/* Last-24h summary */}
      <Card className="mt-6 p-6">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-semibold">Last 24 hours</h2>
          <div className="flex items-center gap-3">
            {mailMsg && <span className="text-sm text-slate-500">{mailMsg}</span>}
            <Button variant="secondary" onClick={emailBriefing} loading={mailing}>
              <Mail size={14} /> Email me this briefing
            </Button>
          </div>
        </div>
        {!daily ? (
          <p className="text-sm text-slate-400">Loading…</p>
        ) : (
          <div className="flex flex-wrap items-center gap-8">
            <div>
              <p className="text-2xl font-bold tracking-tight">{daily.orders}</p>
              <p className="text-sm text-slate-500">new orders</p>
            </div>
            <div>
              <p className="text-2xl font-bold tracking-tight">{money(daily.revenue)}</p>
              <p className="text-sm text-slate-500">revenue</p>
            </div>
            <div className="min-w-0">
              <p className="truncate text-2xl font-bold tracking-tight">{daily.topAd ? daily.topAd.title : '—'}</p>
              <p className="text-sm text-slate-500">{daily.topAd ? `top ad · ${money(daily.topAd.revenue)}` : 'no ad-driven orders'}</p>
            </div>
          </div>
        )}
      </Card>

      {/* Order pipeline at a glance */}
      <Card className="mt-6 p-6">
        <h2 className="mb-4 font-semibold">Order pipeline</h2>
        <div className="flex flex-wrap gap-6">
          {['DRAFT', 'CONFIRMED', 'DISPATCHED', 'DELIVERED', 'RETURNED', 'CANCELLED'].map((status) => (
            <div key={status} className="flex items-center gap-2">
              <span className="text-xl font-bold">{stats.orders[status] || 0}</span>
              <Badge label={status} />
            </div>
          ))}
        </div>
      </Card>

      <Card className="mt-6 border-dashed p-6 text-sm text-slate-500">
        <b className="text-slate-700">Getting started:</b> connect a channel in{' '}
        <Link href="/dashboard/settings" className="text-indigo-600 hover:underline">Settings</Link>, add products in{' '}
        <Link href="/dashboard/inventory" className="text-indigo-600 hover:underline">Inventory</Link>, then reply to customer chats in the{' '}
        <Link href="/dashboard/inbox" className="text-indigo-600 hover:underline">Inbox</Link> — the AI turns each chat into a draft order.
      </Card>
    </div>
  );
}
