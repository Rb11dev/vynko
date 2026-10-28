// Input validation shared by the REST API and the Socket.IO handlers.
export class HttpError extends Error {
  constructor(status, code, message, extra) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.code = code;
    this.extra = extra;
  }
}

const fail = (message, field) => {
  throw new HttpError(400, 'validation_error', message, field ? { field } : undefined);
};
const str = (v, field) => (typeof v === 'string' ? v : fail(`${field} must be text.`, field));
const CONTROL = /[\u0000-\u001f\u007f]/;

export function username(v) {
  const s = str(v, 'username').trim();
  if (!/^[A-Za-z0-9_]{3,20}$/.test(s)) fail('Username must be 3-20 characters: letters, numbers or underscores.', 'username');
  return s;
}
export function password(v, uname) {
  const s = str(v, 'password');
  if (s.length < 8 || s.length > 128) fail('Password must be 8-128 characters.', 'password');
  if (uname && s.toLowerCase() === String(uname).toLowerCase()) fail('Password must not be the same as your username.', 'password');
  return s;
}
export function displayName(v) {
  const s = str(v, 'displayName').trim().replace(/\s+/g, ' ');
  if (s.length < 1 || s.length > 50 || CONTROL.test(s)) fail('Name must be 1-50 characters with no special control characters.', 'displayName');
  return s;
}
export function avatarUrl(v) {
  if (v === null || v === '') return null;
  const s = str(v, 'avatarUrl').trim();
  if (s.length > 500) fail('Picture link is too long.', 'avatarUrl');
  let u;
  try { u = new URL(s); } catch { return fail('Picture must be a valid link.', 'avatarUrl'); }
  if (u.protocol !== 'https:') fail('Picture link must start with https://', 'avatarUrl');
  return u.toString();
}
export function messageBody(v) {
  const t = str(v, 'message').replace(/\r\n/g, '\n').trim();
  if (!t) fail('Message cannot be empty.', 'body');
  if (t.length > 2000) fail('Message is too long (max 2000 characters).', 'body');
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(t)) fail('Message contains invalid characters.', 'body');
  return t;
}
export function intId(v, field = 'id') {
  const n = typeof v === 'string' && /^\d{1,12}$/.test(v) ? Number(v) : v;
  if (!Number.isSafeInteger(n) || n < 1) fail(`Invalid ${field}.`, field);
  return n;
}
export function clientId(v) {
  if (v === undefined || v === null) return null;
  const s = str(v, 'clientId');
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(s)) fail('Invalid clientId.', 'clientId');
  return s;
}
export function meetingTitle(v) {
  if (v === undefined || v === null || v === '') return 'Untitled meeting';
  const s = str(v, 'title').trim();
  if (s.length > 80 || CONTROL.test(s)) fail('Meeting title must be at most 80 characters.', 'title');
  return s || 'Untitled meeting';
}
export const MEETING_EXPIRIES = [30, 60, 1440, 10080];
export function expiresMinutes(v) {
  const n = v === undefined || v === null ? 60 : Number(v);
  if (!MEETING_EXPIRIES.includes(n)) fail(`Expiry must be one of: ${MEETING_EXPIRIES.join(', ')} minutes.`, 'expiresInMinutes');
  return n;
}
export function bool(v, field, dflt) {
  if (v === undefined) return dflt;
  if (typeof v !== 'boolean') fail(`${field} must be true or false.`, field);
  return v;
}
// Returns null (treated as "not found") instead of throwing, so bad codes look like unknown codes.
export const meetingCode = (v) => (typeof v === 'string' && /^[A-Za-z0-9_-]{22}$/.test(v) ? v : null);
export const uuid = (v) => (typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(v) ? v : null);

// WebRTC signaling payloads. Only an SDP description or one ICE candidate is allowed.
export function signal(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new HttpError(400, 'invalid_signal', 'Invalid signal.');
  if (data.description !== undefined) {
    const d = data.description;
    if (!d || typeof d !== 'object' || !['offer', 'answer'].includes(d.type) || typeof d.sdp !== 'string' || d.sdp.length > 60000) {
      throw new HttpError(400, 'invalid_signal', 'Invalid session description.');
    }
    return { description: { type: d.type, sdp: d.sdp } };
  }
  if (data.candidate !== undefined) {
    const c = data.candidate;
    if (!c || typeof c !== 'object' || typeof c.candidate !== 'string' || c.candidate.length > 2000) {
      throw new HttpError(400, 'invalid_signal', 'Invalid ICE candidate.');
    }
    return {
      candidate: {
        candidate: c.candidate,
        sdpMid: typeof c.sdpMid === 'string' ? c.sdpMid.slice(0, 64) : null,
        sdpMLineIndex: Number.isInteger(c.sdpMLineIndex) ? c.sdpMLineIndex : null,
        usernameFragment: typeof c.usernameFragment === 'string' ? c.usernameFragment.slice(0, 128) : null,
      },
    };
  }
  throw new HttpError(400, 'invalid_signal', 'Invalid signal.');
}
