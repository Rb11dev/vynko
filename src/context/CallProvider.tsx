'use client';
// All one-to-one call logic for the browser. The server (server/services/calls.mjs) is the
// source of truth for who may call whom; this file owns getUserMedia + RTCPeerConnection.
//
// A call is only shown as "connected" when RTCPeerConnection.connectionState === 'connected'.
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { emitAck } from '@/lib/socket';
import { createPeer, getLocalMedia, hasMultipleCameras, mediaErrorMessage, stopStream, type Peer } from '@/lib/webrtc';
import type { PublicUser, Signal } from '@/lib/types';
import { CallContext, IDLE_CALL, type CallView } from './call-context';
import { useRealtime } from './RealtimeContext';
import CallOverlay from '@/components/CallOverlay';

const inviteError = (code: string, name: string) =>
  ({
    busy: `${name} is on another call right now.`,
    offline: `${name} is offline. They will see a missed call.`,
    forbidden: "You can't call this person.",
    not_found: 'This user no longer exists.',
    already_in_call: 'You are already in a call.',
    rate_limited: 'You are calling too often. Wait a moment and try again.',
  } as Record<string, string>)[code] ?? 'The call could not be started.';

const endedMessage = (reason: string, direction: 'incoming' | 'outgoing') =>
  ({
    rejected: 'Call declined', timeout: direction === 'outgoing' ? 'No answer' : 'Missed call',
    cancelled: direction === 'incoming' ? 'Missed call' : 'Call cancelled', hangup: 'Call ended',
    disconnected: 'The other person lost connection', connection_failed: 'The connection failed',
    connect_timeout: 'Could not establish a connection',
  } as Record<string, string>)[reason] ?? 'Call ended';

