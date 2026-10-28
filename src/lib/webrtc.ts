import type { Signal } from './types';

// ---------- Microphone / camera ----------
export function mediaErrorMessage(err: unknown, kind: 'audio' | 'video'): string {
  const thing = kind === 'video' ? 'camera and microphone' : 'microphone';
  const name = (err as DOMException)?.name;
  if (typeof window !== 'undefined' && !window.isSecureContext) {
    return `Your browser blocks the ${thing} on this address. Use https:// (or localhost during development).`;
  }
  switch (name) {
    case 'NotAllowedError': case 'SecurityError':
      return `Permission to use your ${thing} was denied. Allow access in your browser's site settings (the lock icon near the address bar), then try again.`;
    case 'NotFoundError': case 'DevicesNotFoundError':
      return `No ${thing} was found. Plug one in or check your system settings, then try again.`;
    case 'NotReadableError': case 'TrackStartError':
      return `Your ${thing} is being used by another app or tab. Close it and try again.`;
    case 'OverconstrainedError':
      return `Your ${thing} does not support the requested settings.`;
    default:
      return `Could not start your ${thing}. ${(err as Error)?.message ?? ''}`.trim();
  }
}

export async function getLocalMedia(kind: 'audio' | 'video', facing: 'user' | 'environment' = 'user'): Promise<MediaStream> {
  if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
    throw Object.assign(new Error('Media devices are not available'), { name: 'SecurityError' });
  }
  return navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    video: kind === 'video' ? { facingMode: facing, width: { ideal: 1280 }, height: { ideal: 720 } } : false,
  });
}

export async function hasMultipleCameras() {
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices.filter((d) => d.kind === 'videoinput').length > 1;
  } catch { return false; }
}

// ---------- One RTCPeerConnection ----------
export type Peer = ReturnType<typeof createPeer>;

export function createPeer(opts: {
  iceServers: RTCIceServer[];
  localStream: MediaStream;
  onSignal: (s: Signal) => void;
  onStream: (s: MediaStream) => void;
  onState: (s: RTCPeerConnectionState) => void;
  ensureReceive?: boolean; // meetings: still receive audio/video even if we have no camera/mic
}) {
  const pc = new RTCPeerConnection({ iceServers: opts.iceServers });
  const fallbackRemote = new MediaStream();
  const pending: RTCIceCandidateInit[] = [];

  opts.localStream.getTracks().forEach((t) => pc.addTrack(t, opts.localStream));
  if (opts.ensureReceive) {
    for (const kind of ['audio', 'video'] as const) {
      if (!opts.localStream.getTracks().some((t) => t.kind === kind)) pc.addTransceiver(kind, { direction: 'recvonly' });
    }
  }
  pc.onicecandidate = (e) => { if (e.candidate) opts.onSignal({ candidate: e.candidate.toJSON() }); };
  pc.ontrack = (e) => {
    let s = e.streams[0];
    if (!s) { fallbackRemote.addTrack(e.track); s = fallbackRemote; }
    opts.onStream(s);
  };
  pc.onconnectionstatechange = () => opts.onState(pc.connectionState);

  const flush = async () => {
    while (pending.length) { try { await pc.addIceCandidate(pending.shift()!); } catch { /* stale candidate */ } }
  };

  return {
    pc,
    // Start (or restart, after a network change) the negotiation.
    async offer(iceRestart = false) {
      const o = await pc.createOffer({ iceRestart });
      await pc.setLocalDescription(o);
      opts.onSignal({ description: { type: 'offer', sdp: pc.localDescription!.sdp } });
    },
    async handleSignal(sig: Signal) {
      if (sig.description) {
        await pc.setRemoteDescription(sig.description);
        await flush();
        if (sig.description.type === 'offer') {
          const a = await pc.createAnswer();
          await pc.setLocalDescription(a);
          opts.onSignal({ description: { type: 'answer', sdp: pc.localDescription!.sdp } });
        }
      } else if (sig.candidate) {
        if (pc.remoteDescription) { try { await pc.addIceCandidate(sig.candidate); } catch { /* ignore */ } }
        else pending.push(sig.candidate); // remote description not set yet
      }
    },
    async replaceVideoTrack(track: MediaStreamTrack) {
      const sender = pc.getSenders().find((s) => s.track?.kind === 'video');
      if (sender) await sender.replaceTrack(track);
    },
    close() {
      pc.onicecandidate = null; pc.ontrack = null; pc.onconnectionstatechange = null;
      try { pc.close(); } catch { /* already closed */ }
    },
  };
}

export const stopStream = (s: MediaStream | null | undefined) => s?.getTracks().forEach((t) => t.stop());
