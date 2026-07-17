// Register — new store + owner account.
'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Zap } from 'lucide-react';
import { api } from '@/lib/api';
import { Button, Field } from '@/components/ui';

export default function RegisterPage() {
  const router = useRouter();
  const [businessName, setBusinessName] = useState('');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleRegister(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await api.post('/auth/register', { businessName, name, email, password });
      router.push('/dashboard');
    } catch (err: any) {
      setError(err.message);
      setLoading(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 p-8">
      <form onSubmit={handleRegister} className="w-full max-w-sm space-y-4">
        <div className="mb-8 text-center">
          <div className="mb-3 inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-indigo-600 text-white">
            <Zap size={22} />
          </div>
          <h2 className="text-2xl font-bold">Create your store</h2>
          <p className="mt-1 text-sm text-slate-500">Your own isolated workspace, ready in seconds</p>
        </div>

        <Field label="Business name" value={businessName} onChange={setBusinessName} placeholder="Dhaka Trends BD" />
        <Field label="Your name" value={name} onChange={setName} placeholder="Rakib Hasan" />
        <Field label="Email" type="email" value={email} onChange={setEmail} placeholder="you@shop.com" />
        <Field label="Password" type="password" value={password} onChange={setPassword} placeholder="At least 6 characters" />

        {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>}

        <Button type="submit" loading={loading} className="w-full">Create store</Button>

        <p className="pt-2 text-center text-sm text-slate-500">
          Already have an account?{' '}
          <Link href="/login" className="font-medium text-indigo-600 hover:underline">Log in</Link>
        </p>
      </form>
    </main>
  );
}