export default function CallProvider({ children }: { children: ReactNode }) {
  const { socket } = useRealtime();
  const [call, setCallState] = useState<CallView>(IDLE_CALL);
  const [localStream, setLocal] = useState<MediaStream | null>(null);
  const [remoteStream, setRemote] = useState<MediaStream | null>(null);
  const callRef = useRef<CallView>(IDLE_CALL);
  const peerRef = useRef<Peer | null>(null);
  const localRef = useRef<MediaStream | null>(null);
  const iceRef = useRef<RTCIceServer[]>([]);
  const queueRef = useRef<Signal[]>([]);
  const watchRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const resetRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const restartsRef = useRef(0);
  const facingRef = useRef<'user' | 'environment'>('user');
  const ringRef = useRef<{ stop: () => void } | null>(null);

  const setCall = useCallback((patch: Partial<CallView>) => {
    callRef.current = { ...callRef.current, ...patch };
    setCallState(callRef.current);
  }, []);

  // --- ringtone (generated with WebAudio; may be silent if the browser blocks autoplay) ---
  const stopRing = useCallback(() => { ringRef.current?.stop(); ringRef.current = null; }, []);
  const startRing = useCallback(() => {
    try {
      stopRing();
      const ctx = new AudioContext();
      const beep = () => {
        const o = ctx.createOscillator(), g = ctx.createGain();
        o.frequency.value = 480; g.gain.value = 0.06; o.connect(g); g.connect(ctx.destination);
        o.start(); o.stop(ctx.currentTime + 0.35);
      };
      beep();
      const iv = setInterval(beep, 1800);
      ringRef.current = { stop: () => { clearInterval(iv); ctx.close().catch(() => {}); } };
    } catch { /* no audio available */ }
  }, [stopRing]);

  // Releases camera, microphone and the peer connection. Always called when a call ends.
  const teardown = useCallback(() => {
    if (watchRef.current) clearTimeout(watchRef.current);
    peerRef.current?.close(); peerRef.current = null;
    stopStream(localRef.current); localRef.current = null;
    queueRef.current = []; restartsRef.current = 0; facingRef.current = 'user';
    setLocal(null); setRemote(null); stopRing();
  }, [stopRing]);

  const finish = useCallback((message: string | null, error: string | null = null) => {
    teardown();
    setCall({ phase: 'ended', callId: null, message, error, startedAt: callRef.current.startedAt });
    if (resetRef.current) clearTimeout(resetRef.current);
    resetRef.current = setTimeout(() => { callRef.current = IDLE_CALL; setCallState(IDLE_CALL); }, error ? 8000 : 2500);
  }, [teardown, setCall]);

  const failCall = useCallback((message: string) => {
    const id = callRef.current.callId;
    if (id) emitAck('call:failed', { callId: id }).catch(() => {});
    finish(null, message);
  }, [finish]);

  const dismiss = useCallback(() => {
    if (resetRef.current) clearTimeout(resetRef.current);
    callRef.current = IDLE_CALL; setCallState(IDLE_CALL);
  }, []);

  // If the link drops, the caller tries an ICE restart a few times before giving up.
  const scheduleWatch = useCallback((isCaller: boolean, delay: number) => {
    if (watchRef.current) clearTimeout(watchRef.current);
    watchRef.current = setTimeout(() => {
      const peer = peerRef.current;
      if (!peer || peer.pc.connectionState === 'connected') return;
      if (isCaller && restartsRef.current < 3) {
        restartsRef.current += 1;
        peer.offer(true).catch(() => {});
        scheduleWatch(true, 8000);
      } else failCall('The connection was lost and could not be recovered.');
    }, delay);
  }, [failCall]);

  const buildPeer = useCallback((isCaller: boolean) => {
    const stream = localRef.current, callId = callRef.current.callId;
    if (!stream || !callId) return;
    const peer = createPeer({
      iceServers: iceRef.current, localStream: stream,
      onSignal: (data) => { emitAck('call:signal', { callId, data }).catch(() => {}); },
      onStream: (s) => setRemote(s),
      onState: (st) => {
        if (st === 'connected') {
          if (watchRef.current) clearTimeout(watchRef.current);
          restartsRef.current = 0;
          setCall({ phase: 'connected', startedAt: callRef.current.startedAt ?? Date.now(), error: null });
          emitAck('call:connected', { callId }).catch(() => {}); // tells the server the media link is REALLY up
        } else if (st === 'disconnected' || st === 'failed') {
          if (callRef.current.phase === 'connected') setCall({ phase: 'reconnecting' });
          scheduleWatch(isCaller, st === 'failed' ? 500 : 4000);
        }
      },
    });
    peerRef.current = peer;
    queueRef.current.splice(0).forEach((s) => peer.handleSignal(s).catch(() => {}));
    if (isCaller) peer.offer().catch(() => failCall('Could not start the connection.'));
  }, [failCall, scheduleWatch, setCall]);

  const startCall = useCallback(async (peerUser: PublicUser, type: 'audio' | 'video') => {
    const ph = callRef.current.phase;
    if (ph !== 'idle' && ph !== 'ended') return;
    if (resetRef.current) clearTimeout(resetRef.current);
    callRef.current = { ...IDLE_CALL, phase: 'calling', peer: peerUser, type, direction: 'outgoing', camOn: type === 'video' };
    setCallState(callRef.current);
    let stream: MediaStream;
    try { stream = await getLocalMedia(type); }
    catch (e) { finish(null, mediaErrorMessage(e, type)); return; }
    if (callRef.current.phase !== 'calling') { stopStream(stream); return; } // user hung up while the permission prompt was open
    localRef.current = stream; setLocal(stream);
    hasMultipleCameras().then((multi) => { if (type === 'video') setCall({ canSwitchCamera: multi }); });
    try {
      const ice = await emitAck<{ iceServers?: RTCIceServer[] }>('ice:get');
      iceRef.current = ice.iceServers ?? [];
      const r = await emitAck<{ ok?: boolean; callId?: string; error?: string }>('call:invite', { toUserId: peerUser.id, type });
      if (r.error || !r.callId) { finish(null, inviteError(r.error ?? '', peerUser.displayName)); return; }
      if (callRef.current.phase !== 'calling') { emitAck('call:cancel', { callId: r.callId }).catch(() => {}); return; }
      setCall({ callId: r.callId });
    } catch { finish(null, 'Could not reach the server. Check your connection and try again.'); }
  }, [finish, setCall]);

  const acceptCall = useCallback(async () => {
    const c = callRef.current;
    if (c.phase !== 'incoming' || !c.callId) return;
    stopRing();
    setCall({ phase: 'connecting' });
    let stream: MediaStream;
    try { stream = await getLocalMedia(c.type); }
    catch (e) { emitAck('call:reject', { callId: c.callId }).catch(() => {}); finish(null, mediaErrorMessage(e, c.type)); return; }
    if (callRef.current.callId !== c.callId) { stopStream(stream); return; }
    localRef.current = stream; setLocal(stream);
    hasMultipleCameras().then((multi) => { if (c.type === 'video') setCall({ canSwitchCamera: multi }); });
    try {
      const ice = await emitAck<{ iceServers?: RTCIceServer[] }>('ice:get');
      iceRef.current = ice.iceServers ?? [];
      const r = await emitAck<{ ok?: boolean; error?: string }>('call:accept', { callId: c.callId });
      if (r.error) { finish('This call is no longer available.'); return; }
      if (callRef.current.callId === c.callId) buildPeer(false);
    } catch { finish(null, 'Could not reach the server. Check your connection and try again.'); }
  }, [buildPeer, finish, setCall, stopRing]);

  const endCall = useCallback(() => {
    const c = callRef.current;
    if (c.phase === 'idle' || c.phase === 'ended') return;
    if (c.callId) {
      const ev = c.phase === 'calling' ? 'call:cancel' : c.phase === 'incoming' ? 'call:reject' : 'call:end';
      emitAck(ev, { callId: c.callId }).catch(() => {});
    }
    finish('Call ended');
  }, [finish]);

  const toggleMic = useCallback(() => {
    const on = !callRef.current.micOn;
    localRef.current?.getAudioTracks().forEach((t) => { t.enabled = on; });
    setCall({ micOn: on });
  }, [setCall]);
  const toggleCam = useCallback(() => {
    const on = !callRef.current.camOn;
    localRef.current?.getVideoTracks().forEach((t) => { t.enabled = on; });
    setCall({ camOn: on });
  }, [setCall]);

  // Front <-> rear camera on phones: swap the track in place, no renegotiation needed.
  const switchCamera = useCallback(async () => {
    const stream = localRef.current;
    if (!stream) return;
    const next = facingRef.current === 'user' ? 'environment' : 'user';
    try {
      const fresh = await getLocalMedia('video', next);
      const track = fresh.getVideoTracks()[0];
      fresh.getAudioTracks().forEach((t) => t.stop()); // keep the original microphone
      track.enabled = callRef.current.camOn;
      await peerRef.current?.replaceVideoTrack(track);
      stream.getVideoTracks().forEach((t) => { stream.removeTrack(t); t.stop(); });
      stream.addTrack(track);
      facingRef.current = next;
      setLocal(new MediaStream(stream.getTracks()));
    } catch (e) { setCall({ error: mediaErrorMessage(e, 'video') }); }
  }, [setCall]);

  useEffect(() => {
    const onIncoming = (p: { callId: string; type: 'audio' | 'video'; from: PublicUser }) => {
      const ph = callRef.current.phase;
      if (ph !== 'idle' && ph !== 'ended') return;
      if (resetRef.current) clearTimeout(resetRef.current);
      callRef.current = { ...IDLE_CALL, phase: 'incoming', callId: p.callId, peer: p.from, type: p.type, direction: 'incoming', camOn: p.type === 'video' };
      setCallState(callRef.current);
      startRing();
    };
    const onAccepted = (p: { callId: string }) => { if (p.callId === callRef.current.callId && callRef.current.direction === 'outgoing') { setCall({ phase: 'connecting' }); buildPeer(true); } };
    const onSignal = (p: { callId: string; data: Signal }) => {
      if (p.callId !== callRef.current.callId) return;
      if (peerRef.current) peerRef.current.handleSignal(p.data).catch(() => {});
      else queueRef.current.push(p.data); // peer not created yet (still waiting for the microphone)
    };
    const onEnded = (p: { callId: string; reason: string }) => { if (p.callId === callRef.current.callId) finish(endedMessage(p.reason, callRef.current.direction)); };
    const onTaken = (p: { callId: string }) => { if (p.callId === callRef.current.callId && callRef.current.phase === 'incoming') finish('Answered on another device'); };
    const onDisconnect = () => { const ph = callRef.current.phase; if (ph !== 'idle' && ph !== 'ended') finish(null, 'Lost connection to the server, so the call was ended.'); };
    socket.on('call:incoming', onIncoming); socket.on('call:accepted', onAccepted); socket.on('call:signal', onSignal);
    socket.on('call:ended', onEnded); socket.on('call:taken', onTaken); socket.on('disconnect', onDisconnect);
    return () => {
      socket.off('call:incoming', onIncoming); socket.off('call:accepted', onAccepted); socket.off('call:signal', onSignal);
      socket.off('call:ended', onEnded); socket.off('call:taken', onTaken); socket.off('disconnect', onDisconnect);
    };
  }, [socket, buildPeer, finish, setCall, startRing]);

  // Leaving the page (or closing the tab) must release the camera and microphone.
  useEffect(() => {
    const onUnload = () => { const c = callRef.current; if (c.callId) socket.emit('call:end', { callId: c.callId }); stopStream(localRef.current); };
    window.addEventListener('pagehide', onUnload);
    return () => { window.removeEventListener('pagehide', onUnload); teardown(); };
  }, [socket, teardown]);

  const api = useMemo(
    () => ({ call, localStream, remoteStream, startCall, acceptCall, endCall, dismiss, toggleMic, toggleCam, switchCamera }),
    [call, localStream, remoteStream, startCall, acceptCall, endCall, dismiss, toggleMic, toggleCam, switchCamera]
  );
  return (
    <CallContext.Provider value={api}>
      {children}
      <CallOverlay />
    </CallContext.Provider>
  );
}
