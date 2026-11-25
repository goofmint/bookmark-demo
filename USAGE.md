# Usage Guide

This guide explains how to run and use the Bookmark Demo app locally.

## What This App Does

Bookmark Demo is a small personal bookmark web app with a local Node/Hono API.

You can:

- Add a bookmark by entering a URL.
- Edit a saved bookmark's URL, tags, and memo.
- Delete a saved bookmark after a confirmation dialog.
- Search bookmarks by URL, title, tags, or memo.
- See saved bookmarks in a newest-first paginated list.
- Store bookmark data in a local SQLite file.

## Install Dependencies

Use Node.js 22.5.0 or newer. This app uses `node:sqlite`, which is still marked
experimental by Node.js and may print an ExperimentalWarning at startup.

Run this once after cloning the repository:

```sh
npm install
```

## Run Locally

Start the API server and Vite client:

```sh
npm run dev
```

Open the Vite URL, usually:

```text
http://127.0.0.1:5173
```

The API server listens on:

```text
http://127.0.0.1:8787
```

## Local Storage

The server creates local data automatically:

```text
data/bookmarks.sqlite
```

Override the database path when needed:

```sh
BOOKMARK_DB_PATH=/tmp/bookmarks.sqlite npm run dev:server
```

<!-- coderabbit-ai-generated:v1 -->

<!-- coderabbit-ai-generated-section:v1:09a8a57eb10a6f546db4463bf38e0f8cf8f7afdc679b6c0c973a1a90e70232be -->

<!-- coderabbit-ai-generated:v1 -->

<!-- coderabbit-ai-generated-section:v1:c368424734444ca21d57f694584edcdd5010d1c8ae288909ef628064bed205a2 -->

SQL migrations in `migrations/` are applied automatically on server startup.

### Transfer bookmarks from before accounts

Before upgrading an existing database, stop the app and make a backup with
`sqlite3 /path/to/bookmarks.sqlite ".backup '/path/to/bookmarks-before-auth.sqlite'"`.
Use the configured database path, or `data/bookmarks.sqlite` by default.

Run the upgraded app with the API and UI reachable only by the administrator.
Create or sign in to the account that should own the legacy bookmarks and verify
its email. Stop the app again and back up the upgraded database before editing it.
Legacy rows remain hidden until assigned. If you ran an earlier version of
migration 0004, it may already have assigned rows to the earliest account. Audit
those rows against the pre-upgrade backup before exposing the app; the procedure
below only transfers rows that still have no owner.

Open the upgraded database with `sqlite3 /path/to/bookmarks.sqlite`. Inspect
`SELECT id, email FROM users;` and
`SELECT id, url FROM bookmarks WHERE user_id IS NULL ORDER BY id;`.
Run the following only if all listed bookmarks belong to the verified account.
Exit the interactive shell. Save the following as a local `transfer.sql` file,
replacing `owner@example.com` with its normalized email, and run it in a fresh
process: `sqlite3 /path/to/bookmarks.sqlite < transfer.sql`.

```sql
.bail on
PRAGMA foreign_keys = ON;
BEGIN IMMEDIATE;
CREATE TEMP TABLE transfer_owner (id INTEGER NOT NULL);
INSERT INTO transfer_owner VALUES ((SELECT id FROM users WHERE email = 'owner@example.com'));
UPDATE bookmarks
SET user_id = (SELECT id FROM transfer_owner)
WHERE user_id IS NULL;
SELECT changes() AS transferred_bookmarks;
DROP TABLE transfer_owner;
COMMIT;
```

If the account does not exist or a URL already belongs to that account, the
command stops without committing. Keep the app stopped and review the conflict
before retrying; do not discard either bookmark automatically. After a successful
transfer, restart privately, sign in as the chosen account, and verify the
bookmarks before granting access. To undo the transfer, stop the app and use
SQLite's `.restore` command on the configured database with the upgraded backup.
This restores the backup as a whole and discards later writes.

<!-- /coderabbit-ai-generated:v1 -->

<!-- /coderabbit-ai-generated:v1 -->

## Use the App

1. Open the app in your browser.
2. Enter a URL such as `https://example.com`.
3. Click `Add`.
4. The server fetches the page HTML and tries to read its `<title>`.
5. The bookmark is saved in SQLite and appears in the list.

Each page shows up to 10 bookmarks. Use `Previous` and `Next` to move through
pages.

Use the search box to filter bookmarks. Multiple words are split by spaces and
matched as AND search terms, so `sqlite hono` returns bookmarks that match both
`sqlite` and `hono` across the URL, title, tags, or memo.

To add tags or a memo, click `Edit`, update the fields, and click `Save`. To
remove a bookmark, click `Delete` and confirm the browser dialog.

If title fetching fails, the bookmark is still saved. In that case, the URL is
used as the title.

## API Endpoints

List bookmarks:

```sh
curl "http://localhost:8787/api/bookmarks?page=1&q=bookmark%20social"
```

Create a bookmark:

```sh
curl -X POST http://localhost:8787/api/bookmarks \
  -H "content-type: application/json" \
  -d '{"url":"https://example.com"}'
```

The app rejects duplicate normalized URLs with a `409` response.

## Useful Scripts

Run tests:

```sh
npm test
```

Build the client:

```sh
npm run build
```

Start only the local API server:

```sh
npm run dev:server
```

Start only the Vite client:

```sh
npm run dev:client
```

## Notes for Beginners

- `src/client` contains the React browser UI.
- `src/server` contains the local Hono API.
- `src/shared` contains TypeScript types used by both client and server code.
- `migrations` contains SQL files applied to the local SQLite database.
