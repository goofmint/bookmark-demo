import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/server/app";
import { BookmarkDatabase } from "../src/server/db";
import {
  generateSessionToken,
  hashPassword,
  hashSessionToken,
  runDecoyPasswordVerification,
  verifyPassword
} from "../src/server/auth";

describe("password hashing", () => {
  it("hashes into the scrypt:salt:hash format", () => {
    expect(hashPassword("password123")).toMatch(/^scrypt:[0-9a-f]{32}:[0-9a-f]{128}$/);
  });

  it("uses a random salt so equal passwords hash differently", () => {
    expect(hashPassword("password123")).not.toBe(hashPassword("password123"));
  });

  it("never embeds the plain password in the hash", () => {
    expect(hashPassword("super-secret")).not.toContain("super-secret");
  });

  it("verifies a correct password and rejects a wrong one", () => {
    const stored = hashPassword("password123");

    expect(verifyPassword("password123", stored)).toBe(true);
    expect(verifyPassword("wrong-password", stored)).toBe(false);
  });

  it("rejects malformed stored hashes instead of throwing", () => {
    expect(verifyPassword("password123", "not-a-hash")).toBe(false);
    expect(verifyPassword("password123", "scrypt:")).toBe(false);
    expect(verifyPassword("password123", "scrypt::")).toBe(false);
    expect(verifyPassword("password123", "bcrypt:abcd:ef01")).toBe(false);
  });
});

