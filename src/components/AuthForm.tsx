'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState, type FormEvent } from 'react';
import { ApiError, post } from '@/lib/api';
import type { Me } from '@/lib/types';
import { useAuth } from '@/context/AuthContext';
import { Button, Input } from './ui';
import { Logo } from './Logo';
import ThemeToggle from './ThemeToggle';

// Same rules as the server (server/validate.mjs). The server always re-checks.
const checks = {
  username: (v: string) => (/^[A-Za-z0-9_]{3,20}$/.test(v.trim()) ? null : 'Use 3-20 letters, numbers or underscores.'),
  displayName: (v: string) => (v.trim().length >= 1 && v.trim().length <= 50 ? null : 'Enter a name (1-50 characters).'),
  password: (v: string) => (v.length >= 8 && v.length <= 128 ? null : 'Password must be 8-128 characters.'),
};

export default function AuthForm({ mode }: { mode: 'login' | 'signup' }) {
  const signup = mode === 'signup';
  const router = useRouter();
  const { user, loading, setUser } = useAuth();
  const [f, setF] = useState({ username: '', displayName: '', password: '' });
  const [errs, setErrs] = useState<Record<string, string | null>>({});
  const [formErr, setFormErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const nextPath = () => {
    const n = new URLSearchParams(window.location.search).get('next');
    return n && n.startsWith('/') && !n.startsWith('//') ? n : '/chats'; // only same-site paths
  };
  useEffect(() => { if (!loading && user) router.replace(nextPath()); }, [loading, user, router]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setFormErr(null);
    const next: Record<string, string | null> = { username: checks.username(f.username), password: signup ? checks.password(f.password) : f.password ? null : 'Enter your password.' };
    if (signup) next.displayName = checks.displayName(f.displayName);
    setErrs(next);
    if (Object.values(next).some(Boolean)) return;
    setBusy(true);
    try {
      const r = await post<{ user: Me }>(signup ? '/api/auth/register' : '/api/auth/login', signup ? f : { username: f.username, password: f.password });
      setUser(r.user);
      router.replace(nextPath());
    } catch (err) {
      if (err instanceof ApiError && err.field) setErrs((cur) => ({ ...cur, [err.field!]: err.message }));
      else setFormErr(err instanceof Error ? err.message : 'Something went wrong.');
    } finally { setBusy(false); }
  };

  return (
    <div className="relative grid min-h-screen place-items-center overflow-hidden px-4 py-10">
      <div aria-hidden className="pointer-events-none absolute -top-40 left-1/2 h-[480px] w-[720px] -translate-x-1/2 rounded-full bg-brand/20 blur-3xl" />
      <div className="absolute right-4 top-4"><ThemeToggle /></div>
      <div className="relative w-full max-w-md animate-rise">
        <Link href="/" className="mb-8 flex justify-center" aria-label="VYNKO home"><Logo size={42} /></Link>
        <form onSubmit={submit} noValidate className="space-y-4 rounded-3xl border border-line bg-surface p-7 shadow-xl">
          <div><h1 className="text-2xl font-extrabold">{signup ? 'Create your account' : 'Welcome back'}</h1><p className="mt-1 text-sm text-muted">{signup ? 'Talk More. Feel Closer.' : 'Sign in to continue your conversations.'}</p></div>
          <Input label="Username" name="username" autoComplete="username" autoCapitalize="none" value={f.username} error={errs.username} onChange={(e) => setF({ ...f, username: e.target.value })} placeholder="e.g. ada_lovelace" />
          {signup && <Input label="Display name" name="displayName" autoComplete="name" value={f.displayName} error={errs.displayName} onChange={(e) => setF({ ...f, displayName: e.target.value })} placeholder="Ada Lovelace" />}
          <Input label="Password" name="password" type="password" autoComplete={signup ? 'new-password' : 'current-password'} value={f.password} error={errs.password} onChange={(e) => setF({ ...f, password: e.target.value })} placeholder={signup ? 'At least 8 characters' : 'Your password'} />
          {formErr && <p role="alert" className="rounded-xl bg-danger/10 p-3 text-sm text-danger">{formErr}</p>}
          <Button type="submit" loading={busy} className="w-full" size="lg">{signup ? 'Create account' : 'Log in'}</Button>
          <p className="text-center text-sm text-muted">
            {signup ? 'Already have an account? ' : 'New to VYNKO? '}
            <Link href={signup ? '/login' : '/signup'} className="font-semibold text-brand">{signup ? 'Log in' : 'Sign up'}</Link>
          </p>
        </form>
      </div>
    </div>
  );
}
