# VYNKO testing guide

Two kinds of checks, kept strictly separate:

1. **Automated tests** (`npm test`) — run by a script, no browser needed. They prove the server logic.
2. **Manual tests** (below) — *you* do these with two browser sessions. **Nothing in section 2 has been run by the author.** Browser audio/video can only be verified by a human with a camera, microphone and speakers.

---

## 1. Automated tests (`npm test`) — 74 tests

| File | Tests | What it proves |
|---|---|---|
| `config-validate.test.mjs` | 9 | Start-up config errors/warnings (missing secret, partial TURN, bad URLs); input validation rules; signaling payload whitelisting; rate limiter |
| `auth-users.test.mjs` | 9 | scrypt hashing, cookies, registration/duplicates, login (same error for wrong password/unknown user), sessions (expiry, token stored only as HMAC), user search + block hiding, contact/block rules, presence privacy, account deletion cascade |
| `messages.test.mjs` | 8 | Persistence, ordering, pagination, **private-conversation authorization**, contact/block rules, unread counts, read receipts, "delivered" only on real confirmation, retry de-duplication, spam limit, search, validation |
| `calls.test.mjs` | 16 | Invitations ring all tabs, multi-tab "first accept wins", **only the intended recipient can accept/reject**, only caller can cancel, busy / offline / timeout / cancel / reject, **offer/answer/ICE relay only between the two parties**, call counted "connected" only when *both* browsers report it, connect-timeout, failure, disconnect cleanup, call history privacy and statuses, crash recovery |
| `meetings.test.mjs` | 9 | Unguessable codes, invalid/expired/revoked/ended links, host-only end/revoke, guest rules + tokens, participant identity proof, 2-person room cap, signal relay with server-set sender, leave/end cleanup, same-participant multi-tab |
| `api.test.mjs` | 14 | **Real HTTP server**: register/login/logout/cookies, 401s, CSRF/origin checks, security headers, size/type limits, login + registration rate limiting, search→contact→message→read flow, third-user lockout, blocking, profile/privacy, meeting lifecycle, call-history privacy, account deletion |
| `realtime.test.mjs` | 9 | `realtime.mjs` against a **fake Socket.IO**: cookie authentication, anonymous/forged sockets refused, spoofed identity ignored, presence + privacy, a full call through sockets, tab-close cleanup, ack handling, message delivery acks, logout/delete disconnects, guest meeting join with ICE |

**Not covered by automation** (needs real dependencies/browsers): the real `socket.io` library, Next.js rendering/build, React components, and WebRTC media. See STATUS.md.

---

## 2. Manual test plan (two browsers)

### Setup
1. `npm install && npm run setup && npm run dev`.
2. **Session A:** normal Chrome window → <http://localhost:3000>.
   **Session B:** a *separate* session: Chrome Incognito, another browser, or another browser profile (cookies must not be shared).
3. Use headphones or mute one side to avoid audio feedback when both are on one computer.
4. *Testing on a phone/second computer:* camera/mic need **HTTPS** there. Use a real HTTPS deployment, or a tunnelling tool (third-party; check its terms), or for throw-away dev only Chrome's `chrome://flags/#unsafely-treat-insecure-origin-as-secure`. Do **not** use that flag for real use.

Record **Pass / Fail / Notes** for each row.

### A. Accounts & contacts
| # | Steps | Expected | Result |
|---|---|---|---|
| A1 | A: Sign up `alice_t` / "Alice" / 8+ char password | Lands on Chats; no password shown anywhere | |
| A2 | B: Sign up `bob_t` | Same | |
| A3 | A: sign up again with `alice_t` (new private window) | "That username is already taken." | |
| A4 | Sign up with `ab` / short password | Inline validation errors, nothing submitted | |
| A5 | Log out, log in with wrong password | "Invalid username or password." (same text for unknown user) | |
| A6 | Log in 9+ times quickly with wrong password | A "Too many requests" message appears (rate limit) | |
| A7 | A: Contacts → search `bob` → Add | Bob appears under Your contacts | |
| A8 | B: Contacts | Alice is **not** auto-added; B can search and add her | |
| A9 | Refresh page / close and reopen tab | Still logged in (session persists) | |
| A10 | Open `/chats` in a logged-out window | Redirected to Log in | |

