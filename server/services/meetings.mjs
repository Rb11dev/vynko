import crypto from 'node:crypto';
import * as v from '../validate.mjs';
import { HttpError } from '../validate.mjs';
import { newToken, hmacId, safeEqual } from '../auth.mjs';

const NOT_FOUND = () => new HttpError(404, 'meeting_not_found', 'This meeting link is not valid.');

export function createMeetingService({ db, secret, now = Date.now }) {
  const status = (m) => (m.revoked_at ? 'revoked' : m.ended_at ? 'ended' : m.expires_at <= now() ? 'expired' : 'active');
  const find = (code) => { const c = v.meetingCode(code); return c ? db.prepare('SELECT m.*, u.display_name AS host_name FROM meetings m JOIN users u ON u.id = m.host_id WHERE m.code = ?').get(c) : undefined; };
  const dto = (m) => ({ code: m.code, title: m.title, hostName: m.host_name, allowGuests: !!m.allow_guests, maxParticipants: m.max_participants, status: status(m), expiresAt: m.expires_at, createdAt: m.created_at });
  const reasonMessage = { revoked: 'This meeting link was revoked by the host.', ended: 'This meeting has ended.', expired: 'This meeting link has expired.' };

  return {
    create(hostId, input = {}) {
      const title = v.meetingTitle(input.title);
      const minutes = v.expiresMinutes(input.expiresInMinutes);
      const allowGuests = v.bool(input.allowGuests, 'allowGuests', true);
      const code = crypto.randomBytes(16).toString('base64url'); // 128 bits: unguessable, 22 chars
      const t = now();
      db.prepare('INSERT INTO meetings (id, code, host_id, title, allow_guests, max_participants, created_at, expires_at) VALUES (?, ?, ?, ?, ?, 2, ?, ?)')
        .run(crypto.randomUUID(), code, hostId, title, allowGuests ? 1 : 0, t, t + minutes * 60000);
      return dto(find(code));
    },

    // Public, minimal info used by the waiting room. Unknown and malformed codes look identical.
    getPublic(code) {
      const m = find(code);
      if (!m) throw NOT_FOUND();
      return dto(m);
    },

    listMine(hostId) {
      const rows = db.prepare('SELECT m.*, u.display_name AS host_name FROM meetings m JOIN users u ON u.id = m.host_id WHERE m.host_id = ? ORDER BY m.created_at DESC LIMIT 50').all(hostId);
      return rows.map(dto);
    },

    // Registers a participant. Signed-in users reuse their row; guests get a secret token (shown once).
    join(code, { user, displayName } = {}) {
      const m = find(code);
      if (!m) throw NOT_FOUND();
      const st = status(m);
      if (st !== 'active') throw new HttpError(410, `meeting_${st}`, reasonMessage[st]);
      const t = now();
      if (user) {
        const role = user.id === m.host_id ? 'host' : 'participant';
        const existing = db.prepare('SELECT id FROM meeting_participants WHERE meeting_id = ? AND user_id = ?').get(m.id, user.id);
        let id = existing?.id;
        if (id) db.prepare('UPDATE meeting_participants SET joined_at = ?, left_at = NULL WHERE id = ?').run(t, id);
        else {
          id = crypto.randomUUID();
          db.prepare('INSERT INTO meeting_participants (id, meeting_id, user_id, display_name, role, joined_at) VALUES (?, ?, ?, ?, ?, ?)').run(id, m.id, user.id, user.display_name, role, t);
        }
        return { participantId: id, displayName: user.display_name, role, meeting: dto(m) };
      }
      if (!m.allow_guests) throw new HttpError(403, 'guests_not_allowed', 'The host requires you to sign in to join this meeting.');
      const name = v.displayName(displayName);
      const token = newToken();
      const id = crypto.randomUUID();
      db.prepare('INSERT INTO meeting_participants (id, meeting_id, display_name, role, token_hash, joined_at) VALUES (?, ?, ?, ?, ?, ?)').run(id, m.id, name, 'participant', hmacId(secret, token), t);
      return { participantId: id, guestToken: token, displayName: name, role: 'participant', meeting: dto(m) };
    },

    // Used by the signaling hub. Proves the caller owns this participant row.
    verifyParticipant(code, participantId, { userId, token }) {
      const m = find(code);
      const pid = v.uuid(participantId);
      if (!m || !pid || status(m) !== 'active') return null;
      const p = db.prepare('SELECT * FROM meeting_participants WHERE id = ? AND meeting_id = ?').get(pid, m.id);
      if (!p) return null;
      const ok = p.user_id !== null ? userId === p.user_id : typeof token === 'string' && p.token_hash && safeEqual(hmacId(secret, token), p.token_hash);
      return ok ? { meeting: m, participant: p } : null;
    },
    markLeft(participantId) { db.prepare('UPDATE meeting_participants SET left_at = ? WHERE id = ?').run(now(), participantId); },

    revoke(hostId, code) {
      const m = find(code);
      if (!m || m.host_id !== hostId) throw NOT_FOUND();
      db.prepare('UPDATE meetings SET revoked_at = COALESCE(revoked_at, ?) WHERE id = ?').run(now(), m.id);
    },
    end(hostId, code) {
      const m = find(code);
      if (!m || m.host_id !== hostId) throw NOT_FOUND();
      db.prepare('UPDATE meetings SET ended_at = COALESCE(ended_at, ?) WHERE id = ?').run(now(), m.id);
    },
  };
}

