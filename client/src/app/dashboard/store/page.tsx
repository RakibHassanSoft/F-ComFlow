// Store manager — create/publish the storefront. 500 setup + 10 per listed product.
'use client';
import { useCallback, useEffect, useState } from 'react';
import { Store, Plus, ExternalLink, Copy, Check, Package, CreditCard } from 'lucide-react';
import { api } from '@/lib/api';
import { money } from '@/lib/format';
import { Button, Card, Field, Loading, PageHeader, ProductImage } from '@/components/ui';

interface StoreT {
  id: string; slug: string; name: string; description: string | null;
  published: boolean; setupPaid: boolean;
}
interface ProductT {
  id: string; name: string; sku: string; price: string; discountPrice: string | null;
  imageUrl: string | null; images: string[]; stockQuantity: number; listedInStore: boolean; listingCharged: boolean;
}
interface Billing { setupFee: number; listingFee: number; unbilledListings: number; listingFeeDue: number; }
interface Payload {
  store: StoreT | null; products: ProductT[]; billing: Billing;
  sslczEnabled: boolean; storeBaseUrl: string;
}

export default function StorePage() {
  const [data, setData] = useState<Payload | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const [banner, setBanner] = useState('');

  // New-store form
  const [slug, setSlug] = useState('');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');

  const load = useCallback(() => {
    api.get('/store').then(setData).catch((e) => setError(e.message));
  }, []);
  useEffect(() => { load(); }, [load]);

  // The billing callback redirects back with ?billing=success|failed|cancelled
  // (read client-side to avoid the useSearchParams/Suspense requirement at build time)
  useEffect(() => {
    const b = new URLSearchParams(window.location.search).get('billing');
    if (b === 'success') setBanner('Payment received — thank you! Your store is updated.');
    else if (b === 'failed') setBanner('That payment did not go through. Please try again.');
    else if (b === 'cancelled') setBanner('Payment cancelled.');
  }, []);

  const store = data?.store || null;
  const publicUrl = store && typeof window !== 'undefined'
    ? `${window.location.origin}/${store.slug}`
    : '';

  async function createStore() {
    setBusy(true); setError('');
    try {
      await api.post('/store', { slug: slug.trim().toLowerCase(), name: name.trim(), description: description.trim() });
      load();
    } catch (e: any) { setError(e.message); } finally { setBusy(false); }
  }

  async function pay(purpose: 'SETUP' | 'LISTING') {
    setBusy(true); setError('');
    try {
      const res = await api.post('/store/checkout', { purpose });
      window.location.href = res.gatewayURL; // hosted SSLCOMMERZ page
    } catch (e: any) { setError(e.message); setBusy(false); }
  }

  async function simulatePay(purpose: 'SETUP' | 'LISTING') {
    setBusy(true); setError('');
    try {
      await api.post('/store/simulate-payment', { purpose });
      load();
    } catch (e: any) { setError(e.message); } finally { setBusy(false); }
  }

  async function toggleListed(p: ProductT) {
    try {
      await api.post(`/store/products/${p.id}/toggle`, {});
      load();
    } catch (e: any) { setError(e.message); }
  }

  async function setPublished(published: boolean) {
    setBusy(true);
    try { await api.patch('/store', { published }); load(); }
    catch (e: any) { setError(e.message); } finally { setBusy(false); }
  }

  function copyLink() {
    if (!publicUrl) return;
    navigator.clipboard?.writeText(publicUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  if (!data && !error) return <Loading />;

  return (
    <div>
      <PageHeader
        title="Your store"
        subtitle="A shareable storefront on your own link — sell straight from Facebook, Instagram or anywhere you post."
      />

      {banner && (
        <Card className="mb-4 border-indigo-200 bg-indigo-50/60 p-4 text-sm font-medium text-indigo-800">{banner}</Card>
      )}
      {error && (
        <Card className="mb-4 border-red-200 bg-red-50/60 p-4 text-sm text-red-700">{error}</Card>
      )}

      {/* ---------- No store yet: claim a link ---------- */}
      {data && !store && (
        <Card className="max-w-xl p-6">
          <div className="mb-4 flex items-center gap-3">
            <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600"><Store size={20} /></span>
            <div>
              <h2 className="font-semibold">Create your store</h2>
              <p className="text-sm text-slate-500">Pick your address. One-time setup fee is {money(data!.billing.setupFee)}.</p>
            </div>
          </div>
          <div className="space-y-3">
            <div>
              <Field label="Store address (slug)" value={slug}
                onChange={(v) => setSlug(v.toLowerCase().replace(/[^a-z0-9-]/g, ''))}
                placeholder="k-shop" />
              <p className="mt-1 text-xs text-slate-500">
                Your link will be{' '}
                <span className="font-mono text-slate-700">
                  {typeof window !== 'undefined' ? window.location.origin : 'fcom.com'}/{slug || 'your-store'}
                </span>
              </p>
            </div>
            <Field label="Store name" value={name} onChange={setName} placeholder="K Shop" />
            <Field label="Short description (optional)" value={description} onChange={setDescription} placeholder="Trendy fashion for everyone" />
            <Button onClick={createStore} loading={busy} disabled={!slug || !name}><Plus size={15} /> Create store</Button>
            <p className="text-xs text-slate-400">You will pay the {money(data!.billing.setupFee)} setup fee on the next step. No fee is charged until you do.</p>
          </div>
        </Card>
      )}

      {/* ---------- Store exists but setup fee unpaid ---------- */}
      {store && !store.setupPaid && (
        <Card className="mb-6 max-w-xl border-amber-200 bg-amber-50/50 p-6">
          <div className="mb-2 flex items-center gap-2 font-semibold text-amber-900">
            <CreditCard size={18} /> Activate your store
          </div>
          <p className="mb-4 text-sm text-amber-800">
            Your store <b>{store.name}</b> is reserved at{' '}
            <span className="font-mono">{publicUrl}</span>. Pay the one-time {money(data!.billing.setupFee)} setup fee to publish it.
          </p>
          <div className="flex flex-wrap gap-2">
            {data!.sslczEnabled ? (
              <Button onClick={() => pay('SETUP')} loading={busy} variant="success">
                <CreditCard size={15} /> Pay {money(data!.billing.setupFee)} with SSLCommerz
              </Button>
            ) : (
              <Button onClick={() => simulatePay('SETUP')} loading={busy} variant="secondary">
                Mark as paid (no payment gateway configured)
              </Button>
            )}
          </div>
        </Card>
      )}

      {/* ---------- Active store: link, publish, catalog ---------- */}
      {store && store.setupPaid && (
        <>
          <Card className="mb-6 p-5">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-lg font-semibold">{store.name}</h2>
                  <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold ${store.published ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
                    {store.published ? 'Live' : 'Paused'}
                  </span>
                </div>
                <div className="mt-1 flex items-center gap-2 text-sm">
                  <a href={publicUrl} target="_blank" rel="noreferrer" className="font-mono text-indigo-600 hover:underline">{publicUrl}</a>
                  <button onClick={copyLink} className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700" aria-label="Copy link">
                    {copied ? <Check size={14} className="text-emerald-600" /> : <Copy size={14} />}
                  </button>
                  <a href={publicUrl} target="_blank" rel="noreferrer" className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700" aria-label="Open store">
                    <ExternalLink size={14} />
                  </a>
                </div>
              </div>
              <Button variant={store.published ? 'secondary' : 'success'} loading={busy} onClick={() => setPublished(!store.published)}>
                {store.published ? 'Pause store' : 'Publish store'}
              </Button>
            </div>
          </Card>

          {/* Listing fees due */}
          {data!.billing.listingFeeDue > 0 && (
            <Card className="mb-6 flex flex-wrap items-center justify-between gap-3 border-indigo-200 bg-indigo-50/50 p-4">
              <p className="text-sm text-indigo-900">
                <b>{money(data!.billing.listingFeeDue)}</b> in listing fees due
                — {data!.billing.unbilledListings} new product{data!.billing.unbilledListings > 1 ? 's' : ''} at {money(data!.billing.listingFee)} each.
              </p>
              <div className="flex gap-2">
                {data!.sslczEnabled ? (
                  <Button variant="success" loading={busy} onClick={() => pay('LISTING')}>Pay {money(data!.billing.listingFeeDue)}</Button>
                ) : (
                  <Button variant="secondary" loading={busy} onClick={() => simulatePay('LISTING')}>Mark as paid</Button>
                )}
              </div>
            </Card>
          )}

          {/* Product catalog with list/unlist toggles */}
          <Card className="overflow-hidden">
            <div className="border-b border-slate-100 px-5 py-3 text-sm font-semibold text-slate-600">
              Products on your storefront
            </div>
            {data!.products.length === 0 ? (
              <div className="flex flex-col items-center py-12 text-center text-sm text-slate-500">
                <Package size={22} className="mb-2 text-slate-300" />
                Add products in Inventory first, then list them here.
              </div>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-100 text-left text-xs uppercase tracking-wide text-slate-400">
                    <th className="px-5 py-3">Product</th>
                    <th className="px-5 py-3">Price</th>
                    <th className="px-5 py-3">Stock</th>
                    <th className="px-5 py-3">On storefront</th>
                  </tr>
                </thead>
                <tbody>
                  {data!.products.map((p) => (
                    <tr key={p.id} className="border-b border-slate-50">
                      <td className="px-5 py-3">
                        <span className="flex items-center gap-3 font-medium">
                          <ProductImage src={p.imageUrl} name={p.name} size={36} />
                          {p.name}
                        </span>
                      </td>
                      <td className="px-5 py-3">
                        {p.discountPrice
                          ? <span><span className="text-slate-400 line-through">{money(p.price)}</span> {money(p.discountPrice)}</span>
                          : money(p.price)}
                      </td>
                      <td className="px-5 py-3 text-slate-500">{p.stockQuantity}</td>
                      <td className="px-5 py-3">
                        <button
                          onClick={() => toggleListed(p)}
                          className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-semibold transition
                            ${p.listedInStore ? 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'}`}
                        >
                          {p.listedInStore ? 'Listed' : 'List it'}
                          {p.listedInStore && !p.listingCharged && <span className="rounded bg-amber-100 px-1 text-[10px] text-amber-700">fee due</span>}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>
          <p className="mt-3 text-xs text-slate-400">
            Listing a product the first time adds a one-time {money(data!.billing.listingFee)} fee. Unlisting is free and never re-charges.
          </p>
        </>
      )}
    </div>
  );
}