### B. Messaging
| # | Steps | Expected | Result |
|---|---|---|---|
| B1 | A → open chat with Bob, send "hi" | Bubble shows a clock briefly, then ✓ (sent) | |
| B2 | B has Chats open | Message appears **instantly** without refresh; unread badge (list + browser tab title) shows 1 | |
| B3 | A watches ticks | ✓ → ✓✓ (delivered) once B's browser received it | |
| B4 | B opens the conversation | Unread clears; A sees ✓✓ turn pink/"read" | |
| B5 | Enter sends; Shift+Enter adds a new line | As described | |
| B6 | Send 2000+ characters / empty message | Blocked / not sendable | |
| B7 | Send ~25 messages in a few seconds | Eventually "sending too fast" error; failed bubble offers retry | |
| B8 | Reload page | Full history is still there (persisted) | |
| B9 | Send 40+ messages then scroll to top | "Load earlier messages" loads older ones without jumping | |
| B10 | Search box in Chats: part of a name, then a word from a message | Conversation filters | |
| B11 | Stop the server, send a message | Banner "offline"; message shows **failed** with retry; restart server, retry works; no duplicate | |
| B12 | **Privacy:** log in as a third user C, try `http://localhost:3000/api/messages/with/<A's id>` | Returns only C's own (empty) history, never A↔B messages | |

### C. Audio call (the main feature)
| # | Steps | Expected | Result |
|---|---|---|---|
| C1 | A → Bob → phone button; allow microphone | A sees "Calling… / Ringing…" | |
| C2 | B | Full-screen incoming call dialog with A's name; ringtone may play (browsers can block autoplay) | |
| C3 | B → Accept (allow mic) | Both show "Connecting…" then a running **timer**. Not "connected" until real audio path is up | |
| C4 | Speak on each side | **Hear each other** (real audio) | |
| C5 | A mutes | B no longer hears A; A's button shows muted; unmute restores | |
| C6 | A ends call | Both screens close; mic indicator in browser tab disappears (resources released) | |
| C7 | History page on both | One entry each: Outgoing/Incoming, Completed, duration | |
| C8 | A calls, B → Decline | A sees "Call declined"; history shows "Declined" on both sides (Outgoing for A, Incoming for B) | |
| C9 | A calls, B ignores 30 s | A: "No answer"; B's dialog closes; history: A "No answer", B "Missed" | |
| C10 | A calls then cancels before answer | B's dialog disappears; B history: Missed | |
| C11 | B on a call with A; C calls B (needs a 3rd session) | C told B is busy | |
| C12 | B closes the tab (no hang-up) during a call | A sees the call end ("lost connection") within seconds; A's mic released | |
| C13 | B has **two tabs** open; A calls | Both tabs ring; accept in one → other tab's dialog closes ("answered on another device") | |
| C14 | Block mic permission in the browser, then place/accept a call | Clear permission message with steps; no call created | |
| C15 | Unplug/disable microphone, call | "No microphone was found" message | |
| C16 | Make a call while Bob's browser is fully closed | A: "Bob is offline…"; B later sees a Missed call in history | |

