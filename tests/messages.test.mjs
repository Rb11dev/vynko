import test from 'node:test';
import assert from 'node:assert/strict';
import { makeApp, makeUser, befriend } from './helpers.mjs';

async function trio() {
  const ctx = makeApp();
  const a = await makeUser(ctx.app); const b = await makeUser(ctx.app); const c = await makeUser(ctx.app);
  befriend(ctx.app, a, b); befriend(ctx.app, a, c);
  return { ...ctx, a, b, c };
}

test('messages persist with sender, timestamp; history is ordered and paginated', async () => {
  const { app, a, b } = await trio();
  for (let i = 1; i <= 7; i++) app.messages.send(i % 2 ? a.id : b.id, i % 2 ? b.id : a.id, `m${i}`, null);
  const page1 = app.messages.list(a.id, b.id, { limit: 3 });
  assert.deepEqual(page1.messages.map((m) => m.body), ['m5', 'm6', 'm7']);
  assert.equal(page1.hasMore, true);
  const page2 = app.messages.list(a.id, b.id, { limit: 3, before: page1.messages[0].id });
  assert.deepEqual(page2.messages.map((m) => m.body), ['m2', 'm3', 'm4']);
  const page3 = app.messages.list(b.id, a.id, { limit: 3, before: page2.messages[0].id });
  assert.deepEqual(page3.messages.map((m) => m.body), ['m1']);
  assert.equal(page3.hasMore, false);
  assert.ok(page1.messages[0].createdAt > 0 && page1.messages[0].senderId);
});

test('PRIVATE: a third user can never read someone else\'s conversation', async () => {
  const { app, a, b, c } = await trio();
  app.messages.send(a.id, b.id, 'secret plans', null);
  assert.deepEqual(app.messages.list(c.id, a.id).messages, [], 'c<->a is a different conversation');
  assert.deepEqual(app.messages.list(c.id, b.id).messages, []);
  assert.equal(app.messages.conversations(c.id).length, 0);
  assert.equal(app.messages.conversations(a.id).length, 1);
});

test('sending requires contact; blocked users cannot send either way; self is rejected', async () => {
  const { app, a, b, c } = await trio();
  assert.throws(() => app.messages.send(b.id, c.id, 'hi', null), (e) => e.status === 403 && e.code === 'not_contact');
  app.users.block(b.id, a.id);
  assert.throws(() => app.messages.send(a.id, b.id, 'hi', null), (e) => e.code === 'blocked');
  assert.throws(() => app.messages.send(b.id, a.id, 'hi', null), (e) => e.code === 'blocked');
  assert.throws(() => app.messages.send(a.id, a.id, 'hi', null), (e) => e.code === 'self');
  assert.throws(() => app.messages.send(a.id, 424242, 'hi', null), (e) => e.status === 404);
});

test('unread counts and read receipts', async () => {
  const { app, a, b } = await trio();
  app.messages.send(a.id, b.id, 'one', null); app.messages.send(a.id, b.id, 'two', null);
  assert.equal(app.messages.conversations(b.id)[0].unread, 2);
  assert.equal(app.messages.conversations(a.id)[0].unread, 0, 'own messages are not unread');
  const ids = app.messages.markRead(b.id, a.id);
  assert.equal(ids.length, 2);
  assert.equal(app.messages.conversations(b.id)[0].unread, 0);
  assert.equal(app.messages.markRead(b.id, a.id).length, 0);
  assert.ok(app.messages.list(a.id, b.id).messages.every((m) => m.readAt && m.deliveredAt));
});

test('delivered is only set via explicit confirmation for the real recipient', async () => {
  const { app, a, b, c } = await trio();
  const m = app.messages.send(a.id, b.id, 'hello', null);
  assert.equal(m.deliveredAt, null, 'a freshly stored message is "sent", not "delivered"');
  assert.equal(app.messages.markDelivered(a.id, [m.id]).length, 0, 'sender cannot mark own message delivered');
  assert.equal(app.messages.markDelivered(c.id, [m.id]).length, 0, 'unrelated user cannot');
  assert.equal(app.messages.markDelivered(b.id, [m.id]).length, 1);
  assert.equal(app.messages.markDelivered(b.id, [m.id]).length, 0, 'only once');
});

test('clientId makes retries idempotent; spam is rate limited', async () => {
  const { app, a, b } = await trio();
  const m1 = app.messages.send(a.id, b.id, 'once', 'client-id-0001');
  const m2 = app.messages.send(a.id, b.id, 'once', 'client-id-0001');
  assert.equal(m1.id, m2.id);
  assert.equal(app.messages.list(a.id, b.id).messages.length, 1);
  let limited = null;
  for (let i = 0; i < 40 && !limited; i++) { try { app.messages.send(a.id, b.id, `spam${i}`, null); } catch (e) { limited = e; } }
  assert.equal(limited?.status, 429);
});

test('conversation search matches names and message text, escaping wildcards', async () => {
  const { app, a, b, c } = await trio();
  app.messages.send(a.id, b.id, 'lunch at noon', null);
  app.messages.send(a.id, c.id, '100% sure', null);
  assert.equal(app.messages.conversations(a.id, 'lunch').length, 1);
  assert.equal(app.messages.conversations(a.id, b.username).length, 1);
  assert.equal(app.messages.conversations(a.id, '%').length, 1, 'literal % only matches the message containing it');
  assert.equal(app.messages.conversations(a.id, 'zzz').length, 0);
});

test('message validation: empty, too long, SQL-ish text stored literally', async () => {
  const { app, a, b } = await trio();
  assert.throws(() => app.messages.send(a.id, b.id, '   ', null), (e) => e.status === 400);
  assert.throws(() => app.messages.send(a.id, b.id, 'x'.repeat(2001), null), (e) => e.status === 400);
  const m = app.messages.send(a.id, b.id, "'); DROP TABLE messages;--", null);
  assert.equal(app.messages.list(a.id, b.id).messages[0].body, m.body);
});
