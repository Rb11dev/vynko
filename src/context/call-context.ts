'use client';
import { createContext, useContext } from 'react';
import type { PublicUser } from '@/lib/types';

export type CallPhase = 'idle' | 'calling' | 'incoming' | 'connecting' | 'connected' | 'reconnecting' | 'ended';
export type CallView = {
  phase: CallPhase; callId: string | null; peer: PublicUser | null; type: 'audio' | 'video';
  direction: 'incoming' | 'outgoing'; startedAt: number | null; message: string | null; error: string | null;
  micOn: boolean; camOn: boolean; canSwitchCamera: boolean;
};
export const IDLE_CALL: CallView = {
  phase: 'idle', callId: null, peer: null, type: 'audio', direction: 'outgoing', startedAt: null,
  message: null, error: null, micOn: true, camOn: true, canSwitchCamera: false,
};
export type CallApi = {
  call: CallView; localStream: MediaStream | null; remoteStream: MediaStream | null;
  startCall: (peer: PublicUser, type: 'audio' | 'video') => Promise<void>;
  acceptCall: () => Promise<void>; endCall: () => void; dismiss: () => void;
  toggleMic: () => void; toggleCam: () => void; switchCamera: () => Promise<void>;
};
export const CallContext = createContext<CallApi | null>(null);
export const useCall = () => {
  const c = useContext(CallContext);
  if (!c) throw new Error('useCall must be used inside CallProvider');
  return c;
};
