import { io, Socket } from 'socket.io-client';

let socket: Socket | null = null;

// One shared connection. Same address as the website unless NEXT_PUBLIC_SIGNALING_URL is set.
export function getSocket(): Socket {
  if (!socket) {
    socket = io(process.env.NEXT_PUBLIC_SIGNALING_URL || undefined, {
      withCredentials: true, autoConnect: false, transports: ['websocket', 'polling'],
    });
  }
  return socket;
}

// Emit with an acknowledgement from the server (rejects on timeout).
export function emitAck<T = any>(event: string, payload?: unknown, timeoutMs = 8000): Promise<T> {
  return new Promise((resolve, reject) => {
    getSocket().timeout(timeoutMs).emit(event, payload, (err: Error | null, res: T) => (err ? reject(new Error('timeout')) : resolve(res)));
  });
}
