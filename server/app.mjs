// Builds all services and the API. Used by the real server and by the tests.
import { createRateLimiter } from './ratelimit.mjs';
import { createPresence } from './services/presence.mjs';
import { createUserService } from './services/users.mjs';
import { createMessageService } from './services/messages.mjs';
import { CallManager } from './services/calls.mjs';
import { createMeetingService, MeetingHub } from './services/meetings.mjs';
import { createApi } from './api.mjs';

const noop = () => {};
// `realtime` is filled in by realtime.mjs once Socket.IO exists (tests pass fakes).
export function createRealtimeHolder() {
  return { notifyMessage: noop, notifyRead: noop, closeMeeting: noop, disconnectUser: noop, disconnectSession: noop };
}

export function createApp({ config, db, realtime = createRealtimeHolder(), emit = noop, now = Date.now, log = console }) {
  const limiters = {
    global: createRateLimiter({ windowMs: 60_000, max: 600, now }),
    register: createRateLimiter({ windowMs: 3600_000, max: 10, now }),
    login: createRateLimiter({ windowMs: 15 * 60_000, max: 8, now }),
    loginIp: createRateLimiter({ windowMs: 15 * 60_000, max: 40, now }),
    search: createRateLimiter({ windowMs: 60_000, max: 30, now }),
    contacts: createRateLimiter({ windowMs: 3600_000, max: 40, now }),
    messages: createRateLimiter({ windowMs: 10_000, max: 20, now }),
    meetingCreate: createRateLimiter({ windowMs: 3600_000, max: 20, now }),
    meetingInfo: createRateLimiter({ windowMs: 60_000, max: 120, now }),
    meetingJoin: createRateLimiter({ windowMs: 10 * 60_000, max: 30, now }),
    callInvite: createRateLimiter({ windowMs: 60_000, max: 10, now }),
  };
  let emitFn = emit;
  const presence = createPresence();
  const users = createUserService({ db, secret: config.secret, now });
  const messages = createMessageService({ db, users, limiter: limiters.messages, now });
  const meetings = createMeetingService({ db, secret: config.secret, now });
  const callManager = new CallManager({ db, users, presence, emit: (...a) => emitFn(...a), now });
  const hub = new MeetingHub({ meetings, emit: (...a) => emitFn(...a) });
  const api = createApi({ config, users, messages, calls: callManager, meetings, presence, realtime, limiters, log });
  return { config, db, limiters, presence, users, messages, meetings, callManager, hub, api, realtime, setEmit: (fn) => { emitFn = fn; } };
}
