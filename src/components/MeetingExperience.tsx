'use client';
// Meeting waiting room + room. Works for signed-in users and guests (guests prove themselves
// with a secret token the server issued when they joined). Joiners send WebRTC offers to
// everyone already in the room; the code is keyed by participant id so groups can be added later.
import Link from 'next/link';
import { AlertTriangle, Copy, Maximize2, Mic, MicOff, PhoneOff, Video, VideoOff } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError, get, post } from '@/lib/api';
import { emitAck, getSocket } from '@/lib/socket';
import { createPeer, getLocalMedia, mediaErrorMessage, stopStream, type Peer } from '@/lib/webrtc';
import type { Meeting, Signal } from '@/lib/types';
import { useAuth } from '@/context/AuthContext';
import { Avatar, Button, Card, Input, Spinner, cn } from './ui';
import { Logo } from './Logo';
import ThemeToggle from './ThemeToggle';
import { StreamEl } from './CallOverlay';

type Tile = { id: string; name: string; stream: MediaStream | null; state: RTCPeerConnectionState | 'new' };
type Session = { participantId: string; token?: string; role: 'host' | 'participant'; name: string };
type Phase = 'loading' | 'invalid' | 'lobby' | 'joining' | 'room' | 'left' | 'ended';

const JOIN_ERRORS: Record<string, string> = {
  room_full: 'This meeting is full right now (one-to-one meetings hold two people).',
  already_joined: 'You are already in this meeting in another tab or window.',
  not_allowed: 'You are not allowed to join this meeting.',
  rate_limited: 'Too many attempts. Wait a moment and try again.',
};

// Gets camera+mic if possible, otherwise degrades gracefully and explains why.
async function acquire(): Promise<{ stream: MediaStream; warning: string | null }> {
  try { return { stream: await getLocalMedia('video'), warning: null }; }
  catch (e1) {
    try { return { stream: await getLocalMedia('audio'), warning: `${mediaErrorMessage(e1, 'video')} You can still join with your microphone.` }; }
    catch (e2) { return { stream: new MediaStream(), warning: `${mediaErrorMessage(e2, 'video')} You can still join to watch and listen.` }; }
  }
}

function Shell({ children, signedIn }: { children: React.ReactNode; signedIn: boolean }) {
  return (
    <div className="relative grid min-h-screen place-items-center px-4 py-10">
      <div className="absolute left-4 top-4"><Link href={signedIn ? '/chats' : '/'}><Logo size={30} /></Link></div>
      <div className="absolute right-4 top-4"><ThemeToggle /></div>
      {children}
    </div>
  );
}

