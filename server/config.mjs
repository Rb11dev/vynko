// Reads and validates environment variables. Fails fast with friendly messages.
export class ConfigError extends Error {}

export function loadConfig(env = process.env, { prod = env.NODE_ENV === 'production' } = {}) {
  const errors = [];
  const warnings = [];
  const list = (v) => (v || '').split(',').map((s) => s.trim()).filter(Boolean);

  const portRaw = env.PORT || '3000';
  const port = Number(portRaw);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    errors.push(`PORT must be a number between 1 and 65535 (got "${portRaw}").`);
  }

  const appUrl = (env.APP_URL || `http://localhost:${portRaw}`).replace(/\/+$/, '');
  let appOrigin = appUrl;
  try {
    appOrigin = new URL(appUrl).origin;
  } catch {
    errors.push(`APP_URL is not a valid URL (got "${appUrl}"). Example: http://localhost:3000`);
  }
  if (prod && !appUrl.startsWith('https://')) {
    warnings.push('APP_URL is not https://. Browsers only allow camera/microphone on https:// or localhost, so public calls will not work without HTTPS.');
  }

  const secret = env.SESSION_SECRET || '';
  if (!secret) {
    errors.push('SESSION_SECRET is missing. Run "npm run setup" to generate one, or set a random value of 32+ characters in .env.');
  } else if (secret.length < 32) {
    errors.push('SESSION_SECRET is too short. Use at least 32 random characters (see .env.example for a command that generates one).');
  } else if (/change[-_ ]?me|placeholder|your[-_ ]?secret/i.test(secret)) {
    errors.push('SESSION_SECRET still looks like a placeholder. Replace it with a random value.');
  }

  const stunUrls = list(env.STUN_URLS ?? 'stun:stun.l.google.com:19302');
  for (const u of stunUrls) {
    if (!/^stuns?:/i.test(u)) errors.push(`STUN_URLS entry "${u}" must start with stun: or stuns:.`);
  }
  if (stunUrls.length === 0) warnings.push('No STUN server configured. Calls between different networks will likely fail.');

  const turnUrls = list(env.TURN_URL);
  const turnUser = env.TURN_USERNAME || '';
  const turnCred = env.TURN_CREDENTIAL || '';
  const turnParts = [turnUrls.length > 0, !!turnUser, !!turnCred].filter(Boolean).length;
  if (turnParts > 0 && turnParts < 3) {
    errors.push('TURN is partly configured. Set TURN_URL, TURN_USERNAME and TURN_CREDENTIAL together, or leave all three empty.');
  }
  for (const u of turnUrls) {
    if (!/^turns?:/i.test(u)) errors.push(`TURN_URL entry "${u}" must start with turn: or turns:.`);
  }
  const hasTurn = turnParts === 3;
  if (!hasTurn) {
    warnings.push('TURN is not configured. Calls work on most home networks, but may fail on strict firewalls or some mobile networks. See README > "STUN and TURN".');
  }

  const dev = !prod;
  const allowedOrigins = new Set(list(env.ALLOWED_ORIGINS));
  allowedOrigins.add(appOrigin);
  if (dev) {
    allowedOrigins.add(`http://localhost:${port}`);
    allowedOrigins.add(`http://127.0.0.1:${port}`);
  }

  const cookieSecure = env.COOKIE_SECURE ? env.COOKIE_SECURE === 'true' : appUrl.startsWith('https://');

  if (errors.length) {
    throw new ConfigError(
      ['', 'VYNKO cannot start because of configuration problems:', ...errors.map((e) => `  - ${e}`), '', 'Fix them in your .env file (see .env.example), then start again.', ''].join('\n')
    );
  }

  const iceServers = [];
  if (stunUrls.length) iceServers.push({ urls: stunUrls });
  if (hasTurn) iceServers.push({ urls: turnUrls, username: turnUser, credential: turnCred });

  return Object.freeze({
    prod,
    port,
    appUrl,
    secret,
    databasePath: env.DATABASE_PATH || './data/vynko.db',
    iceServers,
    hasTurn,
    allowedOrigins,
    cookieSecure,
    trustProxy: env.TRUST_PROXY === 'true',
    warnings,
  });
}
