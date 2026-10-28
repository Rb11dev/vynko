'use client';
import { useEffect } from 'react';
import { Button } from '@/components/ui';

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => { console.error(error); }, [error]);
  return (
    <div role="alert" className="grid min-h-screen place-items-center px-6 text-center">
      <div>
        <h1 className="text-2xl font-bold">Something went wrong</h1>
        <p className="mt-2 max-w-sm text-muted">An unexpected error occurred. Your messages and calls are safe. Try again, and reload the page if it keeps happening.</p>
        <div className="mt-6 flex justify-center gap-3"><Button onClick={reset}>Try again</Button><Button variant="soft" onClick={() => location.assign('/')}>Go home</Button></div>
      </div>
    </div>
  );
}
