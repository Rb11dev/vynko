import Link from 'next/link';
import { MessageCircle } from 'lucide-react';

export default function ChatsHome() {
  return (
    <div className="grid h-full place-items-center p-8 text-center">
      <div>
        <div className="mx-auto mb-5 grid h-20 w-20 place-items-center rounded-3xl bg-gradient-to-br from-brand to-accent text-white shadow-glow"><MessageCircle size={34} /></div>
        <h2 className="text-2xl font-extrabold">Talk More. Feel Closer.</h2>
        <p className="mx-auto mt-2 max-w-sm text-muted">Pick a conversation, or find someone new to message or call.</p>
        <div className="mt-6 flex flex-wrap justify-center gap-3">
          <Link href="/contacts" className="rounded-xl bg-gradient-to-r from-brand to-accent px-5 py-2.5 text-sm font-semibold text-white">Find people</Link>
          <Link href="/meetings" className="rounded-xl bg-raised px-5 py-2.5 text-sm font-semibold">Start a meeting</Link>
        </div>
      </div>
    </div>
  );
}
