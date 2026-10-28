import test from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig, ConfigError } from '../server/config.mjs';
import * as v from '../server/validate.mjs';
import { createRateLimiter } from '../server/ratelimit.mjs';

const good = { SESSION_SECRET: 'a'.repeat(40) };

test('config: missing SESSION_SECRET gives a helpful error', () => {
  assert.throws(() => loadConfig({}, { prod: false }), (e) => e instanceof ConfigError && /SESSION_SECRET is missing/.test(e.message));
});
test('config: short or placeholder secret rejected', () => {
  assert.throws(() => loadConfig({ SESSION_SECRET: 'short' }), /too short/);
  assert.throws(() => loadConfig({ SESSION_SECRET: 'change-me-'.padEnd(40, 'x') }), /placeholder/);
});
test('config: TURN must be all-or-nothing and warns when absent', () => {
  assert.throws(() => loadConfig({ ...good, TURN_URL: 'turn:t.example.com:3478' }), /TURN is partly configured/);
  const c = loadConfig(good);
  assert.equal(c.hasTurn, false);
  assert.ok(c.warnings.some((w) => /TURN is not configured/.test(w)));
  const t = loadConfig({ ...good, TURN_URL: 'turn:t.example.com:3478', TURN_USERNAME: 'u', TURN_CREDENTIAL: 'p' });
  assert.equal(t.hasTurn, true);
  assert.equal(t.iceServers.length, 2);
});
test('config: bad STUN/APP_URL/PORT reported together', () => {
  assert.throws(() => loadConfig({ ...good, STUN_URLS: 'http://x', APP_URL: 'nope', PORT: 'abc' }), (e) => /STUN_URLS/.test(e.message) && /APP_URL/.test(e.message) && /PORT/.test(e.message));
});
test('config: cookies are Secure for https and warning for http in production', () => {
  assert.equal(loadConfig({ ...good, APP_URL: 'https://x.example.com' }, { prod: true }).cookieSecure, true);
  assert.equal(loadConfig(good).cookieSecure, false);
  assert.ok(loadConfig({ ...good, APP_URL: 'http://x.example.com' }, { prod: true }).warnings.some((w) => /https/.test(w)));
});

test('validate: username/password/displayName rules', () => {
  assert.equal(v.username(' bob_1 '), 'bob_1');
  assert.throws(() => v.username('a b'), v.HttpError);
  assert.throws(() => v.username('ab'), v.HttpError);
  assert.throws(() => v.password('short'), v.HttpError);
  assert.throws(() => v.password('Bob12345', 'bob12345'), v.HttpError);
  assert.equal(v.displayName('  Ada   Lovelace '), 'Ada Lovelace');
  assert.throws(() => v.displayName('x\u0000y'), v.HttpError);
  assert.throws(() => v.avatarUrl('http://insecure.example/a.png'), v.HttpError);
  assert.throws(() => v.avatarUrl('javascript:alert(1)'), v.HttpError);
  assert.equal(v.avatarUrl(''), null);
});
test('validate: messages and ids', () => {
  assert.equal(v.messageBody('  hi\r\nthere '), 'hi\nthere');
  assert.throws(() => v.messageBody('   '), v.HttpError);
  assert.throws(() => v.messageBody('x'.repeat(2001)), v.HttpError);
  assert.throws(() => v.messageBody(42), v.HttpError);
  assert.equal(v.intId('12'), 12);
  assert.throws(() => v.intId('1; DROP TABLE users'), v.HttpError);
  assert.equal(v.meetingCode('x'.repeat(21)), null);
  assert.equal(v.meetingCode('A'.repeat(22)), 'A'.repeat(22));
});
test('validate: signaling payloads are strictly shaped', () => {
  assert.deepEqual(v.signal({ description: { type: 'offer', sdp: 'v=0', evil: 1 }, extra: 1 }), { description: { type: 'offer', sdp: 'v=0' } });
  assert.throws(() => v.signal({ description: { type: 'rollback', sdp: '' } }));
  assert.throws(() => v.signal({ description: { type: 'offer', sdp: 'x'.repeat(70000) } }));
  assert.ok(v.signal({ candidate: { candidate: 'candidate:1 1 udp 1 1.2.3.4 5 typ host', sdpMid: '0', sdpMLineIndex: 0 } }).candidate);
  assert.throws(() => v.signal({}));
  assert.throws(() => v.signal(null));
});
test('rate limiter blocks after max and recovers after the window', () => {
  let t = 0;
  const rl = createRateLimiter({ windowMs: 1000, max: 2, now: () => t });
  assert.ok(rl.hit('k').ok && rl.hit('k').ok);
  assert.equal(rl.hit('k').ok, false);
  assert.ok(rl.hit('other').ok);
  t = 1001;
  assert.ok(rl.hit('k').ok);
});
