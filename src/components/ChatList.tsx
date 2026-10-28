'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { MessageSquarePlus, Search } from 'lucide-react';
import { useChat } from '@/context/ChatContext';
import { useAuth } from '@/context/AuthContext';
import { formatTime } from '@/lib/format';
import { Avatar, Badge, EmptyState, ErrorState, Spinner, cn } from './ui';

export default function ChatList() {
  const { conversations, loading, error, query, setQuery, reload } = useChat();
  const { user } = useAuth();
  const pathname = usePathname();
  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center justify-between px-4 pb-2 pt-5 safe-top">
        <h1 className="text-2xl font-extrabold">Chats</h1>
        <Link href="/contacts" aria-label="Start a new chat" className="grid h-10 w-10 place-items-center rounded-xl bg-brand/10 text-brand hover:bg-brand/20"><MessageSquarePlus size={20} /></Link>
      </header>
      <div className="px-4 pb-3">
        <label className="relative block">
          <span className="sr-only">Search conversations</span>
          <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted" />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search chats and messages"
            className="h-10 w-full rounded-xl border border-line bg-surface pl-10 pr-3 text-sm outline-none focus:border-brand focus:ring-4 focus:ring-brand/15" />
        </label>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-4">
        {loading ? <div className="grid place-items-center py-16"><Spinner /></div>
          : error ? <ErrorState message={error} onRetry={reload} />
          : conversations.length === 0 ? (
            <EmptyState icon={<MessageSquarePlus size={28} />} title={query ? 'No matches' : 'No conversations yet'}
              text={query ? 'Try a different name or word.' : 'Add a contact, then say hello.'}
              action={!query && <Link href="/contacts" className="rounded-xl bg-gradient-to-r from-brand to-accent px-5 py-2.5 text-sm font-semibold text-white">Find people</Link>} />
          ) : (
            <ul>
              {conversations.map((c) => {
                const href = `/chats/${c.other.id}`;
                return (
                  <li key={c.id}>
                    <Link href={href} aria-current={pathname === href ? 'page' : undefined}
                      className={cn('flex items-center gap-3 rounded-xl px-3 py-3 transition', pathname === href ? 'bg-brand/10' : 'hover:bg-raised')}>
                      <Avatar name={c.other.displayName} url={c.other.avatarUrl} online={c.other.online} />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-baseline justify-between gap-2">
                          <p className="truncate font-semibold">{c.other.displayName}</p>
                          {c.lastMessageAt && <span className={cn('shrink-0 text-xs', c.unread ? 'font-semibold text-brand' : 'text-muted')}>{formatTime(c.lastMessageAt)}</span>}
                        </div>
                        <div className="flex items-center justify-between gap-2">
                          <p className={cn('truncate text-sm', c.unread ? 'font-medium text-ink' : 'text-muted')}>{c.lastSender === user?.id ? 'You: ' : ''}{c.lastBody}</p>
                          {c.unread > 0 && <Badge>{c.unread > 99 ? '99+' : c.unread}</Badge>}
                        </div>
                      </div>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
      </div>
    </div>
  );
}
