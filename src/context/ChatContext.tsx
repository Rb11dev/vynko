'use client';
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { get, errMsg } from '@/lib/api';
import type { Conversation, Message } from '@/lib/types';
import { useRealtime } from './RealtimeContext';

type StatusEvent = { ids: number[]; status: 'delivered' | 'read'; peerId: number };
type ChatCtx = {
  conversations: Conversation[]; loading: boolean; error: string | null; unreadTotal: number;
  query: string; setQuery: (q: string) => void; reload: () => Promise<void>;
  onMessage: (fn: (m: Message) => void) => () => void;
  onStatus: (fn: (e: StatusEvent) => void) => () => void;
};
const Ctx = createContext<ChatCtx | null>(null);
export const useChat = () => {
  const c = useContext(Ctx);
  if (!c) throw new Error('useChat must be used inside ChatProvider');
  return c;
};

export function ChatProvider({ children }: { children: ReactNode }) {
  const { socket } = useRealtime();
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [unreadTotal, setUnreadTotal] = useState(0);
  const [query, setQuery] = useState('');
  const queryRef = useRef('');
  const msgSubs = useRef(new Set<(m: Message) => void>());
  const statusSubs = useRef(new Set<(e: StatusEvent) => void>());

  const reload = useCallback(async () => {
    const q = queryRef.current;
    try {
      const r = await get<{ conversations: Conversation[] }>(`/api/conversations${q ? `?q=${encodeURIComponent(q)}` : ''}`);
      setConversations(r.conversations);
      if (!q) setUnreadTotal(r.conversations.reduce((n, c) => n + c.unread, 0));
      setError(null);
    } catch (e) { setError(errMsg(e)); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => {
    queryRef.current = query;
    const t = setTimeout(reload, query ? 250 : 0);
    return () => clearTimeout(t);
  }, [query, reload]);

  useEffect(() => {
    // Acknowledge ONCE here: the server only marks a message "delivered" after this ack.
    const onNew = (m: Message, ack?: (ok: boolean) => void) => { ack?.(true); msgSubs.current.forEach((f) => f(m)); reload(); };
    const onStatus = (e: StatusEvent) => statusSubs.current.forEach((f) => f(e));
    const onPresence = (p: { userId: number; online: boolean; lastSeenAt: number | null }) =>
      setConversations((cs) => cs.map((c) => (c.other.id === p.userId ? { ...c, other: { ...c.other, online: p.online, lastSeenAt: p.lastSeenAt } } : c)));
    socket.on('message:new', onNew); socket.on('message:status', onStatus); socket.on('presence', onPresence); socket.on('connect', reload);
    return () => { socket.off('message:new', onNew); socket.off('message:status', onStatus); socket.off('presence', onPresence); socket.off('connect', reload); };
  }, [socket, reload]);

  const onMessage = useCallback((fn: (m: Message) => void) => { msgSubs.current.add(fn); return () => { msgSubs.current.delete(fn); }; }, []);
  const onStatus = useCallback((fn: (e: StatusEvent) => void) => { statusSubs.current.add(fn); return () => { statusSubs.current.delete(fn); }; }, []);

  return <Ctx.Provider value={{ conversations, loading, error, unreadTotal, query, setQuery, reload, onMessage, onStatus }}>{children}</Ctx.Provider>;
}
