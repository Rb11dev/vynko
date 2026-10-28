-- VYNKO initial schema. Times are milliseconds since the Unix epoch.

CREATE TABLE users (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  username       TEXT NOT NULL UNIQUE COLLATE NOCASE CHECK (length(username) BETWEEN 3 AND 20),
  display_name   TEXT NOT NULL CHECK (length(display_name) BETWEEN 1 AND 50),
  password_hash  TEXT NOT NULL,
  avatar_url     TEXT CHECK (avatar_url IS NULL OR length(avatar_url) <= 500),
  show_online    INTEGER NOT NULL DEFAULT 1 CHECK (show_online IN (0, 1)),
  show_last_seen INTEGER NOT NULL DEFAULT 1 CHECK (show_last_seen IN (0, 1)),
  last_seen_at   INTEGER,
  created_at     INTEGER NOT NULL
);

-- "id" is an HMAC of the session token, so a leaked database cannot be used to log in.
CREATE TABLE sessions (
  id         TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  user_agent TEXT
);
CREATE INDEX idx_sessions_user ON sessions(user_id);
CREATE INDEX idx_sessions_expires ON sessions(expires_at);

-- One-directional: "user_id has added contact_id".
CREATE TABLE contacts (
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  contact_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, contact_id),
  CHECK (user_id <> contact_id)
);
CREATE INDEX idx_contacts_contact ON contacts(contact_id);

CREATE TABLE blocks (
  blocker_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  blocked_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (blocker_id, blocked_id),
  CHECK (blocker_id <> blocked_id)
);
CREATE INDEX idx_blocks_blocked ON blocks(blocked_id);

-- One conversation per pair of users; user_a is always the smaller id.
CREATE TABLE conversations (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  user_a          INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  user_b          INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at      INTEGER NOT NULL,
  last_message_at INTEGER,
  UNIQUE (user_a, user_b),
  CHECK (user_a < user_b)
);
CREATE INDEX idx_conversations_b ON conversations(user_b);

CREATE TABLE messages (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  sender_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body            TEXT NOT NULL CHECK (length(body) BETWEEN 1 AND 2000),
  client_id       TEXT,
  created_at      INTEGER NOT NULL,
  delivered_at    INTEGER,
  read_at         INTEGER
);
CREATE INDEX idx_messages_conv ON messages(conversation_id, id);
-- Lets a client safely retry a send without creating a duplicate.
CREATE UNIQUE INDEX idx_messages_dedupe ON messages(sender_id, client_id) WHERE client_id IS NOT NULL;
CREATE INDEX idx_messages_unread ON messages(conversation_id, sender_id) WHERE read_at IS NULL;

-- A row exists from the moment of the invitation. "result" stays NULL while the call
-- is live and is set exactly once when it finishes. (Rows left NULL by a crash are
-- marked "failed" at the next start-up.)
CREATE TABLE calls (
  id           TEXT PRIMARY KEY,
  caller_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  callee_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type         TEXT NOT NULL CHECK (type IN ('audio', 'video')),
  created_at   INTEGER NOT NULL,
  connected_at INTEGER,
  ended_at     INTEGER,
  result       TEXT CHECK (result IS NULL OR result IN ('completed', 'missed', 'rejected', 'cancelled', 'failed', 'busy'))
);
CREATE INDEX idx_calls_caller ON calls(caller_id, created_at);
CREATE INDEX idx_calls_callee ON calls(callee_id, created_at);

CREATE TABLE meetings (
  id               TEXT PRIMARY KEY,
  code             TEXT NOT NULL UNIQUE,
  host_id          INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title            TEXT NOT NULL,
  allow_guests     INTEGER NOT NULL DEFAULT 1 CHECK (allow_guests IN (0, 1)),
  max_participants INTEGER NOT NULL DEFAULT 2 CHECK (max_participants BETWEEN 2 AND 8),
  created_at       INTEGER NOT NULL,
  expires_at       INTEGER NOT NULL,
  revoked_at       INTEGER,
  ended_at         INTEGER
);
CREATE INDEX idx_meetings_host ON meetings(host_id, created_at);

CREATE TABLE meeting_participants (
  id           TEXT PRIMARY KEY,
  meeting_id   TEXT NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
  user_id      INTEGER REFERENCES users(id) ON DELETE CASCADE,
  display_name TEXT NOT NULL,
  role         TEXT NOT NULL CHECK (role IN ('host', 'participant')),
  token_hash   TEXT,
  joined_at    INTEGER NOT NULL,
  left_at      INTEGER,
  CHECK (user_id IS NOT NULL OR token_hash IS NOT NULL)
);
CREATE INDEX idx_participants_meeting ON meeting_participants(meeting_id);
CREATE INDEX idx_participants_user ON meeting_participants(meeting_id, user_id);
