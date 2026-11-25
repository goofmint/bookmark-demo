import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../src/client/App";
import type { Bookmark } from "../src/shared/bookmarks";

const mockFetch = vi.fn<typeof fetch>();

const user = { id: 1, email: "person@example.com" };

const makeBookmark = (overrides: Partial<Bookmark> = {}): Bookmark => ({
  id: 1,
  url: "https://example.com/",
  title: "Example",
  tags: "",
  memo: "",
  createdAt: "2026-05-16T00:00:00.000Z",
  updatedAt: "2026-05-16T00:00:00.000Z",
  ...overrides
});

const meResponse = () => Response.json({ user });
const unauthorized = () => Response.json({ error: "Authentication required." }, { status: 401 });
const bookmarksResponse = (bookmarks: Bookmark[]) =>
  Response.json({
    bookmarks,
    page: 1,
    pageSize: 10,
    totalCount: bookmarks.length,
    totalPages: 1
  });

beforeEach(() => {
  window.history.replaceState(null, "", "/");
  vi.stubGlobal("fetch", mockFetch);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  mockFetch.mockReset();
});

describe("App auth gate", () => {
  it("checks the session with credentials included", async () => {
    mockFetch.mockResolvedValueOnce(unauthorized());

    render(<App />);

    await screen.findByLabelText("Email");
    expect(mockFetch).toHaveBeenNthCalledWith(1, "/api/auth/me", { credentials: "include" });
  });

  it("shows the login screen when there is no valid session", async () => {
    mockFetch.mockResolvedValueOnce(unauthorized());

    render(<App />);

    expect(await screen.findByLabelText("Email")).toBeInTheDocument();
    expect(screen.getByLabelText("Password")).toBeInTheDocument();
    expect(screen.queryByLabelText("Bookmarks")).not.toBeInTheDocument();
  });

  it("shows the bookmark app when a session exists", async () => {
    mockFetch.mockResolvedValueOnce(meResponse()).mockResolvedValueOnce(bookmarksResponse([makeBookmark()]));

    render(<App />);

    expect(await screen.findByRole("link", { name: "Example" })).toBeInTheDocument();
    expect(screen.getByText("person@example.com")).toBeInTheDocument();
  });

  it("toggles between login and account creation", async () => {
    mockFetch.mockResolvedValueOnce(unauthorized());

    render(<App />);

    await screen.findByLabelText("Email");
    expect(screen.getByRole("button", { name: "Log in" })).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Need an account? Create one" }));

    expect(screen.getByRole("button", { name: "Create account" })).toBeInTheDocument();
  });

  it("logs in and then shows the bookmark app", async () => {
    mockFetch
      .mockResolvedValueOnce(unauthorized()) // /api/auth/me
      .mockResolvedValueOnce(meResponse()) // /api/auth/login
      .mockResolvedValueOnce(bookmarksResponse([makeBookmark()])); // /api/bookmarks

    render(<App />);

    await userEvent.type(await screen.findByLabelText("Email"), "person@example.com");
    await userEvent.type(screen.getByLabelText("Password"), "password123");
    await userEvent.click(screen.getByRole("button", { name: "Log in" }));

    expect(await screen.findByRole("link", { name: "Example" })).toBeInTheDocument();
    expect(mockFetch).toHaveBeenNthCalledWith(2, "/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ email: "person@example.com", password: "password123" })
    });
  });

  it("shows an error when login fails", async () => {
    mockFetch
      .mockResolvedValueOnce(unauthorized())
      .mockResolvedValueOnce(Response.json({ error: "Invalid email or password." }, { status: 401 }));

    render(<App />);

    await userEvent.type(await screen.findByLabelText("Email"), "person@example.com");
    await userEvent.type(screen.getByLabelText("Password"), "wrong-password");
    await userEvent.click(screen.getByRole("button", { name: "Log in" }));

    expect(await screen.findByText("Invalid email or password.")).toBeInTheDocument();
    expect(screen.getByLabelText("Email")).toBeInTheDocument();
  });

  it("returns to the login screen after logging out", async () => {
    mockFetch
      .mockResolvedValueOnce(meResponse()) // /api/auth/me
      .mockResolvedValueOnce(bookmarksResponse([makeBookmark()])) // /api/bookmarks
      .mockResolvedValueOnce(new Response(null, { status: 204 })); // /api/auth/logout

    render(<App />);

    await screen.findByRole("link", { name: "Example" });
    await userEvent.click(screen.getByRole("button", { name: "Log out" }));

    expect(await screen.findByLabelText("Email")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Example" })).not.toBeInTheDocument();
  });

  it("returns to the login screen when a bookmark request is unauthorized", async () => {
    mockFetch
      .mockResolvedValueOnce(meResponse()) // /api/auth/me succeeds
      .mockResolvedValueOnce(unauthorized()); // session expires before /api/bookmarks

    render(<App />);

    expect(await screen.findByLabelText("Email")).toBeInTheDocument();
  });
});
