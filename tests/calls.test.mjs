import test from 'node:test';
import assert from 'node:assert/strict';
import { makeApp, makeUser, befriend } from './helpers.mjs';

// Fake timers so timeouts can be triggered instantly.
function fakeTimers() {
  let id = 0; const pending = new Map();
  return { setTimer: (fn, ms) => { pending.set(++id, { fn, ms }); return id; }, clearTimer: (i) => pending.delete(i),
    fire(ms) { for (const [i, t] of [...pending]) if (t.ms === ms) { pending.delete(i); t.fn(); } }, count: () => pending.size };
}

async function setup() {
  const timers = fakeTimers();
  const ctx = makeApp();
  ctx.app.callManager.setTimer = timers.setTimer;
  ctx.app.callManager.clearTimer = timers.clearTimer;
  const a = await makeUser(ctx.app); const b = await makeUser(ctx.app); const c = await makeUser(ctx.app);
  befriend(ctx.app, a, b); befriend(ctx.app, a, c);
  // sockets: a has one tab, b has two tabs, c has one tab
  const sa = { id: 'sa', userId: a.id }, sb1 = { id: 'sb1', userId: b.id }, sb2 = { id: 'sb2', userId: b.id }, sc = { id: 'sc', userId: c.id };
  ctx.app.presence.add(a.id, 'sa'); ctx.app.presence.add(b.id, 'sb1'); ctx.app.presence.add(b.id, 'sb2'); ctx.app.presence.add(c.id, 'sc');
  const to = (sid, ev) => ctx.events.filter((e) => e.socketId === sid && e.event === ev);
  const row = (id) => ctx.db.prepare('SELECT * FROM calls WHERE id = ?').get(id);
  return { ...ctx, timers, a, b, c, sa, sb1, sb2, sc, to, row, cm: ctx.app.callManager };
}
const SDP = { description: { type: 'offer', sdp: 'v=0' } };

test('invite rings ALL of the callee\'s tabs with caller identity', async () => {
  const { cm, sa, b, a, to, row } = await setup();
  const r = cm.invite(sa, { toUserId: b.id, type: 'video' });
  assert.ok(r.ok && r.callId);
  for (const sid of ['sb1', 'sb2']) {
    const ev = to(sid, 'call:incoming');
    assert.equal(ev.length, 1);
    assert.equal(ev[0].payload.from.id, a.id);
    assert.equal(ev[0].payload.type, 'video');
    assert.equal(ev[0].payload.from.password_hash, undefined);
  }
  assert.equal(row(r.callId).result, null, 'live calls have no result yet');
});

test('multi-tab: first tab to accept wins, other tabs are told; no duplicate sessions', async () => {
  const { cm, sa, sb1, sb2, b, to } = await setup();
  const { callId } = cm.invite(sa, { toUserId: b.id, type: 'audio' });
  assert.ok(cm.accept(sb1, callId).ok);
  assert.equal(to('sb2', 'call:taken').length, 1);
  assert.equal(to('sa', 'call:accepted').length, 1);
  assert.equal(cm.accept(sb2, callId).error, 'invalid_state', 'second tab cannot also accept');
  assert.equal(cm.calls.size, 1);
});

test('AUTHZ: only the intended recipient can accept/reject; only the caller can cancel', async () => {
  const { cm, sa, sb1, sc, a, b, to } = await setup();
  const { callId } = cm.invite(sa, { toUserId: b.id, type: 'audio' });
  assert.equal(cm.accept(sc, callId).error, 'not_allowed');
  assert.equal(cm.reject(sc, callId).error, 'not_allowed');
  assert.equal(cm.accept(sa, callId).error, 'not_allowed', 'caller cannot accept own call');
  assert.equal(cm.cancel(sb1, callId).error, 'not_allowed');
  assert.equal(cm.accept({ id: 'x', userId: 9999 }, callId).error, 'not_allowed');
  assert.equal(cm.accept(sb1, 'not-a-call').error, 'not_allowed');
  assert.equal(to('sa', 'call:accepted').length, 0);
});

test('invite forbidden for non-contacts and blocked users; client cannot spoof identity', async () => {
  const { cm, sb1, sc, a, b, c, app } = await setup();
  assert.equal(cm.invite(sb1, { toUserId: c.id, type: 'audio' }).error, 'forbidden');
  app.users.block(a.id, b.id);
  assert.equal(cm.invite({ id: 'sa', userId: a.id }, { toUserId: b.id, type: 'audio' }).error, 'forbidden');
  assert.equal(cm.invite({ id: 'sa', userId: a.id }, { toUserId: b.id, type: 'screen' }).error, 'invalid_request');
  assert.equal(cm.invite({ id: 'sa', userId: a.id }, { toUserId: 'abc', type: 'audio' }).error, 'invalid_request');
});

