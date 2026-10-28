// REST API (plain node:http, no framework). Returns true if it handled the request.
import { HttpError } from './validate.mjs';
import * as v from './validate.mjs';
import { parseCookies, serializeCookie, SESSION_COOKIE } from './auth.mjs';
import { publicUser, selfUser, SESSION_TTL_MS } from './services/users.mjs';

export function createApi({ config, users, messages, calls, meetings, presence, realtime, limiters, log = console }) {
  const routes = [];
  const route = (method, pattern, opts, fn) => {
    const keys = [];
    const re = new RegExp(`^${pattern.replace(/:([a-zA-Z]+)/g, (_, k) => (keys.push(k), '([^/]+)'))}$`);
    routes.push({ method, re, keys, opts, fn });
  };
  const reply = (body, status = 200) => ({ __reply: true, status, body });

  const ipOf = (req) => {
    if (config.trustProxy) {
      const xff = String(req.headers['x-forwarded-for'] || '').split(',').map((s) => s.trim()).filter(Boolean);
      if (xff.length) return xff[xff.length - 1]; // the entry added by YOUR proxy
    }
    return req.socket.remoteAddress || 'unknown';
  };
  const limit = (limiter, key) => {
    const r = limiter.hit(key);
    if (!r.ok) throw new HttpError(429, 'rate_limited', `Too many requests. Try again in ${r.retryAfterSec}s.`, { retryAfterSec: r.retryAfterSec });
  };
  const withPresence = (viewerId, row) => ({ ...publicUser(row), ...users.presenceView(viewerId, row, presence) });
  const setSessionCookie = (res, token) =>
    res.setHeader('Set-Cookie', serializeCookie(SESSION_COOKIE, token, { maxAgeSec: Math.floor(SESSION_TTL_MS / 1000), secure: config.cookieSecure }));
  const clearSessionCookie = (res) => res.setHeader('Set-Cookie', serializeCookie(SESSION_COOKIE, '', { maxAgeSec: 0, secure: config.cookieSecure }));

  // ---- health ----
  route('GET', '/api/health', { public: true }, () => ({ ok: true }));

  // ---- auth ----
  route('POST', '/api/auth/register', { public: true }, async ({ req, res, body, ip }) => {
    limit(limiters.register, ip);
    const user = await users.register(body);
    const { token } = users.createSession(user.id, req.headers['user-agent']);
    setSessionCookie(res, token);
    return reply({ user: selfUser(user) }, 201);
  });
  route('POST', '/api/auth/login', { public: true }, async ({ req, res, body, ip }) => {
    const uname = typeof body.username === 'string' ? body.username.trim().toLowerCase().slice(0, 40) : '';
    limit(limiters.login, `${ip}|${uname}`);
    limit(limiters.loginIp, ip);
    const user = await users.authenticate(body);
    limiters.login.reset(`${ip}|${uname}`);
    const { token } = users.createSession(user.id, req.headers['user-agent']);
    setSessionCookie(res, token);
    return { user: selfUser(user) };
  });
  route('POST', '/api/auth/logout', { public: true }, ({ res, token }) => {
    if (token) { realtime.disconnectSession(users.sessionKey(token)); users.destroySession(token); }
    clearSessionCookie(res);
    return { ok: true };
  });

  // ---- me ----
  route('GET', '/api/me', {}, ({ user }) => ({ user: selfUser(user) }));
  route('PATCH', '/api/me', {}, ({ user, body }) => ({ user: selfUser(users.updateProfile(user.id, body)) }));
  route('DELETE', '/api/me', {}, async ({ user, body, res }) => {
    await users.deleteAccount(user.id, body.password);
    realtime.disconnectUser(user.id);
    clearSessionCookie(res);
    return { ok: true };
  });

  // ---- users & contacts ----
  route('GET', '/api/users/search', {}, ({ user, query }) => {
    limit(limiters.search, `u${user.id}`);
    return { users: users.search(user.id, query.q).map((u) => ({ ...publicUser(u), isContact: !!u.is_contact })) };
  });
  route('GET', '/api/users/:id', {}, ({ user, params }) => {
    const id = v.intId(params.id);
    if (!users.canView(user.id, id)) throw new HttpError(404, 'not_found', 'User not found.');
    const target = users.getById(id);
    return { user: { ...withPresence(user.id, target), isContact: users.isContact(user.id, id), blockedByMe: users.listBlocks(user.id).some((b) => b.id === id), canInteract: users.canInteract(user.id, id).ok } };
  });
  route('GET', '/api/contacts', {}, ({ user }) => ({ contacts: users.listContacts(user.id).map((u) => withPresence(user.id, u)) }));
  route('POST', '/api/contacts', {}, ({ user, body }) => {
    limit(limiters.contacts, `u${user.id}`);
    return reply({ contact: withPresence(user.id, users.addContact(user.id, body.username)) }, 201);
  });
  route('DELETE', '/api/contacts/:id', {}, ({ user, params }) => { users.removeContact(user.id, v.intId(params.id)); return { ok: true }; });
  route('GET', '/api/blocks', {}, ({ user }) => ({ blocked: users.listBlocks(user.id).map(publicUser) }));
  route('POST', '/api/blocks', {}, ({ user, body }) => { users.block(user.id, v.intId(body.userId, 'userId')); return reply({ ok: true }, 201); });
  route('DELETE', '/api/blocks/:id', {}, ({ user, params }) => { users.unblock(user.id, v.intId(params.id)); return { ok: true }; });

  // ---- messages ----
  route('GET', '/api/conversations', {}, ({ user, query }) => ({
    conversations: messages.conversations(user.id, query.q).map((c) => ({
      id: c.id, other: withPresence(user.id, users.getById(c.otherId)), lastBody: c.lastBody, lastSender: c.lastSender, lastMessageAt: c.lastMessageAt, unread: c.unread,
    })),
  }));
  route('GET', '/api/messages/with/:userId', {}, ({ user, params, query }) => messages.list(user.id, v.intId(params.userId, 'userId'), { before: query.before, limit: query.limit }));
  route('POST', '/api/messages', {}, ({ user, body }) => {
    const toUserId = v.intId(body.toUserId, 'toUserId');
    const message = messages.send(user.id, toUserId, body.body, body.clientId); // persisted before we answer
    realtime.notifyMessage(message, toUserId);
    return reply({ message }, 201);
  });
  route('POST', '/api/messages/read', {}, ({ user, body }) => {
    const otherId = v.intId(body.userId, 'userId');
    const ids = messages.markRead(user.id, otherId);
    if (ids.length) realtime.notifyRead(user.id, otherId, ids);
    return { updated: ids.length };
  });

  // ---- calls ----
  route('GET', '/api/calls/history', {}, ({ user, query }) => calls.history(user.id, { before: query.before, limit: query.limit }));

  // ---- meetings ----
  route('POST', '/api/meetings', {}, ({ user, body }) => {
    limit(limiters.meetingCreate, `u${user.id}`);
    return reply({ meeting: meetings.create(user.id, body) }, 201);
  });
  route('GET', '/api/meetings', {}, ({ user }) => ({ meetings: meetings.listMine(user.id) }));
  route('GET', '/api/meetings/:code', { public: true }, ({ params, ip }) => {
    limit(limiters.meetingInfo, ip);
    return { meeting: meetings.getPublic(params.code) };
  });
  route('POST', '/api/meetings/:code/join', { public: true }, ({ params, body, user, ip }) => {
    limit(limiters.meetingJoin, ip);
    return meetings.join(params.code, { user, displayName: body.displayName });
  });
  route('POST', '/api/meetings/:code/end', {}, ({ user, params }) => {
    meetings.end(user.id, params.code);
    realtime.closeMeeting(params.code, 'ended');
    return { ok: true };
  });
  route('POST', '/api/meetings/:code/revoke', {}, ({ user, params }) => {
    meetings.revoke(user.id, params.code);
    realtime.closeMeeting(params.code, 'revoked');
    return { ok: true };
  });

  async function readJson(req) {
    if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) return {};
    const chunks = [];
    let size = 0;
    for await (const c of req) {
      size += c.length;
      if (size > 32 * 1024) throw new HttpError(413, 'payload_too_large', 'Request body is too large.');
      chunks.push(c);
    }
    if (!size) return {};
    if (!String(req.headers['content-type'] || '').includes('application/json')) throw new HttpError(415, 'unsupported_media_type', 'Send JSON (Content-Type: application/json).');
    try {
      const b = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      if (typeof b !== 'object' || b === null || Array.isArray(b)) throw new Error('not an object');
      return b;
    } catch { throw new HttpError(400, 'invalid_json', 'Request body must be a JSON object.'); }
  }

  const checkOrigin = (req) => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return;
    const origin = req.headers.origin;
    if (origin) { if (!config.allowedOrigins.has(origin)) throw new HttpError(403, 'bad_origin', 'Request origin is not allowed.'); return; }
    const site = req.headers['sec-fetch-site'];
    if (site !== 'same-origin' && site !== 'none') throw new HttpError(403, 'bad_origin', 'Request origin is not allowed.');
  };

  async function handle(req, res) {
    const url = new URL(req.url, 'http://localhost');
    if (!url.pathname.startsWith('/api/')) return false;
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    const send = (status, body) => { res.statusCode = status; res.end(JSON.stringify(body)); };
    try {
      const pathname = url.pathname.replace(/\/+$/, '') || '/';
      let matched = null, pathMatched = false;
      for (const r of routes) {
        const m = r.re.exec(pathname);
        if (!m) continue;
        pathMatched = true;
        if (r.method === req.method) { matched = { r, m }; break; }
      }
      if (!matched) throw pathMatched ? new HttpError(405, 'method_not_allowed', 'Method not allowed.') : new HttpError(404, 'not_found', 'Not found.');
      const ip = ipOf(req);
      limit(limiters.global, ip);
      checkOrigin(req);
      const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
      const user = users.userFromToken(token);
      if (!matched.r.opts.public && !user) throw new HttpError(401, 'unauthenticated', 'Please sign in.');
      const params = {};
      matched.r.keys.forEach((k, i) => { try { params[k] = decodeURIComponent(matched.m[i + 1]); } catch { params[k] = ''; } });
      const body = await readJson(req);
      const out = await matched.r.fn({ req, res, params, query: Object.fromEntries(url.searchParams), body, user, token, ip });
      if (out && out.__reply) send(out.status, out.body); else send(200, out);
    } catch (err) {
      if (err instanceof HttpError) {
        if (err.extra?.retryAfterSec) res.setHeader('Retry-After', String(err.extra.retryAfterSec));
        send(err.status, { error: { code: err.code, message: err.message, ...(err.extra?.field ? { field: err.extra.field } : {}) } });
      } else {
        log.error('[api] unexpected error:', req.method, url.pathname, err?.message); // never log bodies or cookies
        send(500, { error: { code: 'internal_error', message: 'Something went wrong on our side. Please try again.' } });
      }
    }
    return true;
  }
  return { handle };
}
