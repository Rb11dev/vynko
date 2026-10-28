'use client';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { AlertCircle, ArrowLeft, Check, CheckCheck, Clock, Phone, Send, UserPlus, Video, ShieldOff } from 'lucide-react';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { get, post, errMsg } from '@/lib/api';
import { formatFull, formatTime, presenceText, randomId } from '@/lib/format';
import type { Message, UserWithPresence } from '@/lib/types';
import { useAuth } from '@/context/AuthContext';
import { useChat } from '@/context/ChatContext';
import { useCall } from '@/context/call-context';
import { useRealtime } from '@/context/RealtimeContext';
import { Avatar, Button, ErrorState, Spinner, cn } from '@/components/ui';

type Other = UserWithPresence & { isContact: boolean; blockedByMe: boolean; canInteract: boolean };
type Local = Message & { pending?: boolean; failed?: boolean };

function Ticks({ m }: { m: Local }) {
  if (m.failed) return <AlertCircle size={14} className="text-danger" aria-label="Failed to send" />;
  if (m.pending) return <Clock size={13} aria-label="Sending" />;
  if (m.readAt) return <CheckCheck size={15} className="text-accent" aria-label="Read" />;
  if (m.deliveredAt) return <CheckCheck size={15} aria-label="Delivered" />;
  return <Check size={15} aria-label="Sent" />;
}

