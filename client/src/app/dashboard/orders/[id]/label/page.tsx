// Phase 5: Printable shipping label. Use the browser's print dialog to
// save as PDF — print CSS hides everything except the label itself.
'use client';
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Printer, Zap } from 'lucide-react';
import { api } from '@/lib/api';
import { money } from '@/lib/format';
import { Button, Loading } from '@/components/ui';
import { useSession } from '@/lib/session';

export default function LabelPage() {
  const { id } = useParams<{ id: string }>();
  const session = useSession();
  const [order, setOrder] = useState<any>(null);

  useEffect(() => {
    api.get(`/orders/${id}`).then(setOrder).catch(console.error);
  }, [id]);

  if (!order) return <Loading />;

  return (
    <div className="max-w-md">
      <div className="no-print mb-4 flex items-center justify-between">
        <Link href={`/dashboard/orders/${id}`} className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-800">
          <ArrowLeft size={15} /> Back to order
        </Link>
        <Button onClick={() => window.print()}><Printer size={15} /> Print / Save PDF</Button>
      </div>

      {/* The label itself */}
      <div className="rounded-xl border-2 border-slate-900 bg-white p-6">
        <div className="flex items-center justify-between border-b-2 border-dashed border-slate-300 pb-4">
          <div className="flex items-center gap-2 font-bold">
            <Zap size={18} /> {order.courierName || 'Courier'}
          </div>
          <span className="font-mono text-sm font-bold">{order.trackingCode}</span>
        </div>

        <div className="space-y-4 py-4">
          <div>
            <p className="text-xs font-bold uppercase tracking-wide text-slate-400">Deliver to</p>
            <p className="mt-1 text-lg font-bold">{order.customerName}</p>
            <p className="font-medium">{order.phone}</p>
            <p>{order.address}</p>
            <p className="font-semibold">{order.district}</p>
          </div>
          <div>
            <p className="text-xs font-bold uppercase tracking-wide text-slate-400">From</p>
            <p className="mt-1 font-medium">{session.tenant.businessName}</p>
          </div>
          <div className="flex justify-between border-t-2 border-dashed border-slate-300 pt-4">
            <div>
              <p className="text-xs font-bold uppercase tracking-wide text-slate-400">Order</p>
              <p className="font-bold">#{order.orderNumber}</p>
            </div>
            <div>
              <p className="text-xs font-bold uppercase tracking-wide text-slate-400">Item</p>
              <p className="font-medium">{order.product.name} × {order.quantity}</p>
            </div>
            <div className="text-right">
              <p className="text-xs font-bold uppercase tracking-wide text-slate-400">
                {order.paymentStatus === 'PAID' ? 'Prepaid' : 'Collect (COD)'}
              </p>
              <p className="font-bold">
                {order.paymentStatus === 'PAID' ? '—' : money(order.totalAmount)}
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
