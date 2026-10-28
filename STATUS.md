# VYNKO — implementation status report

_Honest status as of the build session. Read this before running anything._

## 1. Environment limits of the build session

| Capability | Available? | Consequence |
|---|---|---|
| Node.js 22.22 | ✅ | Server code and tests were really executed |
| npm registry / internet | ❌ | **`npm install` was never run.** Next.js, React, Socket.IO, Tailwind, lucide were never installed |
| A web browser, camera, microphone | ❌ | **No page was ever rendered; no WebRTC call was ever made** |

## 2. What was actually verified

**✅ Executed and passing — `npm test`: 74 / 74 tests** (see TESTING.md §1 for the file-by-file list):
config validation, input validation, password hashing, sessions, user search/contacts/blocks/privacy, private-message authorization, message persistence/pagination/unread/delivered/read, the complete **server-side call state machine** (invite, ring, accept, reject, cancel, busy, offline, timeout, multi-tab, signaling authorization, connect confirmation, failure, disconnect cleanup, history), meeting links + guest tokens + signaling hub, the **real REST API over a real HTTP socket** (cookies, CSRF/origin, rate limits, security headers, authorization boundaries), and `realtime.mjs` driven through a **fake Socket.IO** server.

**✅ Executed manually in the sandbox:** `npm run setup` (creates `.env`, 64-hex secret, mode 600, never overwrites); start-up with no `.env` prints a plain-English config error; start-up without dependencies prints "run npm install"; `npm run db:migrate` creates the database and is idempotent; all 11 tables created by the migration.

**🟡 Partially verified:** all 33 TypeScript/TSX files **parse with zero syntax errors**, and they type-check under `strict` against *stub* declarations for React/Next/lucide/socket.io-client. That catches broken imports, wrong names and typos in our own code, but **not** type errors against the real React/Next types.

## 3. What has NOT been verified (be skeptical here)

* ❌ `npm install` / dependency version compatibility (versions are pinned: Next 14.2.15, React 18.3.1, Socket.IO 4.8.1, Tailwind 3.4.14, lucide-react 0.453.0, TypeScript 5.6.3 — chosen as a known-compatible set, but unconfirmed in this sandbox).
* ❌ `npm run typecheck` and `npm run build` against real packages — expect that you may need to fix a few type or Tailwind issues on first run.
* ❌ The custom server booting with real Next.js + Socket.IO (including the Next dev hot-reload WebSocket coexisting with Socket.IO; `destroyUpgrade:false` is set for that reason).
* ❌ **Every browser behaviour:** UI rendering/responsiveness, dark mode, navigation, forms, getUserMedia permission flows, **WebRTC audio and video, ICE restart/recovery, camera switching, fullscreen**, the WebAudio ringtone.
* ❌ Any test across real networks, NAT, or TURN.
* ❌ Accessibility audit, cross-browser testing (Safari/Firefox quirks), real mobile devices.

The server half of every call flow is tested; the browser half (`CallProvider.tsx`, `lib/webrtc.ts`, `MeetingExperience.tsx`) is written carefully but is **unrun code**. Use TESTING.md sections C–E to verify it.

## 4. Feature status against the brief

Legend: ✅ implemented · 🟡 implemented, browser part unrun · ⛔ not implemented (listed honestly)

| Area | Status | Notes |
|---|---|---|
| Branding, design system, dark/light, landing page | 🟡 | Original wordmark/logo, tokens in `globals.css`, all required landing sections. Never rendered. |
| Registration, login, logout, persistent sessions | ✅ server / 🟡 UI | Tested end to end over HTTP |
| Unique usernames, profile name, profile editing | ✅ / 🟡 | |
| Profile picture | 🟡 partial | `https://` link only; **no upload** |
| User search, contacts, block, account deletion | ✅ / 🟡 | |
| Presence + last seen + privacy controls | ✅ / 🟡 | |
| Server-side validation (+ client validation on forms) | ✅ / 🟡 | |
| One-to-one **audio** calling over WebRTC | 🟡 | Server flow ✅ tested; browser WebRTC unrun |
| One-to-one **video** calling over WebRTC | 🟡 | incl. camera toggle, mic mute, front/rear switch, fullscreen, ICE-restart recovery — unrun |
| Incoming call dialog, accept/reject, ringing/connecting/connected/ended, timer, busy/timeout/failure/cancel | ✅ server / 🟡 UI | "Connected" is shown only when `RTCPeerConnection.connectionState === 'connected'`, and the server counts it only when *both* sides report it |
| Multi-tab handling | ✅ server tested | |
| Signaling authorization & validation | ✅ | Tested, including spoofed identity and outsider injection |
| Real-time messaging, history, unread, search, pagination, status | ✅ server / 🟡 UI | "Sent" = stored; "Delivered" = recipient browser acknowledged; "Read" = conversation opened |
| Meetings: create, unguessable link, copy, join, guest name, preview, toggles, leave, end, revoke, expiry, permissions | ✅ server / 🟡 UI | **1-to-1 only** (cap of 2) |
| **Group calls** | ⛔ | Not implemented and not advertised. Signaling is keyed by participant id so a mesh can be added; `max_participants` column exists |
| Call history (types, direction, duration, statuses; privacy; no misleading incomplete records) | ✅ / 🟡 | Live calls are excluded until finished; crash leftovers marked `failed` |
| Pages: landing, signup, login, dashboard, contacts, conversation, audio/video screens, incoming dialog, meeting create, waiting room, room, settings, history, 404, error/connection states | 🟡 | All present |
| Mobile navigation | 🟡 | Dedicated bottom tab bar + one-pane chat flow; never viewed on a device |
| SQLite schema, constraints, indexes, migrations | ✅ | |
| Rate limiting, origin checks, secure cookies, safe errors, log hygiene | ✅ | See SECURITY.md |
| `.env.example`, start-up validation with friendly errors | ✅ | |
| STUN/TURN configurable (no hard-coded credentials) | ✅ | Static TURN creds caveat in README §6 |
| Deployment docs, HTTPS, backups | ✅ | README §7–8 |
| Screen sharing, attachments, reactions, push/browser notifications, multi-language | ⛔ | Later phase (architecture left open) |
| End-to-end encryption of messages | ⛔ | **Not implemented, not claimed** |
| Push notifications / ringing when browser closed | ⛔ | Documented limitation |

## 5. Known trade-offs and rough edges

* Messaging/calling requires the sender to have added the recipient as a contact (anti-spam); recipients see the sender's messages even if they haven't added them back.
* Calling an offline user records a **missed call** for them but cannot notify them.
* Switch-camera is available in 1:1 calls but **not** inside meeting rooms.
* The WebAudio ringtone may be silent if the browser blocks autoplay before any interaction.
* `reactStrictMode` is off on purpose (see `next.config.mjs`).
* No `package-lock.json` (could not be generated offline): `npm install` creates it — commit it.
* No Content-Security-Policy, no e-mail flows, no 2FA (see SECURITY.md).
* Rate limiting/presence/active calls are in memory → single server process.

## 6. Suggested first run (what I would do next)

1. `npm install` → `npm run check` (tests + real typecheck). Fix any type errors that appear.
2. `npm run build` (catches Tailwind/Next problems).
3. `npm run dev`, then work through TESTING.md **A → B → C → D → E**.
4. Configure TURN and retest across two different networks (D8).
5. Only then: deployment (README §8) and a security review (SECURITY.md).

## 7. Size

~2,400 lines of server + tests (`server/`, `tests/`) and ~2,200 lines of TypeScript/TSX (`src/`).
