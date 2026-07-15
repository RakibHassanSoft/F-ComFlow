// Public single-product page — fcom.com/<slug>/products/<id>.
// Shareable deep link for one product, with its photo gallery and a buy box.
'use client';
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Minus, Plus, Store } from 'lucide-react';
import { api } from '@/lib/api';
import { money } from '@/lib/format';
import { StoreCheckout } from '@/components/StoreCheckout';

interface SProduct {
  id: string; name: string; price: string; discountPrice: string | null;
  imageUrl: string | null; images: string[]; stockQuantity: number;
}
interface Payload { store: { slug: string; name: string }; product: SProduct; sslczEnabled: boolean; }

export default function ProductPage({ params }: { params: { slug: string; productId: string } }) {
  const { slug, productId } = params;
  const [data, setData] = useState<Payload | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [active, setActive] = useState(0);
  const [qty, setQty] = useState(1);

  const load = useCallback(() => {
    api.get(`/shop/${slug}/products/${productId}`).then(setData).catch(() => setNotFound(true));
  }, [slug, productId]);
  useEffect(() => { load(); }, [load]);

  if (notFound) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center bg-slate-50 p-6 text-center">
        <Store className="mb-3 text-slate-300" size={40} />
        <h1 className="text-xl font-semibold text-slate-800">Product not available</h1>
        <Link href={`/${slug}`} className="mt-3 text-sm font-medium text-indigo-600 hover:underline">← Back to store</Link>
      </main>
    );
  }
  if (!data) {
    return <main className="flex min-h-screen items-center justify-center bg-slate-50 text-slate-400">Loading…</main>;
  }

  const p = data.product;
  const gallery = p.images?.length ? p.images : (p.imageUrl ? [p.imageUrl] : []);
  const unit = p.discountPrice != null ? Number(p.discountPrice) : Number(p.price);
  const soldOut = p.stockQuantity <= 0;

  return (
    <main className="min-h-screen bg-slate-50">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-5xl items-center gap-2 px-4 py-4">
          <Link href={`/${slug}`} className="flex items-center gap-1.5 text-sm font-medium text-slate-600 hover:text-indigo-600">
            <ArrowLeft size={16} /> {data.store.name}
          </Link>
        </div>
      </header>

      <div className="mx-auto grid max-w-5xl gap-8 px-4 py-8 md:grid-cols-2">
        {/* Gallery */}
        <div>
          <div className="aspect-square overflow-hidden rounded-2xl border border-slate-200 bg-white">
            {gallery.length > 0
              // eslint-disable-next-line @next/next/no-img-element
              ? <img src={gallery[active]} alt={p.name} className="h-full w-full object-cover" />
              : <span className="flex h-full w-full items-center justify-center text-6xl font-bold text-slate-200">{p.name.slice(0, 1)}</span>}
          </div>
          {gallery.length > 1 && (
            <div className="mt-3 flex gap-2">
              {gallery.map((src, i) => (
                <button key={src} onClick={() => setActive(i)}
                  className={`h-16 w-16 overflow-hidden rounded-lg border-2 ${i === active ? 'border-indigo-500' : 'border-slate-200'}`}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={src} alt="" className="h-full w-full object-cover" />
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Buy box */}
        <div>
          <h1 className="text-2xl font-bold text-slate-900">{p.name}</h1>
          <div className="mt-2 text-xl">
            {p.discountPrice
              ? <span><span className="text-slate-400 line-through">{money(p.price)}</span> <b className="text-slate-900">{money(p.discountPrice)}</b></span>
              : <b>{money(p.price)}</b>}
          </div>
          <p className={`mt-2 text-sm font-medium ${soldOut ? 'text-red-500' : 'text-emerald-600'}`}>
            {soldOut ? 'Out of stock' : `${p.stockQuantity} in stock`}
          </p>

          {!soldOut && (
            <>
              <div className="mt-5 flex items-center gap-3">
                <span className="text-sm text-slate-600">Quantity</span>
                <div className="flex items-center rounded-lg border border-slate-200">
                  <button onClick={() => setQty((q) => Math.max(1, q - 1))} className="px-3 py-2 text-slate-500 hover:text-slate-800"><Minus size={14} /></button>
                  <span className="w-8 text-center text-sm font-semibold">{qty}</span>
                  <button onClick={() => setQty((q) => Math.min(p.stockQuantity, q + 1))} className="px-3 py-2 text-slate-500 hover:text-slate-800"><Plus size={14} /></button>
                </div>
              </div>
              <div className="mt-6">
                <StoreCheckout
                  slug={slug}
                  sslczEnabled={data.sslczEnabled}
                  lines={[{ productId: p.id, name: p.name, unitPrice: unit, quantity: qty }]}
                />
              </div>
            </>
          )}
        </div>
      </div>
      <footer className="py-8 text-center text-xs text-slate-400">Powered by F-ComFlow</footer>
    </main>
  );
}
