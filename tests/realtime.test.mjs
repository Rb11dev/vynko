// Tests server/realtime.mjs against a small FAKE Socket.IO server (the real socket.io package
// is not installed in the build sandbox). This verifies OUR wiring: cookie auth, per-event
// authorization, presence, acks, and cleanup. It does not test the socket.io library itself.
import test from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../server/db.mjs';
import { createApp } from '../server/app.mjs';
import { attachRealtime } from '../server/realtime.mjs';
import { testConfig, befriend } from './helpers.mjs';

class FakeSocket {
  constructor(io, cookie) {
    this.io = io; this.id = `sock${++io.n}`; this.rooms = new Set([this.id]); this.data = {}; this.handlers = {};
    this.handshake = { headers: { cookie } }; this.received = []; this.acks = {}; this.disconnected = false;
  }
  join(r) { this.rooms.add(r); }
  on(ev, h) { (this.handlers[ev] ??= []).push(h); }
  call(ev, payload) { return new Promise((res) => this.handlers[ev]?.forEach((h) => h(payload, res))); }
  got(ev) { return this.received.filter((r) => r.ev === ev); }
  disconnect() { if (this.disconnected) return; this.disconnected = true; this.io.sockets.delete(this.id); this.handlers.disconnect?.forEach((h) => h()); }
}
class FakeIO {
  constructor() { this.n = 0; this.mw = []; this.conn = []; this.sockets = new Map(); }
  use(fn) { this.mw.push(fn); }
  on(ev, fn) { if (ev === 'connection') this.conn.push(fn); }
  inRoom(room) { return [...this.sockets.values()].filter((s) => s.rooms.has(room)); }
  to(room) { return { emit: (ev, payload) => this.inRoom(room).forEach((s) => s.received.push({ ev, payload })) }; }
  in(room) {
    return {
      disconnectSockets: () => this.inRoom(room).forEach((s) => s.disconnect()),
      timeout: () => ({ emit: (ev, payload, cb) => { const rs = []; for (const s of this.inRoom(room)) { s.received.push({ ev, payload }); if (s.acks[ev]) rs.push(s.acks[ev](payload)); } cb(null, rs); } }),
    };
  }
  connect(cookie) {
    const s = new FakeSocket(this, cookie);
    this.sockets.set(s.id, s);
    for (const m of this.mw) m(s, () => {});
    this.conn.forEach((f) => f(s));
    return s;
  }
}

async function setup() {
  const db = openDb(':memory:');
  const app = createApp({ config: testConfig(), db, log: { error() {}, warn() {}, log() {} } });
  const io = new FakeIO();
  attachRealtime({ io, app, log: { error() {} } });
  const mk = async (name) => {
    const u = await app.users.register({ username: name, displayName: name, password: 'correct-horse-battery' });
    const { token } = app.users.createSession(u.id, 't');
    return { ...u, cookie: `vynko_sid=${token}`, token };
  };
  return { app, io, db, mk };
}

test('sockets are authenticated from the session cookie; guests/forged cookies cannot use call APIs', async () => {
  const { io, mk } = await setup();
  const alice = await mk('alice_rt'); const bob = await mk('bob_rt');
  const anon = io.connect(undefined);
  const forged = io.connect('vynko_sid=forged');
  for (const s of [anon, forged]) {
    assert.deepEqual(await s.call('call:invite', { toUserId: bob.id, type: 'audio' }), { error: 'unauthenticated' });
    assert.deepEqual(await s.call('ice:get'), { error: 'unauthenticated' });
    assert.equal((await s.call('meeting:join', { code: 'A'.repeat(22), participantId: 'x' })).error, 'not_allowed');
  }
  const ok = io.connect(alice.cookie);
  const ice = await ok.call('ice:get');
  assert.ok(ice.ok && Array.isArray(ice.iceServers) && ice.iceServers.length >= 1);
  assert.ok(!JSON.stringify(ice).includes('password'));
});

