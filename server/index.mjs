// VYNKO server: Next.js website + REST API + Socket.IO signaling in ONE process.
import http from 'node:http';
import { existsSync } from 'node:fs';
import { loadConfig, ConfigError } from './config.mjs';

if (existsSync('.env')) process.loadEnvFile('.env');
const prod = process.argv.includes('--prod') || process.env.NODE_ENV === 'production';
process.env.NODE_ENV = prod ? 'production' : 'development';

let config;
try {
  config = loadConfig(process.env, { prod });
} catch (err) {
  if (err instanceof ConfigError) { console.error(err.message); process.exit(1); }
  throw err;
}

let next, Server;
try {
  ({ default: next } = await import('next'));
  ({ Server } = await import('socket.io'));
} catch (err) {
  if (err.code === 'ERR_MODULE_NOT_FOUND') {
    console.error('\nDependencies are not installed yet. Run:  npm install\n');
    process.exit(1);
  }
  throw err;
}
const { openDb } = await import('./db.mjs');
const { createApp } = await import('./app.mjs');
const { attachRealtime } = await import('./realtime.mjs');

for (const w of config.warnings) console.warn(`[config] ${w}`);

const db = openDb(config.databasePath);
const app = createApp({ config, db });
const recovered = app.callManager.recoverOrphans();
if (recovered) console.warn(`[calls] marked ${recovered} unfinished call(s) from the previous run as failed.`);

let handleNext;
const server = http.createServer(async (req, res) => {
  try {
    if (await app.api.handle(req, res)) return;
    handleNext(req, res);
  } catch (err) {
    console.error('[http] unexpected error:', err?.message);
    if (!res.headersSent) { res.statusCode = 500; res.end('Server error'); }
  }
});

const nextApp = next({ dev: !prod, dir: process.cwd(), hostname: 'localhost', port: config.port, httpServer: server });
handleNext = nextApp.getRequestHandler();
await nextApp.prepare();

const io = new Server(server, {
  cors: { origin: [...config.allowedOrigins], credentials: true },
  maxHttpBufferSize: 64 * 1024,
  destroyUpgrade: false, // lets Next.js hot-reload keep its own WebSocket in development
  // Only accept browsers whose Origin we trust (blocks cross-site WebSocket hijacking).
  allowRequest: (req, cb) => cb(null, !!req.headers.origin && config.allowedOrigins.has(req.headers.origin)),
});
attachRealtime({ io, app });

setInterval(() => app.users.pruneSessions(), 3600_000).unref();

server.listen(config.port, () => {
  console.log(`\nVYNKO is running (${prod ? 'production' : 'development'}) at ${config.appUrl}\n`);
});

const shutdown = () => {
  console.log('\nShutting down...');
  io.close(() => { server.close(() => { db.close(); process.exit(0); }); });
  setTimeout(() => process.exit(0), 3000).unref();
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
