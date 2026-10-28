import { hashPassword, verifyPassword, newToken, hmacId } from '../auth.mjs';
import * as v from '../validate.mjs';
import { HttpError } from '../validate.mjs';

export const SESSION_TTL_MS = 30 * 24 * 3600 * 1000;
const likeEscape = (s) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

export const publicUser = (u) => ({ id: u.id, username: u.username, displayName: u.display_name, avatarUrl: u.avatar_url ?? null });
export const selfUser = (u) => ({ ...publicUser(u), showOnline: !!u.show_online, showLastSeen: !!u.show_last_seen, createdAt: u.created_at });

export function createUserService({ db, secret, now = Date.now }) {
  let dummyHash; // used so "unknown user" and "wrong password" take similar time

  const byId = db.prepare('SELECT * FROM users WHERE id = ?');
  const byName = db.prepare('SELECT * FROM users WHERE username = ?');
  const blockedEither = db.prepare('SELECT 1 FROM blocks WHERE (blocker_id = ? AND blocked_id = ?) OR (blocker_id = ? AND blocked_id = ?)');
  const isContactQ = db.prepare('SELECT 1 FROM contacts WHERE user_id = ? AND contact_id = ?');
  const hasConv = db.prepare('SELECT 1 FROM conversations WHERE user_a = ? AND user_b = ?');

  const svc = {
    async register(input) {
      const username = v.username(input?.username);
      const displayName = v.displayName(input?.displayName);
      const password = v.password(input?.password, username);
      const hash = await hashPassword(password);
      try {
        const r = db.prepare('INSERT INTO users (username, display_name, password_hash, created_at) VALUES (?, ?, ?, ?)').run(username, displayName, hash, now());
        return byId.get(Number(r.lastInsertRowid));
      } catch (err) {
        if (/UNIQUE/i.test(err.message)) throw new HttpError(409, 'username_taken', 'That username is already taken.');
        throw err;
      }
    },

    async authenticate(input) {
      const uname = typeof input?.username === 'string' ? input.username.trim() : '';
      const pw = typeof input?.password === 'string' ? input.password : '';
      const user = uname ? byName.get(uname) : undefined;
      if (!user) {
        dummyHash ??= await hashPassword('vynko-dummy-password');
        await verifyPassword(pw, dummyHash);
        throw new HttpError(401, 'invalid_credentials', 'Invalid username or password.');
      }
      if (!(await verifyPassword(pw, user.password_hash))) throw new HttpError(401, 'invalid_credentials', 'Invalid username or password.');
      return user;
    },

    createSession(userId, userAgent) {
      const token = newToken();
      const t = now();
      db.prepare('INSERT INTO sessions (id, user_id, created_at, expires_at, user_agent) VALUES (?, ?, ?, ?, ?)')
        .run(hmacId(secret, token), userId, t, t + SESSION_TTL_MS, String(userAgent ?? '').slice(0, 200));
      return { token, expiresAt: t + SESSION_TTL_MS };
    },
    userFromToken(token) {
      if (!token || typeof token !== 'string' || token.length > 200) return null;
      const id = hmacId(secret, token);
      const s = db.prepare('SELECT user_id, expires_at FROM sessions WHERE id = ?').get(id);
      if (!s) return null;
      if (s.expires_at <= now()) { db.prepare('DELETE FROM sessions WHERE id = ?').run(id); return null; }
      return byId.get(s.user_id) ?? null;
    },
    sessionKey: (token) => hmacId(secret, String(token)),
    destroySession(token) { if (token) db.prepare('DELETE FROM sessions WHERE id = ?').run(hmacId(secret, String(token))); },
    destroyUserSessions(userId) { db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId); },
    pruneSessions() { db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(now()); },

    getById: (id) => byId.get(id),
    touchLastSeen(id, ts = now()) { db.prepare('UPDATE users SET last_seen_at = ? WHERE id = ?').run(ts, id); },

    updateProfile(id, patch) {
      const cur = byId.get(id);
      const next = {
        display_name: patch.displayName !== undefined ? v.displayName(patch.displayName) : cur.display_name,
        avatar_url: patch.avatarUrl !== undefined ? v.avatarUrl(patch.avatarUrl) : cur.avatar_url,
        show_online: v.bool(patch.showOnline, 'showOnline', !!cur.show_online) ? 1 : 0,
        show_last_seen: v.bool(patch.showLastSeen, 'showLastSeen', !!cur.show_last_seen) ? 1 : 0,
      };
      db.prepare('UPDATE users SET display_name = ?, avatar_url = ?, show_online = ?, show_last_seen = ? WHERE id = ?')
        .run(next.display_name, next.avatar_url, next.show_online, next.show_last_seen, id);
      return byId.get(id);
    },

    isBlockedEither: (a, b) => !!blockedEither.get(a, b, b, a),
    isContact: (userId, contactId) => !!isContactQ.get(userId, contactId),
    hasConversation(a, b) { return !!hasConv.get(Math.min(a, b), Math.max(a, b)); },

    // Who may message/call whom: you must have added them, and neither side may have blocked the other.
    canInteract(fromId, toId) {
      if (fromId === toId) return { ok: false, code: 'self' };
      if (!byId.get(toId)) return { ok: false, code: 'not_found' };
      if (svc.isBlockedEither(fromId, toId)) return { ok: false, code: 'blocked' };
      if (!svc.isContact(fromId, toId)) return { ok: false, code: 'not_contact' };
      return { ok: true };
    },

    search(viewerId, q) {
      const term = typeof q === 'string' ? q.trim().replace(/^@/, '') : '';
      if (term.length < 2 || term.length > 20) return [];
      return db.prepare(`
        SELECT u.*, EXISTS(SELECT 1 FROM contacts c WHERE c.user_id = ? AND c.contact_id = u.id) AS is_contact
        FROM users u
        WHERE u.username LIKE ? ESCAPE '\\' AND u.id <> ?
          AND u.id NOT IN (SELECT blocked_id FROM blocks WHERE blocker_id = ?)
          AND u.id NOT IN (SELECT blocker_id FROM blocks WHERE blocked_id = ?)
        ORDER BY u.username LIMIT 10`).all(viewerId, `${likeEscape(term)}%`, viewerId, viewerId, viewerId);
    },

    addContact(userId, usernameInput) {
      const target = byName.get(v.username(usernameInput));
      if (!target || svc.isBlockedEither(userId, target.id)) throw new HttpError(404, 'not_found', 'No user with that username.');
      if (target.id === userId) throw new HttpError(400, 'validation_error', "You can't add yourself.");
      db.prepare('INSERT OR IGNORE INTO contacts (user_id, contact_id, created_at) VALUES (?, ?, ?)').run(userId, target.id, now());
      return target;
    },
    removeContact(userId, contactId) { db.prepare('DELETE FROM contacts WHERE user_id = ? AND contact_id = ?').run(userId, contactId); },
    listContacts(userId) {
      return db.prepare(`SELECT u.* FROM contacts c JOIN users u ON u.id = c.contact_id
        WHERE c.user_id = ? AND NOT EXISTS (SELECT 1 FROM blocks b WHERE (b.blocker_id = c.user_id AND b.blocked_id = c.contact_id) OR (b.blocker_id = c.contact_id AND b.blocked_id = c.user_id))
        ORDER BY u.display_name COLLATE NOCASE`).all(userId);
    },
    // People who have added this user (they are the ones who may see presence).
    watchers(userId) { return db.prepare('SELECT user_id FROM contacts WHERE contact_id = ?').all(userId).map((r) => r.user_id); },

    block(blockerId, targetId) {
      if (blockerId === targetId) throw new HttpError(400, 'validation_error', "You can't block yourself.");
      if (!byId.get(targetId)) throw new HttpError(404, 'not_found', 'User not found.');
      db.prepare('INSERT OR IGNORE INTO blocks (blocker_id, blocked_id, created_at) VALUES (?, ?, ?)').run(blockerId, targetId, now());
    },
    unblock(blockerId, targetId) { db.prepare('DELETE FROM blocks WHERE blocker_id = ? AND blocked_id = ?').run(blockerId, targetId); },
    listBlocks(blockerId) {
      return db.prepare('SELECT u.* FROM blocks b JOIN users u ON u.id = b.blocked_id WHERE b.blocker_id = ? ORDER BY b.created_at DESC').all(blockerId);
    },

    // May `viewerId` see public details of `targetId`? (contact, or already in a conversation)
    canView(viewerId, targetId) {
      if (viewerId === targetId) return true;
      if (!byId.get(targetId)) return false;
      return svc.isContact(viewerId, targetId) || svc.hasConversation(viewerId, targetId);
    },

    // Online/last-seen as the viewer is allowed to see it.
    presenceView(viewerId, target, presence) {
      if (!target || target.id === viewerId || svc.isBlockedEither(viewerId, target.id)) return { online: false, lastSeenAt: null };
      const online = !!target.show_online && presence.isOnline(target.id);
      return { online, lastSeenAt: !online && target.show_last_seen ? target.last_seen_at ?? null : null };
    },

    async deleteAccount(id, passwordInput) {
      const user = byId.get(id);
      const ok = user && typeof passwordInput === 'string' && (await verifyPassword(passwordInput, user.password_hash));
      if (!ok) throw new HttpError(403, 'invalid_credentials', 'Password is incorrect.');
      db.prepare('DELETE FROM users WHERE id = ?').run(id); // cascades to sessions, contacts, messages, calls, meetings
    },
  };
  return svc;
}