test('reject: caller notified, history says rejected', async () => {
  const { cm, sa, sb1, sb2, b, a, to, row } = await setup();
  const { callId } = cm.invite(sa, { toUserId: b.id, type: 'audio' });
  assert.ok(cm.reject(sb1, callId).ok);
  assert.equal(to('sa', 'call:ended')[0].payload.reason, 'rejected');
  assert.equal(to('sb2', 'call:ended').length, 1, 'other tab dialog closes');
  assert.equal(to('sb1', 'call:ended').length, 0, 'rejecting tab already knows');
  assert.equal(row(callId).result, 'rejected');
  assert.equal(cm.history(a.id).calls[0].status, 'rejected');
  assert.equal(cm.invite(sa, { toUserId: b.id, type: 'audio' }).ok, true, 'users are free again');
});

test('unanswered call times out as missed on both sides', async () => {
  const { cm, sa, b, a, timers, to, row } = await setup();
  const { callId } = cm.invite(sa, { toUserId: b.id, type: 'audio' });
  timers.fire(cm.ringTimeoutMs);
  assert.equal(row(callId).result, 'missed');
  assert.equal(to('sa', 'call:ended')[0].payload.reason, 'timeout');
  assert.equal(to('sb1', 'call:ended').length, 1);
  assert.equal(cm.history(a.id).calls[0].status, 'unanswered');
  assert.equal(cm.history(b.id).calls[0].status, 'missed');
  assert.equal(cm.calls.size, 0); assert.equal(timers.count(), 0);
});

test('caller cancel while ringing is shown to callee as missed', async () => {
  const { cm, sa, b, to, row } = await setup();
  const { callId } = cm.invite(sa, { toUserId: b.id, type: 'video' });
  assert.ok(cm.cancel(sa, callId).ok);
  assert.equal(to('sb1', 'call:ended')[0].payload.reason, 'cancelled');
  assert.equal(row(callId).result, 'cancelled');
  assert.equal(cm.history(b.id).calls[0].status, 'missed');
});

test('busy: callee already in a call -> busy result, no ringing; caller cannot start a second call', async () => {
  const { cm, sa, sb1, sc, a, b, c, to, app } = await setup();
  befriend(app, b, c);
  const { callId } = cm.invite(sa, { toUserId: b.id, type: 'audio' });
  cm.accept(sb1, callId);
  const r = cm.invite({ id: 'sc', userId: c.id }, { toUserId: b.id, type: 'audio' });
  assert.equal(r.error, 'busy');
  assert.equal(to('sb1', 'call:incoming').length, 1, 'only the first call rang');
  assert.equal(cm.invite(sa, { toUserId: c.id, type: 'audio' }).error, 'already_in_call');
  assert.equal(cm.history(c.id).calls[0].status, 'busy');
  assert.equal(cm.history(b.id).calls[0].status, 'missed', 'callee sees the busy attempt as missed');
});

test('offline callee: recorded as missed, caller told', async () => {
  const { cm, sa, c, app, a } = await setup();
  app.presence.remove(c.id, 'sc');
  assert.equal(cm.invite(sa, { toUserId: c.id, type: 'audio' }).error, 'offline');
  assert.equal(cm.history(c.id).calls[0].status, 'missed');
});

test('signaling relays only between the two parties, only after accept, validated', async () => {
  const { cm, sa, sb1, sb2, sc, b, to } = await setup();
  const { callId } = cm.invite(sa, { toUserId: b.id, type: 'audio' });
  assert.equal(cm.signal(sa, callId, SDP).error, 'invalid_state', 'no signaling while ringing');
  cm.accept(sb1, callId);
  assert.ok(cm.signal(sa, callId, SDP).ok);
  assert.equal(to('sb1', 'call:signal').length, 1);
  assert.equal(to('sb2', 'call:signal').length, 0, 'other tab of callee gets nothing');
  assert.ok(cm.signal(sb1, callId, { candidate: { candidate: 'candidate:1 1 udp 1 1.1.1.1 1 typ host', sdpMid: '0', sdpMLineIndex: 0 } }).ok);
  assert.equal(to('sa', 'call:signal').length, 1);
  assert.equal(cm.signal(sc, callId, SDP).error, 'not_allowed', 'outsider cannot inject signals');
  assert.equal(cm.signal(sb2, callId, SDP).error, 'not_allowed', 'non-accepting tab cannot inject signals');
  assert.equal(cm.signal(sa, callId, { evil: true }).error, 'invalid_signal');
  assert.equal(cm.signal(sa, callId, { description: { type: 'offer', sdp: 'x'.repeat(70000) } }).error, 'invalid_signal');
});

