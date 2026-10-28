# VYNKO security notes

## What is implemented (and where)

| Area | Implementation |
|---|---|
| Passwords | scrypt (N=16384, r=8, p=1), 16-byte random salt, constant-time compare (`server/auth.mjs`). Never stored or logged in plain text. Unknown-user logins perform a dummy hash so timing doesn't reveal valid usernames. |
| Sessions | 256-bit random token in an **HttpOnly, SameSite=Lax** cookie (**Secure** automatically on https). The database stores only `HMAC-SHA256(SESSION_SECRET, token)`, so a leaked DB can't be replayed. 30-day expiry; logout deletes the row and disconnects that session's sockets. |
| Authorization | Every REST route and every Socket.IO event derives the user from the session. Messages are only ever read through the caller's own conversation pair; calls can only be accepted/rejected by the intended callee and signaled by the two parties' sockets; meeting signaling requires proof of a participant row (session or secret guest token). Covered by tests. |
| CSRF | Mutating requests must come from an allowed `Origin` (or `Sec-Fetch-Site: same-origin`), must be `application/json`, plus SameSite cookies. |
| WebSockets | Handshake rejected unless `Origin` is allowed (prevents cross-site WebSocket hijacking); 64 KB message cap; per-socket event flood limit. |
| Input validation | Client **and** server (`server/validate.mjs`): usernames, names, https-only avatar links, message length/characters, meeting titles/expiries, strictly shaped WebRTC signals (SDP size-capped, only whitelisted fields relayed). |
| SQL injection | All SQL is parameterized; `LIKE` input is escaped. |
| Rate limiting | Login (per IP+username and per IP), registration, user search, adding contacts, messages, call invitations, meeting creation/info/join, and a global per-IP limit. |
| Meeting links | 128-bit random codes (22 chars), expiry (30 min – 7 days), revoke/end by host only, guests optional, invalid/malformed/unknown links return the same 404. |
| Headers | `X-Content-Type-Options`, `X-Frame-Options: DENY`, `Referrer-Policy`, `Permissions-Policy` (camera/mic only for own origin), `Cache-Control: no-store` on API. |
| Errors & logs | Clients get generic messages for unexpected errors; the server logs the route and error message only — never bodies, passwords, cookies or tokens. |
| Secrets | `.env` is git-ignored; `.env.example` has placeholders; config is validated at start-up; nothing secret is sent to frontend code (only `NEXT_PUBLIC_*` values are public). |
| Privacy | Online/last-seen can be hidden; blocking hides users from search, contacts, messaging and calling; account deletion removes all the user's data (cascade). |

## Honest limits / not done

* **No end-to-end encryption for messages.** Operators with database access can read them. Don't claim otherwise to users.
* **No Content-Security-Policy.** Next.js needs a nonce-based setup to do this properly; add one before handling sensitive data at scale.
* **TURN credentials are static** and visible to signed-in users/guests; use time-limited credentials for production (see README §6).
* **No e-mail verification, password reset, 2FA or account lockout** (rate limiting only).
* **Rate limiter is in memory** (resets on restart, single process).
* **Calls from non-contacts are blocked by design**: you must add someone as a contact before you can message or call them, and either side can block.
* Remote avatar images are loaded by the *viewer's* browser from whatever https URL a user sets (sent with `no-referrer`). That can reveal a viewer's IP to that image host. Replace with uploads + server-side storage in a later phase.
* This code has **not had an independent security review or penetration test**. Do one before real-world use.

## Deployment checklist

1. Serve only over HTTPS; set `APP_URL=https://…`; confirm the session cookie shows `Secure`.
2. Long random `SESSION_SECRET`; keep `.env` out of git and readable only by the service user (`chmod 600`).
3. `TRUST_PROXY=true` only behind your own proxy that sets `X-Forwarded-For`.
4. Run as a non-root user; keep Node.js and dependencies updated (`npm audit`).
5. Back up the SQLite database regularly; test a restore.
6. Firewall: expose 80/443 (and TURN ports only if self-hosting TURN). Don't expose the Node port directly.
