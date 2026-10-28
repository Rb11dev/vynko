# VYNKO — Talk More. Feel Closer.

A real-time communication web app: **audio calls, video calls, instant messaging and shareable meeting links**, built with Next.js, Socket.IO, WebRTC and SQLite. Original branding and design; free-first and open-source technologies only.

> **Read [STATUS.md](STATUS.md) first.** It is an honest list of what is implemented and exactly what has (and has *not yet*) been tested. In particular: this code was written in a sandbox with **no internet and no browser**, so you must run `npm install` and the manual tests in [TESTING.md](TESTING.md) before trusting browser calling.

---

## 1. Quick start (about 5 minutes)

**You need:** [Node.js](https://nodejs.org) **22.13 or newer** (check with `node -v`) and a modern browser (Chrome, Edge, Firefox, Safari).

```bash
cd vynko
npm install          # downloads dependencies (needs internet)
npm run setup        # creates your .env with a random SESSION_SECRET
npm run dev          # starts everything on http://localhost:3000
```

Open <http://localhost:3000>, click **Get Started**, and create an account.
To try a call you need **two users**: open a second browser (or a private/incognito window, or another browser profile), create a second account, add each other as contacts (Contacts → search username → Add), then press the phone or video button.

> `localhost` is treated as a *secure context* by browsers, so camera and microphone work there without HTTPS. On any other address (a phone on your Wi-Fi, a public domain) browsers **require HTTPS** for camera/mic. See §7.

### Commands

| Command | What it does |
|---|---|
| `npm run setup` | Creates `.env` from `.env.example` with a fresh random `SESSION_SECRET` (never overwrites an existing `.env`) |
| `npm run dev` | Development server (website + API + Socket.IO in one process) |
| `npm test` | Runs the automated tests (74 tests, no network or browser needed) |
| `npm run typecheck` | TypeScript check (needs `npm install` first) |
| `npm run check` | Tests + typecheck |
| `npm run build` | Production build of the website |
| `npm start` | Production server (run `npm run build` first) |
| `npm run db:migrate` | Create/upgrade the database without starting the server |

---

## 2. How it works (architecture)

One Node.js process does three jobs, so beginners only run one thing:

```
Browser ──HTTP──►  server/index.mjs ─┬─► REST API   (server/api.mjs)        accounts, contacts, messages, meetings, history
   │                                 ├─► Next.js    (src/app/...)           the website
   └──WebSocket (Socket.IO)────────► └─► Signaling  (server/realtime.mjs)   presence, call invites, WebRTC offer/answer/ICE
                                              │
                                              ▼
                                      SQLite file (data/vynko.db)

Browser A ◄═════ WebRTC audio/video (peer-to-peer, encrypted) ═════► Browser B
```

* **Signaling vs media.** The server only passes small "setup" messages (who is calling, SDP offers/answers, ICE candidates). The actual audio/video flows **directly between browsers** over WebRTC (via a TURN relay only if a direct path is impossible).
* **Identity** is always taken from the server-side session cookie. The server never trusts a user ID sent by the client.
* **All decisions live in plain, testable modules** (`server/services/*`). `realtime.mjs` and `api.mjs` are thin wrappers around them.

### Folder map

```
server/
  index.mjs            entry point: Next + API + Socket.IO
  config.mjs           reads .env, validates it, explains problems in plain English
  db.mjs, migrations/  SQLite (built-in node:sqlite) + numbered .sql migrations
  auth.mjs             scrypt password hashing, session tokens, cookies
  validate.mjs         input validation shared by REST and sockets
  ratelimit.mjs        in-memory rate limiter
  api.mjs              REST routes
  realtime.mjs         Socket.IO wiring (auth, events, presence)
  services/
    users.mjs          accounts, sessions, contacts, blocks, privacy
    messages.mjs       conversations, history, unread, delivery/read
    calls.mjs          server-side call state machine + call history
    meetings.mjs       meeting links + signaling hub for meeting rooms
    presence.mjs       which browser tabs are online
src/
  app/                 pages (landing, login, signup, chats, contacts, calls, meetings, settings, /m/[code])
  components/          UI kit, call overlay (incoming dialog + audio/video screens), meeting room…
  context/             React state: auth, realtime connection, chat, calls (WebRTC logic)
  lib/                 API client, socket client, WebRTC helpers
tests/                 automated tests (node:test)
scripts/               setup.mjs, migrate.mjs
```

### Dependencies (and why)

Install with `npm install`. Supported Node.js: **22.13+** (see `.nvmrc`; `node:sqlite` needs it).

| Package | Why |
|---|---|
| `next`, `react`, `react-dom` | the website |
| `socket.io`, `socket.io-client` | real-time signaling, presence, message push |
| `lucide-react` | icons |
| `tailwindcss`, `postcss`, `autoprefixer` (dev) | styling |
| `typescript`, `@types/*` (dev) | type checking |

Everything else uses Node.js built-ins: `node:sqlite` (database), `node:crypto` (password hashing, tokens), `node:http` (API), `node:test` (tests). **No paid APIs, no AI services, no native add-ons to compile.**

---

## 3. Configuration (`.env`)

`npm run setup` creates `.env` for you. The server **checks it at start-up** and tells you exactly what is wrong. Never commit `.env` (it is in `.gitignore`).

| Variable | Required? | Meaning / what happens if missing |
|---|---|---|
| `SESSION_SECRET` | **Yes** (32+ chars) | Protects sessions. Missing → server refuses to start with instructions. Changing it logs everyone out. |
| `APP_URL` | Recommended | Public address, no trailing slash. Defaults to `http://localhost:<PORT>`. Used for origin checks and secure-cookie default. |
| `PORT` | No (3000) | Port to listen on. |
| `DATABASE_PATH` | No (`./data/vynko.db`) | SQLite file location. |
| `STUN_URLS` | No | STUN servers (comma separated). Default is a public Google STUN server. Not a guarantee every call connects. |
| `TURN_URL`, `TURN_USERNAME`, `TURN_CREDENTIAL` | Optional, all-or-none | TURN relay. Without it you get a startup warning: calls work on most home networks but can fail on strict firewalls / some mobile networks. |
| `ALLOWED_ORIGINS` | No | Extra allowed browser origins. Default: `APP_URL`. |
| `TRUST_PROXY` | No (false) | `true` **only** behind your own reverse proxy so rate limiting sees real client IPs. |
| `COOKIE_SECURE` | No | Force the cookie `Secure` flag. Default: on when `APP_URL` starts with `https://`. |
| `NEXT_PUBLIC_SIGNALING_URL` | No | Only if signaling lives on another address (not recommended — see §8). |

Generate a secret by hand: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`

---

## 4. Database

* **SQLite** file at `DATABASE_PATH`. Created automatically on first start (or with `npm run db:migrate`).
* **Migrations:** every file in `server/migrations/` named `NNN_description.sql` is applied once, in order, inside a transaction, and recorded in the `schema_migrations` table. To change the schema, add a new file such as `002_add_something.sql` — never edit an applied one.
* **Schema:** `users, sessions, contacts, blocks, conversations, messages, calls, meetings, meeting_participants` with foreign keys, `CHECK` constraints and indexes (see `001_init.sql`). All queries are parameterized.
* **Backups:** the database runs in WAL mode, so don't just copy the `.db` file while the server runs. Use `sqlite3 data/vynko.db ".backup 'backup-YYYY-MM-DD.db'"` (install the `sqlite3` command-line tool) or stop the server and copy `vynko.db`, `-wal` and `-shm` together. Back up regularly and store copies off the server.
* **Scaling later:** SQLite is ideal for one server. If you outgrow it, the queries are plain SQL isolated in `server/services/*`, so moving to PostgreSQL means swapping `db.mjs` and adjusting a few SQL details. Real-time state (presence, active calls, rate limits) lives in memory, so more than one server process would also need a shared store such as Redis.

---

## 5. Security summary

Full notes in [SECURITY.md](SECURITY.md). Highlights: scrypt-hashed passwords; random session tokens stored only as HMACs; HttpOnly + SameSite cookies (+ Secure on HTTPS); server-side authorization on every REST and socket event; Origin checks (CSRF and WebSocket hijacking); strict input validation; rate limiting on login, registration, searches, messages, call invites and meetings; unguessable 128-bit meeting codes.

**Be clear with your users:** text messages are **not end-to-end encrypted** (HTTPS protects them in transit; the server stores them). WebRTC call media *is* encrypted between browsers.

---

## 6. STUN and TURN

WebRTC needs help to find a path between two browsers:

* **STUN** (cheap, default `stun.l.google.com`) tells each browser its public address. Works for many home networks.
* **TURN** *relays* the media when a direct path is impossible (strict corporate Wi-Fi, symmetric NAT, some mobile carriers). It uses real bandwidth, so it is **not free to run** — either rent a TURN service or host your own.

To enable TURN, set `TURN_URL`, `TURN_USERNAME`, `TURN_CREDENTIAL` in `.env` and restart. Self-hosting option: [coturn](https://github.com/coturn/coturn) on a small VPS with a public IP. A minimal `turnserver.conf` looks like this (adapt it and read the coturn docs; open UDP/TCP 3478 and the relay port range in your firewall, and use TLS on 5349 for `turns:`):

```
listening-port=3478
fingerprint
lt-cred-mech
realm=turn.yourdomain.com
user=vynkouser:A-LONG-RANDOM-PASSWORD
```

Limitation to know: these are **static** credentials sent to signed-in users' browsers (and meeting guests). Anyone with them can use your relay. For production, switch to time-limited credentials (coturn's `use-auth-secret` / REST API) generated in `realtime.mjs` where `config.iceServers` is returned.

---

## 7. HTTPS (required for real deployments)

Browsers only allow `getUserMedia` (camera/microphone) on **secure contexts**: `https://` pages and `http://localhost`. So:

* Local development on your own computer: `http://localhost:3000` is fine.
* Testing from a phone or another computer, or deploying publicly: you **must** serve the site over HTTPS, or camera/mic will be blocked (VYNKO shows a clear message when this happens).

Easiest HTTPS: put a reverse proxy that handles certificates in front of the app. With [Caddy](https://caddyserver.com) (automatic Let's Encrypt certificates, WebSockets work out of the box):

```
vynko.yourdomain.com {
    reverse_proxy localhost:3000
}
```

Then in `.env`: `APP_URL=https://vynko.yourdomain.com` and `TRUST_PROXY=true`. (With nginx you must forward WebSocket headers: `proxy_http_version 1.1; proxy_set_header Upgrade $http_upgrade; proxy_set_header Connection "upgrade";` and set `X-Forwarded-For`.)

---

## 8. Deploying

VYNKO needs a host that provides **(a) a long-running Node.js process, (b) persistent WebSocket connections, and (c) a persistent disk** for the SQLite file.

| Hosting type | Works? |
|---|---|
| A VPS / virtual machine (any provider) running Node 22 | ✅ Simplest and most predictable |
| Container/PaaS hosts (Fly.io, Railway, Render, etc.) | ✅ *if* the plan supports WebSockets **and a persistent volume** — **check the provider's current docs and pricing**; free tiers often sleep or have ephemeral disks |
| Static hosting (GitHub Pages, Netlify static, S3) | ❌ cannot run the server |
| Serverless platforms (e.g. Vercel functions) | ❌ no persistent WebSockets or disk for this design |

Steps on a VPS:

1. Install Node 22+, copy the project, `npm install`.
2. `npm run setup`, then edit `.env`: set `APP_URL` (your https domain), `TRUST_PROXY=true`, TURN settings.
3. `npm run build`
4. Run it with a process manager so it restarts automatically, e.g. systemd:
   ```ini
   [Unit]
   Description=VYNKO
   After=network.target
   [Service]
   WorkingDirectory=/opt/vynko
   ExecStart=/usr/bin/node --disable-warning=ExperimentalWarning server/index.mjs --prod
   Restart=always
   User=vynko
   [Install]
   WantedBy=multi-user.target
   ```
5. Put Caddy (or nginx) in front for HTTPS (§7) and open ports 80/443 (+ TURN ports if you self-host TURN).
6. Schedule database backups (§4).

**Frontend and backend separately?** This project is built as *one deployable unit* (the website, API and signaling share one origin so login cookies "just work"). Splitting them is possible (`NEXT_PUBLIC_SIGNALING_URL`, `ALLOWED_ORIGINS`) but cookies then become cross-site and need `SameSite=None; Secure` plus code changes, so it is **not supported out of the box**. If you want a managed database later, that is also a code change (see §4).

---

## 9. Limitations you should know about

* **Calls only ring while the recipient has VYNKO open in a browser tab** (and the socket is connected). If the browser is closed, the device is offline, or the tab is asleep, nothing rings; the caller is told the person is offline and the callee sees a **missed call** in history. There is **no push-notification infrastructure** (that needs a push service, service workers and VAPID keys — a later phase).
* Meetings support **two participants** today. The signaling is keyed by participant ID (mesh-ready), but group calls are **not implemented** and not advertised.
* No screen sharing, file attachments, reactions, password reset by e-mail, or multiple languages yet.
* Profile pictures are an `https://` image link (no upload yet).
* Rate limiting and presence are in-memory: one server process only.

## 10. Troubleshooting

| Problem | Fix |
|---|---|
| "VYNKO cannot start because of configuration problems" | Read the listed items; run `npm run setup` |
| "Dependencies are not installed yet" | Run `npm install` |
| `node:sqlite` errors / "Cannot find module" | Upgrade to Node **22.13+** (`node -v`) |
| Camera/mic blocked or "needs HTTPS" | Use `http://localhost:3000` or HTTPS (§7) |
| "Permission denied" for camera | Click the lock icon by the address bar → allow camera & microphone |
| Call stays on "Connecting…" then fails | Network needs a TURN relay (§6) |
| Port already in use | Change `PORT` in `.env` and `APP_URL` to match |