test('client-supplied identity is ignored: you cannot call "as" someone else', async () => {
  const { io, mk, app } = await setup();
  const a = await mk('a_spoof'); const b = await mk('b_spoof'); const c = await mk('c_spoof');
  befriend(app, a, b);
  const sb = io.connect(b.cookie); io.connect(c.cookie);
  const sa = io.connect(a.cookie);
  const r = await sa.call('call:invite', { toUserId: b.id, type: 'audio', callerId: c.id, userId: c.id, from: c.id });
  assert.ok(r.ok);
  assert.equal(sb.got('call:incoming')[0].payload.from.id, a.id);
});

test('presence: contacts see online/offline; privacy setting hides it', async () => {
  const { io, mk, app } = await setup();
  const a = await mk('a_pres'); const b = await mk('b_pres');
  app.users.addContact(a.id, b.username); // a watches b
  const sa = io.connect(a.cookie);
  const sb = io.connect(b.cookie);
  assert.deepEqual(sa.got('presence').map((e) => [e.payload.userId, e.payload.online]), [[b.id, true]]);
  sb.disconnect();
  assert.equal(sa.got('presence').at(-1).payload.online, false);
  assert.ok(sa.got('presence').at(-1).payload.lastSeenAt > 0);
  app.users.updateProfile(b.id, { showOnline: false });
  io.connect(b.cookie);
  assert.equal(sa.got('presence').at(-1).payload.online, false, 'hidden presence is never broadcast as online');
});

test('full call through sockets: invite, ring, accept, signaling, both report connected, hang up, history', async () => {
  const { io, mk, app } = await setup();
  const a = await mk('a_call'); const b = await mk('b_call');
  befriend(app, a, b);
  const sa = io.connect(a.cookie); const sb1 = io.connect(b.cookie); const sb2 = io.connect(b.cookie);
  const inv = await sa.call('call:invite', { toUserId: b.id, type: 'video' });
  assert.ok(inv.ok);
  assert.equal(sb1.got('call:incoming').length, 1); assert.equal(sb2.got('call:incoming').length, 1);
  assert.ok((await sb2.call('call:accept', { callId: inv.callId })).ok);
  assert.equal(sb1.got('call:taken').length, 1);
  assert.equal(sa.got('call:accepted').length, 1);
  const offer = { description: { type: 'offer', sdp: 'v=0' } };
  assert.ok((await sa.call('call:signal', { callId: inv.callId, data: offer })).ok);
  assert.deepEqual(sb2.got('call:signal')[0].payload.data, offer);
  assert.equal(sb1.got('call:signal').length, 0);
  assert.equal((await sb1.call('call:signal', { callId: inv.callId, data: offer })).error, 'not_allowed');
  await sa.call('call:connected', { callId: inv.callId }); await sb2.call('call:connected', { callId: inv.callId });
  assert.ok((await sb2.call('call:end', { callId: inv.callId })).ok);
  assert.equal(sa.got('call:ended')[0].payload.reason, 'hangup');
  const hist = app.callManager.history(a.id).calls[0];
  assert.equal(hist.status, 'completed'); assert.equal(hist.type, 'video');
});

test('closing a tab mid-call ends it for the other side (cleanup)', async () => {
  const { io, mk, app } = await setup();
  const a = await mk('a_dc'); const b = await mk('b_dc');
  befriend(app, a, b);
  const sa = io.connect(a.cookie); const sb = io.connect(b.cookie);
  const { callId } = await sa.call('call:invite', { toUserId: b.id, type: 'audio' });
  await sb.call('call:accept', { callId });
  sa.disconnect();
  assert.equal(sb.got('call:ended')[0].payload.reason, 'disconnected');
  assert.equal(app.callManager.busy.size, 0);
});

test('handlers always acknowledge, even on bad payloads; missing ack function does not crash', async () => {
  const { io, mk } = await setup();
  const a = await mk('a_bad');
  const sa = io.connect(a.cookie);
  assert.deepEqual(await sa.call('call:invite', null), { error: 'invalid_request' });
  assert.deepEqual(await sa.call('call:accept', { callId: { evil: 1 } }), { error: 'not_allowed' });
  assert.doesNotThrow(() => sa.handlers['call:end'][0]({ callId: 'x' }, undefined));
});

