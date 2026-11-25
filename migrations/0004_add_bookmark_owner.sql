-- Bookmarks become private to the account that created them. SQLite cannot drop
-- the old column-level UNIQUE(url), so the table is rebuilt with uniqueness
-- scoped to (user_id, url).
CREATE TABLE bookmarks_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  -- Nullable only so pre-existing rows survive the migration when no account
  -- exists yet; such rows have no owner and are not visible to anyone.
  user_id INTEGER REFERENCES users (id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  title TEXT NOT NULL,
  tags TEXT NOT NULL DEFAULT '',
  memo TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (user_id, url)
);

-- Keep legacy rows private until an administrator verifies and assigns their owner (see USAGE.md).
INSERT INTO bookmarks_new (id, user_id, url, title, tags, memo, created_at, updated_at)
SELECT id, NULL, url, title, tags, memo, created_at, updated_at
FROM bookmarks;

DROP TABLE bookmarks;
ALTER TABLE bookmarks_new RENAME TO bookmarks;

CREATE INDEX IF NOT EXISTS idx_bookmarks_user_created_at ON bookmarks (user_id, created_at DESC);
