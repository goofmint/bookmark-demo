import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../src/server/app";
import { BookmarkDatabase } from "../src/server/db";

let tempDir: string;
let db: BookmarkDatabase;

const createTestApp = () => createApp({ db });

const addBookmark = (input: { url: string; title: string; tags?: string; memo?: string }) =>
  db.createBookmark({
    url: input.url,
    title: input.title,
    tags: input.tags ?? "",
    memo: input.memo ?? ""
  });

// Bookmark routes now require a session. Sign up to obtain the session cookie
// and reuse it on the protected requests.
const signUp = async (email = "tester@example.com", password = "password123") => {
  const response = await createTestApp().request("http://localhost/api/auth/signup", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password })
  });
  const setCookie = response.headers.get("set-cookie");
  if (!setCookie) {
    throw new Error("Sign up did not return a session cookie.");
  }

  return setCookie.split(";")[0];
};

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "bookmark-demo-"));
  db = new BookmarkDatabase(join(tempDir, "bookmarks.sqlite"));
  db.migrate(join(process.cwd(), "migrations"));
});

afterEach(async () => {
  vi.unstubAllGlobals();
  db.close();
  await rm(tempDir, { recursive: true, force: true });
});

describe("local server bookmarks API", () => {
  it("returns 404 for the removed OGP image endpoint", async () => {
    const response = await createTestApp().request("http://localhost/api/ogp/some-name");

    expect(response.status).toBe(404);
  });

  it("requires authentication for every bookmark route", async () => {
    const list = await createTestApp().request("http://localhost/api/bookmarks");
    const create = await createTestApp().request("http://localhost/api/bookmarks", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url: "https://example.com" })
    });
    const update = await createTestApp().request("http://localhost/api/bookmarks/1", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url: "https://example.com" })
    });
    const remove = await createTestApp().request("http://localhost/api/bookmarks/1", {
      method: "DELETE"
    });

    expect(list.status).toBe(401);
    expect(create.status).toBe(401);
    expect(update.status).toBe(401);
    expect(remove.status).toBe(401);
  });

  it("does not create a bookmark for an unauthenticated request", async () => {
    await createTestApp().request("http://localhost/api/bookmarks", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url: "https://example.com" })
    });

    const cookie = await signUp();
    const response = await createTestApp().request("http://localhost/api/bookmarks", {
      headers: { cookie }
    });
    const body = (await response.json()) as { totalCount: number };

    // The rejected request above must not have written anything to the database.
    expect(body.totalCount).toBe(0);
  });

  it("clamps an out-of-range page before selecting bookmarks", async () => {
    const cookie = await signUp();
    for (let index = 1; index <= 21; index += 1) {
      addBookmark({
        url: `https://example.com/${index}`,
        title: `Example ${index}`
      });
    }

    const response = await createTestApp().request("http://localhost/api/bookmarks?page=99", {
      headers: { cookie }
    });
    const body = await response.json() as {
      bookmarks: Array<{ id: number }>;
      page: number;
      pageSize: number;
      totalCount: number;
      totalPages: number;
    };

    expect(response.status).toBe(200);
    expect(body.page).toBe(3);
    expect(body.pageSize).toBe(10);
    expect(body.totalCount).toBe(21);
    expect(body.totalPages).toBe(3);
    expect(body.bookmarks).toHaveLength(1);
  });

  it("uses AND search terms across bookmark fields", async () => {
    addBookmark({
      url: "https://example.com/hono",
      title: "Hono",
      tags: "typescript, database",
      memo: "Framework"
    });
    addBookmark({
      url: "https://example.com/sqlite",
      title: "SQLite",
      tags: "database",
      memo: "Local data"
    });
    addBookmark({
      url: "https://example.com/react",
      title: "React",
      tags: "ui",
      memo: "Client"
    });

    const cookie = await signUp();
    const response = await createTestApp().request("http://localhost/api/bookmarks?q=hono%20database", {
      headers: { cookie }
    });
    const body = await response.json() as { bookmarks: Array<{ title: string }>; totalCount: number };

    expect(response.status).toBe(200);
    expect(body.totalCount).toBe(1);
    expect(body.bookmarks.map((bookmark) => bookmark.title)).toEqual(["Hono"]);
  });

  it("creates a bookmark and rejects duplicate normalized URLs", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("<title>Example</title>", { headers: { "content-type": "text/html" } }))
    );

    const cookie = await signUp();
    const app = createTestApp();
    const request = {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ url: "https://example.com/#top" })
    };
    const created = await app.request("http://localhost/api/bookmarks", request);
    const duplicate = await app.request("http://localhost/api/bookmarks", request);

    expect(created.status).toBe(201);
    await expect(created.json()).resolves.toMatchObject({
      bookmark: {
        url: "https://example.com/",
        title: "Example"
      }
    });
    expect(duplicate.status).toBe(409);
  });

  it("updates and deletes a bookmark", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("<title>Updated</title>", { headers: { "content-type": "text/html" } }))
    );
    const cookie = await signUp();
    const bookmark = addBookmark({
      url: "https://example.com/old",
      title: "Old"
    });
    const app = createTestApp();

    const updated = await app.request(`http://localhost/api/bookmarks/${bookmark.id}`, {
      method: "PUT",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({
        url: "https://example.com/new",
        tags: " local, sqlite ",
        memo: " updated "
      })
    });
    const deleted = await app.request(`http://localhost/api/bookmarks/${bookmark.id}`, {
      method: "DELETE",
      headers: { cookie }
    });
    const missing = await app.request(`http://localhost/api/bookmarks/${bookmark.id}`, {
      method: "DELETE",
      headers: { cookie }
    });

    expect(updated.status).toBe(200);
    await expect(updated.json()).resolves.toMatchObject({
      bookmark: {
        url: "https://example.com/new",
        title: "Updated",
        tags: "local, sqlite",
        memo: "updated"
      }
    });
    expect(deleted.status).toBe(204);
    expect(missing.status).toBe(404);
  });
});
