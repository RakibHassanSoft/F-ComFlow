// Phase 4: Inventory — product catalog with live stock and low-stock warnings.
'use client';
import { useCallback, useEffect, useState } from 'react';
import { Package, Plus, Pencil, AlertTriangle, RefreshCw } from 'lucide-react';
import { api } from '@/lib/api';
import { money } from '@/lib/format';
import { getSocket } from '@/lib/socket';
import { Button, Card, EmptyState, Field, Loading, Modal, PageHeader, ProductImage } from '@/components/ui';
import { ImageUploader } from '@/components/ImageUploader';

interface Product {
  id: string; sku: string; name: string; price: string;
  stockQuantity: number; reorderThreshold: number; imageUrl: string | null; images: string[];
}

const emptyForm = { sku: '', name: '', price: '', stockQuantity: '', reorderThreshold: '5', images: [] as string[] };

export default function InventoryPage() {
  const [products, setProducts] = useState<Product[] | null>(null);
  const [editing, setEditing] = useState<Product | null>(null); // null = closed, product = edit
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(() => {
    api.get('/products').then(setProducts).catch(console.error);
  }, []);
  useEffect(() => { load(); }, [load]);

  // LIVE: an external store (Shopify/WooCommerce webhook) just sold something —
  // the central stock changed, so refresh the table and show who did it.
  const [syncMsg, setSyncMsg] = useState('');
  useEffect(() => {
    const socket = getSocket();
    const onSynced = (data: { sku: string; stockQuantity: number }) => {
      setSyncMsg(`External store sale synced: ${data.sku} → ${data.stockQuantity} left in central stock`);
      setTimeout(() => setSyncMsg(''), 7000);
      load();
    };
    socket.on('inventory:synced', onSynced);
    return () => { socket.off('inventory:synced', onSynced); };
  }, [load]);

  function openAdd() {
    setForm(emptyForm);
    setError('');
    setShowAdd(true);
  }
  function openEdit(p: Product) {
    setForm({
      sku: p.sku, name: p.name, price: String(p.price),
      stockQuantity: String(p.stockQuantity), reorderThreshold: String(p.reorderThreshold),
      images: p.images?.length ? p.images : (p.imageUrl ? [p.imageUrl] : []),
    });
    setError('');
    setEditing(p);
  }

  async function save() {
    setSaving(true);
    setError('');
    try {
      if (editing) {
        await api.patch(`/products/${editing.id}`, {
          name: form.name, price: Number(form.price),
          stockQuantity: Number(form.stockQuantity), reorderThreshold: Number(form.reorderThreshold),
          images: form.images,
        });
      } else {
        await api.post('/products', {
          sku: form.sku, name: form.name, price: Number(form.price),
          stockQuantity: Number(form.stockQuantity), reorderThreshold: Number(form.reorderThreshold),
          images: form.images,
        });
      }
      setShowAdd(false);
      setEditing(null);
      load();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  const lowStock = products?.filter((p) => p.stockQuantity <= p.reorderThreshold) || [];

  return (
    <div>
      <PageHeader
        title="Inventory"
        subtitle="One central stock ledger — every channel sells from the same numbers."
        action={<Button onClick={openAdd}><Plus size={15} /> Add product</Button>}
      />

      {syncMsg && (
        <Card className="mb-4 flex items-center gap-3 border-indigo-200 bg-indigo-50/60 p-4">
          <RefreshCw size={18} className="shrink-0 text-indigo-500" />
          <p className="text-sm font-medium">{syncMsg}</p>
        </Card>
      )}

      {lowStock.length > 0 && (
        <Card className="mb-4 flex items-center gap-3 border-amber-200 bg-amber-50/60 p-4">
          <AlertTriangle size={18} className="shrink-0 text-amber-500" />
          <p className="text-sm">
            <b>{lowStock.length} product{lowStock.length > 1 ? 's' : ''} low on stock:</b>{' '}
            {lowStock.map((p) => p.name).join(', ')} — restock soon.
          </p>
        </Card>
      )}

      {!products ? (
        <Loading />
      ) : products.length === 0 ? (
        <Card>
          <EmptyState icon={<Package size={22} />} title="No products yet"
            hint="Add your first product so the AI parser can match it in conversations." />
        </Card>
      ) : (
        <Card className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 text-left text-xs uppercase tracking-wide text-slate-400">
                <th className="px-5 py-3">SKU</th>
                <th className="px-5 py-3">Product</th>
                <th className="px-5 py-3">Price</th>
                <th className="px-5 py-3">Stock</th>
                <th className="px-5 py-3">Reorder at</th>
                <th className="px-5 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {products.map((p) => {
                const low = p.stockQuantity <= p.reorderThreshold;
                return (
                  <tr key={p.id} className="border-b border-slate-50 transition hover:bg-slate-50/60">
                    <td className="px-5 py-3 font-mono text-xs text-slate-500">{p.sku}</td>
                    <td className="px-5 py-3">
                      <span className="flex items-center gap-3 font-medium">
                        <ProductImage src={p.imageUrl} name={p.name} size={36} />
                        {p.name}
                      </span>
                    </td>
                    <td className="px-5 py-3">{money(p.price)}</td>
                    <td className="px-5 py-3">
                      <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-bold
                        ${low ? 'bg-red-50 text-red-600' : 'bg-emerald-50 text-emerald-700'}`}>
                        {p.stockQuantity} in stock
                      </span>
                    </td>
                    <td className="px-5 py-3 text-slate-500">{p.reorderThreshold}</td>
                    <td className="px-5 py-3 text-right">
                      <button onClick={() => openEdit(p)} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700">
                        <Pencil size={15} />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
      )}

      {/* Add / edit modal */}
      <Modal
        title={editing ? `Edit ${editing.name}` : 'Add product'}
        open={showAdd || !!editing}
        onClose={() => { setShowAdd(false); setEditing(null); }}
      >
        <div className="space-y-3">
          {!editing && <Field label="SKU" value={form.sku} onChange={(v) => setForm({ ...form, sku: v })} placeholder="TSH-001" />}
          <Field label="Name" value={form.name} onChange={(v) => setForm({ ...form, name: v })} placeholder="Premium T-Shirt" />
          <Field label="Price (BDT)" type="number" value={form.price} onChange={(v) => setForm({ ...form, price: v })} placeholder="550" />
          <Field label="Stock quantity" type="number" value={form.stockQuantity} onChange={(v) => setForm({ ...form, stockQuantity: v })} placeholder="40" />
          <Field label="Reorder threshold" type="number" value={form.reorderThreshold} onChange={(v) => setForm({ ...form, reorderThreshold: v })} />
          <ImageUploader images={form.images} onChange={(imgs) => setForm({ ...form, images: imgs })} />
          {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>}
          <Button onClick={save} loading={saving} className="w-full">{editing ? 'Save changes' : 'Add product'}</Button>
        </div>
      </Modal>
    </div>
  );
}