describe("session tokens", () => {
  it("generates a URL-safe token", () => {
    expect(generateSessionToken()).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("generates a unique token each time", () => {
    expect(generateSessionToken()).not.toBe(generateSessionToken());
  });

  it("hashes a token deterministically as SHA-256 hex", () => {
    const token = "example-token";

    expect(hashSessionToken(token)).toBe(hashSessionToken(token));
    expect(hashSessionToken(token)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("matches a known SHA-256 vector and never returns the raw token", () => {
    // Independently computed SHA-256 of the empty string.
    expect(hashSessionToken("")).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
    );

    const token = generateSessionToken();
    expect(hashSessionToken(token)).not.toBe(token);
  });
});

describe("runDecoyPasswordVerification", () => {
  it("runs without throwing so login timing stays constant for unknown emails", () => {
    expect(() => runDecoyPasswordVerification("anything")).not.toThrow();
    expect(() => runDecoyPasswordVerification("")).not.toThrow();
  });
});

describe("authentication API", () => {
  let tempDir: string;
  let db: BookmarkDatabase;

  const createTestApp = () => createApp({ db });

  const jsonRequest = (path: string, body: unknown, cookie?: string) =>
    createTestApp().request(`http://localhost${path}`, {
      method: "POST",
      headers: cookie
        ? { "content-type": "application/json", cookie }
        : { "content-type": "application/json" },
      body: JSON.stringify(body)
    });

  const cookieFrom = (response: Response) => {
    const setCookie = response.headers.get("set-cookie");
    return setCookie ? setCookie.split(";")[0] : null;
  };

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "bookmark-demo-auth-"));
    db = new BookmarkDatabase(join(tempDir, "bookmarks.sqlite"));
    db.migrate(join(process.cwd(), "migrations"));
  });

  afterEach(async () => {
    db.close();
    await rm(tempDir, { recursive: true, force: true });
  });

  it("signs up a new account and sets an HttpOnly session cookie", async () => {
    const response = await jsonRequest("/api/auth/signup", {
      email: "Person@Example.com",
      password: "password123"
    });

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toMatchObject({
      user: { email: "person@example.com" }
    });

    const setCookie = response.headers.get("set-cookie") ?? "";
    expect(setCookie).toMatch(/^session=/);
    expect(setCookie).toMatch(/HttpOnly/i);
    expect(setCookie).toMatch(/SameSite=Lax/i);
    expect(setCookie).toMatch(/Path=\//i);
    expect(setCookie).not.toMatch(/Secure/i);
  });

  it("does not store the password or session token in plain text", async () => {
    const password = "password123";
    const response = await jsonRequest("/api/auth/signup", {
      email: "secret@example.com",
      password
    });
    const token = (cookieFrom(response) ?? "").replace("session=", "");

    const user = db.findUserByEmail("secret@example.com");
    expect(user).not.toBeNull();
    expect(user?.password_hash).not.toContain(password);
    expect(user?.password_hash.startsWith("scrypt:")).toBe(true);

    // The raw cookie token must not be findable as a stored session row.
    expect(token.length).toBeGreaterThan(0);
    expect(db.findValidSession(token, new Date(0).toISOString())).toBeNull();
  });

  it("rejects a duplicate email with a 409", async () => {
    await jsonRequest("/api/auth/signup", { email: "dupe@example.com", password: "password123" });
    const second = await jsonRequest("/api/auth/signup", {
      email: "dupe@example.com",
      password: "password123"
    });

    expect(second.status).toBe(409);
  });

  it("rejects weak passwords and malformed emails", async () => {
    const shortPassword = await jsonRequest("/api/auth/signup", {
      email: "weak@example.com",
      password: "short"
    });
    const badEmail = await jsonRequest("/api/auth/signup", {
      email: "not-an-email",
      password: "password123"
    });

    expect(shortPassword.status).toBe(400);
    expect(badEmail.status).toBe(400);
  });

  it("logs in with valid credentials and rejects a wrong password identically to an unknown email", async () => {
    await jsonRequest("/api/auth/signup", { email: "user@example.com", password: "password123" });

    const ok = await jsonRequest("/api/auth/login", {
      email: "user@example.com",
      password: "password123"
    });
    const wrongPassword = await jsonRequest("/api/auth/login", {
      email: "user@example.com",
      password: "wrong-password"
    });
    const unknownEmail = await jsonRequest("/api/auth/login", {
      email: "ghost@example.com",
      password: "password123"
    });

    expect(ok.status).toBe(200);

    // Email enumeration guard: same status and same message for both failures.
    expect(wrongPassword.status).toBe(401);
    expect(unknownEmail.status).toBe(401);
    const wrongBody = (await wrongPassword.json()) as { error: string };
    const unknownBody = (await unknownEmail.json()) as { error: string };
    expect(wrongBody.error).toBe(unknownBody.error);
  });

  it("logs in case-insensitively against the registered email", async () => {
    await jsonRequest("/api/auth/signup", { email: "mixed@example.com", password: "password123" });

    const response = await jsonRequest("/api/auth/login", {
      email: "  MiXeD@Example.com  ",
      password: "password123"
    });

    expect(response.status).toBe(200);
  });

  it("reports auth status through /api/auth/me and clears it on logout", async () => {
    const signup = await jsonRequest("/api/auth/signup", {
      email: "me@example.com",
      password: "password123"
    });
    const cookie = cookieFrom(signup);
    expect(cookie).not.toBeNull();

    const before = await createTestApp().request("http://localhost/api/auth/me", {
      headers: { cookie: cookie as string }
    });
    expect(before.status).toBe(200);
    await expect(before.json()).resolves.toMatchObject({ user: { email: "me@example.com" } });

    const anonymous = await createTestApp().request("http://localhost/api/auth/me");
    expect(anonymous.status).toBe(401);

    const logout = await createTestApp().request("http://localhost/api/auth/logout", {
      method: "POST",
      headers: { cookie: cookie as string }
    });
    expect(logout.status).toBe(204);

    // The session row is gone, so the same cookie no longer authenticates.
    const after = await createTestApp().request("http://localhost/api/auth/me", {
      headers: { cookie: cookie as string }
    });
    expect(after.status).toBe(401);
  });

  it("treats an expired session as logged out", async () => {
    const signup = await jsonRequest("/api/auth/signup", {
      email: "expired@example.com",
      password: "password123"
    });
    const cookie = cookieFrom(signup) ?? "";

    // Force every stored session to be expired, then confirm access is denied.
    db.deleteExpiredSessions(new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString());

    const me = await createTestApp().request("http://localhost/api/auth/me", {
      headers: { cookie }
    });
    const bookmarks = await createTestApp().request("http://localhost/api/bookmarks", {
      headers: { cookie }
    });

    expect(me.status).toBe(401);
    expect(bookmarks.status).toBe(401);
  });
});
