import test from 'node:test';
import assert from 'node:assert/strict';
import { hashPassword, verifyPassword, parseCookies, serializeCookie } from '../server/auth.mjs';
import { makeApp, makeUser, befriend } from './helpers.mjs';

test('passwords are hashed (never plain text), salted and verifiable', async () => {
  const h1 = await hashPassword('hunter2hunter2');
  const h2 = await hashPassword('hunter2hunter2');
  assert.match(h1, /^scrypt\$/);
  assert.ok(!h1.includes('hunter2'));
  assert.notEqual(h1, h2);
  assert.equal(await verifyPassword('hunter2hunter2', h1), true);
  assert.equal(await verifyPassword('wrong-password', h1), false);
  assert.equal(await verifyPassword('x', 'garbage'), false);
});

test('cookie helpers', () => {
  assert.deepEqual(parseCookies('a=1; b=hello%20world; bad'), { a: '1', b: 'hello world' });
  const c = serializeCookie('s', 'v', { maxAgeSec: 5, secure: true });
  assert.match(c, /HttpOnly/); assert.match(c, /Secure/); assert.match(c, /SameSite=Lax/);
});

test('registration stores a hash, rejects duplicates case-insensitively', async () => {
  const { app, db } = makeApp();
  const u = await makeUser(app, 'Alice');
  const row = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(u.id);
  assert.ok(!row.password_hash.includes('correct-horse'));
  await assert.rejects(app.users.register({ username: 'alice', displayName: 'X', password: 'another-password' }), (e) => e.status === 409);
  await assert.rejects(app.users.register({ username: 'bad name', displayName: 'X', password: 'another-password' }), (e) => e.status === 400);
});

test('login: wrong password and unknown user give the same error', async () => {
  const { app } = makeApp();
  await makeUser(app, 'bob');
  const a = await app.users.authenticate({ username: 'bob', password: 'nope-nope-nope' }).catch((e) => e);
  const b = await app.users.authenticate({ username: 'ghost', password: 'nope-nope-nope' }).catch((e) => e);
  assert.equal(a.status, 401); assert.equal(b.status, 401); assert.equal(a.message, b.message);
  assert.equal((await app.users.authenticate({ username: 'BOB', password: 'correct-horse-battery' })).username, 'bob');
});

test('sessions: valid, destroyed, expired; DB stores only an HMAC of the token', () => {
  let t = 1_000_000;
  const { app, db } = makeApp({ now: () => t });
  return makeUser(app, 'carol').then((u) => {
    const { token } = app.users.createSession(u.id, 'UA');
    assert.equal(app.users.userFromToken(token).id, u.id);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM sessions WHERE id = ?').get(token).n, 0, 'raw token must not be stored');
    assert.equal(app.users.userFromToken('forged-token'), null);
    app.users.destroySession(token);
    assert.equal(app.users.userFromToken(token), null);
    const s2 = app.users.createSession(u.id, 'UA');
    t += 31 * 24 * 3600 * 1000;
    assert.equal(app.users.userFromToken(s2.token), null);
  });
});

test('search: prefix match, hides self and blocked users (both directions), escapes wildcards', async () => {
  const { app } = makeApp();
  const a = await makeUser(app, 'zed_a'); const b = await makeUser(app, 'zed_b'); const c = await makeUser(app, 'zed_c');
  assert.deepEqual(app.users.search(a.id, 'zed').map((u) => u.username), ['zed_b', 'zed_c']);
  assert.deepEqual(app.users.search(a.id, '%%'), []);
  assert.deepEqual(app.users.search(a.id, 'z'), [], 'needs 2+ chars');
  app.users.block(a.id, b.id);
  assert.deepEqual(app.users.search(a.id, 'zed').map((u) => u.username), ['zed_c']);
  assert.deepEqual(app.users.search(b.id, 'zed').map((u) => u.username), ['zed_c'], 'blocked user cannot find the blocker');
});

test('canInteract needs a contact and no blocks', async () => {
  const { app } = makeApp();
  const a = await makeUser(app); const b = await makeUser(app);
  assert.equal(app.users.canInteract(a.id, b.id).code, 'not_contact');
  app.users.addContact(a.id, b.username);
  assert.equal(app.users.canInteract(a.id, b.id).ok, true);
  assert.equal(app.users.canInteract(b.id, a.id).code, 'not_contact', 'adding is one-directional');
  app.users.block(b.id, a.id);
  assert.equal(app.users.canInteract(a.id, b.id).code, 'blocked');
  assert.equal(app.users.canInteract(a.id, a.id).code, 'self');
  assert.equal(app.users.canInteract(a.id, 9999).code, 'not_found');
});

test('presence privacy: hidden online/last-seen are not exposed', async () => {
  const { app } = makeApp();
  const a = await makeUser(app); const b = await makeUser(app);
  app.presence.add(b.id, 's1');
  app.users.touchLastSeen(b.id, 555);
  assert.equal(app.users.presenceView(a.id, app.users.getById(b.id), app.presence).online, true);
  app.users.updateProfile(b.id, { showOnline: false });
  assert.equal(app.users.presenceView(a.id, app.users.getById(b.id), app.presence).online, false);
  app.presence.remove(b.id, 's1');
  assert.equal(app.users.presenceView(a.id, app.users.getById(b.id), app.presence).lastSeenAt, 555);
  app.users.updateProfile(b.id, { showLastSeen: false });
  assert.equal(app.users.presenceView(a.id, app.users.getById(b.id), app.presence).lastSeenAt, null);
});

test('account deletion needs the password and removes everything', async () => {
  const { app, db } = makeApp();
  const a = await makeUser(app); const b = await makeUser(app);
  befriend(app, a, b);
  app.messages.send(a.id, b.id, 'hello', null);
  await assert.rejects(app.users.deleteAccount(a.id, 'wrong-wrong-wrong'), (e) => e.status === 403);
  await app.users.deleteAccount(a.id, 'correct-horse-battery');
  for (const t of ['users WHERE id=' + a.id, 'messages', 'conversations', 'contacts WHERE user_id=' + a.id]) {
    assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get().n, 0, t);
  }
});
