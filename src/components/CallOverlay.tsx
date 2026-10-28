'use client';
// Incoming-call dialog + full-screen audio/video call UI. Everything shown here is driven by
// the real call state in CallProvider (nothing is simulated).
import { Maximize2, Mic, MicOff, Phone, PhoneOff, RefreshCw, SwitchCamera, Video, VideoOff, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useCall } from '@/context/call-context';
import { formatDuration } from '@/lib/format';
import { Avatar, cn } from './ui';

function useElapsed(startedAt: number | null) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!startedAt) return;
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [startedAt]);
  return startedAt ? Math.max(0, Math.floor((now - startedAt) / 1000)) : 0;
}

export function StreamEl({ stream, kind, muted, mirror, className }: { stream: MediaStream | null; kind: 'video' | 'audio'; muted?: boolean; mirror?: boolean; className?: string }) {
  const ref = useRef<HTMLVideoElement & HTMLAudioElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.srcObject = stream;
    if (stream) el.play?.().catch(() => {});
  }, [stream]);
  if (kind === 'audio') return <audio ref={ref} autoPlay muted={muted} />;
  return <video ref={ref} autoPlay playsInline muted={muted} className={cn(className, mirror && '-scale-x-100')} />;
}

function RoundBtn({ onClick, label, active = true, danger, children, size = 'md' }: { onClick: () => void; label: string; active?: boolean; danger?: boolean; children: React.ReactNode; size?: 'md' | 'lg' }) {
  return (
    <button onClick={onClick} aria-label={label} title={label}
      className={cn('grid place-items-center rounded-full text-white transition active:scale-95', size === 'lg' ? 'h-16 w-16' : 'h-14 w-14',
        danger ? 'bg-danger hover:brightness-110' : active ? 'bg-white/15 hover:bg-white/25' : 'bg-white text-slate-900 hover:bg-white/90')}>
      {children}
    </button>
  );
}