export default function MeetingExperience({ code }: { code: string }) {
  const { user, loading: authLoading } = useAuth();
  const [phase, setPhase] = useState<Phase>('loading');
  const [meeting, setMeeting] = useState<Meeting | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [guestName, setGuestName] = useState('');
  const [warning, setWarning] = useState<string | null>(null);
  const [micOn, setMicOn] = useState(true);
  const [camOn, setCamOn] = useState(true);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [tiles, setTiles] = useState<Tile[]>([]);
  const [online, setOnline] = useState(true);
  const [notice, setNotice] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const streamRef = useRef<MediaStream | null>(null);
  const sessionRef = useRef<Session | null>(null);
  const iceRef = useRef<RTCIceServer[]>([]);
  const peersRef = useRef(new Map<string, { peer: Peer; initiator: boolean; restarts: number; name: string }>());
  const namesRef = useRef(new Map<string, string>());
  const phaseRef = useRef<Phase>('loading');
  const boxRef = useRef<HTMLDivElement>(null);
  const setPhaseBoth = (p: Phase) => { phaseRef.current = p; setPhase(p); };

  // 1) Validate the link (invalid / expired / revoked links are rejected here and again by the server on join).
  useEffect(() => {
    let alive = true;
    get<{ meeting: Meeting }>(`/api/meetings/${encodeURIComponent(code)}`)
      .then((r) => {
        if (!alive) return;
        setMeeting(r.meeting);
        if (r.meeting.status !== 'active') {
          setProblem({ revoked: 'This meeting link was revoked by the host.', ended: 'This meeting has ended.', expired: 'This meeting link has expired.', active: '' }[r.meeting.status]);
          setPhaseBoth('invalid');
        } else setPhaseBoth('lobby');
      })
      .catch((e) => { if (!alive) return; setProblem(e instanceof ApiError && e.status === 404 ? 'This meeting link is not valid.' : e.message); setPhaseBoth('invalid'); });
    return () => { alive = false; };
  }, [code]);

  // 2) Waiting room: preview camera and microphone.
  useEffect(() => {
    if (phase !== 'lobby' || streamRef.current) return;
    let alive = true;
    acquire().then(({ stream: s, warning: w }) => {
      if (!alive) { stopStream(s); return; }
      streamRef.current = s; setStream(s); setWarning(w);
      if (!s.getVideoTracks().length) setCamOn(false);
      if (!s.getAudioTracks().length) setMicOn(false);
    });
    return () => { alive = false; };
  }, [phase]);

  useEffect(() => {
    streamRef.current?.getAudioTracks().forEach((t) => { t.enabled = micOn; });
    streamRef.current?.getVideoTracks().forEach((t) => { t.enabled = camOn; });
  }, [micOn, camOn, stream]);

  const updateTile = useCallback((id: string, patch: Partial<Tile>) => {
    setTiles((cur) => {
      const has = cur.some((t) => t.id === id);
      return has ? cur.map((t) => (t.id === id ? { ...t, ...patch } : t)) : [...cur, { id, name: namesRef.current.get(id) ?? 'Guest', stream: null, state: 'new', ...patch }];
    });
  }, []);

  const closePeer = useCallback((id: string) => {
    peersRef.current.get(id)?.peer.close();
    peersRef.current.delete(id);
    setTiles((cur) => cur.filter((t) => t.id !== id));
  }, []);

  const makePeer = useCallback((id: string, initiator: boolean) => {
    const local = streamRef.current ?? new MediaStream();
    const entry = { peer: null as unknown as Peer, initiator, restarts: 0, name: namesRef.current.get(id) ?? 'Guest' };
    entry.peer = createPeer({
      iceServers: iceRef.current, localStream: local, ensureReceive: true,
      onSignal: (data) => { emitAck('meeting:signal', { to: id, data }).catch(() => {}); },
      onStream: (s) => updateTile(id, { stream: s }),
      onState: (st) => {
        updateTile(id, { state: st });
        if (st === 'failed' && entry.initiator && entry.restarts < 3) { entry.restarts += 1; entry.peer.offer(true).catch(() => {}); }
      },
    });
    peersRef.current.set(id, entry);
    updateTile(id, { name: entry.name });
    if (initiator) entry.peer.offer().catch(() => setNotice('Could not start the connection to another participant.'));
    return entry;
  }, [updateTile]);

  const cleanupRoom = useCallback(() => {
    for (const id of [...peersRef.current.keys()]) peersRef.current.get(id)?.peer.close();
    peersRef.current.clear(); setTiles([]);
  }, []);

  const enterRoom = useCallback(async (s: Session): Promise<string | null> => {
    const socket = getSocket();
    if (!socket.connected) {
      socket.connect();
      await new Promise<void>((res, rej) => { const t = setTimeout(() => rej(new Error('timeout')), 8000); socket.once('connect', () => { clearTimeout(t); res(); }); });
    }
    const r = await emitAck<{ ok?: boolean; error?: string; peers?: { participantId: string; displayName: string }[]; iceServers?: RTCIceServer[] }>('meeting:join', { code, participantId: s.participantId, token: s.token });
    if (!r.ok) return JOIN_ERRORS[r.error ?? ''] ?? 'Could not join the meeting.';
    iceRef.current = r.iceServers ?? [];
    for (const p of r.peers ?? []) { namesRef.current.set(p.participantId, p.displayName); makePeer(p.participantId, true); }
    return null;
  }, [code, makePeer]);

  // 3) Join: register with the server, then open the signaling room.
  const join = async () => {
    setProblem(null); setPhaseBoth('joining');
    try {
      const r = await post<{ participantId: string; guestToken?: string; displayName: string; role: 'host' | 'participant' }>(`/api/meetings/${encodeURIComponent(code)}/join`, { displayName: guestName });
      const s: Session = { participantId: r.participantId, token: r.guestToken, role: r.role, name: r.displayName };
      sessionRef.current = s;
      const err = await enterRoom(s);
      if (err) { setProblem(err); setPhaseBoth('lobby'); return; }
      setPhaseBoth('room');
    } catch (e) {
      setProblem(e instanceof ApiError ? e.message : 'Could not join. Check your connection and try again.');
      setPhaseBoth(e instanceof ApiError && e.status === 410 ? 'invalid' : 'lobby');
    }
  };

  // 4) Live room events.
  useEffect(() => {
    if (phase !== 'room') return;
    const socket = getSocket();
    const onPeerJoined = (p: { participantId: string; displayName: string }) => { namesRef.current.set(p.participantId, p.displayName); updateTile(p.participantId, { name: p.displayName }); };
    const onSignal = (p: { from: string; data: Signal }) => {
      const entry = peersRef.current.get(p.from) ?? makePeer(p.from, false);
      entry.peer.handleSignal(p.data).catch(() => {});
    };
    const onPeerLeft = (p: { participantId: string }) => closePeer(p.participantId);
    const onEnded = (p: { reason: string }) => { cleanupRoom(); stopStream(streamRef.current); streamRef.current = null; setStream(null); setProblem(p.reason === 'revoked' ? 'The host revoked this meeting link.' : 'The host ended the meeting.'); setPhaseBoth('ended'); };
    const onDown = () => setOnline(false);
    const onUp = async () => { // reconnected: rebuild the room from scratch
      setOnline(true);
      if (phaseRef.current !== 'room' || !sessionRef.current) return;
      cleanupRoom();
      const err = await enterRoom(sessionRef.current).catch(() => 'Could not rejoin the meeting.');
      if (err) { setProblem(err); setNotice(err); }
    };
    socket.on('meeting:peer-joined', onPeerJoined); socket.on('meeting:signal', onSignal); socket.on('meeting:peer-left', onPeerLeft);
    socket.on('meeting:ended', onEnded); socket.on('disconnect', onDown); socket.on('connect', onUp);
    return () => {
      socket.off('meeting:peer-joined', onPeerJoined); socket.off('meeting:signal', onSignal); socket.off('meeting:peer-left', onPeerLeft);
      socket.off('meeting:ended', onEnded); socket.off('disconnect', onDown); socket.off('connect', onUp);
    };
  }, [phase, makePeer, closePeer, cleanupRoom, enterRoom, updateTile]);

  const leave = useCallback(() => {
    if (phaseRef.current === 'room') emitAck('meeting:leave').catch(() => {});
    cleanupRoom(); stopStream(streamRef.current); streamRef.current = null; setStream(null);
    setPhaseBoth('left');
  }, [cleanupRoom]);

  const endForAll = async () => {
    if (!confirm('End this meeting for everyone?')) return;
    try { await post(`/api/meetings/${encodeURIComponent(code)}/end`); } catch (e) { setNotice(e instanceof Error ? e.message : 'Could not end the meeting.'); }
  };

  // Always release camera/microphone when the page closes or the component unmounts.
  useEffect(() => {
    const release = () => { if (phaseRef.current === 'room') getSocket().emit('meeting:leave'); cleanupRoom(); stopStream(streamRef.current); streamRef.current = null; };
    window.addEventListener('pagehide', release);
    return () => { window.removeEventListener('pagehide', release); release(); };
  }, [cleanupRoom]);

  const copyLink = async () => { try { await navigator.clipboard.writeText(window.location.href); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { window.prompt('Copy this link:', window.location.href); } };
  const hasVideo = !!stream?.getVideoTracks().length, hasAudio = !!stream?.getAudioTracks().length;

  if (phase === 'loading' || authLoading) return <div className="grid min-h-screen place-items-center"><Spinner className="h-8 w-8" /></div>;

  if (phase === 'invalid' || phase === 'ended' || phase === 'left') {
    return (
      <Shell signedIn={!!user}>
        <Card className="w-full max-w-md text-center">
          <div className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-2xl bg-raised text-brand">{phase === 'left' ? <PhoneOff /> : <AlertTriangle />}</div>
          <h1 className="text-xl font-bold">{phase === 'left' ? 'You left the meeting' : phase === 'ended' ? 'Meeting ended' : 'Can’t open this meeting'}</h1>
          <p className="mt-2 text-sm text-muted">{phase === 'left' ? 'You can rejoin any time while the link is active.' : problem}</p>
          <div className="mt-6 flex justify-center gap-3">
            {phase === 'left' && <Button onClick={() => { setProblem(null); setPhaseBoth('lobby'); }}>Rejoin</Button>}
            <Link href={user ? '/meetings' : '/'} className="inline-flex h-11 items-center rounded-xl bg-raised px-5 text-sm font-semibold">{user ? 'Back to meetings' : 'Go to VYNKO'}</Link>
          </div>
        </Card>
      </Shell>
    );
  }

  if (phase === 'lobby' || phase === 'joining') {
    const needsName = !user;
    return (
      <Shell signedIn={!!user}>
        <div className="grid w-full max-w-4xl gap-6 md:grid-cols-[1.4fr_1fr]">
          <div className="relative aspect-video overflow-hidden rounded-3xl bg-slate-900 shadow-xl">
            {stream && hasVideo ? <StreamEl stream={stream} kind="video" muted mirror className={cn('h-full w-full object-cover', !camOn && 'opacity-0')} /> : null}
            {(!stream || !hasVideo || !camOn) && <div className="absolute inset-0 grid place-items-center text-white/80"><div className="text-center"><Avatar name={user?.displayName ?? (guestName || 'Guest')} url={user?.avatarUrl} size={84} /><p className="mt-3 text-sm">{!stream ? 'Starting camera…' : 'Camera is off'}</p></div></div>}
            <div className="absolute inset-x-0 bottom-3 flex justify-center gap-3">
              <button onClick={() => setMicOn(!micOn)} disabled={!hasAudio} aria-label={micOn ? 'Mute microphone' : 'Unmute microphone'} className={cn('grid h-12 w-12 place-items-center rounded-full text-white disabled:opacity-40', micOn ? 'bg-white/20 hover:bg-white/30' : 'bg-danger')}>{micOn ? <Mic size={20} /> : <MicOff size={20} />}</button>
              <button onClick={() => setCamOn(!camOn)} disabled={!hasVideo} aria-label={camOn ? 'Turn camera off' : 'Turn camera on'} className={cn('grid h-12 w-12 place-items-center rounded-full text-white disabled:opacity-40', camOn ? 'bg-white/20 hover:bg-white/30' : 'bg-danger')}>{camOn ? <Video size={20} /> : <VideoOff size={20} />}</button>
            </div>
          </div>
          <Card className="flex flex-col justify-center">
            <p className="text-xs font-bold uppercase tracking-wider text-muted">Ready to join?</p>
            <h1 className="mt-1 text-2xl font-extrabold">{meeting?.title}</h1>
            <p className="mb-4 text-sm text-muted">Hosted by {meeting?.hostName}</p>
            {needsName && <Input label="Your name" value={guestName} maxLength={50} onChange={(e) => setGuestName(e.target.value)} placeholder="How should others see you?" />}
            {!needsName && <p className="text-sm">Joining as <strong>{user?.displayName}</strong></p>}
            {warning && <p role="alert" className="mt-3 rounded-xl bg-amber-500/10 p-3 text-xs text-amber-700 dark:text-amber-300">{warning}</p>}
            {problem && <p role="alert" className="mt-3 rounded-xl bg-danger/10 p-3 text-sm text-danger">{problem}</p>}
            <Button size="lg" className="mt-4" loading={phase === 'joining'} disabled={needsName && !guestName.trim()} onClick={join}>Join meeting</Button>
            {meeting && !meeting.allowGuests && !user && <p className="mt-3 text-xs text-muted">This meeting requires a VYNKO account. <Link href={`/login?next=/m/${code}`} className="font-semibold text-brand">Log in</Link></p>}
          </Card>
        </div>
      </Shell>
    );
  }

  // ---------- Room ----------
  const remote = tiles;
  const single = remote.length <= 1;
  const self = sessionRef.current;
  return (
    <div ref={boxRef} className="dvh relative flex flex-col bg-slate-950 text-white">
      {!online && <div role="status" className="bg-danger px-3 py-1.5 text-center text-xs font-medium">Connection lost. Trying to reconnect…</div>}
      <header className="flex items-center justify-between px-4 py-3 safe-top">
        <div><p className="font-semibold">{meeting?.title}</p><p className="text-xs text-white/60">{remote.length === 0 ? 'Waiting for others to join…' : `${remote.length + 1} in this meeting`}</p></div>
        <div className="flex gap-2">
          <button onClick={copyLink} className="inline-flex h-9 items-center gap-1.5 rounded-full bg-white/15 px-3 text-xs font-semibold hover:bg-white/25"><Copy size={14} /> {copied ? 'Copied' : 'Invite link'}</button>
          <button onClick={() => (document.fullscreenElement ? document.exitFullscreen() : boxRef.current?.requestFullscreen?.())} aria-label="Full screen" className="grid h-9 w-9 place-items-center rounded-full bg-white/15 hover:bg-white/25"><Maximize2 size={16} /></button>
        </div>
      </header>

      <div className={cn('relative min-h-0 flex-1 p-2', !single && 'grid auto-rows-fr gap-2 sm:grid-cols-2')}>
        {remote.length === 0 && (
          <div className="grid h-full place-items-center text-center"><div><Avatar name={self?.name ?? 'You'} size={96} /><p className="mt-4 text-lg font-semibold">You’re the only one here</p><p className="text-sm text-white/60">Share the invite link to bring someone in.</p></div></div>
        )}
        {remote.map((t) => {
          const live = t.state === 'connected' && !!t.stream?.getVideoTracks().length;
          return (
            <div key={t.id} className="relative overflow-hidden rounded-2xl bg-slate-900">
              <StreamEl stream={t.stream} kind="audio" />
              {t.stream && <StreamEl stream={t.stream} kind="video" className={cn('h-full w-full object-cover', !live && 'opacity-0')} />}
              {!live && <div className="absolute inset-0 grid place-items-center"><div className="text-center"><Avatar name={t.name} size={88} /><p className="mt-3 text-sm text-white/70">{t.state === 'connected' ? 'Camera off' : t.state === 'failed' ? 'Connection failed' : 'Connecting…'}</p></div></div>}
              <span className="absolute bottom-3 left-3 rounded-full bg-black/55 px-3 py-1 text-xs font-medium">{t.name}</span>
            </div>
          );
        })}
        {stream && (
          <div className="absolute bottom-4 right-4 h-32 w-24 overflow-hidden rounded-2xl border border-white/20 bg-slate-800 shadow-xl sm:h-40 sm:w-28">
            {hasVideo && <StreamEl stream={stream} kind="video" muted mirror className={cn('h-full w-full object-cover', !camOn && 'opacity-0')} />}
            {(!hasVideo || !camOn) && <div className="absolute inset-0 grid place-items-center text-white/70"><VideoOff size={22} /></div>}
            <span className="absolute bottom-1 left-1 rounded bg-black/55 px-1.5 text-[10px]">You</span>
          </div>
        )}
      </div>

      {notice && <div role="alert" className="mx-4 mb-2 rounded-xl bg-danger/90 p-2 text-center text-sm">{notice}</div>}
      <footer className="safe-bottom flex items-center justify-center gap-3 p-4">
        <button onClick={() => setMicOn(!micOn)} disabled={!hasAudio} aria-label={micOn ? 'Mute microphone' : 'Unmute microphone'} className={cn('grid h-14 w-14 place-items-center rounded-full disabled:opacity-40', micOn ? 'bg-white/15 hover:bg-white/25' : 'bg-white text-slate-900')}>{micOn ? <Mic /> : <MicOff />}</button>
        <button onClick={() => setCamOn(!camOn)} disabled={!hasVideo} aria-label={camOn ? 'Turn camera off' : 'Turn camera on'} className={cn('grid h-14 w-14 place-items-center rounded-full disabled:opacity-40', camOn ? 'bg-white/15 hover:bg-white/25' : 'bg-white text-slate-900')}>{camOn ? <Video /> : <VideoOff />}</button>
        <button onClick={leave} aria-label="Leave meeting" className="grid h-14 w-14 place-items-center rounded-full bg-danger hover:brightness-110"><PhoneOff /></button>
        {self?.role === 'host' && <button onClick={endForAll} className="h-14 rounded-full bg-white/15 px-5 text-sm font-semibold hover:bg-white/25">End for all</button>}
      </footer>
    </div>
  );
}
