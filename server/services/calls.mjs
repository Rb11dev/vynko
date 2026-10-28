// Server-side call state machine. It never touches Socket.IO directly: it is given
// an `emit(socketId, event, payload)` function, which makes it fully unit-testable.
//
// States: ringing -> connecting (callee accepted) -> connected (BOTH browsers report a
// live WebRTC connection) -> finished. Every finish writes one result to the database.
import crypto from 'node:crypto';
import * as v from '../validate.mjs';
import { publicUser } from './users.mjs';

export function callHistoryDto(row, viewerId, other) {
  const outgoing = row.caller_id === viewerId;
  let status = row.result;
  if (!outgoing && (status === 'cancelled' || status === 'busy')) status = 'missed';
  if (outgoing && status === 'missed') status = 'unanswered';
  return {
    id: row.id, type: row.type, direction: outgoing ? 'outgoing' : 'incoming', status,
    createdAt: row.created_at, connectedAt: row.connected_at ?? null,
    durationSec: row.connected_at && row.ended_at ? Math.max(0, Math.round((row.ended_at - row.connected_at) / 1000)) : null,
    other: publicUser(other),
  };
}

export class CallManager {
  constructor({ db, users, presence, emit, now = Date.now, ringTimeoutMs = 30000, connectTimeoutMs = 45000, setTimer = setTimeout, clearTimer = clearTimeout }) {
    Object.assign(this, { db, users, presence, emit, now, ringTimeoutMs, connectTimeoutMs, setTimer, clearTimer });
    this.calls = new Map(); // callId -> live call
    this.busy = new Map();  // userId -> callId
  }

  // Calls left unfinished by a crash/restart are marked failed so history is never misleading.
  recoverOrphans() {
    return Number(this.db.prepare("UPDATE calls SET result = 'failed', ended_at = ? WHERE result IS NULL").run(this.now()).changes);
  }

  #record(callerId, calleeId, type, result) {
    const id = crypto.randomUUID();
    const t = this.now();
    this.db.prepare('INSERT INTO calls (id, caller_id, callee_id, type, created_at, ended_at, result) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(id, callerId, calleeId, type, t, result ? t : null, result);
    return id;
  }