export default function CallOverlay() {
  const { call, localStream, remoteStream, acceptCall, endCall, dismiss, startCall, toggleMic, toggleCam, switchCamera } = useCall();
  const elapsed = useElapsed(call.phase === 'connected' || call.phase === 'reconnecting' ? call.startedAt : null);
  const boxRef = useRef<HTMLDivElement>(null);
  const [full, setFull] = useState(false);
  useEffect(() => {
    const onFs = () => setFull(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', onFs);
    return () => document.removeEventListener('fullscreenchange', onFs);
  }, []);

  if (call.phase === 'idle' || !call.peer) return null;
  const peer = call.peer;
  const video = call.type === 'video';

  // ---------- Incoming call dialog ----------
  if (call.phase === 'incoming') {
    return (
      <div role="alertdialog" aria-modal="true" aria-label={`Incoming ${call.type} call from ${peer.displayName}`}
        className="fixed inset-0 z-[100] grid place-items-center bg-black/60 p-4 backdrop-blur-md">
        <div className="w-full max-w-sm animate-rise rounded-3xl border border-line bg-surface p-8 text-center shadow-2xl">
          <div className="relative mx-auto mb-5 grid h-28 w-28 place-items-center">
            <span className="absolute inset-0 animate-pulseRing rounded-full bg-brand/40" />
            <Avatar name={peer.displayName} url={peer.avatarUrl} size={96} />
          </div>
          <p className="text-sm text-muted">Incoming {call.type} call</p>
          <h2 className="mt-1 text-2xl font-bold">{peer.displayName}</h2>
          <p className="text-sm text-muted">@{peer.username}</p>
          <div className="mt-8 flex items-center justify-center gap-10">
            <div className="text-center">
              <RoundBtn danger label="Decline call" onClick={endCall}><PhoneOff /></RoundBtn>
              <span className="mt-2 block text-xs text-muted">Decline</span>
            </div>
            <div className="text-center">
              <button onClick={acceptCall} aria-label="Accept call" className="grid h-14 w-14 place-items-center rounded-full bg-ok text-white transition hover:brightness-110 active:scale-95">
                {video ? <Video /> : <Phone />}
              </button>
              <span className="mt-2 block text-xs text-muted">Accept</span>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ---------- Call finished (message / error + retry) ----------
  if (call.phase === 'ended') {
    return (
      <div className="fixed inset-x-0 top-0 z-[100] flex justify-center p-3 safe-top">
        <div role="status" className="flex max-w-md items-start gap-3 rounded-2xl border border-line bg-surface p-4 shadow-2xl">
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold">{call.error ? 'Call problem' : call.message ?? 'Call ended'}</p>
            {call.error && <p className="mt-1 text-sm text-muted">{call.error}</p>}
            {call.error && (
              <button onClick={() => { dismiss(); startCall(peer, call.type); }} className="mt-3 inline-flex items-center gap-1.5 text-sm font-semibold text-brand">
                <RefreshCw size={14} /> Try again
              </button>
            )}
          </div>
          <button onClick={dismiss} aria-label="Dismiss" className="text-muted hover:text-ink"><X size={18} /></button>
        </div>
      </div>
    );
  }

  const status =
    call.phase === 'calling' ? (call.callId ? 'Ringing…' : 'Starting…')
    : call.phase === 'connecting' ? 'Connecting…'
    : call.phase === 'reconnecting' ? 'Reconnecting…'
    : formatDuration(elapsed);
  const showRemoteVideo = video && !!remoteStream && call.phase !== 'calling' && call.phase !== 'connecting';

  return (
    <div ref={boxRef} role="dialog" aria-label={`${call.type} call with ${peer.displayName}`} className="fixed inset-0 z-[100] overflow-hidden bg-slate-950 text-white">
      <StreamEl stream={remoteStream} kind="audio" />
      {video && <StreamEl stream={remoteStream} kind="video" className={cn('absolute inset-0 h-full w-full object-cover transition-opacity', showRemoteVideo ? 'opacity-100' : 'opacity-0')} />}

      {!showRemoteVideo && (
        <div className="absolute inset-0 grid place-items-center bg-[radial-gradient(ellipse_at_top,rgb(109_74_255/0.45),transparent_60%),radial-gradient(ellipse_at_bottom,rgb(255_92_138/0.25),transparent_55%)]">
          <div className="text-center">
            <div className="relative mx-auto mb-6 grid h-40 w-40 place-items-center">
              {call.phase !== 'connected' && <span className="absolute inset-0 animate-pulseRing rounded-full bg-white/20" />}
              <Avatar name={peer.displayName} url={peer.avatarUrl} size={128} />
            </div>
            <h2 className="text-3xl font-bold">{peer.displayName}</h2>
            <p className="mt-2 text-lg text-white/70 tabular-nums" aria-live="polite">{status}</p>
          </div>
        </div>
      )}

      <div className="absolute inset-x-0 top-0 flex items-center justify-between bg-gradient-to-b from-black/60 to-transparent p-4 safe-top">
        <div>
          <p className="font-semibold">{peer.displayName}</p>
          <p className="text-sm text-white/70 tabular-nums" aria-live="polite">
            {call.phase === 'reconnecting' && <span className="mr-1 inline-block h-2 w-2 animate-pulse rounded-full bg-amber-400" />}{status}
          </p>
        </div>
        {video && (
          <button onClick={() => (document.fullscreenElement ? document.exitFullscreen() : boxRef.current?.requestFullscreen?.())}
            aria-label={full ? 'Exit full screen' : 'Full screen'} className="grid h-10 w-10 place-items-center rounded-full bg-white/15 hover:bg-white/25">
            <Maximize2 size={18} />
          </button>
        )}
      </div>

      {video && localStream && (
        <div className="absolute bottom-32 right-4 h-36 w-24 overflow-hidden rounded-2xl border border-white/20 bg-slate-800 shadow-xl sm:h-44 sm:w-32">
          <StreamEl stream={localStream} kind="video" muted mirror className="h-full w-full object-cover" />
          {!call.camOn && <div className="absolute inset-0 grid place-items-center bg-slate-900 text-white/70"><VideoOff size={22} /></div>}
        </div>
      )}

      {call.error && <div role="alert" className="absolute inset-x-4 bottom-36 rounded-xl bg-danger/90 p-3 text-center text-sm">{call.error}</div>}

      <div className="absolute inset-x-0 bottom-0 flex items-center justify-center gap-4 bg-gradient-to-t from-black/70 to-transparent p-6 pb-8 safe-bottom">
        <RoundBtn onClick={toggleMic} label={call.micOn ? 'Mute microphone' : 'Unmute microphone'} active={call.micOn}>{call.micOn ? <Mic /> : <MicOff />}</RoundBtn>
        {video && <RoundBtn onClick={toggleCam} label={call.camOn ? 'Turn camera off' : 'Turn camera on'} active={call.camOn}>{call.camOn ? <Video /> : <VideoOff />}</RoundBtn>}
        {video && call.canSwitchCamera && <RoundBtn onClick={switchCamera} label="Switch camera"><SwitchCamera /></RoundBtn>}
        <RoundBtn danger size="lg" onClick={endCall} label={call.phase === 'calling' ? 'Cancel call' : 'End call'}><PhoneOff /></RoundBtn>
      </div>
    </div>
  );
}