export default function Conversation() {
  const otherId = Number(useParams<{ userId: string }>().userId);
  const { user } = useAuth();
  const { socket } = useRealtime();
  const { onMessage, onStatus, reload } = useChat();
  const { startCall, call } = useCall();
  const [other, setOther] = useState<Other | null>(null);
  const [msgs, setMsgs] = useState<Local[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const taRef = useRef<HTMLTextAreaElement>(null);

  const markRead = useCallback(() => { post('/api/messages/read', { userId: otherId }).then(reload).catch(() => {}); }, [otherId, reload]);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const [o, h] = await Promise.all([get<{ user: Other }>(`/api/users/${otherId}`), get<{ messages: Message[]; hasMore: boolean }>(`/api/messages/with/${otherId}?limit=30`)]);
      setOther(o.user); setMsgs(h.messages); setHasMore(h.hasMore); stick.current = true; markRead();
    } catch (e) { setError(errMsg(e)); }
    finally { setLoading(false); }
  }, [otherId, markRead]);
  useEffect(() => { setMsgs([]); setOther(null); load(); }, [load]);

  const loadEarlier = async () => {
    const first = msgs.find((m) => m.id > 0);
    if (!first) return;
    const el = scroller.current, prevH = el?.scrollHeight ?? 0;
    try {
      const h = await get<{ messages: Message[]; hasMore: boolean }>(`/api/messages/with/${otherId}?limit=30&before=${first.id}`);
      stick.current = false;
      setMsgs((cur) => [...h.messages, ...cur]); setHasMore(h.hasMore);
      requestAnimationFrame(() => { if (el) el.scrollTop = el.scrollHeight - prevH; });
    } catch (e) { setNotice(errMsg(e)); }
  };

  useEffect(() => onMessage((m) => {
    if (m.senderId !== otherId) return;
    setMsgs((cur) => (cur.some((x) => x.id === m.id) ? cur : [...cur, m]));
    markRead();
  }), [onMessage, otherId, markRead]);
  useEffect(() => onStatus((e) => {
    if (e.peerId !== otherId) return;
    const ids = new Set(e.ids), t = Date.now();
    setMsgs((cur) => cur.map((m) => (ids.has(m.id) ? { ...m, deliveredAt: m.deliveredAt ?? t, readAt: e.status === 'read' ? t : m.readAt } : m)));
  }), [onStatus, otherId]);
  useEffect(() => {
    const onPresence = (p: { userId: number; online: boolean; lastSeenAt: number | null }) => { if (p.userId === otherId) setOther((o) => (o ? { ...o, online: p.online, lastSeenAt: p.lastSeenAt } : o)); };
    socket.on('presence', onPresence);
    return () => { socket.off('presence', onPresence); };
  }, [socket, otherId]);

  useLayoutEffect(() => { const el = scroller.current; if (el && stick.current) el.scrollTop = el.scrollHeight; }, [msgs]);

  const send = async (body: string, clientId = randomId()) => {
    const tempId = -Date.now();
    setMsgs((cur) => [...cur.filter((m) => m.clientId !== clientId), { id: tempId, conversationId: 0, senderId: user!.id, body, clientId, createdAt: Date.now(), deliveredAt: null, readAt: null, pending: true }]);
    stick.current = true;
    try {
      const r = await post<{ message: Message }>('/api/messages', { toUserId: otherId, body, clientId });
      setMsgs((cur) => cur.map((m) => (m.clientId === clientId ? r.message : m))); // now confirmed by the server
      reload();
    } catch (e) {
      setMsgs((cur) => cur.map((m) => (m.clientId === clientId ? { ...m, pending: false, failed: true } : m)));
      setNotice(errMsg(e));
    }
  };
  const submit = () => {
    const body = text.trim();
    if (!body || !other?.canInteract) return;
    setText(''); setNotice(null); send(body);
    if (taRef.current) taRef.current.style.height = 'auto';
  };

  const addContact = async () => {
    try { await post('/api/contacts', { username: other!.username }); await load(); } catch (e) { setNotice(errMsg(e)); }
  };

  if (loading && !other) return <div className="grid h-full place-items-center"><Spinner /></div>;
  if (error || !other) return <div className="grid h-full place-items-center"><ErrorState message={error ?? 'Conversation not found.'} onRetry={load} /></div>;

  const busy = call.phase !== 'idle' && call.phase !== 'ended';
  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-3 border-b border-line bg-surface px-3 py-3 safe-top">
        <Link href="/chats" aria-label="Back to chats" className="grid h-10 w-10 place-items-center rounded-xl text-muted hover:bg-raised md:hidden"><ArrowLeft size={20} /></Link>
        <Avatar name={other.displayName} url={other.avatarUrl} online={other.online} size={42} />
        <div className="min-w-0 flex-1">
          <p className="truncate font-bold">{other.displayName}</p>
          <p className="truncate text-xs text-muted" aria-live="polite">{presenceText(other) || `@${other.username}`}</p>
        </div>
        <button disabled={!other.canInteract || busy} onClick={() => startCall(other, 'audio')} aria-label="Start audio call" title="Audio call" className="grid h-10 w-10 place-items-center rounded-xl text-brand hover:bg-brand/10 disabled:opacity-40"><Phone size={20} /></button>
        <button disabled={!other.canInteract || busy} onClick={() => startCall(other, 'video')} aria-label="Start video call" title="Video call" className="grid h-10 w-10 place-items-center rounded-xl text-brand hover:bg-brand/10 disabled:opacity-40"><Video size={21} /></button>
      </header>

      {!other.isContact && other.canInteract === false && !other.blockedByMe && (
        <div className="flex items-center justify-between gap-3 bg-brand/10 px-4 py-2.5 text-sm">
          <span>@{other.username} isn&apos;t in your contacts.</span>
          <Button size="sm" onClick={addContact}><UserPlus size={15} /> Add</Button>
        </div>
      )}

      <div ref={scroller} onScroll={(e) => { const el = e.currentTarget; stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120; }} className="min-h-0 flex-1 overflow-y-auto px-3 py-4 sm:px-6">
        {hasMore && <div className="mb-3 text-center"><Button variant="soft" size="sm" onClick={loadEarlier}>Load earlier messages</Button></div>}
        {msgs.length === 0 ? (
          <div className="grid h-full place-items-center text-center text-sm text-muted"><p>No messages yet.<br />Say hello to {other.displayName}!</p></div>
        ) : (
          <ul className="mx-auto flex max-w-3xl flex-col gap-1.5">
            {msgs.map((m) => {
              const mine = m.senderId === user?.id;
              return (
                <li key={m.clientId ?? m.id} className={cn('flex', mine ? 'justify-end' : 'justify-start')}>
                  <div title={formatFull(m.createdAt)} className={cn('max-w-[82%] rounded-2xl px-3.5 py-2 shadow-sm sm:max-w-[70%]', mine ? 'rounded-br-md bg-gradient-to-br from-brand to-brand/85 text-white' : 'rounded-bl-md border border-line bg-surface')}>
                    <p className="whitespace-pre-wrap break-words text-[15px] leading-snug">{m.body}</p>
                    <p className={cn('mt-0.5 flex items-center justify-end gap-1 text-[11px]', mine ? 'text-white/75' : 'text-muted')}>
                      {formatTime(m.createdAt)} {mine && <Ticks m={m} />}
                    </p>
                    {m.failed && <button onClick={() => send(m.body, m.clientId ?? randomId())} className="mt-1 text-xs font-semibold underline">Not sent. Tap to retry</button>}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {notice && <div role="alert" className="bg-danger/10 px-4 py-2 text-center text-sm text-danger">{notice}</div>}
      {other.canInteract ? (
        <form onSubmit={(e) => { e.preventDefault(); submit(); }} className="safe-bottom flex items-end gap-2 border-t border-line bg-surface p-3">
          <label className="min-w-0 flex-1">
            <span className="sr-only">Message</span>
            <textarea ref={taRef} value={text} rows={1} maxLength={2000} placeholder="Write a message…"
              onChange={(e) => { setText(e.target.value); e.target.style.height = 'auto'; e.target.style.height = `${Math.min(e.target.scrollHeight, 140)}px`; }}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); submit(); } }}
              className="max-h-36 w-full resize-none rounded-2xl border border-line bg-bg px-4 py-2.5 text-[15px] outline-none focus:border-brand focus:ring-4 focus:ring-brand/15" />
          </label>
          <button type="submit" disabled={!text.trim()} aria-label="Send message" className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-gradient-to-br from-brand to-accent text-white shadow-glow transition disabled:opacity-40"><Send size={18} /></button>
        </form>
      ) : (
        <div className="safe-bottom flex items-center justify-center gap-2 border-t border-line bg-surface p-4 text-sm text-muted">
          <ShieldOff size={16} /> {other.blockedByMe ? 'You blocked this user. Unblock them in Contacts to chat.' : 'You can’t message this user.'}
        </div>
      )}
    </div>
  );
}
