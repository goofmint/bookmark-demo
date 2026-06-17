import { Hono } from "hono";
import type { Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import type { BookmarkDatabase } from "./db";
import type { CreateBookmarkRequest, UpdateBookmarkRequest } from "../shared/bookmarks";
import type { AuthCredentials, AuthUser } from "../shared/auth";
import { fetchPageTitle, normalizeUrl } from "./title";
import {
  generateSessionToken,
  hashPassword,
  hashSessionToken,
  runDecoyPasswordVerification,
  verifyPassword
} from "./auth";

export type AppDependencies = {
  db: BookmarkDatabase;
};

const PAGE_SIZE = 10;

const SESSION_COOKIE_NAME = "session";
// 30 days. Used both for the DB expiry timestamp and the cookie Max-Age.
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const SESSION_TTL_SECONDS = Math.floor(SESSION_TTL_MS / 1000);
const MIN_PASSWORD_LENGTH = 8;
const MAX_PASSWORD_LENGTH = 200;
const MAX_EMAIL_LENGTH = 254;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Login and signup share one message so a failure never reveals whether the
// email is registered.
const INVALID_CREDENTIALS_MESSAGE = "Invalid email or password.";

// Local development runs over plain http on http://127.0.0.1, where a Secure
// cookie would never be sent. Default to not Secure and let deployments opt in.
const COOKIE_SECURE = process.env.SESSION_COOKIE_SECURE === "true";

const sessionCookieOptions = {
  httpOnly: true,
  sameSite: "Lax",
  path: "/",
  secure: COOKIE_SECURE
} as const;

const normalizeEmail = (value: unknown) =>
  typeof value === "string" ? value.trim().toLowerCase() : "";

const getCredentials = (payload: unknown): AuthCredentials | null => {
  if (typeof payload !== "object" || payload === null) {
    return null;
  }

  const { email, password } = payload as Record<string, unknown>;
  if (typeof email !== "string" || typeof password !== "string") {
    return null;
  }

  return { email, password };
};

const cleanText = (value: unknown) => (typeof value === "string" ? value.trim() : "");

const cleanTags = (value: unknown) =>
  cleanText(value)
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean)
    .join(", ");

const getUrlFromPayload = (payload: unknown) => {
  if (
    typeof payload !== "object" ||
    payload === null ||
    typeof (payload as CreateBookmarkRequest | UpdateBookmarkRequest).url !== "string"
  ) {
    return null;
  }

  return (payload as CreateBookmarkRequest | UpdateBookmarkRequest).url;
};

const parseBookmarkId = (value: string) => {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
};

const escapeLikeTerm = (term: string) => term.replace(/[\\%_]/g, (character) => `\\${character}`);

const parseSearchTerms = (value: string | undefined) =>
  cleanText(value)
    .split(/\s+/)
    .map((term) => term.trim())
    .filter(Boolean);

const buildSearchFilter = (terms: string[]) => {
  if (terms.length === 0) {
    return {
      sql: "",
      bindings: [] as string[]
    };
  }

  const sql = terms
    .map(() => "(url LIKE ? ESCAPE '\\' OR title LIKE ? ESCAPE '\\' OR tags LIKE ? ESCAPE '\\' OR memo LIKE ? ESCAPE '\\')")
    .join(" AND ");
  const bindings = terms.flatMap((term) => {
    const pattern = `%${escapeLikeTerm(term)}%`;
    return [pattern, pattern, pattern, pattern];
  });

  return {
    sql: `WHERE ${sql}`,
    bindings
  };
};

const isUniqueError = (error: unknown) =>
  error instanceof Error && error.message.toLowerCase().includes("unique");

