// Phase 1: Login page — email/password plus "Sign in with Google"
// (the Google button appears only when NEXT_PUBLIC_GOOGLE_CLIENT_ID is set).
'use client';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Zap } from 'lucide-react';
import { api } from '@/lib/api';
import { Button, Field } from '@/components/ui';

const GOOGLE_CLIENT_ID = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID || '';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('demo@fcomflow.com');
  const [password, setPassword] = useState('demo1234');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const googleBtn = useRef<HTMLDivElement>(null);

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await api.post('/auth/login', { email, password });
      router.push('/dashboard');
    } catch (err: any) {
      setError(err.message);
      setLoading(false);
    }
  }

  // Google Identity Services: load the script, render the official button.
  // Google hands us an ID token; our API verifies it and sets the cookies.
  useEffect(() => {
    if (!GOOGLE_CLIENT_ID) return;

    const init = () => {
      const google = (window as any).google;
      if (!google?.accounts?.id || !googleBtn.current) return;
      google.accounts.id.initialize({
        client_id: GOOGLE_CLIENT_ID,
        callback: async (response: { credential: string }) => {
          setError('');
          try {
            await api.post('/auth/google', { credential: response.credential });
            router.push('/dashboard');
          } catch (err: any) {
            setError(err.message);
          }
        },
      });
      google.accounts.id.renderButton(googleBtn.current, {
        theme: 'outline', size: 'large', width: 336, text: 'continue_with',
      });
    };

    if ((window as any).google?.accounts?.id) { init(); return; }
    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.onload = init;
    document.head.appendChild(script);
  }, [router]);

  return (
    <main className="flex min-h-screen">
      {/* Left: brand panel */}
      <div className="hidden w-1/2 flex-col justify-between bg-gradient-to-br from-indigo-600 via-indigo-700 to-slate-900 p-12 text-white lg:flex">
        <div className="flex items-center gap-2 text-lg font-bold">
          <Zap size={22} className="text-amber-300" /> F-ComFlow
        </div>
        <div>
          <h1 className="text-4xl font-bold leading-tight">
            Run your entire<br />social commerce business<br />from one dashboard.
          </h1>
          <p className="mt-4 max-w-md text-indigo-200">
            Unified inbox · AI order parsing · live inventory · courier booking · Bangla QR payments · COD risk scores.
          </p>
        </div>
        <p className="text-sm text-indigo-300">Built for SMUCT CSE FEST 2026</p>
      </div>

      {/* Right: form */}
      <div className="flex w-full items-center justify-center p-8 lg:w-1/2">
        <form onSubmit={handleLogin} className="w-full max-w-sm space-y-4">
          <div className="mb-8">
            <h2 className="text-2xl font-bold">Welcome back</h2>
            <p className="mt-1 text-sm text-slate-500">Log in to your merchant workspace</p>
          </div>

          <Field label="Email" type="email" value={email} onChange={setEmail} placeholder="you@shop.com" />
          <Field label="Password" type="password" value={password} onChange={setPassword} placeholder="••••••••" />

          {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>}

          <Button type="submit" loading={loading} className="w-full">Log in</Button>

          {GOOGLE_CLIENT_ID && (
            <>
              <div className="flex items-center gap-3 pt-1">
                <span className="h-px flex-1 bg-slate-200" />
                <span className="text-xs text-slate-400">or</span>
                <span className="h-px flex-1 bg-slate-200" />
              </div>
              <div ref={googleBtn} className="flex justify-center" />
              <p className="text-center text-xs text-slate-400">
                First time with Google? A fresh store is created for you automatically.
              </p>
            </>
          )}

          <p className="pt-2 text-center text-sm text-slate-500">
            New here?{' '}
            <Link href="/register" className="font-medium text-indigo-600 hover:underline">Create your store</Link>
          </p>
          <p className="rounded-lg bg-slate-100 px-3 py-2 text-center text-xs text-slate-500">
            Demo login: <b>demo@fcomflow.com</b> / <b>demo1234</b> (run the seed first)
          </p>
        </form>
      </div>
    </main>
  );
}
