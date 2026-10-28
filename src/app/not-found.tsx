import Link from 'next/link';
import { Logo } from '@/components/Logo';

export default function NotFound() {
  return (
    <div className="grid min-h-screen place-items-center px-6 text-center">
      <div>
        <Logo className="mb-8" />
        <p className="grad-text text-7xl font-black">404</p>
        <h1 className="mt-3 text-2xl font-bold">This page drifted out of range</h1>
        <p className="mt-2 text-muted">The page you’re looking for doesn’t exist or has moved.</p>
        <Link href="/" className="mt-6 inline-flex h-11 items-center rounded-xl bg-gradient-to-r from-brand to-accent px-6 text-sm font-semibold text-white">Back to VYNKO</Link>
      </div>
    </div>
  );
}