export const createApp = ({ db }: AppDependencies) => {
  const app = new Hono();

  // Resolves the signed-in user from the session cookie, or null when there is
  // no valid (existing, unexpired) session.
  const resolveCurrentUser = (c: Context) => {
    const token = getCookie(c, SESSION_COOKIE_NAME);
    if (!token) {
      return null;
    }

    const session = db.findValidSession(hashSessionToken(token), new Date().toISOString());
    if (!session) {
      return null;
    }

    return db.findUserById(session.user_id);
  };

  app.post("/api/auth/signup", async (c) => {
    let payload: unknown;
    try {
      payload = await c.req.json();
    } catch {
      return c.json({ error: "Request body must be valid JSON." }, 400);
    }

    const credentials = getCredentials(payload);
    if (credentials === null) {
      return c.json({ error: "Email and password are required." }, 400);
    }

    const email = normalizeEmail(credentials.email);
    if (!EMAIL_PATTERN.test(email) || email.length > MAX_EMAIL_LENGTH) {
      return c.json({ error: "A valid email address is required." }, 400);
    }

    if (
      credentials.password.length < MIN_PASSWORD_LENGTH ||
      credentials.password.length > MAX_PASSWORD_LENGTH
    ) {
      return c.json(
        { error: `Password must be between ${MIN_PASSWORD_LENGTH} and ${MAX_PASSWORD_LENGTH} characters.` },
        400
      );
    }

    let user: AuthUser;
    try {
      user = db.createUser(email, hashPassword(credentials.password));
    } catch (error) {
      if (isUniqueError(error)) {
        return c.json({ error: "An account with this email already exists." }, 409);
      }

      return c.json({ error: "Failed to create account." }, 500);
    }

    issueSession(c, user.id);
    return c.json({ user }, 201);
  });

  app.post("/api/auth/login", async (c) => {
    let payload: unknown;
    try {
      payload = await c.req.json();
    } catch {
      return c.json({ error: "Request body must be valid JSON." }, 400);
    }

    const credentials = getCredentials(payload);
    if (credentials === null) {
      return c.json({ error: "Email and password are required." }, 400);
    }

    const email = normalizeEmail(credentials.email);
    const user = email ? db.findUserByEmail(email) : null;

    // Always run a password verification so the response time does not reveal
    // whether the email exists, and always return the same error on failure.
    if (!user) {
      runDecoyPasswordVerification(credentials.password);
      return c.json({ error: INVALID_CREDENTIALS_MESSAGE }, 401);
    }

    if (!verifyPassword(credentials.password, user.password_hash)) {
      return c.json({ error: INVALID_CREDENTIALS_MESSAGE }, 401);
    }

    issueSession(c, user.id);
    return c.json({ user: { id: user.id, email: user.email } });
  });

  app.post("/api/auth/logout", (c) => {
    const token = getCookie(c, SESSION_COOKIE_NAME);
    if (token) {
      db.deleteSession(hashSessionToken(token));
    }

    deleteCookie(c, SESSION_COOKIE_NAME, sessionCookieOptions);
    return c.body(null, 204);
  });

  app.get("/api/auth/me", (c) => {
    const user = resolveCurrentUser(c);
    if (!user) {
      return c.json({ error: "Authentication required." }, 401);
    }

    return c.json({ user });
  });

  // Creates a session row (storing only the token hash) and sets the cookie that
  // carries the raw token back to the browser.
  function issueSession(c: Context, userId: number) {
    const token = generateSessionToken();
    const now = Date.now();
    db.deleteExpiredSessions(new Date(now).toISOString());
    db.createSession(hashSessionToken(token), userId, new Date(now + SESSION_TTL_MS).toISOString());
    setCookie(c, SESSION_COOKIE_NAME, token, {
      ...sessionCookieOptions,
      maxAge: SESSION_TTL_SECONDS
    });
  }

  // Every /api/bookmarks route requires a valid session. Behavior for
  // authenticated requests is unchanged.
  const requireAuth = async (
    c: Context,
    next: () => Promise<void>
  ) => {
    if (!resolveCurrentUser(c)) {
      return c.json({ error: "Authentication required." }, 401);
    }

    return next();
  };

  app.use("/api/bookmarks", requireAuth);
  app.use("/api/bookmarks/*", requireAuth);

  app.get("/api/bookmarks", (c) => {
    const pageParam = Number(c.req.query("page") ?? "1");
    const requestedPage = Number.isInteger(pageParam) && pageParam > 0 ? pageParam : 1;
    const searchTerms = parseSearchTerms(c.req.query("q"));
    const searchFilter = buildSearchFilter(searchTerms);

    return c.json(db.listBookmarks(searchFilter, requestedPage, PAGE_SIZE));
  });

  app.post("/api/bookmarks", async (c) => {
    let payload: unknown;

    try {
      payload = await c.req.json();
    } catch {
      return c.json({ error: "Request body must be valid JSON." }, 400);
    }

    const payloadUrl = getUrlFromPayload(payload);
    if (payloadUrl === null) {
      return c.json({ error: "URL is required." }, 400);
    }

    let url: string;
    try {
      url = normalizeUrl(payloadUrl);
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : "Invalid URL." }, 400);
    }

    const tags = cleanTags((payload as CreateBookmarkRequest).tags);
    const memo = cleanText((payload as CreateBookmarkRequest).memo);
    const title = (await fetchPageTitle(url)) ?? url;

    try {
      const bookmark = db.createBookmark({ url, title, tags, memo });
      return c.json({ bookmark }, 201);
    } catch (error) {
      if (isUniqueError(error)) {
        return c.json({ error: "This URL is already bookmarked." }, 409);
      }

      return c.json({ error: "Failed to create bookmark." }, 500);
    }
  });

  app.put("/api/bookmarks/:id", async (c) => {
    const id = parseBookmarkId(c.req.param("id"));
    if (id === null) {
      return c.json({ error: "Bookmark not found." }, 404);
    }

    let payload: unknown;

    try {
      payload = await c.req.json();
    } catch {
      return c.json({ error: "Request body must be valid JSON." }, 400);
    }

    const payloadUrl = getUrlFromPayload(payload);
    if (payloadUrl === null) {
      return c.json({ error: "URL is required." }, 400);
    }

    let url: string;
    try {
      url = normalizeUrl(payloadUrl);
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : "Invalid URL." }, 400);
    }

    const tags = cleanTags((payload as UpdateBookmarkRequest).tags);
    const memo = cleanText((payload as UpdateBookmarkRequest).memo);
    const title = (await fetchPageTitle(url)) ?? url;

    try {
      const bookmark = db.updateBookmark(id, { url, title, tags, memo });
      if (!bookmark) {
        return c.json({ error: "Bookmark not found." }, 404);
      }

      return c.json({ bookmark });
    } catch (error) {
      if (isUniqueError(error)) {
        return c.json({ error: "This URL is already bookmarked." }, 409);
      }

      return c.json({ error: "Failed to update bookmark." }, 500);
    }
  });

  app.delete("/api/bookmarks/:id", (c) => {
    const id = parseBookmarkId(c.req.param("id"));
    if (id === null) {
      return c.json({ error: "Bookmark not found." }, 404);
    }

    if (!db.deleteBookmark(id)) {
      return c.json({ error: "Bookmark not found." }, 404);
    }

    return c.body(null, 204);
  });

  return app;
};
