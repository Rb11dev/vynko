import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { makeApp } from './helpers.mjs';

let ctx, server, base;
before(async () => {
  ctx = makeApp();
  server = http.createServer(async (req, res) => { if (!(await ctx.app.api.handle(req, res))) { res.statusCode = 404; res.end('not api'); } });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

const ORIGIN = 'http://localhost:3000';
async function call(method, path, { body, cookie, origin = ORIGIN, headers = {} } = {}) {
  const h = { ...headers };
  if (origin) h.Origin = origin;
  if (cookie) h.Cookie = cookie;
  if (body !== undefined) h['Content-Type'] = 'application/json';
  const res = await fetch(base + path, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  let json = null; try { json = JSON.parse(text); } catch { /* not json */ }
  const setCookie = res.headers.get('set-cookie');
  return { status: res.status, json, setCookie, cookie: setCookie ? setCookie.split(';')[0] : null, headers: res.headers };
}
let counter = 0;
// Creates a user + session directly (HTTP registration is rate limited to 10/hour/IP by design).
async function signup(name) {
  const username = name ?? `api_user_${++counter}`;
  const user = await ctx.app.users.register({ username, displayName: `Dis ${username}`, password: 'correct-horse-battery' });
  const { token } = ctx.app.users.createSession(user.id, 'test');
  return { id: user.id, username, cookie: `vynko_sid=${token}` };
}

test('register sets an HttpOnly session cookie; /api/me works; response never leaks the hash', async () => {
  const r = await call('POST', '/api/auth/register', { body: { username: 'zoe_1', displayName: 'Zoe', password: 'correct-horse-battery' } });
  assert.equal(r.status, 201);
  assert.match(r.setCookie, /vynko_sid=/); assert.match(r.setCookie, /HttpOnly/); assert.match(r.setCookie, /SameSite=Lax/);
  assert.ok(!JSON.stringify(r.json).includes('password'));
  const me = await call('GET', '/api/me', { cookie: r.cookie });
  assert.equal(me.status, 200); assert.equal(me.json.user.username, 'zoe_1');
});

test('server-side validation and duplicate usernames', async () => {
  assert.equal((await call('POST', '/api/auth/register', { body: { username: 'x', displayName: 'X', password: 'short' } })).status, 400);
  assert.equal((await call('POST', '/api/auth/register', { body: { username: 'zoe_1', displayName: 'Z', password: 'correct-horse-battery' } })).status, 409);
  assert.equal((await call('POST', '/api/auth/register', { body: ['nope'] })).status, 400);
});

test('login ok / wrong password; logout kills the session and disconnects its sockets', async () => {
  const u = await signup();
  assert.equal((await call('POST', '/api/auth/login', { body: { username: u.username, password: 'bad-bad-bad-bad' } })).status, 401);
  const ok = await call('POST', '/api/auth/login', { body: { username: u.username, password: 'correct-horse-battery' } });
  assert.equal(ok.status, 200);
  const out = await call('POST', '/api/auth/logout', { cookie: ok.cookie });
  assert.equal(out.status, 200);
  assert.ok(ctx.realtimeCalls.some((c) => c[0] === 'disconnectSession'));
  assert.equal((await call('GET', '/api/me', { cookie: ok.cookie })).status, 401, 'session is dead server-side');
  assert.equal((await call('GET', '/api/me', { cookie: u.cookie })).status, 200, 'other sessions unaffected');
});

test('protected endpoints need a session; garbage cookie rejected', async () => {
  for (const [m, p] of [['GET', '/api/me'], ['GET', '/api/contacts'], ['GET', '/api/conversations'], ['GET', '/api/calls/history'], ['POST', '/api/messages'], ['GET', '/api/meetings'], ['GET', '/api/users/search?q=ab']]) {
    assert.equal((await call(m, p, { body: m === 'POST' ? {} : undefined })).status, 401, `${m} ${p}`);
  }
  assert.equal((await call('GET', '/api/me', { cookie: 'vynko_sid=forged' })).status, 401);
});

test('CSRF/origin: cross-site and origin-less mutating requests are refused', async () => {
  assert.equal((await call('POST', '/api/auth/login', { origin: 'https://evil.example', body: { username: 'a', password: 'b' } })).status, 403);
  assert.equal((await call('POST', '/api/auth/login', { origin: null, body: { username: 'a', password: 'b' } })).status, 403);
  assert.equal((await call('POST', '/api/auth/login', { origin: null, headers: { 'Sec-Fetch-Site': 'same-origin' }, body: { username: 'a', password: 'b' } })).status, 401);
  const wrongType = await fetch(base + '/api/auth/login', { method: 'POST', headers: { Origin: ORIGIN, 'Content-Type': 'text/plain' }, body: '{"username":"a","password":"b"}' });
  assert.equal(wrongType.status, 415);
});

test('security headers, JSON errors, 404/405, safe 500s', async () => {
  const r = await call('GET', '/api/health');
  assert.equal(r.headers.get('x-content-type-options'), 'nosniff'); assert.equal(r.headers.get('cache-control'), 'no-store');
  assert.equal((await call('GET', '/api/does-not-exist')).status, 404);
  assert.equal((await call('PUT', '/api/me', { cookie: (await signup()).cookie, body: {} })).status, 405);
  const big = await fetch(base + '/api/auth/login', { method: 'POST', headers: { Origin: ORIGIN, 'Content-Type': 'application/json' }, body: JSON.stringify({ a: 'x'.repeat(40000) }) });
  assert.equal(big.status, 413);
});

test('login is rate limited (brute-force protection)', async () => {
  let last;
  for (let i = 0; i < 12; i++) last = await call('POST', '/api/auth/login', { body: { username: 'bruteforce_target', password: 'guess-guess-guess' } });
  assert.equal(last.status, 429);
  assert.ok(Number(last.headers.get('retry-after')) > 0);
});

test('user search -> add contact -> message -> read, with a third user locked out', async () => {
  const a = await signup('flow_a'); const b = await signup('flow_b'); const c = await signup('flow_c');
  const s = await call('GET', '/api/users/search?q=flow_', { cookie: a.cookie });
  assert.deepEqual(s.json.users.map((u) => u.username), ['flow_b', 'flow_c']);
  assert.ok(!JSON.stringify(s.json).includes('password'));

  const before = await call('POST', '/api/messages', { cookie: a.cookie, body: { toUserId: b.id, body: 'hi' } });
  assert.equal(before.status, 403, 'must add contact first');
  assert.equal((await call('POST', '/api/contacts', { cookie: a.cookie, body: { username: 'flow_b' } })).status, 201);
  assert.equal((await call('POST', '/api/contacts', { cookie: a.cookie, body: { username: 'nobody_here' } })).status, 404);

  const sent = await call('POST', '/api/messages', { cookie: a.cookie, body: { toUserId: b.id, body: 'Hello B', clientId: 'client-abc-123' } });
  assert.equal(sent.status, 201);
  assert.equal(sent.json.message.deliveredAt, null);
  assert.ok(ctx.realtimeCalls.some((x) => x[0] === 'notifyMessage' && x[2] === b.id), 'recipient pushed in real time');

  const convB = await call('GET', '/api/conversations', { cookie: b.cookie });
  assert.equal(convB.json.conversations[0].unread, 1);
  assert.equal(convB.json.conversations[0].other.username, 'flow_a');
  assert.equal((await call('GET', `/api/users/${a.id}`, { cookie: b.cookie })).status, 200, 'conversation partner is viewable');
  assert.equal((await call('GET', `/api/users/${b.id}`, { cookie: c.cookie })).status, 404, 'strangers are not');

  assert.equal((await call('GET', `/api/messages/with/${a.id}`, { cookie: b.cookie })).json.messages[0].body, 'Hello B');
  assert.deepEqual((await call('GET', `/api/messages/with/${a.id}`, { cookie: c.cookie })).json.messages, []);
  assert.deepEqual((await call('GET', `/api/messages/with/${b.id}`, { cookie: c.cookie })).json.messages, []);
  assert.equal((await call('GET', '/api/conversations', { cookie: c.cookie })).json.conversations.length, 0);

  assert.equal((await call('POST', '/api/messages/read', { cookie: b.cookie, body: { userId: a.id } })).json.updated, 1);
  assert.ok(ctx.realtimeCalls.some((x) => x[0] === 'notifyRead'));
  assert.equal((await call('GET', '/api/conversations', { cookie: b.cookie })).json.conversations[0].unread, 0);
  assert.equal((await call('GET', `/api/messages/with/${b.id}`, { cookie: a.cookie })).json.messages[0].readAt > 0, true);

  const bad = await call('POST', '/api/messages', { cookie: a.cookie, body: { toUserId: 'abc', body: 'x' } });
  assert.equal(bad.status, 400);
});

test('blocking stops messages and hides the blocker', async () => {
  const a = await signup('blk_a'); const b = await signup('blk_b');
  await call('POST', '/api/contacts', { cookie: a.cookie, body: { username: 'blk_b' } });
  await call('POST', '/api/contacts', { cookie: b.cookie, body: { username: 'blk_a' } });
  assert.equal((await call('POST', '/api/blocks', { cookie: b.cookie, body: { userId: a.id } })).status, 201);
  assert.equal((await call('POST', '/api/messages', { cookie: a.cookie, body: { toUserId: b.id, body: 'x' } })).status, 403);
  assert.equal((await call('GET', '/api/contacts', { cookie: a.cookie })).json.contacts.length, 0);
  assert.equal((await call('GET', '/api/blocks', { cookie: b.cookie })).json.blocked[0].username, 'blk_a');
  await call('DELETE', `/api/blocks/${a.id}`, { cookie: b.cookie });
  assert.equal((await call('POST', '/api/messages', { cookie: a.cookie, body: { toUserId: b.id, body: 'x' } })).status, 201);
});

test('profile edit + privacy settings validated', async () => {
  const u = await signup('prof_a');
  const r = await call('PATCH', '/api/me', { cookie: u.cookie, body: { displayName: 'New Name', showOnline: false, avatarUrl: 'https://img.example/a.png' } });
  assert.equal(r.json.user.displayName, 'New Name'); assert.equal(r.json.user.showOnline, false);
  assert.equal((await call('PATCH', '/api/me', { cookie: u.cookie, body: { avatarUrl: 'javascript:alert(1)' } })).status, 400);
  assert.equal((await call('PATCH', '/api/me', { cookie: u.cookie, body: { showOnline: 'yes' } })).status, 400);
});

test('meetings: create, public info, guest join, invalid links, host-only end/revoke', async () => {
  const host = await signup('meet_host'); const other = await signup('meet_other');
  const created = await call('POST', '/api/meetings', { cookie: host.cookie, body: { title: 'Standup', expiresInMinutes: 60, allowGuests: true } });
  assert.equal(created.status, 201);
  const code = created.json.meeting.code;
  assert.equal((await call('POST', '/api/meetings', { body: {} })).status, 401, 'creating needs login');

  const info = await call('GET', `/api/meetings/${code}`);
  assert.equal(info.json.meeting.title, 'Standup'); assert.equal(info.json.meeting.status, 'active');
  assert.equal(info.json.meeting.hostId, undefined);
  assert.equal((await call('GET', '/api/meetings/not-a-real-code-at-all')).status, 404);
  assert.equal((await call('GET', `/api/meetings/${'A'.repeat(22)}`)).status, 404);

  const guest = await call('POST', `/api/meetings/${code}/join`, { body: { displayName: 'Guest Gina' } });
  assert.equal(guest.status, 200); assert.ok(guest.json.guestToken);
  assert.equal((await call('POST', `/api/meetings/${code}/join`, { body: {} })).status, 400, 'guest needs a name');

  assert.equal((await call('POST', `/api/meetings/${code}/end`, { cookie: other.cookie })).status, 404, 'non-host cannot end');
  assert.equal((await call('POST', `/api/meetings/${code}/revoke`, { cookie: other.cookie })).status, 404);
  assert.equal((await call('POST', `/api/meetings/${code}/revoke`, { cookie: host.cookie })).status, 200);
  assert.ok(ctx.realtimeCalls.some((x) => x[0] === 'closeMeeting' && x[1] === code && x[2] === 'revoked'));
  assert.equal((await call('POST', `/api/meetings/${code}/join`, { body: { displayName: 'Late' } })).status, 410, 'revoked link rejected');
  assert.equal((await call('GET', '/api/meetings', { cookie: host.cookie })).json.meetings[0].status, 'revoked');
});

test('call history endpoint is private to the participants', async () => {
  const a = await signup('hist_a'); const b = await signup('hist_b'); const c = await signup('hist_c');
  ctx.db.prepare("INSERT INTO calls (id, caller_id, callee_id, type, created_at, connected_at, ended_at, result) VALUES ('11111111-1111-1111-1111-111111111111', ?, ?, 'audio', 1000, 2000, 5000, 'completed')").run(a.id, b.id);
  const ha = (await call('GET', '/api/calls/history', { cookie: a.cookie })).json.calls;
  const hb = (await call('GET', '/api/calls/history', { cookie: b.cookie })).json.calls;
  assert.equal(ha[0].direction, 'outgoing'); assert.equal(hb[0].direction, 'incoming'); assert.equal(ha[0].durationSec, 3);
  assert.equal((await call('GET', '/api/calls/history', { cookie: c.cookie })).json.calls.length, 0);
});

test('account deletion needs the password, ends sessions', async () => {
  const u = await signup('del_a');
  assert.equal((await call('DELETE', '/api/me', { cookie: u.cookie, body: { password: 'wrong-wrong-wrong' } })).status, 403);
  assert.equal((await call('DELETE', '/api/me', { cookie: u.cookie, body: { password: 'correct-horse-battery' } })).status, 200);
  assert.equal((await call('GET', '/api/me', { cookie: u.cookie })).status, 401);
  assert.equal((await call('POST', '/api/auth/login', { body: { username: 'del_a', password: 'correct-horse-battery' } })).status, 401);
});

test('registration is rate limited per IP', async () => {
  let last;
  for (let i = 0; i < 12; i++) last = await call('POST', '/api/auth/register', { body: { username: `spam_${i}_user`, displayName: 'S', password: 'correct-horse-battery' } });
  assert.equal(last.status, 429);
});
