import test from 'node:test';
import assert from 'node:assert/strict';
import { makeApp, makeUser } from './helpers.mjs';

async function setup(now) {
  const ctx = makeApp(now ? { now } : {});
  const host = await makeUser(ctx.app); const guestUser = await makeUser(ctx.app);
  const to = (sid, ev) => ctx.events.filter((e) => e.socketId === sid && e.event === ev);
  return { ...ctx, host, guestUser, to, m: ctx.app.meetings, hub: ctx.app.hub };
}

test('meeting codes are 22-char unguessable and unique', async () => {
  const { m, host } = await setup();
  const codes = new Set(Array.from({ length: 50 }, () => m.create(host.id, {}).code));
  assert.equal(codes.size, 50);
  for (const c of codes) assert.match(c, /^[A-Za-z0-9_-]{22}$/);
});

test('invalid, malformed and unknown links are rejected identically', async () => {
  const { m } = await setup();
  for (const bad of ['short', 'x'.repeat(22), '../../etc/passwd', "'; DROP TABLE meetings;--", undefined, 42]) {
    assert.throws(() => m.getPublic(bad), (e) => e.status === 404 && e.code === 'meeting_not_found');
    assert.throws(() => m.join(bad, { displayName: 'G' }), (e) => e.status === 404);
  }
});

test('expired, revoked and ended meetings cannot be joined', async () => {
  let t = 1_000_000;
  const { m, host } = await setup(() => t);
  const a = m.create(host.id, { expiresInMinutes: 30 });
  assert.equal(m.getPublic(a.code).status, 'active');
  t += 31 * 60000;
  assert.equal(m.getPublic(a.code).status, 'expired');
  assert.throws(() => m.join(a.code, { displayName: 'G' }), (e) => e.status === 410 && e.code === 'meeting_expired');
  const b = m.create(host.id, {}); m.revoke(host.id, b.code);
  assert.throws(() => m.join(b.code, { displayName: 'G' }), (e) => e.code === 'meeting_revoked');
  const c = m.create(host.id, {}); m.end(host.id, c.code);
  assert.throws(() => m.join(c.code, { displayName: 'G' }), (e) => e.code === 'meeting_ended');
});

test('only the host can revoke or end; expiry options validated', async () => {
  const { m, host, guestUser } = await setup();
  const mt = m.create(host.id, {});
  assert.throws(() => m.revoke(guestUser.id, mt.code), (e) => e.status === 404);
  assert.throws(() => m.end(guestUser.id, mt.code), (e) => e.status === 404);
  assert.throws(() => m.create(host.id, { expiresInMinutes: 99999 }), (e) => e.status === 400);
  assert.throws(() => m.create(host.id, { title: 'x'.repeat(100) }), (e) => e.status === 400);
});

test('guests: allowed only when the host permits it; need a valid name; get a secret token', async () => {
  const { m, host } = await setup();
  const open = m.create(host.id, { allowGuests: true });
  const closed = m.create(host.id, { allowGuests: false });
  assert.throws(() => m.join(closed.code, { displayName: 'Guest' }), (e) => e.status === 403 && e.code === 'guests_not_allowed');
  assert.throws(() => m.join(open.code, { displayName: '' }), (e) => e.status === 400);
  const j = m.join(open.code, { displayName: 'Gina' });
  assert.ok(j.guestToken && j.participantId);
  assert.equal(j.role, 'participant');
});

test('hub: participant must prove identity (token or session) - wrong token / wrong user rejected', async () => {
  const { m, hub, host, guestUser } = await setup();
  const mt = m.create(host.id, {});
  const g = m.join(mt.code, { displayName: 'Gina' });
  const h = m.join(mt.code, { user: host });
  assert.equal(hub.join({ id: 's1', userId: null }, { code: mt.code, participantId: g.participantId, token: 'wrong' }).error, 'not_allowed');
  assert.equal(hub.join({ id: 's1', userId: null }, { code: mt.code, participantId: g.participantId }).error, 'not_allowed');
  assert.equal(hub.join({ id: 's2', userId: guestUser.id }, { code: mt.code, participantId: h.participantId }).error, 'not_allowed', 'another user cannot take the host seat');
  assert.equal(hub.join({ id: 's3', userId: null }, { code: mt.code, participantId: h.participantId }).error, 'not_allowed', 'guest cannot take a user seat');
  assert.equal(hub.join({ id: 's4', userId: null }, { code: 'A'.repeat(22), participantId: g.participantId, token: g.guestToken }).error, 'not_allowed');
  assert.ok(hub.join({ id: 's1', userId: null }, { code: mt.code, participantId: g.participantId, token: g.guestToken }).ok);
});

