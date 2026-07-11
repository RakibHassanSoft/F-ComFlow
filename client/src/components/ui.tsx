// Small reusable UI pieces used on every page.
// Keeping them in one file makes the design consistent and easy to tweak.
'use client';
import { ReactNode } from 'react';
import { X, Loader2 } from 'lucide-react';

// ---------- Card ----------
export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div className={`rounded-2xl border border-slate-200 bg-white shadow-sm ${className}`}>
      {children}
    </div>
  );
}

// ---------- Buttons ----------
const buttonStyles = {
  primary: 'bg-indigo-600 text-white hover:bg-indigo-700 shadow-sm',
  secondary: 'bg-white text-slate-700 border border-slate-300 hover:bg-slate-50',
  danger: 'bg-white text-red-600 border border-red-200 hover:bg-red-50',
  success: 'bg-emerald-600 text-white hover:bg-emerald-700 shadow-sm',
};

export function Button({
  children, onClick, variant = 'primary', disabled = false, loading = false, type = 'button', className = '',
}: {
  children: ReactNode;
  onClick?: () => void;
  variant?: keyof typeof buttonStyles;
  disabled?: boolean;
  loading?: boolean;
  type?: 'button' | 'submit';
  className?: string;
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled || loading}
      className={`inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition
        disabled:cursor-not-allowed disabled:opacity-50 ${buttonStyles[variant]} ${className}`}
    >
      {loading && <Loader2 size={15} className="animate-spin" />}
      {children}
    </button>
  );
}

// ---------- Status badges ----------
const badgeColors: Record<string, string> = {
  DRAFT: 'bg-slate-100 text-slate-600',
  CONFIRMED: 'bg-blue-50 text-blue-700',
  DISPATCHED: 'bg-amber-50 text-amber-700',
  DELIVERED: 'bg-emerald-50 text-emerald-700',
  RETURNED: 'bg-orange-50 text-orange-700',
  CANCELLED: 'bg-red-50 text-red-600',
  UNPAID: 'bg-slate-100 text-slate-600',
  PARTIAL: 'bg-amber-50 text-amber-700',
  PAID: 'bg-emerald-50 text-emerald-700',
  PENDING: 'bg-amber-50 text-amber-700',
  LOW: 'bg-emerald-50 text-emerald-700',
  MEDIUM: 'bg-amber-50 text-amber-700',
  HIGH: 'bg-red-50 text-red-700',
  MESSENGER: 'bg-blue-50 text-blue-700',
  INSTAGRAM: 'bg-pink-50 text-pink-700',
  WHATSAPP: 'bg-emerald-50 text-emerald-700',
  TELEGRAM: 'bg-sky-50 text-sky-700',
  VIBER: 'bg-purple-50 text-purple-700',
  WEBCHAT: 'bg-teal-50 text-teal-700',
  EMAIL: 'bg-slate-100 text-slate-700',
};

export function Badge({ label }: { label: string }) {
  return (
    <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold ${badgeColors[label] || 'bg-slate-100 text-slate-600'}`}>
      {label}
    </span>
  );
}

// ---------- Modal ----------
export function Modal({
  title, open, onClose, children, wide = false,
}: {
  title: string;
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-sm" onClick={onClose}>
      <div
        className={`max-h-[90vh] w-full ${wide ? 'max-w-2xl' : 'max-w-md'} overflow-y-auto rounded-2xl bg-white p-6 shadow-xl`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">{title}</h2>
          <button onClick={onClose} className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600">
            <X size={18} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

// ---------- Form input ----------
export function Field({
  label, value, onChange, type = 'text', placeholder = '', warn = false,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  placeholder?: string;
  warn?: boolean; // true = AI was unsure about this field — highlight it
}) {
  return (
    <label className="block">
      <span className="mb-1 flex items-center gap-2 text-sm font-medium text-slate-700">
        {label}
        {warn && <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700">CHECK THIS</span>}
      </span>
      <input
        type={type}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className={`w-full rounded-lg border px-3 py-2 text-sm outline-none transition focus:ring-2
          ${warn ? 'border-amber-300 bg-amber-50 focus:ring-amber-200' : 'border-slate-300 focus:border-indigo-400 focus:ring-indigo-100'}`}
      />
    </label>
  );
}

// ---------- Page header ----------
export function PageHeader({ title, subtitle, action }: { title: string; subtitle?: string; action?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
        {subtitle && <p className="mt-0.5 text-sm text-slate-500">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

// ---------- Empty state ----------
export function EmptyState({ icon, title, hint }: { icon: ReactNode; title: string; hint: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <div className="mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-100 text-slate-400">{icon}</div>
      <p className="font-medium text-slate-700">{title}</p>
      <p className="mt-1 max-w-xs text-sm text-slate-500">{hint}</p>
    </div>
  );
}

// ---------- Loading spinner ----------
export function Loading() {
  return (
    <div className="flex items-center justify-center py-20">
      <Loader2 size={28} className="animate-spin text-indigo-500" />
    </div>
  );
}
