import Link from 'next/link';
import { Link2, Lock, MessageCircle, Mic, PhoneOff, ServerCog, ShieldCheck, Smartphone, Users, Video, Phone, KeyRound } from 'lucide-react';
import { Logo } from '@/components/Logo';
import ThemeToggle from '@/components/ThemeToggle';

const FEATURES = [
  { icon: Phone, title: 'Crystal-clear audio calls', text: 'Call any contact straight from their profile. Ringing, accept, decline, mute and a live timer, all over WebRTC.' },
  { icon: Video, title: 'Face-to-face video', text: 'Live video with a camera preview, camera on/off, front/rear camera switching on phones and full-screen view.' },
  { icon: MessageCircle, title: 'Instant messaging', text: 'Real-time chats with saved history, unread counts, search and honest sent / delivered / read status.' },
  { icon: Link2, title: 'Meeting links', text: 'Create a private, unguessable link. Guests join with just a name after checking their camera and mic.' },
  { icon: Users, title: 'Contacts & presence', text: 'Find people by username, build your contact list, and control who sees your online and last-seen status.' },
  { icon: Smartphone, title: 'Made for every screen', text: 'A purpose-built mobile layout with bottom navigation, plus a roomy desktop view. Light and dark themes.' },
];

function CallPreview() {
  return (
    <div className="relative mx-auto w-full max-w-md animate-rise" aria-hidden="true">
      <div className="absolute -inset-6 rounded-[3rem] bg-gradient-to-br from-brand/40 to-accent/30 blur-3xl" />
      <div className="relative overflow-hidden rounded-[2rem] border border-white/10 bg-slate-950 p-3 shadow-2xl">
        <div className="relative aspect-[4/5] overflow-hidden rounded-[1.5rem] bg-[radial-gradient(ellipse_at_top,#6d4aff_0%,#1b1440_55%,#0b0a15_100%)]">
          <div className="absolute inset-x-0 top-0 flex items-center justify-between p-4 text-white">
            <div><p className="text-sm font-semibold">Maya Okafor</p><p className="text-xs text-white/70">12:41</p></div>
            <span className="rounded-full bg-white/15 px-2.5 py-1 text-[11px]">HD video</span>
          </div>
          <div className="absolute inset-0 grid place-items-center">
            <div className="grid h-32 w-32 place-items-center rounded-full bg-gradient-to-br from-brand to-accent text-4xl font-bold text-white shadow-glow">MO</div>
          </div>
          <div className="absolute bottom-24 right-4 grid h-28 w-20 place-items-center rounded-2xl border border-white/20 bg-slate-800 text-sm font-bold text-white/80">You</div>
          <div className="absolute inset-x-0 bottom-5 flex items-center justify-center gap-3">
            {[Mic, Video].map((I, i) => <span key={i} className="grid h-12 w-12 place-items-center rounded-full bg-white/15 text-white"><I size={20} /></span>)}
            <span className="grid h-14 w-14 place-items-center rounded-full bg-danger text-white"><PhoneOff size={22} /></span>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function Landing() {
  return (
    <div className="overflow-x-hidden">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-5 py-5">
        <Link href="/" aria-label="VYNKO home"><Logo /></Link>
        <nav aria-label="Primary" className="hidden items-center gap-8 text-sm font-medium text-muted md:flex">
          <a href="#features" className="hover:text-ink">Features</a><a href="#privacy" className="hover:text-ink">Privacy</a><a href="#contact" className="hover:text-ink">Contact</a>
        </nav>
        <div className="flex items-center gap-1">
          <ThemeToggle />
          <Link href="/login" className="hidden h-10 items-center rounded-xl px-4 text-sm font-semibold text-muted hover:text-ink sm:inline-flex">Log in</Link>
          <Link href="/signup" className="inline-flex h-10 items-center rounded-xl bg-ink px-4 text-sm font-semibold text-bg">Sign up</Link>
        </div>
      </header>

      <main>
        <section className="relative mx-auto grid max-w-6xl items-center gap-14 px-5 pb-20 pt-10 lg:grid-cols-[1.1fr_1fr] lg:pt-16">
          <div aria-hidden className="pointer-events-none absolute -left-40 top-0 h-96 w-96 rounded-full bg-brand/15 blur-3xl" />
          <div className="relative animate-rise">
            <p className="mb-5 inline-flex items-center gap-2 rounded-full border border-line bg-surface px-3.5 py-1.5 text-xs font-semibold text-muted"><span className="h-2 w-2 rounded-full bg-accent" /> Talk More. Feel Closer.</p>
            <h1 className="text-5xl font-black leading-[1.05] tracking-tight sm:text-6xl">Bring Every <span className="grad-text">Conversation</span> Closer.</h1>
            <p className="mt-6 max-w-xl text-lg text-muted">VYNKO brings audio calls, video calls and instant messaging together in your browser. Call a friend, chat in real time, or share a meeting link with anyone, no download required.</p>
            <div className="mt-9 flex flex-wrap gap-3">
              <Link href="/signup" className="inline-flex items-center rounded-xl bg-gradient-to-r from-brand to-accent px-8 py-3.5 text-base font-semibold text-white shadow-glow transition hover:brightness-110">Get Started</Link>
              <Link href="/meetings" className="inline-flex items-center gap-2 rounded-xl border border-line bg-surface px-8 py-3.5 text-base font-semibold transition hover:bg-raised"><Video size={18} /> Start a Meeting</Link>
            </div>
            <p className="mt-5 text-sm text-muted">Free to run. Open-source stack. Works on desktop and mobile browsers.</p>
          </div>
          <CallPreview />
        </section>

        <section id="features" className="mx-auto max-w-6xl scroll-mt-8 px-5 py-20">
          <div className="mx-auto mb-12 max-w-2xl text-center"><h2 className="text-3xl font-extrabold sm:text-4xl">Everything you need to stay connected</h2><p className="mt-3 text-muted">One simple place for the calls, messages and meetings that matter.</p></div>
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map(({ icon: Icon, title, text }) => (
              <article key={title} className="group rounded-3xl border border-line bg-surface p-6 transition hover:-translate-y-1 hover:shadow-xl">
                <div className="mb-4 grid h-12 w-12 place-items-center rounded-2xl bg-gradient-to-br from-brand/15 to-accent/15 text-brand"><Icon size={22} /></div>
                <h3 className="text-lg font-bold">{title}</h3><p className="mt-1.5 text-sm leading-relaxed text-muted">{text}</p>
              </article>
            ))}
          </div>
        </section>

        <section id="privacy" className="mx-auto max-w-6xl scroll-mt-8 px-5 py-20">
          <div className="rounded-[2rem] bg-slate-950 p-8 text-white sm:p-12">
            <div className="grid gap-10 lg:grid-cols-[1fr_1.2fr]">
              <div>
                <span className="mb-4 inline-grid h-12 w-12 place-items-center rounded-2xl bg-white/10"><ShieldCheck /></span>
                <h2 className="text-3xl font-extrabold">Privacy and security, stated plainly</h2>
                <p className="mt-3 text-white/70">We’d rather be precise than flashy. Here is exactly what protects you today.</p>
              </div>
              <ul className="grid gap-4 sm:grid-cols-2">
                {[
                  { i: KeyRound, t: 'Hashed passwords', d: 'Passwords are salted and hashed with scrypt, never stored in plain text.' },
                  { i: Lock, t: 'Encrypted calls', d: 'WebRTC encrypts audio and video between browsers (DTLS-SRTP).' },
                  { i: ServerCog, t: 'HTTPS in transit', d: 'When deployed with HTTPS, everything between you and the server is encrypted in transit.' },
                  { i: ShieldCheck, t: 'You control visibility', d: 'Hide your online status and last seen, block anyone, or delete your account.' },
                ].map(({ i: I, t, d }) => (
                  <li key={t} className="rounded-2xl bg-white/5 p-4"><I size={18} className="mb-2 text-accent" /><p className="font-semibold">{t}</p><p className="mt-1 text-sm text-white/65">{d}</p></li>
                ))}
              </ul>
            </div>
            <p className="mt-8 rounded-2xl bg-white/5 p-4 text-sm text-white/75"><strong className="text-white">Good to know:</strong> text messages are protected by HTTPS in transit but are <em>not</em> end-to-end encrypted. They are stored on the server so your history works. Calls are encrypted between browsers.</p>
          </div>
        </section>

        <section className="mx-auto max-w-4xl px-5 pb-24 text-center">
          <h2 className="text-3xl font-extrabold sm:text-4xl">Ready to bring someone closer?</h2>
          <p className="mx-auto mt-3 max-w-xl text-muted">Create an account in seconds, or start a meeting and send the link.</p>
          <div className="mt-7 flex flex-wrap justify-center gap-3">
            <Link href="/signup" className="inline-flex items-center rounded-xl bg-gradient-to-r from-brand to-accent px-8 py-3.5 font-semibold text-white shadow-glow">Get Started</Link>
            <Link href="/meetings" className="inline-flex items-center rounded-xl border border-line bg-surface px-8 py-3.5 font-semibold hover:bg-raised">Start a Meeting</Link>
          </div>
        </section>
      </main>

      <footer id="contact" className="border-t border-line bg-surface">
        <div className="mx-auto grid max-w-6xl gap-8 px-5 py-12 sm:grid-cols-[1.5fr_1fr_1fr]">
          <div><Logo size={30} /><p className="mt-3 max-w-xs text-sm text-muted">Talk More. Feel Closer.</p></div>
          <div><p className="mb-3 text-sm font-bold">Navigate</p><ul className="space-y-2 text-sm text-muted"><li><a href="#features" className="hover:text-ink">Features</a></li><li><a href="#privacy" className="hover:text-ink">Privacy</a></li><li><Link href="/login" className="hover:text-ink">Log in</Link></li><li><Link href="/signup" className="hover:text-ink">Sign up</Link></li></ul></div>
          <div><p className="mb-3 text-sm font-bold">Contact</p><ul className="space-y-2 text-sm text-muted"><li>hello@vynko.example</li><li>support@vynko.example</li></ul><p className="mt-2 text-xs text-muted/80">Replace these placeholder addresses before launch.</p></div>
        </div>
        <p className="border-t border-line py-5 text-center text-xs text-muted">© {new Date().getFullYear()} VYNKO. All rights reserved.</p>
      </footer>
    </div>
  );
}