test('message "delivered" only after the recipient browser acknowledges; offline stays "sent"', async () => {
  const { io, mk, app } = await setup();
  const a = await mk('a_msg'); const b = await mk('b_msg');
  befriend(app, a, b);
  const sa = io.connect(a.cookie);
  // b offline
  const m1 = app.messages.send(a.id, b.id, 'are you there?', null);
  app.realtime.notifyMessage(m1, b.id);
  assert.equal(app.messages.list(a.id, b.id).messages[0].deliveredAt, null);
  // b connects: waiting messages are marked delivered on connect and the sender is told
  const sb = io.connect(b.cookie);
  assert.ok(app.messages.list(a.id, b.id).messages[0].deliveredAt > 0);
  assert.equal(sa.got('message:status').at(-1).payload.status, 'delivered');
  // live message: no ack from the browser -> not delivered
  const m2 = app.messages.send(a.id, b.id, 'second', null);
  app.realtime.notifyMessage(m2, b.id);
  assert.equal(sb.got('message:new').at(-1).payload.body, 'second');
  const row = () => app.messages.list(a.id, b.id).messages.find((m) => m.id === m2.id);
  assert.equal(row().deliveredAt, null);
  // with an ack -> delivered, sender informed
  sb.acks['message:new'] = () => true;
  const m3 = app.messages.send(a.id, b.id, 'third', null);
  app.realtime.notifyMessage(m3, b.id);
  assert.ok(app.messages.list(a.id, b.id).messages.find((m) => m.id === m3.id).deliveredAt > 0);
  assert.deepEqual(sa.got('message:status').at(-1).payload.ids, [m3.id]);
  // read receipts
  app.realtime.notifyRead(b.id, a.id, [m3.id]);
  assert.equal(sa.got('message:status').at(-1).payload.status, 'read');
});

test('logout disconnects only that session\'s sockets; account deletion disconnects all', async () => {
  const { io, mk, app } = await setup();
  const a = await mk('a_out');
  const second = app.users.createSession(a.id, 't2');
  const s1 = io.connect(a.cookie); const s2 = io.connect(`vynko_sid=${second.token}`);
  app.realtime.disconnectSession(app.users.sessionKey(a.token));
  assert.equal(s1.disconnected, true); assert.equal(s2.disconnected, false);
  app.realtime.disconnectUser(a.id);
  assert.equal(s2.disconnected, true);
});

test('meeting over sockets: guest token proves identity, ICE returned, peers signaled, cleanup on disconnect', async () => {
  const { io, mk, app } = await setup();
  const host = await mk('host_rt');
  const meeting = app.meetings.create(host.id, {});
  const h = app.meetings.join(meeting.code, { user: await app.users.getById(host.id) });
  const g = app.meetings.join(meeting.code, { displayName: 'Guest G' });
  const sh = io.connect(host.cookie); const sg = io.connect(undefined);
  const rh = await sh.call('meeting:join', { code: meeting.code, participantId: h.participantId });
  assert.ok(rh.ok && rh.iceServers.length && rh.self.role === 'host');
  assert.equal((await sg.call('meeting:join', { code: meeting.code, participantId: g.participantId, token: 'bad' })).error, 'not_allowed');
  const rg = await sg.call('meeting:join', { code: meeting.code, participantId: g.participantId, token: g.guestToken });
  assert.ok(rg.ok); assert.equal(rg.peers[0].participantId, h.participantId);
  assert.equal(sh.got('meeting:peer-joined')[0].payload.displayName, 'Guest G');
  const offer = { description: { type: 'offer', sdp: 'v=0' } };
  assert.ok((await sg.call('meeting:signal', { to: h.participantId, data: offer })).ok);
  assert.equal(sh.got('meeting:signal')[0].payload.from, g.participantId);
  sg.disconnect();
  assert.equal(sh.got('meeting:peer-left')[0].payload.participantId, g.participantId);
  app.realtime.closeMeeting(meeting.code, 'ended');
  assert.equal(sh.got('meeting:ended')[0].payload.reason, 'ended');
});
