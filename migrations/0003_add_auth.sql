-- Accounts that can sign in with an email address and password.
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  -- Emails are stored normalized (trimmed + lower-cased) so login lookups and
  -- the UNIQUE constraint treat "User@Example.com" and "user@example.com" alike.
  email TEXT NOT NULL UNIQUE,
  -- Never the plain password: this holds a salted scrypt hash (see auth.ts).
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- One row per active login. The browser cookie carries the raw session token;
-- only its SHA-256 hash is stored here so a database leak cannot reveal a usable
-- token.
CREATE TABLE IF NOT EXISTS sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  token_hash TEXT NOT NULL UNIQUE,
  user_id INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  -- ISO-8601 UTC text, compared lexicographically against the current time.
  expires_at TEXT NOT NULL,
  -- Deleting a user removes their sessions too.
  FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
);

-- Every authenticated request looks a session up by its token hash.
CREATE INDEX IF NOT EXISTS idx_sessions_token_hash ON sessions (token_hash);
-- Speeds up expiry cleanup.
CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions (expires_at);
