'use client';
import { PhoneIncoming, PhoneMissed, PhoneOff, PhoneOutgoing, Phone, Video } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { errMsg, get } from '@/lib/api';
import { formatDuration, formatFull } from '@/lib/format';
import type { CallRecord } from '@/lib/types';
import { useCall } from '@/context/call-context';
import { Avatar, Button, EmptyState, ErrorState, Spinner, cn } from '@/components/ui';

const LABEL: Record<CallRecord['status'], string> = { completed: 'Completed', missed: 'Missed', unanswered: 'No answer', rejected: 'Declined', cancelled: 'Cancelled', failed: 'Failed', busy: 'Busy' };

export default function HistoryPage() {
  const { startCall, call } = useCall();
  const [items, setItems] = useState<CallRecord[]>([]);
  const [more, setMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const busy = call.phase !== 'idle' && call.phase !== 'ended';

  const load = useCallback(async (before?: number) => {
    try {
      const r = await get<{ calls: CallRecord[]; hasMore: boolean }>(`/api/calls/history?limit=30${before ? `&before=${before}` : ''}`);
      setItems((cur) => (before ? [...cur, ...r.calls] : r.calls)); setMore(r.hasMore); setError(null);
    } catch (e) { setError(errMsg(e)); } finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-2xl px-4 pb-10 pt-6 safe-top">
        <h1 className="text-2xl font-extrabold">Call history</h1>
        {loading ? <div className="grid place-items-center py-16"><Spinner /></div> : error ? <ErrorState message={error} onRetry={() => load()} />
          : items.length === 0 ? <EmptyState icon={<Phone size={28} />} title="No calls yet" text="Your audio and video calls will show up here." /> : (
            <>
              <ul className="mt-4 divide-y divide-line rounded-2xl border border-line bg-surface">
                {items.map((c) => {
                  const bad = ['missed', 'failed', 'rejected', 'busy'].includes(c.status);
                  const Icon = c.status === 'missed' ? PhoneMissed : c.status === 'failed' || c.status === 'rejected' ? PhoneOff : c.direction === 'incoming' ? PhoneIncoming : PhoneOutgoing;
                  return (
                    <li key={c.id} className="flex items-center gap-3 p-3">
                      <Avatar name={c.other.displayName} url={c.other.avatarUrl} />
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-semibold">{c.other.displayName}</p>
                        <p className={cn('flex flex-wrap items-center gap-x-2 text-xs', bad ? 'text-danger' : 'text-muted')}>
                          <span className="inline-flex items-center gap-1"><Icon size={13} /> {c.direction === 'incoming' ? 'Incoming' : 'Outgoing'} · {LABEL[c.status]}</span>
                          <span className="inline-flex items-center gap-1 text-muted">{c.type === 'video' ? <Video size={12} /> : <Phone size={12} />} {c.type}</span>
                          {c.durationSec !== null && <span className="text-muted">· {formatDuration(c.durationSec)}</span>}
                        </p>
                        <p className="text-xs text-muted">{formatFull(c.createdAt)}</p>
                      </div>
                      <button disabled={busy} onClick={() => startCall({ ...c.other }, c.type)} aria-label={`Call ${c.other.displayName} again`} className="grid h-10 w-10 place-items-center rounded-xl text-brand hover:bg-brand/10 disabled:opacity-40">{c.type === 'video' ? <Video size={20} /> : <Phone size={19} />}</button>
                    </li>
                  );
                })}
              </ul>
              {more && <div className="mt-4 text-center"><Button variant="soft" onClick={() => load(items[items.length - 1].createdAt)}>Load more</Button></div>}
            </>
          )}
      </div>
    </div>
  );
}
