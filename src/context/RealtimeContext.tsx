'use client';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { Socket } from 'socket.io-client';
import { getSocket } from '@/lib/socket';
import { useAuth } from './AuthContext';

export type ConnStatus = 'connecting' | 'connected' | 'disconnected';
const Ctx = createContext<{ socket: Socket; status: ConnStatus } | null>(null);
export const useRealtime = () => {
  const c = useContext(Ctx);
  if (!c) throw new Error('useRealtime must be used inside RealtimeProvider');
  return c;
};

// Keeps one Socket.IO connection open for as long as the user is signed in.
export function RealtimeProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const socket = getSocket();
  const [status, setStatus] = useState<ConnStatus>('connecting');

  useEffect(() => {
    if (!user) return;
    const up = () => setStatus('connected');
    const down = () => setStatus('disconnected');
    const trying = () => setStatus('connecting');
    socket.on('connect', up); socket.on('disconnect', down); socket.on('connect_error', down);
    socket.io.on('reconnect_attempt', trying);
    if (socket.connected) setStatus('connected'); else socket.connect();
    return () => {
      socket.off('connect', up); socket.off('disconnect', down); socket.off('connect_error', down);
      socket.io.off('reconnect_attempt', trying);
    };
  }, [user, socket]);

  return <Ctx.Provider value={{ socket, status }}>{children}</Ctx.Provider>;
}
