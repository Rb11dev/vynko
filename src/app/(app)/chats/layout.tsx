'use client';
import { usePathname } from 'next/navigation';
import ChatList from '@/components/ChatList';
import { cn } from '@/components/ui';

// Desktop: list + conversation side by side. Mobile: one at a time.
export default function ChatsLayout({ children }: { children: React.ReactNode }) {
  const inConversation = usePathname() !== '/chats';
  return (
    <div className="flex h-full">
      <section className={cn('h-full w-full shrink-0 border-line md:w-[340px] md:border-r', inConversation && 'hidden md:block')} aria-label="Conversations"><ChatList /></section>
      <section className={cn('h-full min-w-0 flex-1', !inConversation && 'hidden md:block')}>{children}</section>
    </div>
  );
}
