'use client';
import Link from 'next/link';
import { Check, Copy, ExternalLink, Link2, Video } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { errMsg, get, post } from '@/lib/api';
import { formatFull } from '@/lib/format';
import type { Meeting } from '@/lib/types';
import { Button, Card, EmptyState, ErrorState, Input, Spinner, Toggle, cn } from '@/components/ui';

const EXPIRIES = [{ v: 30, l: '30 minutes' }, { v: 60, l: '1 hour' }, { v: 1440, l: '24 hours' }, { v: 10080, l: '7 days' }];
const linkFor = (code: string) => `${window.location.origin}/m/${code}`;

function CopyButton({ code }: { code: string }) {
  const [done, setDone] = useState(false);
  return (
    <Button size="sm" variant="soft" onClick={async () => { try { await navigator.clipboard.writeText(linkFor(code)); setDone(true); setTimeout(() => setDone(false), 1800); } catch { window.prompt('Copy this link:', linkFor(code)); } }}>
      {done ? <Check size={15} /> : <Copy size={15} />} {done ? 'Copied' : 'Copy link'}
    </Button>
  );
}

export default function MeetingsPage() {
  const [title, setTitle] = useState('');
  const [expires, setExpires] = useState(60);
  const [guests, setGuests] = useState(true);
  const [creating, setCreating] = useState(false);
  const [fresh, setFresh] = useState<Meeting | null>(null);
  const [list, setList] = useState<Meeting[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    try { setList((await get<{ meetings: Meeting[] }>('/api/meetings')).meetings); setError(null); }
    catch (e) { setError(errMsg(e)); } finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const create = async () => {
    setCreating(true); setNotice(null);
    try { const r = await post<{ meeting: Meeting }>('/api/meetings', { title, expiresInMinutes: expires, allowGuests: guests }); setFresh(r.meeting); setTitle(''); await load(); }
    catch (e) { setNotice(errMsg(e)); } finally { setCreating(false); }
  };
  const act = async (code: string, what: 'end' | 'revoke') => {
    if (!confirm(what === 'end' ? 'End this meeting for everyone?' : 'Revoke this link? Nobody will be able to join with it.')) return;
    try { await post(`/api/meetings/${code}/${what}`); await load(); if (fresh?.code === code) setFresh(null); } catch (e) { setNotice(errMsg(e)); }
  };

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-2xl space-y-6 px-4 pb-10 pt-6 safe-top">
        <h1 className="text-2xl font-extrabold">Meetings</h1>
        <Card>
          <h2 className="font-bold">Start a meeting</h2>
          <p className="mb-4 text-sm text-muted">Create a private link and share it. One-to-one meetings today; the room code is ready for groups later.</p>
          <div className="space-y-3">
            <Input label="Title (optional)" value={title} maxLength={80} onChange={(e) => setTitle(e.target.value)} placeholder="Weekly catch-up" />
            <label className="block">
              <span className="mb-1.5 block text-sm font-medium">Link expires after</span>
              <select value={expires} onChange={(e) => setExpires(Number(e.target.value))} className="h-11 w-full rounded-xl border border-line bg-surface px-3 text-sm">
                {EXPIRIES.map((x) => <option key={x.v} value={x.v}>{x.l}</option>)}
              </select>
            </label>
            <Toggle checked={guests} onChange={setGuests} label="Allow guests" hint="Guests join with just a name. Turn off to require a VYNKO account." />
            {notice && <p role="alert" className="text-sm text-danger">{notice}</p>}
            <Button loading={creating} onClick={create} className="w-full"><Video size={17} /> Create meeting link</Button>
          </div>
        </Card>

        {fresh && (
          <Card className="border-brand/40 bg-brand/5">
            <p className="text-sm font-semibold text-brand">Meeting ready: {fresh.title}</p>
            <div className="mt-2 flex items-center gap-2 break-all rounded-xl bg-surface p-3 text-sm"><Link2 size={16} className="shrink-0 text-muted" />{linkFor(fresh.code)}</div>
            <div className="mt-3 flex flex-wrap gap-2"><CopyButton code={fresh.code} /><Link href={`/m/${fresh.code}`} className="inline-flex h-9 items-center gap-2 rounded-xl bg-gradient-to-r from-brand to-accent px-3 text-sm font-semibold text-white"><ExternalLink size={15} /> Join now</Link></div>
          </Card>
        )}

        <section aria-label="Your meetings">
          <h2 className="mb-2 text-xs font-bold uppercase tracking-wider text-muted">Your meetings</h2>
          {loading ? <div className="grid place-items-center py-10"><Spinner /></div> : error ? <ErrorState message={error} onRetry={load} />
            : list.length === 0 ? <EmptyState icon={<Video size={28} />} title="No meetings yet" text="Create a link above to get started." /> : (
              <ul className="divide-y divide-line rounded-2xl border border-line bg-surface">
                {list.map((m) => (
                  <li key={m.code} className="flex flex-wrap items-center gap-3 p-3">
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-semibold">{m.title}</p>
                      <p className="text-xs text-muted">Created {formatFull(m.createdAt)} · {m.allowGuests ? 'guests allowed' : 'accounts only'}</p>
                      <span className={cn('mt-1 inline-block rounded-full px-2 py-0.5 text-[11px] font-bold uppercase', m.status === 'active' ? 'bg-ok/15 text-ok' : 'bg-raised text-muted')}>{m.status}</span>
                    </div>
                    {m.status === 'active' && (
                      <div className="flex flex-wrap gap-2">
                        <CopyButton code={m.code} />
                        <Link href={`/m/${m.code}`} className="inline-flex h-9 items-center rounded-xl bg-raised px-3 text-sm font-semibold hover:bg-line">Join</Link>
                        <Button size="sm" variant="ghost" onClick={() => act(m.code, 'revoke')}>Revoke</Button>
                        <Button size="sm" variant="ghost" className="text-danger" onClick={() => act(m.code, 'end')}>End</Button>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
        </section>
      </div>
    </div>
  );
}
