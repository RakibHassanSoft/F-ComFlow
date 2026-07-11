// Ads — the feature Meta's own Ads Manager can't do:
// every conversation that arrived from a click-to-Messenger / click-to-Instagram
// / click-to-WhatsApp ad is tagged with the ad id, so this page shows
// AD -> CONVERSATIONS -> ORDERS ->
// REVENUE from our own database (works in demo mode via the simulator too).
// Connect the ad account (ads_read/ads_management) and the live campaign
// list with spend + pause/resume appears as well.
'use client';
import { useCallback, useEffect, useState } from 'react';
import { Megaphone, Facebook, Pause, Play, Unplug } from 'lucide-react';
import { api } from '@/lib/api';
import { money } from '@/lib/format';
import { Badge, Button, Card, EmptyState, Loading, Modal, PageHeader } from '@/components/ui';

declare global {
  interface Window { FB: any; fbAsyncInit: () => void; }
}
const META_APP_ID = process.env.NEXT_PUBLIC_META_APP_ID || '';

interface AttributionRow {
  adId: string; adTitle: string;
  conversations: number; orders: number; revenue: number; highRisk: number;
  spend: number | null; costPerOrder: number | null; roi: number | null;
}
interface Campaign {
  id: string; name: string; status: string; dailyBudget: number | null;
  spend: number; impressions: number; clicks: number;
}
interface AdAccount { id: string; name: string; currency: string }

// Meta's effective_status has many values beyond ACTIVE/PAUSED. Map each to a
// friendly label, a colour, and whether Pause/Resume even applies.
function campaignState(status: string): { label: string; cls: string; active: boolean; controllable: boolean } {
  switch (status) {
    case 'ACTIVE':
      return { label: 'Active', cls: 'bg-emerald-50 text-emerald-700', active: true, controllable: true };
    case 'PAUSED':
    case 'CAMPAIGN_PAUSED':
    case 'ADSET_PAUSED':
      return { label: 'Paused', cls: 'bg-slate-100 text-slate-600', active: false, controllable: true };
    case 'IN_PROCESS':
    case 'PENDING_REVIEW':
    case 'PENDING_BILLING_INFO':
    case 'PREAPPROVED':
      return { label: status.replace(/_/g, ' ').toLowerCase(), cls: 'bg-amber-50 text-amber-700', active: false, controllable: false };
    case 'WITH_ISSUES':
    case 'DISAPPROVED':
      return { label: status.replace(/_/g, ' ').toLowerCase(), cls: 'bg-red-50 text-red-600', active: false, controllable: false };
    case 'ARCHIVED':
    case 'DELETED':
      return { label: status.toLowerCase(), cls: 'bg-slate-100 text-slate-400', active: false, controllable: false };
    default:
      return { label: status.replace(/_/g, ' ').toLowerCase(), cls: 'bg-slate-100 text-slate-600', active: false, controllable: false };
  }
}

