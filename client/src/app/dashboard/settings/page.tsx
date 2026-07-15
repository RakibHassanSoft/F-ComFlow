// Settings — profile, channel connections, risk threshold, automation
// (auto-status + business-hours away reply) and quick-reply templates.
'use client';
import { useEffect, useState } from 'react';
import { Plug, MessageSquarePlus, Trash2, Clock, Users } from 'lucide-react';
import { api } from '@/lib/api';
import { Button, Card, Field, PageHeader } from '@/components/ui';
import { useSession } from '@/lib/session';
import { ChannelConnect } from '@/components/ChannelConnect';

interface Template { id: string; title: string; body: string }
interface TeamUser { id: string; name: string; email: string; role: string }

export default function SettingsPage() {
  const session = useSession();
  const [threshold, setThreshold] = useState(session.tenant.riskThreshold);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);

  // Automation settings
  const [autoStatus, setAutoStatus] = useState(true);
  const [away, setAway] = useState('');
  const [startHour, setStartHour] = useState<string>('');
  const [endHour, setEndHour] = useState<string>('');
  const [autoSaved, setAutoSaved] = useState(false);
  const [autoSaving, setAutoSaving] = useState(false);

  // Templates
  const [templates, setTemplates] = useState<Template[]>([]);
  const [tTitle, setTTitle] = useState('');
  const [tBody, setTBody] = useState('');
  const [tAdding, setTAdding] = useState(false);

  // Team (OWNER only)
  const isOwner = session.user.role === 'OWNER';
  const [team, setTeam] = useState<TeamUser[]>([]);
  const [uName, setUName] = useState('');
  const [uEmail, setUEmail] = useState('');
  const [uPassword, setUPassword] = useState('');
  const [uAdding, setUAdding] = useState(false);
  const [uError, setUError] = useState('');

  useEffect(() => {
    if (isOwner) api.get('/auth/users').then(setTeam).catch(() => {});
  }, [isOwner]);

  async function addAgent() {
    setUAdding(true);
    setUError('');
    try {
      const created = await api.post('/auth/users', { name: uName, email: uEmail, password: uPassword });
      setTeam((prev) => [...prev, created]);
      setUName(''); setUEmail(''); setUPassword('');
    } catch (e: any) {
      setUError(e.message);
    } finally { setUAdding(false); }
  }

  async function removeAgent(id: string) {
    setUError('');
    try {
      await api.delete(`/auth/users/${id}`);
      setTeam((prev) => prev.filter((u) => u.id !== id));
    } catch (e: any) {
      setUError(e.message);
    }
  }

  useEffect(() => {
    api.get('/stats/settings').then((s) => {
      setThreshold(s.riskThreshold);
      setAutoStatus(Boolean(s.autoStatusMessages));
      setAway(s.awayMessage || '');
      setStartHour(s.businessHourStart == null ? '' : String(s.businessHourStart));
      setEndHour(s.businessHourEnd == null ? '' : String(s.businessHourEnd));
    }).catch(console.error);
    api.get('/templates').then(setTemplates).catch(console.error);
  }, []);

  async function saveThreshold() {
    setSaving(true);
    try {
      await api.patch('/stats/settings', { riskThreshold: threshold });
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } finally { setSaving(false); }
  }

  async function saveAutomation() {
    setAutoSaving(true);
    try {
      await api.patch('/stats/settings', {
        autoStatusMessages: autoStatus,
        awayMessage: away,
        businessHourStart: startHour === '' ? null : Number(startHour),
        businessHourEnd: endHour === '' ? null : Number(endHour),
      });
      setAutoSaved(true);
      setTimeout(() => setAutoSaved(false), 3000);
    } finally { setAutoSaving(false); }
  }

  async function addTemplate() {
    if (!tTitle.trim() || !tBody.trim()) return;
    setTAdding(true);
    try {
      const created = await api.post('/templates', { title: tTitle, body: tBody });
      setTemplates((prev) => [...prev, created]);
      setTTitle('');
      setTBody('');
    } finally { setTAdding(false); }
  }

  async function removeTemplate(id: string) {
    await api.delete(`/templates/${id}`);
    setTemplates((prev) => prev.filter((t) => t.id !== id));
  }

  return (
    <div className="max-w-2xl">
      <PageHeader title="Settings" subtitle="Your workspace configuration." />

      {/* ---------- Profile ---------- */}
      <Card className="mb-4 p-6">
        <h2 className="mb-4 font-semibold">Profile</h2>
        <dl className="space-y-3 text-sm">
          <div className="flex justify-between border-b border-slate-100 pb-3">
            <dt className="text-slate-500">Business</dt><dd className="font-medium">{session.tenant.businessName}</dd>
          </div>
          <div className="flex justify-between border-b border-slate-100 pb-3">
            <dt className="text-slate-500">Name</dt><dd className="font-medium">{session.user.name}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-slate-500">Email</dt><dd className="font-medium">{session.user.email}</dd>
          </div>
        </dl>
      </Card>

      {/* ---------- Real channel connections ---------- */}
      <Card className="mb-4 p-6">
        <h2 className="flex items-center gap-2 font-semibold"><Plug size={17} /> Connected channels</h2>
        <p className="mt-1 text-sm text-slate-500">
          Connect your real Facebook Page, Instagram account or WhatsApp Business number — one click.
          Setup guide: <b>docs/CONNECT_CHANNELS.md</b>.
        </p>
        <ChannelConnect />
      </Card>

      {/* ---------- Automation (OWNER only — the server rejects agent saves) ---------- */}
      {isOwner && (
      <Card className="mb-4 p-6">
        <h2 className="flex items-center gap-2 font-semibold"><Clock size={17} /> Automation</h2>
        <p className="mt-1 text-sm text-slate-500">
          Keep customers updated without lifting a finger.
        </p>

        <label className="mt-5 flex cursor-pointer items-center justify-between gap-4">
          <span className="text-sm">
            <span className="font-medium">Order status messages</span>
            <span className="block text-slate-500">Auto-message the customer when an order is confirmed, shipped or delivered.</span>
          </span>
          <input type="checkbox" checked={autoStatus} onChange={(e) => setAutoStatus(e.target.checked)}
            className="h-5 w-5 shrink-0 accent-indigo-600" />
        </label>

        <div className="mt-5">
          <label className="block">
            <span className="mb-1 block text-sm font-medium text-slate-700">Away message (out of hours)</span>
            <textarea
              value={away}
              onChange={(e) => setAway(e.target.value)}
              placeholder="e.g. Thanks for your message! We're closed now and will reply by 10am 🙏"
              rows={2}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
            />
          </label>
          <p className="mt-1 text-xs text-slate-400">Leave blank to disable the auto-reply. Sent at most once every 6 hours per customer.</p>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-3">
          <Field label="Opens at (hour 0-23)" type="number" value={startHour} onChange={setStartHour} placeholder="e.g. 9" />
          <Field label="Closes at (hour 0-23)" type="number" value={endHour} onChange={setEndHour} placeholder="e.g. 22" />
        </div>
        <p className="mt-1 text-xs text-slate-400">Bangladesh time. Leave both blank to be "always open" (never send the away reply).</p>

        <div className="mt-5 flex items-center gap-3">
          <Button onClick={saveAutomation} loading={autoSaving}>Save automation</Button>
          {autoSaved && <span className="text-sm font-medium text-emerald-600">Saved ✓</span>}
        </div>
      </Card>
      )}

      {/* ---------- Team (OWNER only) ---------- */}
      {isOwner && (
        <Card className="mb-4 p-6">
          <h2 className="flex items-center gap-2 font-semibold"><Users size={17} /> Team</h2>
          <p className="mt-1 text-sm text-slate-500">
            Agents share your inbox and orders. They log in with the email and password you set here.
          </p>

          <div className="mt-4 space-y-2">
            {team.map((u) => (
              <div key={u.id} className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 p-3">
                <div className="min-w-0">
                  <p className="text-sm font-semibold">{u.name} <span className="ml-1 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-500">{u.role}</span></p>
                  <p className="truncate text-sm text-slate-500">{u.email}</p>
                </div>
                {u.role !== 'OWNER' && (
                  <button onClick={() => removeAgent(u.id)}
                    className="shrink-0 rounded-lg p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600">
                    <Trash2 size={16} />
                  </button>
                )}
              </div>
            ))}
          </div>

          <div className="mt-4 space-y-2 border-t border-slate-100 pt-4">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Name" value={uName} onChange={setUName} placeholder="e.g. Rina Akter" />
              <Field label="Email" value={uEmail} onChange={setUEmail} placeholder="rina@example.com" />
            </div>
            <Field label="Password (min 6 characters)" type="password" value={uPassword} onChange={setUPassword} placeholder="They can share this to log in" />
            {uError && <p className="text-sm text-red-600">{uError}</p>}
            <Button onClick={addAgent} loading={uAdding}
              disabled={!uName.trim() || !uEmail.trim() || uPassword.length < 6}>
              Add agent
            </Button>
          </div>
        </Card>
      )}

      {/* ---------- Quick-reply templates ---------- */}
      <Card className="mb-4 p-6">
        <h2 className="flex items-center gap-2 font-semibold"><MessageSquarePlus size={17} /> Quick-reply templates</h2>
        <p className="mt-1 text-sm text-slate-500">
          Saved replies you can drop into any chat with one tap. You can use variables:
          <code className="mx-1 rounded bg-slate-100 px-1">{'{customer}'}</code>
          <code className="mr-1 rounded bg-slate-100 px-1">{'{shop}'}</code>
          <code className="rounded bg-slate-100 px-1">{'{agent}'}</code> — filled in automatically when inserted.
        </p>

        <div className="mt-4 space-y-2">
          {templates.length === 0 && <p className="text-sm text-slate-400">No templates yet — add your first below.</p>}
          {templates.map((t) => (
            <div key={t.id} className="flex items-start justify-between gap-3 rounded-lg border border-slate-200 p-3">
              <div className="min-w-0">
                <p className="text-sm font-semibold">{t.title}</p>
                <p className="truncate text-sm text-slate-500">{t.body}</p>
              </div>
              <button onClick={() => removeTemplate(t.id)} className="shrink-0 rounded-lg p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600">
                <Trash2 size={16} />
              </button>
            </div>
          ))}
        </div>

        <div className="mt-4 space-y-2 border-t border-slate-100 pt-4">
          <Field label="Title" value={tTitle} onChange={setTTitle} placeholder="e.g. Delivery charge" />
          <label className="block">
            <span className="mb-1 block text-sm font-medium text-slate-700">Message</span>
            <textarea value={tBody} onChange={(e) => setTBody(e.target.value)} rows={2}
              placeholder="e.g. Delivery is ৳60 inside Dhaka, ৳120 outside."
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100" />
          </label>
          <Button onClick={addTemplate} loading={tAdding} disabled={!tTitle.trim() || !tBody.trim()}>Add template</Button>
        </div>
      </Card>

      {/* ---------- Risk threshold (OWNER only) ---------- */}
      {isOwner && (
      <Card className="p-6">
        <h2 className="font-semibold">COD risk threshold</h2>
        <p className="mt-1 text-sm text-slate-500">
          Orders scoring at or above this show the high-risk banner and the one-click advance-payment action.
        </p>
        <div className="mt-5 flex items-center gap-4">
          <input
            type="range" min={0} max={100} value={threshold}
            onChange={(e) => setThreshold(Number(e.target.value))}
            className="flex-1 accent-indigo-600"
          />
          <span className="w-14 rounded-lg bg-slate-100 py-1.5 text-center font-bold">{threshold}%</span>
        </div>
        <div className="mt-4 flex items-center gap-3">
          <Button onClick={saveThreshold} loading={saving}>Save</Button>
          {saved && <span className="text-sm font-medium text-emerald-600">Saved ✓</span>}
        </div>
      </Card>
      )}
    </div>
  );
}