// Signaling hub for meeting rooms (pure logic; Socket.IO is injected as `emit`).
// Rooms are keyed by meeting code and by participantId, so mesh group calls can be added later.
export class MeetingHub {
  constructor({ meetings, emit }) {
    this.meetings = meetings;
    this.emit = emit;
    this.rooms = new Map();   // code -> Map(participantId -> { socketId, displayName })
    this.sockets = new Map(); // socketId -> { code, participantId }
  }

  join(socket, { code, participantId, token } = {}) {
    if (this.sockets.has(socket.id)) return { error: 'already_in_meeting' };
    const verified = this.meetings.verifyParticipant(code, participantId, { userId: socket.userId ?? null, token });
    if (!verified) return { error: 'not_allowed' };
    const { meeting, participant } = verified;
    const room = this.rooms.get(meeting.code) ?? new Map();
    if (room.has(participant.id)) return { error: 'already_joined' };
    if (room.size >= meeting.max_participants) return { error: 'room_full' };
    const peers = [...room].map(([id, p]) => ({ participantId: id, displayName: p.displayName }));
    for (const p of room.values()) this.emit(p.socketId, 'meeting:peer-joined', { participantId: participant.id, displayName: participant.display_name });
    room.set(participant.id, { socketId: socket.id, displayName: participant.display_name });
    this.rooms.set(meeting.code, room);
    this.sockets.set(socket.id, { code: meeting.code, participantId: participant.id });
    return { ok: true, self: { participantId: participant.id, displayName: participant.display_name, role: participant.role }, peers };
  }

  signal(socket, { to, data } = {}) {
    const me = this.sockets.get(socket.id);
    if (!me) return { error: 'not_allowed' };
    const target = this.rooms.get(me.code)?.get(to);
    if (!target || to === me.participantId) return { error: 'not_allowed' };
    let clean;
    try { clean = v.signal(data); } catch { return { error: 'invalid_signal' }; }
    this.emit(target.socketId, 'meeting:signal', { from: me.participantId, data: clean }); // `from` is set by the server
    return { ok: true };
  }

  leave(socket) {
    const me = this.sockets.get(socket.id);
    if (!me) return { ok: true };
    this.sockets.delete(socket.id);
    const room = this.rooms.get(me.code);
    room?.delete(me.participantId);
    this.meetings.markLeft(me.participantId);
    if (room) {
      for (const p of room.values()) this.emit(p.socketId, 'meeting:peer-left', { participantId: me.participantId });
      if (room.size === 0) this.rooms.delete(me.code);
    }
    return { ok: true };
  }

  // Host ended/revoked the meeting: tell everyone and empty the room.
  closeRoom(code, reason) {
    const room = this.rooms.get(code);
    if (!room) return;
    for (const [pid, p] of room) {
      this.emit(p.socketId, 'meeting:ended', { reason });
      this.sockets.delete(p.socketId);
      this.meetings.markLeft(pid);
    }
    this.rooms.delete(code);
  }
}
