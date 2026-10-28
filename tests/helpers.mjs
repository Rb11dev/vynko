import { openDb } from '../server/db.mjs';
import { loadConfig } from '../server/config.mjs';
import { createApp } from '../server/app.mjs';

export const testConfig = (extra = {}) =>
  loadConfig({ SESSION_SECRET: 'test-secret-'.padEnd(48, 'x'), APP_URL: 'http://localhost:3000', PORT: '3000', ...extra }, { prod: false });

export function makeApp(opts = {}) {
  const db = openDb(':memory:');
  const events = [];
  const emit = (socketId, event, payload) => events.push({ socketId, event, payload });
  const realtimeCalls = [];
  const realtime = {
    notifyMessage: (m, to) => realtimeCalls.push(['notifyMessage', m, to]),
    notifyRead: (...a) => realtimeCalls.push(['notifyRead', ...a]),
    closeMeeting: (...a) => realtimeCalls.push(['closeMeeting', ...a]),
    disconnectUser: (...a) => realtimeCalls.push(['disconnectUser', ...a]),
    disconnectSession: (...a) => realtimeCalls.push(['disconnectSession', ...a]),
  };
  const app = createApp({ config: testConfig(), db, emit, realtime, log: { error() {}, warn() {}, log() {} }, ...opts });
  return { app, db, events, realtimeCalls };
}

let n = 0;
export async function makeUser(app, name) {
  n += 1;
  const username = name ?? `user${n}x`;
  return app.users.register({ username, displayName: `Name ${username}`, password: 'correct-horse-battery' });
}
// Makes a and b mutual contacts.
export function befriend(app, a, b) {
  app.users.addContact(a.id, b.username);
  app.users.addContact(b.id, a.username);
}
