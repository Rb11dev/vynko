import * as v from '../validate.mjs';
import { HttpError } from '../validate.mjs';
import { tx } from '../db.mjs';

const likeEscape = (s) => s.replace(/[\\%_]/g, (c) => `\\${c}`);
export const messageDto = (m) => ({
  id: m.id, conversationId: m.conversation_id, senderId: m.sender_id, body: m.body, clientId: m.client_id ?? null,
  createdAt: m.created_at, deliveredAt: m.delivered_at ?? null, readAt: m.read_at ?? null,
});

export function createMessageService({ db, users, limiter, now = Date.now }) {
  const pair = (a, b) => (a < b ? [a, b] : [b, a]);
  const findConv = db.prepare('SELECT id FROM conversations WHERE user_a = ? AND user_b = ?');

  return {
    send(senderId, toUserId, bodyInput, clientIdInput) {
      const body = v.messageBody(bodyInput);
      const clientId = v.clientId(clientIdInput);
      const can = users.canInteract(senderId, toUserId);
      if (!can.ok) {
        const map = { self: [400, "You can't message yourself."], not_found: [404, 'User not found.'], blocked: [403, "You can't message this user."], not_contact: [403, 'Add this person as a contact first.'] };
        const [status, msg] = map[can.code];
        throw new HttpError(status, can.code, msg);
      }
      if (clientId) {
        const dup = db.prepare('SELECT * FROM messages WHERE sender_id = ? AND client_id = ?').get(senderId, clientId);
        if (dup) return messageDto(dup); // safe retry
      }
      const rl = limiter.hit(`msg:${senderId}`);
      if (!rl.ok) throw new HttpError(429, 'rate_limited', `You're sending messages too fast. Try again in ${rl.retryAfterSec}s.`);
      const [a, b] = pair(senderId, toUserId);
      return tx(db, () => {
        const t = now();
        db.prepare('INSERT INTO conversations (user_a, user_b, created_at) VALUES (?, ?, ?) ON CONFLICT (user_a, user_b) DO NOTHING').run(a, b, t);
        const conv = findConv.get(a, b);
        const r = db.prepare('INSERT INTO messages (conversation_id, sender_id, body, client_id, created_at) VALUES (?, ?, ?, ?, ?)').run(conv.id, senderId, body, clientId, t);
        db.prepare('UPDATE conversations SET last_message_at = ? WHERE id = ?').run(t, conv.id);
        return messageDto(db.prepare('SELECT * FROM messages WHERE id = ?').get(Number(r.lastInsertRowid)));
      });
    },

    // History between `userId` and `otherId`. Only the two participants can ever load it.
    list(userId, otherId, { before, limit } = {}) {
      const [a, b] = pair(userId, otherId);
      const conv = findConv.get(a, b);
      if (!conv) return { messages: [], hasMore: false };
      const lim = Math.min(Math.max(Number.parseInt(limit ?? 30, 10) || 30, 1), 100);
      const bef = before ? v.intId(before, 'before') : null;
      const rows = db.prepare('SELECT * FROM messages WHERE conversation_id = ? AND (? IS NULL OR id < ?) ORDER BY id DESC LIMIT ?').all(conv.id, bef, bef, lim + 1);
      const hasMore = rows.length > lim;
      return { messages: rows.slice(0, lim).reverse().map(messageDto), hasMore };
    },

    conversations(userId, q) {
      const term = typeof q === 'string' ? q.trim().slice(0, 50) : '';
      const like = term ? `%${likeEscape(term)}%` : null;
      const rows = db.prepare(`
        SELECT c.id, u.id AS other_id, c.last_message_at,
          (SELECT body FROM messages m WHERE m.conversation_id = c.id ORDER BY m.id DESC LIMIT 1) AS last_body,
          (SELECT sender_id FROM messages m WHERE m.conversation_id = c.id ORDER BY m.id DESC LIMIT 1) AS last_sender,
          (SELECT COUNT(*) FROM messages m WHERE m.conversation_id = c.id AND m.sender_id <> ? AND m.read_at IS NULL) AS unread
        FROM conversations c
        JOIN users u ON u.id = CASE WHEN c.user_a = ? THEN c.user_b ELSE c.user_a END
        WHERE (c.user_a = ? OR c.user_b = ?)
          AND (? IS NULL OR u.username LIKE ? ESCAPE '\\' OR u.display_name LIKE ? ESCAPE '\\'
               OR EXISTS (SELECT 1 FROM messages m WHERE m.conversation_id = c.id AND m.body LIKE ? ESCAPE '\\'))
        ORDER BY c.last_message_at DESC LIMIT 100`).all(userId, userId, userId, userId, like, like, like, like);
      return rows.map((r) => ({ id: r.id, otherId: r.other_id, lastBody: r.last_body, lastSender: r.last_sender, lastMessageAt: r.last_message_at, unread: r.unread }));
    },

    // The reader marks everything the other person sent as read. Returns the ids that changed.
    markRead(readerId, otherId) {
      const [a, b] = pair(readerId, otherId);
      const conv = findConv.get(a, b);
      if (!conv) return [];
      const t = now();
      return db.prepare('UPDATE messages SET read_at = ?, delivered_at = COALESCE(delivered_at, ?) WHERE conversation_id = ? AND sender_id = ? AND read_at IS NULL RETURNING id')
        .all(t, t, conv.id, otherId).map((r) => r.id);
    },

    // The recipient's browser confirmed it received these messages.
    markDelivered(recipientId, messageIds) {
      const ids = messageIds.filter((n) => Number.isSafeInteger(n));
      if (!ids.length) return [];
      return db.prepare(`UPDATE messages SET delivered_at = ? WHERE id IN (${ids.map(() => '?').join(',')}) AND sender_id <> ? AND delivered_at IS NULL
        AND conversation_id IN (SELECT id FROM conversations WHERE user_a = ? OR user_b = ?) RETURNING id, sender_id`)
        .all(now(), ...ids, recipientId, recipientId, recipientId);
    },
    // When a user connects, everything waiting for them counts as delivered.
    markAllDelivered(recipientId) {
      return db.prepare(`UPDATE messages SET delivered_at = ? WHERE delivered_at IS NULL AND sender_id <> ?
        AND conversation_id IN (SELECT id FROM conversations WHERE user_a = ? OR user_b = ?) RETURNING id, sender_id`)
        .all(now(), recipientId, recipientId, recipientId);
    },
  };
}