  // socket = { id, userId }
  invite(socket, { toUserId, type } = {}) {
    if (type !== 'audio' && type !== 'video') return { error: 'invalid_request' };
    let to;
    try { to = v.intId(toUserId, 'toUserId'); } catch { return { error: 'invalid_request' }; }
    const can = this.users.canInteract(socket.userId, to);
    if (!can.ok) return { error: can.code === 'not_found' ? 'not_found' : 'forbidden' };
    if (this.busy.has(socket.userId)) return { error: 'already_in_call' };
    if (this.busy.has(to)) { this.#record(socket.userId, to, type, 'busy'); return { error: 'busy' }; }
    if (!this.presence.isOnline(to)) { this.#record(socket.userId, to, type, 'missed'); return { error: 'offline' }; }

    const caller = this.users.getById(socket.userId);
    const id = crypto.randomUUID();
    this.db.prepare('INSERT INTO calls (id, caller_id, callee_id, type, created_at) VALUES (?, ?, ?, ?, ?)').run(id, socket.userId, to, type, this.now());
    const call = { id, callerId: socket.userId, calleeId: to, type, state: 'ringing', callerSocket: socket.id, calleeSocket: null, reported: new Set(), timer: null, done: false, connectedAt: null };
    call.timer = this.setTimer(() => this.#finish(call, 'missed', 'timeout'), this.ringTimeoutMs);
    this.calls.set(id, call);
    this.busy.set(socket.userId, id);
    this.busy.set(to, id);
    for (const sid of this.presence.sockets(to)) this.emit(sid, 'call:incoming', { callId: id, type, from: publicUser(caller) });
    return { ok: true, callId: id };
  }

  #get(callId) { const c = typeof callId === 'string' ? this.calls.get(callId) : undefined; return c && !c.done ? c : null; }
  #isParty(c, socket) { return (socket.userId === c.callerId && socket.id === c.callerSocket) || (socket.userId === c.calleeId && socket.id === c.calleeSocket); }
  #other(c, socket) { return socket.id === c.callerSocket ? c.calleeSocket : c.callerSocket; }

  accept(socket, callId) {
    const c = this.#get(callId);
    if (!c || socket.userId !== c.calleeId) return { error: 'not_allowed' }; // only the intended recipient
    if (c.state !== 'ringing') return { error: 'invalid_state' };
    this.clearTimer(c.timer);
    c.state = 'connecting';
    c.calleeSocket = socket.id;
    c.timer = this.setTimer(() => this.#finish(c, 'failed', 'connect_timeout'), this.connectTimeoutMs);
    for (const sid of this.presence.sockets(c.calleeId)) if (sid !== socket.id) this.emit(sid, 'call:taken', { callId: c.id });
    this.emit(c.callerSocket, 'call:accepted', { callId: c.id });
    return { ok: true };
  }

  reject(socket, callId) {
    const c = this.#get(callId);
    if (!c || socket.userId !== c.calleeId) return { error: 'not_allowed' };
    if (c.state !== 'ringing') return { error: 'invalid_state' };
    this.#finish(c, 'rejected', 'rejected', socket.id);
    return { ok: true };
  }

  cancel(socket, callId) {
    const c = this.#get(callId);
    if (!c || socket.userId !== c.callerId || socket.id !== c.callerSocket) return { error: 'not_allowed' };
    if (c.state !== 'ringing') return { error: 'invalid_state' };
    this.#finish(c, 'cancelled', 'cancelled', socket.id);
    return { ok: true };
  }

  signal(socket, callId, data) {
    const c = this.#get(callId);
    if (!c || !this.#isParty(c, socket)) return { error: 'not_allowed' };
    if (c.state === 'ringing') return { error: 'invalid_state' };
    let clean;
    try { clean = v.signal(data); } catch { return { error: 'invalid_signal' }; }
    this.emit(this.#other(c, socket), 'call:signal', { callId: c.id, data: clean });
    return { ok: true };
  }

  // A browser says its RTCPeerConnection is really connected. We only mark the call
  // connected once BOTH sides have said so.
  connected(socket, callId) {
    const c = this.#get(callId);
    if (!c || !this.#isParty(c, socket)) return { error: 'not_allowed' };
    if (c.state === 'ringing') return { error: 'invalid_state' };
    c.reported.add(socket.userId);
    if (c.state === 'connecting' && c.reported.size === 2) {
      this.clearTimer(c.timer);
      c.timer = null;
      c.state = 'connected';
      c.connectedAt = this.now();
      this.db.prepare('UPDATE calls SET connected_at = ? WHERE id = ?').run(c.connectedAt, c.id);
    }
    return { ok: true };
  }

  end(socket, callId, reason = 'hangup') {
    const c = this.#get(callId);
    if (!c || !this.#isParty(c, socket)) return { error: 'not_allowed' };
    this.#finish(c, c.connectedAt ? 'completed' : 'cancelled', reason, socket.id);
    return { ok: true };
  }

  failed(socket, callId) {
    const c = this.#get(callId);
    if (!c || !this.#isParty(c, socket)) return { error: 'not_allowed' };
    this.#finish(c, c.connectedAt ? 'completed' : 'failed', 'connection_failed', socket.id);
    return { ok: true };
  }

  // A browser tab closed or lost its connection: clean up any call it was part of.
  disconnect(socket) {
    for (const c of [...this.calls.values()]) {
      if (c.done) continue;
      if (c.state === 'ringing') {
        if (socket.id === c.callerSocket) this.#finish(c, 'cancelled', 'disconnected', socket.id);
      } else if (this.#isParty(c, socket)) {
        this.#finish(c, c.connectedAt ? 'completed' : 'failed', 'disconnected', socket.id);
      }
    }
  }

  #finish(c, result, reason, exceptSocket) {
    if (c.done) return;
    c.done = true;
    if (c.timer) this.clearTimer(c.timer);
    const t = this.now();
    this.db.prepare('UPDATE calls SET result = ?, ended_at = ? WHERE id = ?').run(result, t, c.id);
    this.calls.delete(c.id);
    if (this.busy.get(c.callerId) === c.id) this.busy.delete(c.callerId);
    if (this.busy.get(c.calleeId) === c.id) this.busy.delete(c.calleeId);
    const targets = new Set([c.callerSocket]);
    if (c.state === 'ringing') this.presence.sockets(c.calleeId).forEach((s) => targets.add(s));
    else if (c.calleeSocket) targets.add(c.calleeSocket);
    for (const sid of targets) if (sid && sid !== exceptSocket) this.emit(sid, 'call:ended', { callId: c.id, reason });
  }

  history(userId, { before, limit } = {}) {
    const lim = Math.min(Math.max(Number.parseInt(limit ?? 30, 10) || 30, 1), 100);
    const bef = before ? Number(before) : null;
    if (bef !== null && !Number.isFinite(bef)) throw new v.HttpError(400, 'validation_error', 'Invalid cursor.');
    const rows = this.db.prepare(`SELECT * FROM calls WHERE (caller_id = ? OR callee_id = ?) AND result IS NOT NULL AND (? IS NULL OR created_at < ?)
      ORDER BY created_at DESC, id DESC LIMIT ?`).all(userId, userId, bef, bef, lim + 1);
    const items = rows.slice(0, lim).map((r) => callHistoryDto(r, userId, this.users.getById(r.caller_id === userId ? r.callee_id : r.caller_id)));
    return { calls: items, hasMore: rows.length > lim };
  }
}
