// Dashboard shell — auth guard, sidebar nav, live socket + notification bell.
'use client';
import { useEffect, useRef, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import Link from 'next/link';
import {
  Zap, LayoutDashboard, MessageSquare, ShoppingBag, Package, Truck, Wallet, Megaphone, Settings, LogOut, AlertTriangle, BarChart3, Users, Menu, X, Bell, FileText, Store,
} from 'lucide-react';
import { api } from '@/lib/api';
import { getSocket, joinTenantRoom } from '@/lib/socket';
import { Loading } from '@/components/ui';
import { Session, SessionContext } from '@/lib/session';
import { timeAgo } from '@/lib/format';

const NAV = [
  { href: '/dashboard', label: 'Overview', icon: LayoutDashboard },
  { href: '/dashboard/inbox', label: 'Inbox', icon: MessageSquare },
  { href: '/dashboard/orders', label: 'Orders', icon: ShoppingBag },
  { href: '/dashboard/customers', label: 'Customers', icon: Users },
  { href: '/dashboard/inventory', label: 'Inventory', icon: Package },
  { href: '/dashboard/store', label: 'Store', icon: Store },
  { href: '/dashboard/shipping', label: 'Shipping', icon: Truck },
  { href: '/dashboard/invoices', label: 'Invoices', icon: FileText },
  { href: '/dashboard/payments', label: 'Payments', icon: Wallet, ownerOnly: true }, // ledger is OWNER-gated server-side
  { href: '/dashboard/analytics', label: 'Analytics', icon: BarChart3 },
  { href: '/dashboard/ads', label: 'Ads', icon: Megaphone },
  { href: '/dashboard/settings', label: 'Settings', icon: Settings },
];

interface Notif { id: number; text: string; href: string; at: Date; read: boolean }
let notifId = 0;

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [session, setSession] = useState<Session | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [lowStock, setLowStock] = useState(0); // badge on the Inventory nav item
  const [navOpen, setNavOpen] = useState(false); // mobile off-canvas sidebar

  // Notification center
  const [notifs, setNotifs] = useState<Notif[]>([]);
  const [bellOpen, setBellOpen] = useState(false);
  const bellRef = useRef<HTMLDivElement>(null);
  const unread = notifs.filter((n) => !n.read).length;

  // Restore the session; kick to login if it's gone
  useEffect(() => {
    api.get('/auth/me')
      .then(async (data) => {
        setSession(data);
        // Get a fresh access token for the Socket.io handshake
        const { token } = await api.post('/auth/refresh');
        joinTenantRoom(token);
      })
      .catch(() => router.replace('/login'));
  }, [router]);

  // Live events -> low-stock badge + toast + notification center
  useEffect(() => {
    const refreshLowStock = () =>
      api.get('/stats').then((s) => setLowStock(s.lowStockProducts || 0)).catch(() => {});
    refreshLowStock();

    const push = (text: string, href: string) =>
      setNotifs((prev) => [{ id: ++notifId, text, href, at: new Date(), read: false }, ...prev].slice(0, 25));

    const socket = getSocket();
    const onLowStock = (d: { productName: string; stockQuantity: number }) => {
      setToast(`Low stock: ${d.productName} — only ${d.stockQuantity} left!`);
      setTimeout(() => setToast(null), 6000);
      refreshLowStock();
      push(`Low stock: ${d.productName} (${d.stockQuantity} left)`, '/dashboard/inventory');
    };
    const onMessage = (d: { message?: { direction?: string; text?: string } }) => {
      if (d.message?.direction === 'INBOUND') {
        push(`New message: ${(d.message.text || '').slice(0, 60)}`, '/dashboard/inbox');
      }
    };
    const onConversation = () => push('New conversation started', '/dashboard/inbox');
    const onPayment = () => push('Payment received — invoice settled', '/dashboard/invoices');
    const onSynced = (d: { sku?: string; stockQuantity?: number }) => {
      refreshLowStock();
      push(`External store sale synced: ${d.sku} → ${d.stockQuantity} left`, '/dashboard/inventory');
    };

    socket.on('alert:lowstock', onLowStock);
    socket.on('message:new', onMessage);
    socket.on('conversation:new', onConversation);
    socket.on('payment:settled', onPayment);
    socket.on('inventory:synced', onSynced);
    return () => {
      socket.off('alert:lowstock', onLowStock);
      socket.off('message:new', onMessage);
      socket.off('conversation:new', onConversation);
      socket.off('payment:settled', onPayment);
      socket.off('inventory:synced', onSynced);
    };
  }, []);

  // Close the bell dropdown on outside click
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (bellRef.current && !bellRef.current.contains(e.target as Node)) setBellOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  function openBell() {
    setBellOpen((open) => {
      if (!open) setNotifs((prev) => prev.map((n) => ({ ...n, read: true }))); // opening marks read
      return !open;
    });
  }

  async function logout() {
    await api.post('/auth/logout');
    router.replace('/login');
  }

  if (!session) return <Loading />;

  const isOwner = session.user.role === 'OWNER';
  const nav = NAV.filter((n) => !n.ownerOnly || isOwner);

  const bell = (
    <div ref={bellRef} className="relative">
      <button onClick={openBell} aria-label="Notifications"
        className="relative flex h-10 w-10 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500 shadow-sm transition hover:text-slate-800">
        <Bell size={17} />
        {unread > 0 && (
          <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-red-500 px-1 text-[11px] font-bold text-white">
            {unread}
          </span>
        )}
      </button>
      {bellOpen && (
        <div className="absolute right-0 top-12 z-50 max-h-96 w-80 overflow-y-auto rounded-2xl border border-slate-200 bg-white p-2 shadow-xl">
          <p className="px-3 py-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Notifications</p>
          {notifs.length === 0 ? (
            <p className="px-3 pb-4 pt-1 text-sm text-slate-400">Nothing yet — live events land here.</p>
          ) : (
            notifs.map((n) => (
              <Link key={n.id} href={n.href} onClick={() => setBellOpen(false)}
                className="block rounded-lg px-3 py-2.5 transition hover:bg-slate-50">
                <p className="text-sm text-slate-700">{n.text}</p>
                <p className="mt-0.5 text-xs text-slate-400">{timeAgo(n.at)}</p>
              </Link>
            ))
          )}
        </div>
      )}
    </div>
  );

  return (
    <SessionContext.Provider value={session}>
      <div className="flex min-h-screen">
        {/* ---------- Mobile top bar ---------- */}
        <div className="fixed inset-x-0 top-0 z-40 flex h-14 items-center gap-3 bg-slate-950 px-3 text-white lg:hidden">
          <button onClick={() => setNavOpen(!navOpen)} className="rounded-lg p-2 hover:bg-slate-800" aria-label="Toggle menu">
            {navOpen ? <X size={20} /> : <Menu size={20} />}
          </button>
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-indigo-600">
            <Zap size={14} />
          </div>
          <span className="text-sm font-bold tracking-tight">F-ComFlow</span>
          <div className="ml-auto">{bell}</div>
        </div>

        {/* ---------- Desktop bell (floats top-right) ---------- */}
        <div className="fixed right-6 top-5 z-40 hidden lg:block">{bell}</div>

        {/* ---------- Mobile scrim ---------- */}
        {navOpen && (
          <div className="fixed inset-0 z-40 bg-slate-900/50 lg:hidden" onClick={() => setNavOpen(false)} />
        )}

        {/* ---------- Sidebar ---------- */}
        <aside className={`fixed inset-y-0 left-0 z-50 flex w-60 flex-col bg-slate-950 text-slate-300 transition-transform duration-200
          ${navOpen ? 'translate-x-0 shadow-2xl' : '-translate-x-full'} lg:translate-x-0`}>
          <div className="flex items-center gap-2 px-5 py-5 text-white">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-600">
              <Zap size={16} />
            </div>
            <span className="text-[15px] font-bold tracking-tight">F-ComFlow</span>
          </div>

          <nav className="flex-1 space-y-0.5 px-3 py-2">
            {nav.map(({ href, label, icon: Icon }) => {
              const active = href === '/dashboard' ? pathname === href : pathname.startsWith(href);
              return (
                <Link
                  key={href}
                  href={href}
                  onClick={() => setNavOpen(false)}
                  className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition
                    ${active ? 'bg-indigo-600 text-white shadow' : 'hover:bg-slate-800/60 hover:text-white'}`}
                >
                  <Icon size={17} /> {label}
                  {label === 'Inventory' && lowStock > 0 && (
                    <span className="ml-auto flex h-5 min-w-5 items-center justify-center rounded-full bg-amber-500 px-1.5 text-[11px] font-bold text-white">
                      {lowStock}
                    </span>
                  )}
                </Link>
              );
            })}
          </nav>

          <div className="border-t border-slate-800 p-4">
            <p className="truncate text-sm font-semibold text-white">{session.tenant.businessName}</p>
            <p className="truncate text-xs text-slate-400">{session.user.name} · {session.user.role}</p>
            <button
              onClick={logout}
              className="mt-3 flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-slate-400 transition hover:bg-slate-800/60 hover:text-white"
            >
              <LogOut size={15} /> Log out
            </button>
          </div>
        </aside>

        {/* ---------- Main content ---------- */}
        <main className="min-w-0 flex-1 p-4 pt-20 lg:ml-60 lg:p-8">{children}</main>

        {/* ---------- Low-stock toast ---------- */}
        {toast && (
          <div className="fixed bottom-6 right-6 z-50 flex items-center gap-3 rounded-xl border border-amber-200 bg-white px-4 py-3 shadow-lg">
            <AlertTriangle size={18} className="text-amber-500" />
            <p className="text-sm font-medium">{toast}</p>
          </div>
        )}
      </div>
    </SessionContext.Provider>
  );
}
