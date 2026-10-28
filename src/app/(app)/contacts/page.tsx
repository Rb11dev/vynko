'use client';
import Link from 'next/link';
import { Ban, MessageCircle, Phone, Search, UserMinus, UserPlus, Users, Video } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { del, errMsg, get, post } from '@/lib/api';
import { presenceText } from '@/lib/format';
import type { PublicUser, UserWithPresence } from '@/lib/types';
import { useCall } from '@/context/call-context';
import { useRealtime } from '@/context/RealtimeContext';
import { Avatar, Button, EmptyState, ErrorState, Spinner } from '@/components/ui';

type Found = PublicUser & { isContact: boolean };

export default function ContactsPage() {
  const { socket } = useRealtime();
  const { startCall, call } = useCall();
  const [contacts, setContacts] = useState<UserWithPresence[]>([]);
  const [blocked, setBlocked] = useState<PublicUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [found, setFound] = useState<Found[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const busy = call.phase !== 'idle' && call.phase !== 'ended';

  const load = useCallback(async () => {
    try {
      const [c, b] = await Promise.all([get<{ contacts: UserWithPresence[] }>('/api/contacts'), get<{ blocked: PublicUser[] }>('/api/blocks')]);
      setContacts(c.contacts); setBlocked(b.blocked); setError(null);
    } catch (e) { setError(errMsg(e)); } finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    const onPresence = (p: { userId: number; online: boolean; lastSeenAt: number | null }) =>
      setContacts((cs) => cs.map((c) => (c.id === p.userId ? { ...c, online: p.online, lastSeenAt: p.lastSeenAt } : c)));
    socket.on('presence', onPresence);
    return () => { socket.off('presence', onPresence); };
  }, [socket]);

  useEffect(() => {
    const term = q.trim().replace(/^@/, '');
    if (term.length < 2) { setFound(null); return; }
    setSearching(true);
    const t = setTimeout(async () => {
      try { setFound((await get<{ users: Found[] }>(`/api/users/search?q=${encodeURIComponent(term)}`)).users); setNotice(null); }
      catch (e) { setNotice(errMsg(e)); } finally { setSearching(false); }
    }, 300);
    return () => clearTimeout(t);
  }, [q]);

  const act = async (fn: () => Promise<unknown>) => { try { setNotice(null); await fn(); await load(); } catch (e) { setNotice(errMsg(e)); } };
  const add = (u: Found) => act(async () => { await post('/api/contacts', { username: u.username }); setFound((f) => f?.map((x) => (x.id === u.id ? { ...x, isContact: true } : x)) ?? null); });

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-2xl px-4 pb-10 pt-6 safe-top">
        <h1 className="text-2xl font-extrabold">Contacts</h1>
        <label className="relative mt-4 block">
          <span className="sr-only">Find people by username</span>
          <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find people by username" className="h-11 w-full rounded-xl border border-line bg-surface pl-10 pr-3 text-sm outline-none focus:border-brand focus:ring-4 focus:ring-brand/15" />
        </label>
        {notice && <p role="alert" className="mt-3 text-sm text-danger">{notice}</p>}

        {found !== null && (
          <section className="mt-4" aria-label="Search results">
            <h2 className="mb-2 text-xs font-bold uppercase tracking-wider text-muted">Search results {searching && <Spinner className="ml-1 inline h-3 w-3" />}</h2>
            {found.length === 0 && !searching ? <p className="rounded-xl bg-raised p-4 text-sm text-muted">No users match “{q.trim()}”.</p> : (
              <ul className="divide-y divide-line rounded-2xl border border-line bg-surface">
                {found.map((u) => (
                  <li key={u.id} className="flex items-center gap-3 p-3">
                    <Avatar name={u.displayName} url={u.avatarUrl} /><div className="min-w-0 flex-1"><p className="truncate font-semibold">{u.displayName}</p><p className="text-xs text-muted">@{u.username}</p></div>
                    {u.isContact ? <span className="text-xs font-semibold text-ok">In contacts</span> : <Button size="sm" onClick={() => add(u)}><UserPlus size={15} /> Add</Button>}
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}

        <section className="mt-6" aria-label="Your contacts">
          <h2 className="mb-2 text-xs font-bold uppercase tracking-wider text-muted">Your contacts ({contacts.length})</h2>
          {loading ? <div className="grid place-items-center py-12"><Spinner /></div> : error ? <ErrorState message={error} onRetry={load} />
            : contacts.length === 0 ? <EmptyState icon={<Users size={28} />} title="No contacts yet" text="Search for a username above to add your first contact." /> : (
              <ul className="divide-y divide-line rounded-2xl border border-line bg-surface">
                {contacts.map((c) => (
                  <li key={c.id} className="flex flex-wrap items-center gap-3 p-3">
                    <Avatar name={c.displayName} url={c.avatarUrl} online={c.online} />
                    <div className="min-w-0 flex-1"><p className="truncate font-semibold">{c.displayName}</p><p className="truncate text-xs text-muted">@{c.username}{presenceText(c) ? ` · ${presenceText(c)}` : ''}</p></div>
                    <div className="flex items-center gap-0.5">
                      <Link href={`/chats/${c.id}`} aria-label={`Message ${c.displayName}`} className="grid h-10 w-10 place-items-center rounded-xl text-brand hover:bg-brand/10"><MessageCircle size={19} /></Link>
                      <button disabled={busy} onClick={() => startCall(c, 'audio')} aria-label={`Audio call ${c.displayName}`} className="grid h-10 w-10 place-items-center rounded-xl text-brand hover:bg-brand/10 disabled:opacity-40"><Phone size={19} /></button>
                      <button disabled={busy} onClick={() => startCall(c, 'video')} aria-label={`Video call ${c.displayName}`} className="grid h-10 w-10 place-items-center rounded-xl text-brand hover:bg-brand/10 disabled:opacity-40"><Video size={20} /></button>
                      <button onClick={() => act(() => del(`/api/contacts/${c.id}`))} aria-label={`Remove ${c.displayName}`} title="Remove contact" className="grid h-10 w-10 place-items-center rounded-xl text-muted hover:bg-raised"><UserMinus size={18} /></button>
                      <button onClick={() => { if (confirm(`Block ${c.displayName}? They won't be able to message or call you.`)) act(() => post('/api/blocks', { userId: c.id })); }} aria-label={`Block ${c.displayName}`} title="Block" className="grid h-10 w-10 place-items-center rounded-xl text-muted hover:bg-danger/10 hover:text-danger"><Ban size={18} /></button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
        </section>

        {blocked.length > 0 && (
          <section className="mt-8" aria-label="Blocked users">
            <h2 className="mb-2 text-xs font-bold uppercase tracking-wider text-muted">Blocked ({blocked.length})</h2>
            <ul className="divide-y divide-line rounded-2xl border border-line bg-surface">
              {blocked.map((b) => (
                <li key={b.id} className="flex items-center gap-3 p-3">
                  <Avatar name={b.displayName} url={b.avatarUrl} size={38} /><div className="flex-1"><p className="font-semibold">{b.displayName}</p><p className="text-xs text-muted">@{b.username}</p></div>
                  <Button size="sm" variant="soft" onClick={() => act(() => del(`/api/blocks/${b.id}`))}>Unblock</Button>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </div>
  );
}
