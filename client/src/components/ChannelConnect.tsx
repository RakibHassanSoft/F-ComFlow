// One-click social channel connection (used on the Settings page).
//
//  - "Connect with Facebook": opens the official Facebook Login popup,
//    the merchant picks their Page (and linked Instagram) from a list.
//  - "Connect WhatsApp": opens Meta's Embedded Signup popup, which walks
//    the merchant through linking their WhatsApp Business number.
//  - "Advanced" section keeps the manual paste-a-token option.
//
// Requires NEXT_PUBLIC_META_APP_ID in client/.env.local. Without it, the
// one-click buttons explain what's missing and manual mode still works.
'use client';
import { useCallback, useEffect, useState } from 'react';
import { Facebook, MessageCircle, Send, Phone, Globe, Mail, Link2, Trash2, CheckCircle2, ChevronDown, Music2, AtSign } from 'lucide-react';
import { api, API_ORIGIN } from '@/lib/api';
import { Button, Field, Modal } from '@/components/ui';
import { useSession } from '@/lib/session';

declare global {
  interface Window { FB: any; fbAsyncInit: () => void; }
}

const META_APP_ID = process.env.NEXT_PUBLIC_META_APP_ID || '';
const WA_CONFIG_ID = process.env.NEXT_PUBLIC_META_WA_CONFIG_ID || '';

interface Connection {
  id: string;
  type: 'MESSENGER' | 'INSTAGRAM' | 'WHATSAPP' | 'TELEGRAM' | 'VIBER' | 'WEBCHAT' | 'EMAIL';
  externalId: string; label: string | null; tokenPreview: string;
}
interface FbPage { id: string; name: string; igId: string | null; igUsername: string | null }

const CHANNEL_META = {
  MESSENGER: { name: 'Facebook Page (Messenger)', idLabel: 'Facebook Page ID', tokenLabel: 'Page access token' },
  INSTAGRAM: { name: 'Instagram (Business/Creator)', idLabel: 'Instagram account ID', tokenLabel: 'Page access token' },
  WHATSAPP: { name: 'WhatsApp Business (Cloud API)', idLabel: 'Phone number ID', tokenLabel: 'System-user access token' },
  TELEGRAM: { name: 'Telegram bot', idLabel: 'Bot ID', tokenLabel: 'Bot token (from @BotFather)' },
  VIBER: { name: 'Viber bot', idLabel: 'Bot account ID', tokenLabel: 'Auth token (partners.viber.com)' },
  WEBCHAT: { name: 'Website chat widget', idLabel: 'Widget ID', tokenLabel: 'Not needed (enter "-")' },
  EMAIL: { name: 'Email (support inbox)', idLabel: 'Support address', tokenLabel: 'Not needed (enter "-")' },
};

