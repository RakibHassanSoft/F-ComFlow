// Sales analytics — revenue by day, by product and by district, straight from
// the orders table (cancelled orders excluded). Pure CSS bars, no chart lib.
'use client';
import { useEffect, useState } from 'react';
import { BarChart3 } from 'lucide-react';
import { api } from '@/lib/api';
import { money } from '@/lib/format';
import { Card, EmptyState, Loading, PageHeader } from '@/components/ui';

interface Analytics {
  days: number;
  totalOrders: number;
  totalRevenue: number;
  avgOrderValue: number;
  returnRate: number;
  byDay: { date: string; revenue: number; orders: number }[];
  byProduct: { name: string; revenue: number; quantity: number; orders: number }[];
  byDistrict: { district: string; revenue: number; orders: number }[];
}

const RANGES = [7, 30, 90];

export default function AnalyticsPage() {
  const [data, setData] = useState<Analytics | null>(null);
  const [days, setDays] = useState(30);

  useEffect(() => {
    setData(null);
    api.get(`/stats/analytics?days=${days}`).then(setData).catch(console.error);
  }, [days]);

  if (!data) return <Loading />;

  const maxDay = Math.max(1, ...data.byDay.map((d) => d.revenue));
  const maxProduct = Math.max(1, ...data.byProduct.map((p) => p.revenue));
  const maxDistrict = Math.max(1, ...data.byDistrict.map((d) => d.revenue));

  const summary = [
    { label: 'Revenue', value: money(data.totalRevenue) },
    { label: 'Orders', value: String(data.totalOrders) },
    { label: 'Avg order value', value: money(data.avgOrderValue) },
    { label: 'Return rate', value: `${data.returnRate}%` },
  ];

  return (
    <div>
      <PageHeader
        title="Analytics"
        subtitle={`Sales performance over the last ${days} days.`}
        action={
          <div className="flex gap-1.5">
            {RANGES.map((r) => (
              <button key={r} onClick={() => setDays(r)}
                className={`rounded-full px-3.5 py-1.5 text-xs font-semibold transition
                  ${days === r ? 'bg-slate-900 text-white' : 'bg-white text-slate-600 hover:bg-slate-100'}`}>
                {r}d
              </button>
            ))}
          </div>
        }
      />

      {/* Summary cards */}
      <div className="mb-6 grid grid-cols-2 gap-4 xl:grid-cols-4">
        {summary.map((s) => (
          <Card key={s.label} className="p-5">
            <p className="text-2xl font-bold tracking-tight">{s.value}</p>
            <p className="mt-0.5 text-sm text-slate-500">{s.label}</p>
          </Card>
        ))}
      </div>

      {data.totalOrders === 0 ? (
        <Card>
          <EmptyState icon={<BarChart3 size={22} />} title="No orders in this period"
            hint="Create a few orders (or widen the range) and the charts fill in." />
        </Card>
      ) : (
        <>
          {/* Revenue by day */}
          <Card className="mb-6 p-6">
            <h2 className="mb-4 font-semibold">Revenue by day</h2>
            <div className="flex h-40 items-end gap-[2px]">
              {data.byDay.map((d) => (
                <div key={d.date} className="group relative flex-1">
                  <div
                    className="w-full rounded-t bg-indigo-500 transition group-hover:bg-indigo-600"
                    style={{ height: `${Math.max(d.revenue > 0 ? 4 : 1, Math.round((d.revenue / maxDay) * 152))}px` }}
                  />
                  <div className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-1 hidden -translate-x-1/2 whitespace-nowrap rounded-lg bg-slate-900 px-2.5 py-1.5 text-xs text-white group-hover:block">
                    {new Date(d.date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} · {money(d.revenue)} · {d.orders} order{d.orders !== 1 ? 's' : ''}
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-2 flex justify-between text-xs text-slate-400">
              <span>{new Date(data.byDay[0].date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}</span>
              <span>{new Date(data.byDay[data.byDay.length - 1].date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}</span>
            </div>
          </Card>

          <div className="grid gap-6 lg:grid-cols-2">
            {/* Top products */}
            <Card className="p-6">
              <h2 className="mb-4 font-semibold">Top products</h2>
              <div className="space-y-3">
                {data.byProduct.slice(0, 8).map((p) => (
                  <div key={p.name}>
                    <div className="mb-1 flex items-center justify-between text-sm">
                      <span className="truncate font-medium">{p.name}</span>
                      <span className="ml-3 shrink-0 text-slate-500">{money(p.revenue)} · {p.quantity} pcs</span>
                    </div>
                    <div className="h-2 rounded-full bg-slate-100">
                      <div className="h-2 rounded-full bg-indigo-500" style={{ width: `${Math.max(2, Math.round((p.revenue / maxProduct) * 100))}%` }} />
                    </div>
                  </div>
                ))}
              </div>
            </Card>

            {/* Top districts */}
            <Card className="p-6">
              <h2 className="mb-4 font-semibold">Revenue by district</h2>
              <div className="space-y-3">
                {data.byDistrict.slice(0, 8).map((d) => (
                  <div key={d.district}>
                    <div className="mb-1 flex items-center justify-between text-sm">
                      <span className="truncate font-medium">{d.district}</span>
                      <span className="ml-3 shrink-0 text-slate-500">{money(d.revenue)} · {d.orders} order{d.orders !== 1 ? 's' : ''}</span>
                    </div>
                    <div className="h-2 rounded-full bg-slate-100">
                      <div className="h-2 rounded-full bg-emerald-500" style={{ width: `${Math.max(2, Math.round((d.revenue / maxDistrict) * 100))}%` }} />
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