### D. Video call
| # | Steps | Expected | Result |
|---|---|---|---|
| D1 | A → video button; allow camera+mic | Local preview appears while ringing | |
| D2 | B accepts | Remote **live video** both ways; local preview in the corner | |
| D3 | Camera off/on (A) | B's view of A freezes/blank, local tile shows camera-off icon; turning on restores | |
| D4 | Mute/unmute | Works as in audio | |
| D5 | Fullscreen button | Call goes full screen and exits | |
| D6 | On a phone with 2 cameras: Switch camera | Front↔rear changes, call continues | |
| D7 | Turn Wi-Fi off for ~5 s then on (one side) | Status shows "Reconnecting…", then recovers; if not, a clear failure message with **Try again** | |
| D8 | Two devices on different networks (e.g. phone on mobile data) with **no TURN** configured | May fail to connect → expected; configure TURN (README §6) and retest | |
| D9 | End call | Camera light turns off on both devices | |

### E. Meetings & guests
| # | Steps | Expected | Result |
|---|---|---|---|
| E1 | A → Meetings → Create (1 hour, guests allowed) | Link shown; Copy link works | |
| E2 | B (guest, not logged in) opens the link | Waiting room: camera preview, mic/camera toggles, name field required | |
| E3 | A joins via "Join now"; B enters a name and joins | Each sees the other's video/audio; tiles say "Connecting…" until really connected | |
| E4 | A: a 3rd browser opens the link and joins | "This meeting is full…" | |
| E5 | B toggles mic/cam off in waiting room before joining | B enters muted/camera-off | |
| E6 | B clicks Leave | A sees B disappear; B can Rejoin | |
| E7 | A "End for all" | B sees "The host ended the meeting"; link now says ended | |
| E8 | Create another meeting; A clicks **Revoke**; open link | "This meeting link was revoked." | |
| E9 | Open `/m/garbage` and `/m/` + 22 random letters | "This meeting link is not valid." | |
| E10 | Create meeting with **Allow guests off**; open as guest | Told to log in | |
| E11 | Wait past expiry (use the 30-minute option or edit `expires_at` in the DB) | "This meeting link has expired." | |
| E12 | Stop the server during a meeting, restart | "Connection lost…" banner, then the room rebuilds automatically | |

### F. Profile, privacy, blocking
| # | Steps | Expected | Result |
|---|---|---|---|
| F1 | Settings: change display name & picture URL (`https://…`) | Updates everywhere on refresh; `http://` link rejected | |
| F2 | Turn off "Show when I'm online" | Contacts no longer see your green dot | |
| F3 | A blocks Bob | Bob can't message/call A; Bob no longer finds A in search | |
| F4 | Unblock | Messaging works again | |
| F5 | Delete account (wrong password, then right) | Wrong rejected; right → logged out; login fails; contacts lose them | |

### G. Mobile layout (Chrome DevTools → device toolbar, and ideally a real phone)
| # | Check | Expected | Result |
|---|---|---|---|
| G1 | 375×667 on `/` | No horizontal scroll; hero, preview, features stack cleanly | |
| G2 | Logged in on mobile | Bottom tab bar (5 tabs) instead of sidebar; Chats list full width | |
| G3 | Open a conversation | List hides, back arrow appears, bottom tabs hide, composer sits above the keyboard / safe area | |
| G4 | Incoming call + call screens | Controls reachable with a thumb; local preview doesn't cover controls | |
| G5 | Rotate to landscape | Call/meeting screens remain usable | |
| G6 | Dark/light toggle; "reduce motion" OS setting | Both themes readable; animations stop with reduce-motion | |

### H. Error and recovery states
| # | Check | Expected | Result |
|---|---|---|---|
| H1 | Stop the server while logged in | Red "offline/reconnecting" banner; returns when server restarts | |
| H2 | Visit `/nope` | 404 page | |
| H3 | Call a user while your socket is disconnected | "Could not reach the server" message, no stuck call UI | |

> Tip: DevTools → Network → throttling/offline and `chrome://webrtc-internals` help diagnose WebRTC problems.

---

## 3. Reporting results
Copy the tables into an issue/notes and mark each row. Anything failing in section C/D with *"Connecting…" then fail across different networks* is most likely a TURN requirement, not a bug.