export function ChannelConnect() {
  const session = useSession();
  const [connections, setConnections] = useState<Connection[]>([]);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [sdkReady, setSdkReady] = useState(false);
  const [busy, setBusy] = useState('');

  // Telegram / Viber / Email inputs + webchat snippet visibility
  const [tgToken, setTgToken] = useState('');
  const [vbToken, setVbToken] = useState('');
  const [emAddr, setEmAddr] = useState('');
  const [openPanel, setOpenPanel] = useState(''); // which extra-channel panel is open

  // Facebook page-picker state
  const [pages, setPages] = useState<FbPage[] | null>(null);
  const [llToken, setLlToken] = useState('');
  const [pickedPage, setPickedPage] = useState('');
  const [withInstagram, setWithInstagram] = useState(true);

  // WhatsApp embedded-signup session info (arrives via window message events)
  const [waSession, setWaSession] = useState<{ phoneNumberId?: string; wabaId?: string }>({});

  // Manual (advanced) form
  const [showManual, setShowManual] = useState(false);
  const [mType, setMType] = useState<Connection['type']>('MESSENGER');
  const [mId, setMId] = useState('');
  const [mToken, setMToken] = useState('');

  const load = useCallback(() => {
    api.get('/channels').then(setConnections).catch(() => {});
  }, []);
  useEffect(() => { load(); }, [load]);

  // ---- Load the Facebook JS SDK once ----
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

  // ---- Listen for WhatsApp Embedded Signup session info ----
  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (!String(event.origin).includes('facebook.com')) return;
      try {
        const data = typeof event.data === 'string' ? JSON.parse(event.data) : event.data;
        if (data?.type === 'WA_EMBEDDED_SIGNUP' && data?.data) {
          setWaSession({ phoneNumberId: data.data.phone_number_id, wabaId: data.data.waba_id });
        }
      } catch { /* not our event */ }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);

  // ================= Facebook one-click =================
  function connectFacebook() {
    if (!sdkReady) return;
    setMsg(null);
    window.FB.login(
      async (response: any) => {
        const userToken = response?.authResponse?.accessToken;
        if (!userToken) { setMsg({ ok: false, text: 'Facebook login was cancelled.' }); return; }
        setBusy('fb');
        try {
          // Server exchanges for a long-lived token + lists the Pages
          const result = await api.post('/channels/oauth/facebook/pages', { userToken });
          setPages(result.pages);
          setLlToken(result.longLivedToken);
          setPickedPage(result.pages[0]?.id || '');
        } catch (e: any) {
          setMsg({ ok: false, text: e.message });
        } finally { setBusy(''); }
      },
      { scope: 'pages_show_list,pages_messaging,pages_manage_metadata,instagram_basic,instagram_manage_messages' }
    );
  }

  async function confirmFacebookPage() {
    setBusy('fbsave');
    try {
      const r = await api.post('/channels/oauth/facebook/connect', {
        longLivedToken: llToken, pageId: pickedPage, connectInstagram: withInstagram,
      });
      setMsg({ ok: true, text: 'Connected: ' + r.saved.map((s: any) => `${s.type} (${s.label})`).join(', ') });
      setPages(null); setLlToken('');
      load();
    } catch (e: any) {
      setMsg({ ok: false, text: e.message });
    } finally { setBusy(''); }
  }

  // ================= WhatsApp one-click =================
  function connectWhatsApp() {
    if (!sdkReady) return;
    setMsg(null);
    if (!WA_CONFIG_ID) {
      setMsg({ ok: false, text: 'NEXT_PUBLIC_META_WA_CONFIG_ID is not set — create an Embedded Signup configuration in the Meta app (WhatsApp → Embedded signup) and put its ID in client/.env.local.' });
      return;
    }
    window.FB.login(
      async (response: any) => {
        const code = response?.authResponse?.code;
        if (!code) { setMsg({ ok: false, text: 'WhatsApp signup was cancelled.' }); return; }
        setBusy('wa');
        try {
          const r = await api.post('/channels/oauth/whatsapp/connect', {
            code, phoneNumberId: waSession.phoneNumberId, wabaId: waSession.wabaId,
          });
          setMsg({ ok: true, text: 'Connected: WHATSAPP (' + r.saved[0].label + ')' });
          load();
        } catch (e: any) {
          setMsg({ ok: false, text: e.message });
        } finally { setBusy(''); }
      },
      {
        config_id: WA_CONFIG_ID,
        response_type: 'code',
        override_default_response_type: true,
        extras: { setup: {}, sessionInfoVersion: '3' },
      }
    );
  }

  // ================= Telegram / Viber / Webchat / Email =================
  // These need NO Meta app and NO approval — Telegram especially can be
  // fully live in minutes: create a bot with @BotFather, paste the token.
  async function connectSimple(kind: 'telegram' | 'viber' | 'webchat' | 'email', body: object) {
    setBusy(kind); setMsg(null);
    try {
      const r = await api.post(`/channels/connect/${kind}`, body);
      setMsg({ ok: true, text: 'Connected: ' + r.saved.map((s: any) => `${s.type} (${s.label})`).join(', ') });
      setTgToken(''); setVbToken(''); setEmAddr(''); setOpenPanel('');
      load();
    } catch (e: any) {
      setMsg({ ok: false, text: e.message });
    } finally { setBusy(''); }
  }

  const widgetSnippet = `<script src="${API_ORIGIN}/api/livechat/widget.js" data-tenant="${session.tenant.id}"></script>`;

  // ================= manual + shared =================
  async function connectManual() {
    setBusy('manual'); setMsg(null);
    try {
      const r = await api.post('/channels', { type: mType, externalId: mId, accessToken: mToken });
      setMsg({ ok: true, text: `Connected. Meta verified: "${r.verified}"` });
      setMId(''); setMToken('');
      load();
    } catch (e: any) {
      setMsg({ ok: false, text: e.message });
    } finally { setBusy(''); }
  }
  async function testChannel(id: string) {
    const r = await api.post(`/channels/${id}/test`);
    setMsg({ ok: r.ok, text: r.ok ? `Live check passed: "${r.detail}"` : `Failed: ${r.detail}` });
  }
  async function disconnect(id: string) {
    await api.post(`/channels/${id}/disconnect`);
    load();
  }

  return (
    <div>
      {/* existing connections */}
      <div className="mt-4 space-y-2">
        {connections.length === 0 && (
          <p className="rounded-lg bg-slate-50 px-4 py-3 text-sm text-slate-500">
            No channels connected yet — the inbox runs on simulated messages until you connect one.
          </p>
        )}
        {connections.map((c) => (
          <div key={c.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 p-3">
            <div>
              <p className="text-sm font-semibold">{CHANNEL_META[c.type].name}</p>
              <p className="text-xs text-slate-500">{c.label ? `${c.label} · ` : ''}{c.externalId} · token {c.tokenPreview}</p>
            </div>
            <div className="flex gap-2">
              <Button variant="secondary" onClick={() => testChannel(c.id)}><CheckCircle2 size={14} /> Test</Button>
              <Button variant="danger" onClick={() => disconnect(c.id)}><Trash2 size={14} /> Disconnect</Button>
            </div>
          </div>
        ))}
      </div>

      {/* one-click buttons */}
      <div className="mt-5 grid gap-3 sm:grid-cols-2">
        <button
          onClick={connectFacebook}
          disabled={!META_APP_ID || !sdkReady || busy !== ''}
          className="flex items-center justify-center gap-2 rounded-xl bg-[#1877F2] px-4 py-3 text-sm font-semibold text-white transition hover:bg-[#0f6ae0] disabled:opacity-50"
        >
          <Facebook size={17} /> {busy === 'fb' ? 'Loading your Pages…' : 'Connect with Facebook'}
        </button>
        <button
          onClick={connectWhatsApp}
          disabled={!META_APP_ID || !sdkReady || busy !== ''}
          className="flex items-center justify-center gap-2 rounded-xl bg-[#25D366] px-4 py-3 text-sm font-semibold text-white transition hover:bg-[#1eb857] disabled:opacity-50"
        >
          <MessageCircle size={17} /> {busy === 'wa' ? 'Connecting…' : 'Connect WhatsApp'}
        </button>
      </div>
      {!META_APP_ID && (
        <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700">
          One-click connect needs <b>NEXT_PUBLIC_META_APP_ID</b> in client/.env.local (your Meta app's App ID).
          See docs/CONNECT_CHANNELS.md. Manual connect below works without it.
        </p>
      )}

      {msg && (
        <p className={`mt-3 rounded-lg px-3 py-2 text-sm ${msg.ok ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-600'}`}>
          {msg.text}
        </p>
      )}

      {/* ---------- More channels: Telegram, Viber, Website chat, Email ---------- */}
      <p className="mt-6 text-xs font-bold uppercase tracking-wide text-slate-400">More channels — no Meta approval needed</p>
      <div className="mt-2 grid gap-2 sm:grid-cols-2">
        {/* Telegram */}
        <div className="rounded-xl border border-slate-200 p-3">
          <button onClick={() => setOpenPanel(openPanel === 'tg' ? '' : 'tg')} className="flex w-full items-center gap-2 text-sm font-semibold">
            <Send size={15} className="text-sky-500" /> Telegram <span className="ml-auto text-xs font-normal text-emerald-600">free · instant</span>
          </button>
          {openPanel === 'tg' && (
            <div className="mt-3 space-y-2">
              <p className="text-xs text-slate-500">Create a bot with <b>@BotFather</b> in Telegram (2 min), paste its token:</p>
              <Field label="Bot token" value={tgToken} onChange={setTgToken} placeholder="123456:ABC-DEF…" />
              <Button className="w-full" loading={busy === 'telegram'} disabled={!tgToken}
                onClick={() => connectSimple('telegram', { botToken: tgToken })}>Connect Telegram</Button>
            </div>
          )}
        </div>
        {/* Viber */}
        <div className="rounded-xl border border-slate-200 p-3">
          <button onClick={() => setOpenPanel(openPanel === 'vb' ? '' : 'vb')} className="flex w-full items-center gap-2 text-sm font-semibold">
            <Phone size={15} className="text-purple-500" /> Viber <span className="ml-auto text-xs font-normal text-slate-400">bot API</span>
          </button>
          {openPanel === 'vb' && (
            <div className="mt-3 space-y-2">
              <p className="text-xs text-slate-500">Create a bot at <b>partners.viber.com</b>, paste its auth token:</p>
              <Field label="Auth token" value={vbToken} onChange={setVbToken} placeholder="4xxxxxxx-…" />
              <Button className="w-full" loading={busy === 'viber'} disabled={!vbToken}
                onClick={() => connectSimple('viber', { authToken: vbToken })}>Connect Viber</Button>
            </div>
          )}
        </div>
        {/* Website widget */}
        <div className="rounded-xl border border-slate-200 p-3">
          <button onClick={() => setOpenPanel(openPanel === 'web' ? '' : 'web')} className="flex w-full items-center gap-2 text-sm font-semibold">
            <Globe size={15} className="text-teal-500" /> Website chat widget <span className="ml-auto text-xs font-normal text-emerald-600">100% ours</span>
          </button>
          {openPanel === 'web' && (
            <div className="mt-3 space-y-2">
              <p className="text-xs text-slate-500">Paste this ONE line into your website — a chat bubble appears and messages land in this inbox:</p>
              <code className="block break-all rounded-lg bg-slate-900 px-3 py-2 text-[11px] leading-relaxed text-emerald-300">{widgetSnippet}</code>
              <Button className="w-full" loading={busy === 'webchat'}
                onClick={() => connectSimple('webchat', {})}>Enable widget</Button>
            </div>
          )}
        </div>
        {/* Email */}
        <div className="rounded-xl border border-slate-200 p-3">
          <button onClick={() => setOpenPanel(openPanel === 'em' ? '' : 'em')} className="flex w-full items-center gap-2 text-sm font-semibold">
            <Mail size={15} className="text-slate-500" /> Email <span className="ml-auto text-xs font-normal text-slate-400">support inbox</span>
          </button>
          {openPanel === 'em' && (
            <div className="mt-3 space-y-2">
              <p className="text-xs text-slate-500">Register your support address. Inbound mail arrives via your provider&apos;s webhook; replies go out via SMTP (server/.env).</p>
              <Field label="Support address" value={emAddr} onChange={setEmAddr} placeholder="support@yourshop.com" />
              <Button className="w-full" loading={busy === 'email'} disabled={!emAddr}
                onClick={() => connectSimple('email', { address: emAddr })}>Connect email</Button>
            </div>
          )}
        </div>
        {/* TikTok — in development. TikTok has no open DM API; it needs a TikTok
            Business / TikTok Shop partner approval, so we surface it as coming soon. */}
        <div className="rounded-xl border border-dashed border-slate-200 p-3 opacity-80">
          <div className="flex w-full items-center gap-2 text-sm font-semibold text-slate-500">
            <Music2 size={15} className="text-slate-400" /> TikTok
            <span className="ml-auto rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-700">In development</span>
          </div>
          <p className="mt-2 text-xs text-slate-500">
            Coming soon. TikTok messaging needs a TikTok Business / TikTok Shop partner approval;
            we&apos;ll enable it here once it&apos;s granted.
          </p>
        </div>
        {/* Threads — in development. Threads has no DM API; only public replies
            (read/reply/hide) via the Threads API, which needs Meta app review. */}
        <div className="rounded-xl border border-dashed border-slate-200 p-3 opacity-80">
          <div className="flex w-full items-center gap-2 text-sm font-semibold text-slate-500">
            <AtSign size={15} className="text-slate-400" /> Threads
            <span className="ml-auto rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-700">In development</span>
          </div>
          <p className="mt-2 text-xs text-slate-500">
            Coming soon. Threads has no private-message API — only public replies on your posts.
            We&apos;ll add reply management here once the Threads API is connected.
          </p>
        </div>
      </div>

      {/* Facebook page picker */}
      <Modal title="Choose the Page to connect" open={!!pages} onClose={() => setPages(null)}>
        {pages && (
          <div className="space-y-2">
            {pages.map((p) => (
              <label key={p.id}
                className={`flex cursor-pointer items-center gap-3 rounded-xl border p-3 ${pickedPage === p.id ? 'border-indigo-400 bg-indigo-50/50' : 'border-slate-200'}`}>
                <input type="radio" name="page" checked={pickedPage === p.id} onChange={() => setPickedPage(p.id)} />
                <div>
                  <p className="text-sm font-semibold">{p.name}</p>
                  <p className="text-xs text-slate-500">
                    Page {p.id}{p.igUsername ? ` · linked Instagram @${p.igUsername}` : ' · no linked Instagram'}
                  </p>
                </div>
              </label>
            ))}
            {pages.find((p) => p.id === pickedPage)?.igId && (
              <label className="flex items-center gap-2 px-1 text-sm">
                <input type="checkbox" checked={withInstagram} onChange={(e) => setWithInstagram(e.target.checked)} />
                Also connect the linked Instagram account
              </label>
            )}
            <Button className="w-full" loading={busy === 'fbsave'} onClick={confirmFacebookPage}>
              Connect this Page
            </Button>
          </div>
        )}
      </Modal>

      {/* manual (advanced) */}
      <button
        onClick={() => setShowManual(!showManual)}
        className="mt-5 flex items-center gap-1.5 text-sm font-medium text-slate-500 hover:text-slate-800"
      >
        <ChevronDown size={15} className={showManual ? 'rotate-180 transition' : 'transition'} />
        Advanced: connect manually with an ID + token
      </button>
      {showManual && (
        <div className="mt-3 space-y-3 rounded-xl bg-slate-50 p-4">
          <label className="block">
            <span className="mb-1 block text-sm font-medium text-slate-700">Channel type</span>
            <select value={mType} onChange={(e) => setMType(e.target.value as Connection['type'])}
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-indigo-400">
              {Object.entries(CHANNEL_META).map(([k, v]) => <option key={k} value={k}>{v.name}</option>)}
            </select>
          </label>
          <Field label={CHANNEL_META[mType].idLabel} value={mId} onChange={setMId} placeholder="e.g. 1234567890" />
          <Field label={CHANNEL_META[mType].tokenLabel} value={mToken} onChange={setMToken} placeholder="EAAG… / long-lived token" />
          <Button onClick={connectManual} loading={busy === 'manual'} disabled={!mId || !mToken} className="w-full">
            <Link2 size={15} /> Verify &amp; connect
          </Button>
        </div>
      )}

      {/* webhook info */}
      <div className="mt-4 rounded-xl border border-dashed border-slate-300 p-4 text-sm">
        <p className="font-semibold">Webhook URL (set once in your Meta app)</p>
        <code className="mt-1 block break-all rounded-lg bg-slate-900 px-3 py-2 text-xs text-emerald-300">{API_ORIGIN}/api/meta/webhook</code>
        <p className="mt-2 text-xs text-slate-500">
          One URL serves Messenger, Instagram and WhatsApp for ALL merchants. Verify token lives in server/.env
          (META_VERIFY_TOKEN). Every event is HMAC-signature-checked. Pages connected via the blue button are
          auto-subscribed — no dashboard work per merchant.
        </p>
      </div>
    </div>
  );
}
