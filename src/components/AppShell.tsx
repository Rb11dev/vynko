'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { LogOut, MessageCircle, Phone, Settings, Users, Video } from 'lucide-react';
import { useEffect, type ReactNode } from 'react';
import { useAuth } from '@/context/AuthContext';
import { RealtimeProvider, useRealtime } from '@/context/RealtimeContext';
import { ChatProvider, useChat } from '@/context/ChatContext';
import CallProvider from '@/context/CallProvider';
import { Avatar, Badge, ConnectionBanner, Spinner, cn } from './ui';
import { Logo, LogoMark } from './Logo';
import ThemeToggle from './ThemeToggle';

const NAV = [
  { href: '/chats', label: 'Chats', icon: MessageCircle },
  { href: '/contacts', label: 'Contacts', icon: Users },
  { href: '/history', label: 'Calls', icon: Phone },
  { href: '/meetings', label: 'Meetings', icon: Video },
  { href: '/settings', label: 'Settings', icon: Settings },
];

function Shell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { user, logout } = useAuth();
  const { status } = useRealtime();
  const { unreadTotal } = useChat();
  const inConversation = /^\/chats\/\d+/.test(pathname);
  const active = (href: string) => pathname === href || pathname.startsWith(href + '/');

  useEffect(() => { document.title = unreadTotal ? `(${unreadTotal}) VYNKO` : 'VYNKO'; }, [unreadTotal]);

  return (
    <div className="dvh flex flex-col">
      <ConnectionBanner status={status} />
      <div className="flex min-h-0 flex-1">
        <aside className="hidden w-64 shrink-0 flex-col border-r border-line bg-surface p-4 md:flex">
          <Link href="/chats" className="mb-6 px-2"><Logo size={34} /></Link>
          <nav className="flex flex-1 flex-col gap-1" aria-label="Main">
            {NAV.map(({ href, label, icon: Icon }) => (
              <Link key={href} href={href} aria-current={active(href) ? 'page' : undefined}
                className={cn('flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold transition', active(href) ? 'bg-brand/10 text-brand' : 'text-muted hover:bg-raised hover:text-ink')}>
                <Icon size={19} /> <span className="flex-1">{label}</span>
                {href === '/chats' && unreadTotal > 0 && <Badge>{unreadTotal > 99 ? '99+' : unreadTotal}</Badge>}
              </Link>
            ))}
          </nav>
          <div className="mt-4 flex items-center gap-3 rounded-2xl bg-raised p-3">
            {user && <Avatar name={user.displayName} url={user.avatarUrl} size={38} />}
            <div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold">{user?.displayName}</p><p className="truncate text-xs text-muted">@{user?.username}</p></div>
            <ThemeToggle />
            <button onClick={logout} aria-label="Log out" title="Log out" className="grid h-10 w-10 place-items-center rounded-xl text-muted hover:bg-line hover:text-ink"><LogOut size={18} /></button>
          </div>
        </aside>
        <main className="min-w-0 flex-1 overflow-hidden">{children}</main>
      </div>
      {!inConversation && (
        <nav aria-label="Main" className="safe-bottom grid grid-cols-5 border-t border-line bg-surface md:hidden">
          {NAV.map(({ href, label, icon: Icon }) => (
            <Link key={href} href={href} aria-current={active(href) ? 'page' : undefined}
              className={cn('relative flex flex-col items-center gap-0.5 py-2.5 text-[11px] font-semibold', active(href) ? 'text-brand' : 'text-muted')}>
              <Icon size={22} />{label}
              {href === '/chats' && unreadTotal > 0 && <span className="absolute right-[28%] top-1.5"><Badge>{unreadTotal > 99 ? '99+' : unreadTotal}</Badge></span>}
            </Link>
          ))}
        </nav>
      )}
    </div>
  );
}

// Protects every page inside the app: signed-out visitors are sent to the login page.
export default function AppShell({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  useEffect(() => { if (!loading && !user) router.replace(`/login?next=${encodeURIComponent(pathname)}`); }, [loading, user, router, pathname]);
  if (loading || !user) return <div className="dvh grid place-items-center"><div className="flex flex-col items-center gap-3"><LogoMark size={48} /><Spinner /></div></div>;
  return (
    <RealtimeProvider><ChatProvider><CallProvider><Shell>{children}</Shell></CallProvider></ChatProvider></RealtimeProvider>
  );
}
