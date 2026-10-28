'use client';
import { Loader2, AlertCircle, WifiOff } from 'lucide-react';
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from 'react';
import { initials } from '@/lib/format';

export const cn = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ');

type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'ghost' | 'soft' | 'danger'; size?: 'sm' | 'md' | 'lg'; loading?: boolean };
export function Button({ variant = 'primary', size = 'md', loading, className, children, disabled, ...rest }: BtnProps) {
  const base = 'inline-flex items-center justify-center gap-2 rounded-xl font-semibold transition active:scale-[0.98] disabled:opacity-50 disabled:pointer-events-none';
  const sizes = { sm: 'h-9 px-3 text-sm', md: 'h-11 px-5 text-sm', lg: 'h-12 px-7 text-base' }[size];
  const variants = {
    primary: 'bg-gradient-to-r from-brand to-accent text-white shadow-glow hover:brightness-110',
    soft: 'bg-raised text-ink hover:bg-line',
    ghost: 'text-muted hover:bg-raised hover:text-ink',
    danger: 'bg-danger text-white hover:brightness-110',
  }[variant];
  return (
    <button className={cn(base, sizes, variants, className)} disabled={disabled || loading} {...rest}>
      {loading && <Loader2 size={16} className="animate-spin" />}{children}
    </button>
  );
}

export function Input({ label, error, className, id, ...rest }: InputHTMLAttributes<HTMLInputElement> & { label?: string; error?: string | null }) {
  const iid = id ?? rest.name;
  return (
    <label className="block" htmlFor={iid}>
      {label && <span className="mb-1.5 block text-sm font-medium">{label}</span>}
      <input id={iid} aria-invalid={!!error} className={cn('h-11 w-full rounded-xl border bg-surface px-3.5 text-sm outline-none transition placeholder:text-muted/70 focus:border-brand focus:ring-4 focus:ring-brand/15', error ? 'border-danger' : 'border-line', className)} {...rest} />
      {error && <span role="alert" className="mt-1 block text-xs text-danger">{error}</span>}
    </label>
  );
}

export function Avatar({ name, url, size = 44, online }: { name: string; url?: string | null; size?: number; online?: boolean }) {
  return (
    <span className="relative inline-block shrink-0" style={{ width: size, height: size }}>
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt="" referrerPolicy="no-referrer" className="h-full w-full rounded-full object-cover" />
      ) : (
        <span className="grid h-full w-full place-items-center rounded-full bg-gradient-to-br from-brand to-accent font-bold text-white" style={{ fontSize: size * 0.38 }}>{initials(name)}</span>
      )}
      {online && <span className="absolute bottom-0 right-0 h-3 w-3 rounded-full border-2 border-surface bg-ok" title="Online" />}
    </span>
  );
}

export function Badge({ children }: { children: ReactNode }) {
  return <span className="inline-grid min-w-5 place-items-center rounded-full bg-accent px-1.5 text-[11px] font-bold leading-5 text-white">{children}</span>;
}

export const Spinner = ({ className }: { className?: string }) => <Loader2 className={cn('animate-spin text-muted', className)} />;

export function EmptyState({ icon, title, text, action }: { icon: ReactNode; title: string; text?: string; action?: ReactNode }) {
  return (
    <div className="grid place-items-center px-6 py-16 text-center">
      <div className="mb-4 grid h-16 w-16 place-items-center rounded-2xl bg-raised text-brand">{icon}</div>
      <h3 className="text-lg font-bold">{title}</h3>
      {text && <p className="mt-1 max-w-xs text-sm text-muted">{text}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="grid place-items-center px-6 py-12 text-center">
      <div className="mb-3 grid h-14 w-14 place-items-center rounded-2xl bg-danger/10 text-danger"><AlertCircle /></div>
      <p className="max-w-xs text-sm">{message}</p>
      {onRetry && <Button variant="soft" size="sm" className="mt-4" onClick={onRetry}>Try again</Button>}
    </div>
  );
}

export function ConnectionBanner({ status }: { status: 'connecting' | 'connected' | 'disconnected' }) {
  if (status === 'connected') return null;
  return (
    <div role="status" className="flex items-center justify-center gap-2 bg-danger/90 px-3 py-1.5 text-xs font-medium text-white">
      <WifiOff size={14} /> {status === 'connecting' ? 'Reconnecting to VYNKO…' : 'You are offline. Messages and calls will resume when the connection returns.'}
    </div>
  );
}

export const Card = ({ children, className }: { children: ReactNode; className?: string }) => (
  <div className={cn('rounded-2xl border border-line bg-surface p-5 shadow-sm', className)}>{children}</div>
);

export function Toggle({ checked, onChange, label, hint }: { checked: boolean; onChange: (v: boolean) => void; label: string; hint?: string }) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-4 py-2">
      <span><span className="block text-sm font-medium">{label}</span>{hint && <span className="block text-xs text-muted">{hint}</span>}</span>
      <button type="button" role="switch" aria-checked={checked} onClick={() => onChange(!checked)}
        className={cn('relative h-6 w-11 shrink-0 rounded-full transition', checked ? 'bg-brand' : 'bg-line')}>
        <span className={cn('absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all', checked ? 'left-[22px]' : 'left-0.5')} />
      </button>
    </label>
  );
}
