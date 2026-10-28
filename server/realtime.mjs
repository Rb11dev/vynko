// Socket.IO wiring. All decisions live in the services; this file only authenticates
// sockets, forwards events to them and pushes results back to the right browsers.
// Identity ALWAYS comes from the session cookie checked at connection time - never from
// anything the client sends.
import { parseCookies, SESSION_COOKIE } from './auth.mjs';
import { publicUser } from './services/users.mjs';
import { createRateLimiter } from './ratelimit.mjs';

export function attachRealtime({ io, app, log = console }) {
  const { config, users, messages, presence, callManager, hub, meetings, limiters } = app;
  const eventLimiter = createRateLimiter({ windowMs: 10_000, max: 300 });
  io.use((socket, next) => {
    const token = parseCookies(socket.handshake.headers.cookie)[SESSION_COOKIE];
    socket.data.user = users.userFromToken(token);
    socket.data.sessionKey = token ? users.sessionKey(token) : null;
    next();
  });

  // Route outgoing events from the services to specific sockets (socket id == its own room).
  app.setEmit((socketId, event, payload) => io.to(socketId).emit(event, payload));

  const emitUser = (userId, event, payload) => io.to(`user:${userId}`).emit(event, payload);

  const broadcastPresence = (userId) => {
    const row = users.getById(userId);
    if (!row) return;
    for (const watcher of users.watchers(userId)) {
      emitUser(watcher, 'presence', { userId, ...users.presenceView(watcher, row, presence) });
    }
  };

  Object.assign(app.realtime, {
    // Push a stored message to the recipient. It only becomes "delivered" when their browser acknowledges it.
    notifyMessage(message, toUserId) {
      if (!presence.isOnline(toUserId)) return;
      io.in(`user:${toUserId}`).timeout(5000).emit('message:new', message, (err, responses) => {
        if (!responses || responses.length === 0) return;
        const updated = messages.markDelivered(toUserId, [message.id]);
        for (const row of updated) emitUser(row.sender_id, 'message:status', { ids: [row.id], status: 'delivered', peerId: toUserId });
      });
    },
    notifyRead(readerId, otherId, ids) { emitUser(otherId, 'message:status', { ids, status: 'read', peerId: readerId }); },
    closeMeeting(code, reason) { hub.closeRoom(code, reason); },
    disconnectUser(userId) { io.in(`user:${userId}`).disconnectSockets(true); },
    disconnectSession(key) { io.in(`session:${key}`).disconnectSockets(true); },
  });

  io.on('connection', (socket) => {
    const user = socket.data.user;
    const ctx = { id: socket.id, userId: user?.id ?? null };
    if (socket.data.sessionKey && user) socket.join(`session:${socket.data.sessionKey}`);

    // Wraps a handler: acknowledgement required, errors contained, flood-protected.
    const on = (event, { userOnly = false } = {}, handler) => {
      socket.on(event, (payload, ack) => {
        if (typeof payload === 'function') { ack = payload; payload = undefined; }
        const done = typeof ack === 'function' ? ack : () => {};
        try {
          if (userOnly && !ctx.userId) return done({ error: 'unauthenticated' });
          if (!eventLimiter.hit(socket.id).ok) return done({ error: 'rate_limited' });
          done(handler(payload ?? {}) ?? { ok: true });
        } catch (err) {
          log.error(`[socket] ${event} failed:`, err?.message);
          done({ error: 'internal_error' });
        }
      });
    };

    if (user) {
      socket.join(`user:${user.id}`);
      if (presence.add(user.id, socket.id)) broadcastPresence(user.id);
      for (const row of messages.markAllDelivered(user.id)) emitUser(row.sender_id, 'message:status', { ids: [row.id], status: 'delivered', peerId: user.id });
    }

    on('ice:get', { userOnly: true }, () => ({ ok: true, iceServers: config.iceServers }));

    on('call:invite', { userOnly: true }, (p) => {
      if (!limiters.callInvite.hit(`u${ctx.userId}`).ok) return { error: 'rate_limited' };
      return callManager.invite(ctx, p);
    });
    on('call:accept', { userOnly: true }, (p) => callManager.accept(ctx, p.callId));
    on('call:reject', { userOnly: true }, (p) => callManager.reject(ctx, p.callId));
    on('call:cancel', { userOnly: true }, (p) => callManager.cancel(ctx, p.callId));
    on('call:signal', { userOnly: true }, (p) => callManager.signal(ctx, p.callId, p.data));
    on('call:connected', { userOnly: true }, (p) => callManager.connected(ctx, p.callId));
    on('call:failed', { userOnly: true }, (p) => callManager.failed(ctx, p.callId));
    on('call:end', { userOnly: true }, (p) => callManager.end(ctx, p.callId));

    // Meetings work for guests too (they prove themselves with a secret token).
    on('meeting:join', {}, (p) => {
      const r = hub.join(ctx, p);
      return r.ok ? { ...r, iceServers: config.iceServers } : r;
    });
    on('meeting:signal', {}, (p) => hub.signal(ctx, p));
    on('meeting:leave', {}, () => hub.leave(ctx));

    socket.on('disconnect', () => {
      eventLimiter.reset(socket.id);
      callManager.disconnect(ctx);
      hub.leave(ctx);
      if (user && presence.remove(user.id, socket.id)) {
        users.touchLastSeen(user.id);
        broadcastPresence(user.id);
      }
    });
  });
}