export default function AdsPage() {
  const [rows, setRows] = useState<AttributionRow[] | null>(null);
  const [status, setStatus] = useState<{ connected: boolean; accountName: string | null } | null>(null);
  const [campaigns, setCampaigns] = useState<Campaign[] | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState('');
  const [sdkReady, setSdkReady] = useState(false);

  // ad-account picker
  const [accounts, setAccounts] = useState<AdAccount[] | null>(null);
  const [picked, setPicked] = useState('');
  const [llToken, setLlToken] = useState('');

  const load = useCallback(async () => {
    const [summary, st] = await Promise.all([api.get('/ads/summary'), api.get('/ads/status')]);
    setRows(summary);
    setStatus(st);
    if (st.connected) {
      api.get('/ads/campaigns').then(setCampaigns).catch((e) => setMsg({ ok: false, text: e.message }));
    }
  }, []);
  useEffect(() => { load().catch(console.error); }, [load]);

  // Facebook SDK (same pattern as Settings)
  useEffect(() => {
    if (!META_APP_ID) return;
    if (window.FB) { setSdkReady(true); return; }
    window.fbAsyncInit = () => {
      window.FB.init({ appId: META_APP_ID, cookie: true, xfbml: false, version: 'v21.0' });
      setSdkReady(true);
    };
    const s = document.createElement('script');
    s.src = 'https://connect.facebook.net/en_US/sdk.js';
    s.async = true;
    document.body.appendChild(s);
  }, []);

  function connectAds() {
    if (!sdkReady) {
      setMsg({ ok: false, text: 'One-click connect needs NEXT_PUBLIC_META_APP_ID in client/.env.local (see docs/CONNECT_CHANNELS.md).' });
      return;
    }
    setMsg(null);
    window.FB.login(
      async (response: any) => {
        const userToken = response?.authResponse?.accessToken;
        if (!userToken) { setMsg({ ok: false, text: 'Facebook login was cancelled.' }); return; }
        setBusy('connect');
        try {
          const r = await api.post('/ads/oauth/accounts', { userToken });
          setAccounts(r.accounts);
          setLlToken(r.longLivedToken);
          setPicked(r.accounts[0]?.id || '');
        } catch (e: any) {
          setMsg({ ok: false, text: e.message });
        } finally { setBusy(''); }
      },
      { scope: 'ads_read,ads_management' }
    );
  }

  async function confirmAccount() {
    setBusy('save');
    try {
      const account = accounts?.find((a) => a.id === picked);
      await api.post('/ads/oauth/connect', { longLivedToken: llToken, accountId: picked, accountName: account?.name });
      setAccounts(null);
      setMsg({ ok: true, text: `Ad account connected: ${account?.name}` });
      load();
    } catch (e: any) {
      setMsg({ ok: false, text: e.message });
    } finally { setBusy(''); }
  }

  async function toggleCampaign(c: Campaign) {
    const next = campaignState(c.status).active ? 'PAUSED' : 'ACTIVE';
    setBusy(c.id);
    try {
      await api.post(`/ads/campaigns/${c.id}/status`, { status: next });
      setCampaigns((prev) => prev?.map((x) => (x.id === c.id ? { ...x, status: next } : x)) ?? null);
      setMsg({ ok: true, text: `Campaign ${next === 'PAUSED' ? 'paused' : 'resumed'}: ${c.name}` });
    } catch (e: any) {
      setMsg({ ok: false, text: e.message });
    } finally { setBusy(''); }
  }

  async function disconnect() {
    await api.post('/ads/disconnect');
    setCampaigns(null);
    load();
  }

  if (!rows) return <Loading />;

  return (
    <div>
      <PageHeader
        title="Ads"
        subtitle="Which ads actually turn into orders — traced through your own inbox."
        action={
          status?.connected ? (
            <div className="flex items-center gap-2">
              <span className="text-sm text-slate-500">Connected: <b>{status.accountName}</b></span>
              <Button variant="secondary" onClick={disconnect}><Unplug size={14} /> Disconnect</Button>
            </div>
          ) : (
            <Button onClick={connectAds} loading={busy === 'connect'}>
              <Facebook size={15} /> Connect ad account
            </Button>
          )
        }
      />

      {msg && (
        <p className={`mb-4 rounded-lg px-3 py-2 text-sm ${msg.ok ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-600'}`}>
          {msg.text}
        </p>
      )}

      {/* ---------- Attribution: ad -> conversations -> orders -> revenue ---------- */}
      <Card className="mb-6 overflow-x-auto">
        <div className="border-b border-slate-100 px-5 py-4">
          <h2 className="font-semibold">Ad → Order attribution</h2>
          <p className="mt-0.5 text-sm text-slate-500">
            Built from ad referral tags on incoming chats. Spend &amp; ROI fill in once you connect the ad account.
          </p>
        </div>
        {rows.length === 0 ? (
          <EmptyState icon={<Megaphone size={22} />} title="No ad-attributed conversations yet"
            hint='Simulate a few incoming messages — most carry a demo ad tag. With real channels, click-to-Messenger ads tag chats automatically.' />
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 text-left text-xs uppercase tracking-wide text-slate-400">
                <th className="px-5 py-3">Ad</th>
                <th className="px-5 py-3 text-right">Conversations</th>
                <th className="px-5 py-3 text-right">Orders</th>
                <th className="px-5 py-3 text-right">Revenue</th>
                <th className="px-5 py-3 text-right">Spend</th>
                <th className="px-5 py-3 text-right">ROI</th>
                <th className="px-5 py-3 text-right">High-risk orders</th>
                <th className="px-5 py-3 text-right">Conv → order rate</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.adId} className="border-b border-slate-50 hover:bg-slate-50/60">
                  <td className="px-5 py-3">
                    <p className="font-medium">{r.adTitle}</p>
                    <p className="text-xs text-slate-400">{r.adId}</p>
                  </td>
                  <td className="px-5 py-3 text-right font-medium">{r.conversations}</td>
                  <td className="px-5 py-3 text-right font-medium">{r.orders}</td>
                  <td className="px-5 py-3 text-right font-semibold text-emerald-600">{money(r.revenue)}</td>
                  <td className="px-5 py-3 text-right text-slate-500">{r.spend != null ? money(r.spend) : '—'}</td>
                  <td className="px-5 py-3 text-right font-medium">
                    {r.roi != null
                      ? <span className={r.roi >= 1 ? 'text-emerald-600' : 'text-red-600'}>{r.roi.toFixed(1)}×</span>
                      : <span className="text-slate-400">—</span>}
                  </td>
                  <td className="px-5 py-3 text-right">
                    {r.highRisk > 0 ? <Badge label="HIGH" /> : null}{' '}
                    <span className="text-slate-500">{r.highRisk}</span>
                  </td>
                  <td className="px-5 py-3 text-right text-slate-500">
                    {r.conversations ? Math.round((r.orders / r.conversations) * 100) : 0}%
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      {/* ---------- Live campaigns (needs the connected ad account) ---------- */}
      <Card className="overflow-x-auto">
        <div className="border-b border-slate-100 px-5 py-4">
          <h2 className="font-semibold">Live campaigns (last 30 days)</h2>
          <p className="mt-0.5 text-sm text-slate-500">
            Straight from the Meta Marketing API — pause or resume without leaving the dashboard.
          </p>
        </div>
        {!status?.connected ? (
          <EmptyState icon={<Facebook size={22} />} title="No ad account connected"
            hint='Press "Connect ad account" — one Facebook popup, pick your ad account, done.' />
        ) : !campaigns ? (
          <Loading />
        ) : campaigns.length === 0 ? (
          <EmptyState icon={<Megaphone size={22} />} title="No campaigns in this ad account"
            hint="Campaigns you create in Meta Ads Manager will show up here with spend and results." />
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 text-left text-xs uppercase tracking-wide text-slate-400">
                <th className="px-5 py-3">Campaign</th>
                <th className="px-5 py-3">Status</th>
                <th className="px-5 py-3 text-right">Spend</th>
                <th className="px-5 py-3 text-right">Impressions</th>
                <th className="px-5 py-3 text-right">Clicks</th>
                <th className="px-5 py-3 text-right">Control</th>
              </tr>
            </thead>
            <tbody>
              {campaigns.map((c) => {
                const st = campaignState(c.status);
                return (
                <tr key={c.id} className="border-b border-slate-50 hover:bg-slate-50/60">
                  <td className="px-5 py-3 font-medium">{c.name}</td>
                  <td className="px-5 py-3">
                    <span className={`badge inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold capitalize ${st.cls}`}>
                      {st.label}
                    </span>
                  </td>
                  <td className="px-5 py-3 text-right font-medium">{money(c.spend)}</td>
                  <td className="px-5 py-3 text-right text-slate-500">{c.impressions.toLocaleString()}</td>
                  <td className="px-5 py-3 text-right text-slate-500">{c.clicks.toLocaleString()}</td>
                  <td className="px-5 py-3 text-right">
                    {st.controllable ? (
                      <Button variant="secondary" loading={busy === c.id} onClick={() => toggleCampaign(c)}>
                        {st.active ? <><Pause size={14} /> Pause</> : <><Play size={14} /> Resume</>}
                      </Button>
                    ) : (
                      <span className="text-xs text-slate-400">—</span>
                    )}
                  </td>
                </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Card>

      {/* ---------- ad account picker ---------- */}
      <Modal title="Choose your ad account" open={!!accounts} onClose={() => setAccounts(null)}>
        {accounts && (
          <div className="space-y-2">
            {accounts.map((a) => (
              <label key={a.id}
                className={`flex cursor-pointer items-center gap-3 rounded-xl border p-3 ${picked === a.id ? 'border-indigo-400 bg-indigo-50/50' : 'border-slate-200'}`}>
                <input type="radio" name="acc" checked={picked === a.id} onChange={() => setPicked(a.id)} />
                <div>
                  <p className="text-sm font-semibold">{a.name}</p>
                  <p className="text-xs text-slate-500">{a.id} · {a.currency}</p>
                </div>
              </label>
            ))}
            <Button className="w-full" loading={busy === 'save'} onClick={confirmAccount}>Connect this account</Button>
          </div>
        )}
      </Modal>
    </div>
  );
}