test('hub: two people connect, signals are relayed with a server-set sender, room is capped at 2', async () => {
  const { m, hub, host, to } = await setup();
  const mt = m.create(host.id, {});
  const h = m.join(mt.code, { user: host });
  const g = m.join(mt.code, { displayName: 'Gina' });
  const g2 = m.join(mt.code, { displayName: 'Third' });
  const r1 = hub.join({ id: 'h', userId: host.id }, { code: mt.code, participantId: h.participantId });
  assert.deepEqual(r1.peers, []); assert.equal(r1.self.role, 'host');
  const r2 = hub.join({ id: 'g', userId: null }, { code: mt.code, participantId: g.participantId, token: g.guestToken });
  assert.deepEqual(r2.peers.map((p) => p.participantId), [h.participantId]);
  assert.equal(to('h', 'meeting:peer-joined')[0].payload.participantId, g.participantId);
  assert.equal(hub.join({ id: 'g2', userId: null }, { code: mt.code, participantId: g2.participantId, token: g2.guestToken }).error, 'room_full');

  const sdp = { description: { type: 'offer', sdp: 'v=0' } };
  assert.ok(hub.signal({ id: 'g', userId: null }, { to: h.participantId, data: sdp }).ok);
  assert.equal(to('h', 'meeting:signal')[0].payload.from, g.participantId);
  assert.equal(hub.signal({ id: 'g', userId: null }, { to: 'nope', data: sdp }).error, 'not_allowed');
  assert.equal(hub.signal({ id: 'g', userId: null }, { to: g.participantId, data: sdp }).error, 'not_allowed', 'cannot signal yourself');
  assert.equal(hub.signal({ id: 'outsider', userId: null }, { to: h.participantId, data: sdp }).error, 'not_allowed');
  assert.equal(hub.signal({ id: 'g', userId: null }, { to: h.participantId, data: { x: 1 } }).error, 'invalid_signal');
});

test('hub: leaving notifies peers and frees the seat; ending the meeting closes the room', async () => {
  const { m, hub, host, to } = await setup();
  const mt = m.create(host.id, {});
  const h = m.join(mt.code, { user: host });
  const g = m.join(mt.code, { displayName: 'Gina' });
  hub.join({ id: 'h', userId: host.id }, { code: mt.code, participantId: h.participantId });
  hub.join({ id: 'g', userId: null }, { code: mt.code, participantId: g.participantId, token: g.guestToken });
  hub.leave({ id: 'g', userId: null });
  assert.equal(to('h', 'meeting:peer-left')[0].payload.participantId, g.participantId);
  assert.ok(hub.join({ id: 'g-new', userId: null }, { code: mt.code, participantId: g.participantId, token: g.guestToken }).ok, 'can rejoin');
  hub.closeRoom(mt.code, 'ended');
  assert.equal(to('h', 'meeting:ended').length, 1);
  assert.equal(to('g-new', 'meeting:ended').length, 1);
  assert.equal(hub.rooms.size, 0);
});

test('hub: same participant cannot be in the room twice (multi-tab)', async () => {
  const { m, hub, host } = await setup();
  const mt = m.create(host.id, {});
  const h = m.join(mt.code, { user: host });
  assert.ok(hub.join({ id: 't1', userId: host.id }, { code: mt.code, participantId: h.participantId }).ok);
  assert.equal(hub.join({ id: 't2', userId: host.id }, { code: mt.code, participantId: h.participantId }).error, 'already_joined');
  assert.equal(hub.join({ id: 't1', userId: host.id }, { code: mt.code, participantId: h.participantId }).error, 'already_in_meeting');
});
