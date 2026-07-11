// Phase 5: Shipping — every dispatched parcel with live courier status.
'use client';
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Truck, RefreshCw, Printer } from 'lucide-react';
import { api } from '@/lib/api';
import { getSocket } from '@/lib/socket';
import { timeAgo } from '@/lib/format';
import { Badge, Button, Card, EmptyState, Loading, PageHeader } from '@/components/ui';

interface Order {
  id: string; orderNumber: number; customerName: string; district: string;
  courierName: string | null; trackingCode: string | null; courierStatus: string | null;
  status: string; createdAt: string; product: { name: string }; quantity: number;
}

// The journey each parcel walks through
const JOURNEY = ['Picked up', 'At sorting hub', 'In transit', 'Out for delivery', 'Delivered'];

export default function ShippingPage() {
  const [orders, setOrders] = useState<Order[] | null>(null);
  const [syncing, setSyncing] = useState('');

  const load = useCallback(async () => {
    // shipped = dispatched or already delivered
    const [dispatched, delivered] = await Promise.all([
      api.get('/orders?status=DISPATCHED'),
      api.get('/orders?status=DELIVERED'),
    ]);
    setOrders([...dispatched, ...delivered].filter((o: Order) => o.trackingCode));
  }, []);
  useEffect(() => { load(); }, [load]);

  // LIVE: courier webhooks / the background poller broadcast every status
  // change — the progress bars move on screen without any refresh.
  useEffect(() => {
    const socket = getSocket();
    const onUpdate = () => load();
    socket.on('order:updated', onUpdate);
    return () => { socket.off('order:updated', onUpdate); };
  }, [load]);

  async function sync(orderId: string) {
    setSyncing(orderId);
    try { await api.post(`/couriers/sync/${orderId}`); await load(); }
    finally { setSyncing(''); }
  }

  if (!orders) return <Loading />;

  return (
    <div>
      <PageHeader title="Shipping" subtitle="Booked consignments and their live tracking status." />

      {orders.length === 0 ? (
        <Card>
          <EmptyState icon={<Truck size={22} />} title="No shipments yet"
            hint="Confirm an order, then book a courier from the order page." />
        </Card>
      ) : (
        <div className="space-y-3">
          {orders.map((o) => {
            const step = JOURNEY.indexOf(o.courierStatus || '') + 1;
            return (
              <Card key={o.id} className="p-5">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <Link href={`/dashboard/orders/${o.id}`} className="font-semibold text-indigo-600 hover:underline">
                      Order #{o.orderNumber}
                    </Link>
                    <p className="text-sm text-slate-500">
                      {o.customerName} · {o.district} · {o.product.name} × {o.quantity}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge label={o.status} />
                    <span className="rounded-lg bg-slate-100 px-2.5 py-1 font-mono text-xs">{o.courierName} · {o.trackingCode}</span>
                  </div>
                </div>

                {/* Progress bar through the courier journey */}
                <div className="mt-4 flex items-center gap-1">
                  {JOURNEY.map((label, i) => (
                    <div key={label} className="flex-1">
                      <div className={`h-1.5 rounded-full ${i < step ? 'bg-indigo-500' : 'bg-slate-200'}`} />
                      <p className={`mt-1.5 text-[10px] ${i < step ? 'font-semibold text-indigo-600' : 'text-slate-400'}`}>{label}</p>
                    </div>
                  ))}
                </div>

                <div className="mt-3 flex items-center justify-between">
                  <p className="text-xs text-slate-400">Booked {timeAgo(o.createdAt)}</p>
                  <div className="flex gap-2">
                    <Link href={`/dashboard/orders/${o.id}/label`}>
                      <Button variant="secondary"><Printer size={14} /> Label</Button>
                    </Link>
                    {o.status === 'DISPATCHED' && (
                      <Button variant="secondary" onClick={() => sync(o.id)} loading={syncing === o.id}>
                        <RefreshCw size={14} /> Sync status
                      </Button>
                    )}
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
