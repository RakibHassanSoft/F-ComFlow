// Public storefront at fcom.com/<slug> — link-only shop the merchant shares.
'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { ShoppingBag, Minus, Plus, Store } from 'lucide-react';
import { api } from '@/lib/api';
import { money } from '@/lib/format';
import { StoreCheckout, CheckoutLine } from '@/components/StoreCheckout';

interface SProduct {
  id: string; name: string; price: string; discountPrice: string | null;
  imageUrl: string | null; images: string[]; stockQuantity: number;
}
interface Storefront { slug: string; name: string; description: string | null; products: SProduct[]; sslczEnabled: boolean; }

function unit(p: SProduct) { return p.discountPrice != null ? Number(p.discountPrice) : Number(p.price); }

export default function StorefrontPage({ params }: { params: { slug: string } }) {
  const { slug } = params;
  const [data, setData] = useState<Storefront | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [cart, setCart] = useState<Record<string, number>>({});

  const load = useCallback(() => {
    api.get(`/shop/${slug}`).then(setData).catch(() => setNotFound(true));
  }, [slug]);
  useEffect(() => { load(); }, [load]);

  function setQty(id: string, qty: number) {
    setCart((c) => {
      const next = { ...c };
      if (qty <= 0) delete next[id]; else next[id] = Math.min(50, qty);
      return next;
    });
  }

  const lines: CheckoutLine[] = useMemo(() => {
    if (!data) return [];
    return Object.entries(cart)
      .map(([id, quantity]) => {
        const p = data.products.find((x) => x.id === id);
        return p ? { productId: id, name: p.name, unitPrice: unit(p), quantity } : null;
      })
      .filter(Boolean) as CheckoutLine[];
  }, [cart, data]);

  if (notFound) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center bg-slate-50 p-6 text-center">
        <Store className="mb-3 text-slate-300" size={40} />
        <h1 className="text-xl font-semibold text-slate-800">Store not found</h1>
        <p className="mt-1 text-sm text-slate-500">This store link may be paused or no longer available.</p>
      </main>
    );
  }
  if (!data) {
    return <main className="flex min-h-screen items-center justify-center bg-slate-50 text-slate-400">Loading store…</main>;
  }

  return (
    <main className="min-h-screen bg-slate-50">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto max-w-5xl px-4 py-6">
          <div className="flex items-center gap-3">
            <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-indigo-600 text-white"><Store size={20} /></span>
            <div>
              <h1 className="text-xl font-bold text-slate-900">{data.name}</h1>
              {data.description && <p className="text-sm text-slate-500">{data.description}</p>}
            </div>
          </div>
        </div>
      </header>

      <div className="mx-auto grid max-w-5xl gap-6 px-4 py-8 lg:grid-cols-[1fr_340px]">
        {/* Product grid */}
        <div>
          {data.products.length === 0 ? (
            <p className="rounded-2xl border border-slate-200 bg-white p-10 text-center text-slate-500">
              This store hasn’t listed any products yet.
            </p>
          ) : (
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
              {data.products.map((p) => {
                const qty = cart[p.id] || 0;
                const soldOut = p.stockQuantity <= 0;
                return (
                  <div key={p.id} className="flex flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white">
                    <Link href={`/${slug}/products/${p.id}`} className="block aspect-square bg-slate-100">
                      {p.imageUrl
                        // eslint-disable-next-line @next/next/no-img-element
                        ? <img src={p.imageUrl} alt={p.name} className="h-full w-full object-cover" />
                        : <span className="flex h-full w-full items-center justify-center text-3xl font-bold text-slate-300">{p.name.slice(0, 1)}</span>}
                    </Link>
                    <div className="flex flex-1 flex-col p-3">
                      <Link href={`/${slug}/products/${p.id}`} className="line-clamp-2 text-sm font-medium text-slate-800 hover:text-indigo-600">{p.name}</Link>
                      <div className="mt-1 text-sm">
                        {p.discountPrice
                          ? <span><span className="text-slate-400 line-through">{money(p.price)}</span> <b>{money(p.discountPrice)}</b></span>
                          : <b>{money(p.price)}</b>}
                      </div>
                      <div className="mt-auto pt-3">
                        {soldOut ? (
                          <span className="text-xs font-semibold text-red-500">Out of stock</span>
                        ) : qty === 0 ? (
                          <button onClick={() => setQty(p.id, 1)} className="w-full rounded-lg bg-indigo-600 py-1.5 text-xs font-semibold text-white hover:bg-indigo-700">Add to cart</button>
                        ) : (
                          <div className="flex items-center justify-between rounded-lg border border-slate-200">
                            <button onClick={() => setQty(p.id, qty - 1)} className="px-2.5 py-1.5 text-slate-500 hover:text-slate-800"><Minus size={14} /></button>
                            <span className="text-sm font-semibold">{qty}</span>
                            <button onClick={() => setQty(p.id, qty + 1)} disabled={qty >= p.stockQuantity} className="px-2.5 py-1.5 text-slate-500 hover:text-slate-800 disabled:opacity-30"><Plus size={14} /></button>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Cart / checkout */}
        <aside>
          {lines.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-500">
              <ShoppingBag className="mx-auto mb-2 text-slate-300" size={26} />
              Your cart is empty. Add a product to check out.
            </div>
          ) : (
            <StoreCheckout slug={slug} lines={lines} sslczEnabled={data.sslczEnabled} onPlaced={() => setCart({})} />
          )}
        </aside>
      </div>

      <footer className="py-8 text-center text-xs text-slate-400">Powered by F-ComFlow</footer>
    </main>
  );
}