test('connected requires BOTH browsers to report a real connection; duration from then', async () => {
  let t = 10_000;
  const ctx = await setup();
  const { cm, sa, sb1, b, a, row, timers } = ctx;
  cm.now = () => t;
  const { callId } = cm.invite(sa, { toUserId: b.id, type: 'video' });
  cm.accept(sb1, callId);
  cm.connected(sa, callId);
  assert.equal(row(callId).connected_at, null, 'one report is not enough');
  t = 12_000;
  cm.connected(sb1, callId);
  assert.equal(row(callId).connected_at, 12_000);
  assert.equal(timers.count(), 0, 'connect-timeout cancelled');
  t = 75_000;
  assert.ok(cm.end(sb1, callId).ok);
  assert.equal(row(callId).result, 'completed');
  const h = cm.history(a.id).calls[0];
  assert.equal(h.durationSec, 63); assert.equal(h.status, 'completed'); assert.equal(h.direction, 'outgoing'); assert.equal(h.type, 'video');
  assert.equal(ctx.to('sa', 'call:ended')[0].payload.reason, 'hangup');
});

test('accepted but never connects -> failed after timeout, no fake duration', async () => {
  const { cm, sa, sb1, b, a, timers, row } = await setup();
  const { callId } = cm.invite(sa, { toUserId: b.id, type: 'audio' });
  cm.accept(sb1, callId);
  timers.fire(cm.connectTimeoutMs);
  assert.equal(row(callId).result, 'failed');
  const h = cm.history(a.id).calls[0];
  assert.equal(h.status, 'failed'); assert.equal(h.durationSec, null);
});

test('client-reported connection failure ends the call as failed', async () => {
  const { cm, sa, sb1, b, row, to } = await setup();
  const { callId } = cm.invite(sa, { toUserId: b.id, type: 'audio' });
  cm.accept(sb1, callId);
  assert.ok(cm.failed(sa, callId).ok);
  assert.equal(row(callId).result, 'failed');
  assert.equal(to('sb1', 'call:ended')[0].payload.reason, 'connection_failed');
});

test('disconnect cleanup: tab closing ends the call, frees both users, notifies the peer', async () => {
  const { cm, sa, sb1, b, a, row, to, timers } = await setup();
  const { callId } = cm.invite(sa, { toUserId: b.id, type: 'audio' });
  cm.accept(sb1, callId); cm.connected(sa, callId); cm.connected(sb1, callId);
  cm.disconnect(sa);
  assert.equal(row(callId).result, 'completed');
  assert.equal(to('sb1', 'call:ended')[0].payload.reason, 'disconnected');
  assert.equal(cm.calls.size, 0); assert.equal(cm.busy.size, 0); assert.equal(timers.count(), 0);
  assert.equal(cm.invite(sa, { toUserId: b.id, type: 'audio' }).ok, true);
});

test('caller disconnect while ringing cancels; callee tab closing does not kill ringing on other tabs', async () => {
  const { cm, sa, sb1, b, row, to } = await setup();
  const first = cm.invite(sa, { toUserId: b.id, type: 'audio' });
  cm.disconnect(sb1);
  assert.equal(row(first.callId).result, null, 'still ringing for the other tab');
  cm.disconnect(sa);
  assert.equal(row(first.callId).result, 'cancelled');
  assert.equal(to('sb2', 'call:ended').length, 1);
});

test('history: only participants see a call; incomplete/crashed calls never look real', async () => {
  const { cm, sa, sb1, b, c, a, app, db } = await setup();
  const { callId } = cm.invite(sa, { toUserId: b.id, type: 'audio' });
  assert.equal(cm.history(a.id).calls.length, 0, 'live call is not in history yet');
  assert.equal(cm.history(c.id).calls.length, 0);
  assert.equal(cm.recoverOrphans(), 1);
  assert.equal(db.prepare('SELECT result FROM calls WHERE id = ?').get(callId).result, 'failed');
  assert.equal(cm.history(c.id).calls.length, 0, 'third party never sees it');
  assert.equal(cm.history(b.id).calls[0].other.id, a.id);
  assert.equal(cm.history(a.id).calls[0].other.passwordHash, undefined);
});
