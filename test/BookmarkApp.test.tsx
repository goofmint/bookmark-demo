import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BookmarkApp } from "../src/client/BookmarkApp";
import type { Bookmark } from "../src/shared/bookmarks";

const mockFetch = vi.fn<typeof fetch>();

const renderApp = () =>
  render(
    <BookmarkApp
      user={{ id: 1, email: "user@example.com" }}
      onLogout={vi.fn()}
      onUnauthorized={vi.fn()}
    />
  );

const makeBookmark = (overrides: Partial<Bookmark> = {}): Bookmark => ({
  id: 1,
  url: "https://example.com/",
  title: "Example",
  tags: "docs, demo",
  memo: "Useful reference",
  createdAt: "2026-05-16T00:00:00.000Z",
  updatedAt: "2026-05-16T00:00:00.000Z",
  ...overrides
});

const bookmarksResponse = (
  bookmarks: Bookmark[],
  pagination: Partial<{ page: number; pageSize: number; totalCount: number; totalPages: number }> = {}
) =>
  Response.json({
    bookmarks,
    page: pagination.page ?? 1,
    pageSize: pagination.pageSize ?? 10,
    totalCount: pagination.totalCount ?? bookmarks.length,
    totalPages: pagination.totalPages ?? 1
  });

const deferResponse = () => {
  let resolve!: (value: Response) => void;
  const promise = new Promise<Response>((resolvePromise) => { resolve = resolvePromise; });
  return { promise, resolve };
};

beforeEach(() => {
  window.history.replaceState(null, "", "/");
  vi.stubGlobal("fetch", mockFetch);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  mockFetch.mockReset();
});

describe("BookmarkApp", () => {
  it("shows the signed-in email and a log out button", async () => {
    mockFetch.mockResolvedValueOnce(bookmarksResponse([makeBookmark()]));

    renderApp();

    expect(await screen.findByText("Signed in as user@example.com")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Log out" })).toBeInTheDocument();
  });

  it("logs out and notifies the gate", async () => {
    const onLogout = vi.fn();
    mockFetch
      .mockResolvedValueOnce(bookmarksResponse([makeBookmark()]))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));

    render(
      <BookmarkApp
        user={{ id: 1, email: "user@example.com" }}
        onLogout={onLogout}
        onUnauthorized={vi.fn()}
      />
    );

    await screen.findByRole("link", { name: "Example" });
    await userEvent.click(screen.getByRole("button", { name: "Log out" }));

    await waitFor(() => {
      expect(mockFetch).toHaveBeenLastCalledWith("/api/auth/logout", {
        method: "POST",
        credentials: "include"
      });
    });
    expect(onLogout).toHaveBeenCalled();
  });

  it("returns to the login screen when a bookmark request is unauthorized", async () => {
    const onUnauthorized = vi.fn();
    mockFetch.mockResolvedValueOnce(Response.json({ error: "Authentication required." }, { status: 401 }));

    render(
      <BookmarkApp
        user={{ id: 1, email: "user@example.com" }}
        onLogout={vi.fn()}
        onUnauthorized={onUnauthorized}
      />
    );

    await waitFor(() => {
      expect(onUnauthorized).toHaveBeenCalled();
    });
  });

  it("loads and renders bookmarks with tags and memo", async () => {
    mockFetch.mockResolvedValueOnce(bookmarksResponse([makeBookmark()]));

    renderApp();

    expect(await screen.findByRole("link", { name: "Example" })).toHaveAttribute(
      "href",
      "https://example.com/"
    );
    expect(screen.getByText("docs")).toBeInTheDocument();
    expect(screen.getByText("demo")).toBeInTheDocument();
    expect(screen.getByText("Useful reference")).toBeInTheDocument();
  });

  it("adds a bookmark from the URL-only form and refreshes the first page", async () => {
    mockFetch
      .mockResolvedValueOnce(bookmarksResponse([]))
      .mockResolvedValueOnce(Response.json({ bookmark: makeBookmark({ id: 2 }) }, { status: 201 }))
      .mockResolvedValueOnce(bookmarksResponse([makeBookmark({ id: 2 })]));

    renderApp();

    await screen.findByText("No bookmarks yet.");
    await userEvent.type(screen.getByLabelText("URL"), "https://example.com");
    await userEvent.click(screen.getByRole("button", { name: "Add" }));

    await waitFor(() => {
      expect(mockFetch).toHaveBeenNthCalledWith(2, "/api/bookmarks", {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        credentials: "include",
        body: JSON.stringify({
          url: "https://example.com"
        })
      });
    });

    expect(await screen.findByRole("link", { name: "Example" })).toBeInTheDocument();
    expect(mockFetch).toHaveBeenLastCalledWith("/api/bookmarks?page=1", { credentials: "include" });
  });

  it("edits a bookmark and refreshes the current page", async () => {
    mockFetch
      .mockResolvedValueOnce(bookmarksResponse([makeBookmark()]))
      .mockResolvedValueOnce(Response.json({ bookmark: makeBookmark({ tags: "updated" }) }))
      .mockResolvedValueOnce(bookmarksResponse([makeBookmark({ tags: "updated" })]));

    renderApp();

    await screen.findByRole("link", { name: "Example" });
    await userEvent.click(screen.getByRole("button", { name: "Edit Example" }));
    const editTagsInput = screen.getByLabelText("Tags");
    await userEvent.clear(editTagsInput);
    await userEvent.type(editTagsInput, "updated");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(mockFetch).toHaveBeenNthCalledWith(2, "/api/bookmarks/1", {
        method: "PUT",
        headers: {
          "content-type": "application/json"
        },
        credentials: "include",
        body: JSON.stringify({
          url: "https://example.com/",
          tags: "updated",
          memo: "Useful reference"
        })
      });
    });

    expect(await screen.findByText("updated")).toBeInTheDocument();
    expect(mockFetch).toHaveBeenLastCalledWith("/api/bookmarks?page=1", { credentials: "include" });
  });

  it("confirms deletion before deleting and refreshing the list", async () => {
    vi.spyOn(window, "confirm").mockReturnValueOnce(true);
    mockFetch
      .mockResolvedValueOnce(bookmarksResponse([makeBookmark()]))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(bookmarksResponse([]));

    renderApp();

    await screen.findByRole("link", { name: "Example" });
    await userEvent.click(screen.getByRole("button", { name: "Delete Example" }));

    expect(window.confirm).toHaveBeenCalledWith('Delete "Example"?');
    await waitFor(() => {
      expect(mockFetch).toHaveBeenNthCalledWith(2, "/api/bookmarks/1", {
        method: "DELETE",
        credentials: "include"
      });
    });
    expect(mockFetch).toHaveBeenLastCalledWith("/api/bookmarks?page=1", { credentials: "include" });
  });

  it("loads the next page", async () => {
    mockFetch
      .mockResolvedValueOnce(
        bookmarksResponse([makeBookmark()], { page: 1, totalCount: 11, totalPages: 2 })
      )
      .mockResolvedValueOnce(
        bookmarksResponse([makeBookmark({ id: 2, title: "Next page" })], {
          page: 2,
          totalCount: 11,
          totalPages: 2
        })
      );

    renderApp();

    await screen.findByRole("link", { name: "Example" });
    await userEvent.click(screen.getByRole("button", { name: "Next" }));

    expect(await screen.findByRole("link", { name: "Next page" })).toBeInTheDocument();
    expect(mockFetch).toHaveBeenLastCalledWith("/api/bookmarks?page=2", { credentials: "include" });
  });

  it("searches bookmarks and keeps the query in pagination", async () => {
    mockFetch
      .mockResolvedValueOnce(bookmarksResponse([]))
      .mockResolvedValueOnce(
        bookmarksResponse([makeBookmark({ title: "Search result" })], {
          page: 1,
          totalCount: 11,
          totalPages: 2
        })
      )
      .mockResolvedValueOnce(
        bookmarksResponse([makeBookmark({ id: 2, title: "More results" })], {
          page: 2,
          totalCount: 11,
          totalPages: 2
        })
      );

    renderApp();

    await screen.findByText("No bookmarks yet.");
    await userEvent.type(screen.getByLabelText("Search bookmarks"), "bookmark social");
    await userEvent.click(screen.getByRole("button", { name: "Search" }));

    expect(await screen.findByRole("link", { name: "Search result" })).toBeInTheDocument();
    expect(mockFetch).toHaveBeenLastCalledWith("/api/bookmarks?page=1&q=bookmark+social", {
      credentials: "include"
    });
    expect(window.location.search).toBe("?q=bookmark+social");

    await userEvent.click(screen.getByRole("button", { name: "Next" }));

    expect(await screen.findByRole("link", { name: "More results" })).toBeInTheDocument();
    expect(mockFetch).toHaveBeenLastCalledWith("/api/bookmarks?page=2&q=bookmark+social", {
      credentials: "include"
    });
    expect(window.location.search).toBe("?page=2&q=bookmark+social");
  });

  it("refreshes the first page of the active search after creating on page two", async () => {
    window.history.replaceState(null, "", "/?page=2&q=docs");
    mockFetch
      .mockResolvedValueOnce(bookmarksResponse([makeBookmark({ title: "Page two result" })], {
        page: 2, totalCount: 11, totalPages: 2
      }))
      .mockResolvedValueOnce(Response.json({ bookmark: makeBookmark({ id: 2 }) }, { status: 201 }))
      .mockResolvedValueOnce(bookmarksResponse([makeBookmark({ id: 2, title: "Refreshed result" })]));

    renderApp();

    await screen.findByRole("link", { name: "Page two result" });
    expect(screen.getByText("Page 2 of 2")).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText("URL"), "https://example.com");
    await userEvent.click(screen.getByRole("button", { name: "Add" }));

    expect(await screen.findByRole("link", { name: "Refreshed result" })).toBeInTheDocument();
    expect(mockFetch).toHaveBeenNthCalledWith(2, "/api/bookmarks", expect.objectContaining({ method: "POST" }));
    expect(mockFetch).toHaveBeenNthCalledWith(3, "/api/bookmarks?page=1&q=docs", { credentials: "include" });
    expect(window.location.search).toBe("?q=docs");
  });

  it("keeps the URL in sync after deleting the last bookmark on a page", async () => {
    vi.spyOn(window, "confirm").mockReturnValueOnce(true);
    window.history.replaceState(null, "", "/?page=2&q=docs");
    mockFetch
      .mockResolvedValueOnce(
        bookmarksResponse([makeBookmark()], { page: 2, totalCount: 11, totalPages: 2 })
      )
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(
        bookmarksResponse([makeBookmark({ id: 2 })], { page: 1, totalCount: 10, totalPages: 1 })
      );

    renderApp();

    await screen.findByRole("link", { name: "Example" });
    await userEvent.click(screen.getByRole("button", { name: "Delete Example" }));

    await waitFor(() => {
      expect(mockFetch).toHaveBeenLastCalledWith("/api/bookmarks?page=1&q=docs", {
        credentials: "include"
      });
    });
    expect(window.location.search).toBe("?q=docs");
  });

  it.each([
    ["results", () => bookmarksResponse([makeBookmark({ title: "Stale results" })])],
    ["an error", () => Response.json({ error: "Stale error." }, { status: 503 })]
  ])("ignores %s from a search replaced by Clear", async (_outcome, response) => {
    const search = deferResponse();
    const clear = deferResponse();
    mockFetch.mockResolvedValueOnce(bookmarksResponse([]))
      .mockReturnValueOnce(search.promise)
      .mockReturnValueOnce(clear.promise);

    renderApp();

    await screen.findByText("No bookmarks yet.");
    await userEvent.type(screen.getByLabelText("Search bookmarks"), "docs");
    await userEvent.click(screen.getByRole("button", { name: "Search" }));
    await userEvent.click(screen.getByRole("button", { name: "Clear" }));
    await act(async () => search.resolve(response()));

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Stale results" })).not.toBeInTheDocument();
    expect(screen.getByText("Loading bookmarks...")).toBeInTheDocument();
    await act(async () => clear.resolve(bookmarksResponse([makeBookmark({ title: "All bookmarks" })])));

    expect(screen.getByRole("link", { name: "All bookmarks" })).toBeInTheDocument();
    expect(screen.queryByText("Loading bookmarks...")).not.toBeInTheDocument();
  });

  it.each(["create", "delete"] as const)("preserves navigation when a pending %s finishes", async (operation) => {
    const mutation = deferResponse();
    window.history.replaceState(null, "", "/?page=2&q=docs");
    vi.spyOn(window, "confirm").mockReturnValue(true);
    mockFetch.mockResolvedValueOnce(bookmarksResponse([makeBookmark()], { page: 2, totalPages: 2 }))
      .mockReturnValueOnce(mutation.promise)
      .mockResolvedValueOnce(bookmarksResponse([makeBookmark({ id: 2, title: "New view" })]));

    renderApp();
    await screen.findByRole("link", { name: "Example" });
    const actions = {
      create: async () => {
        await userEvent.type(screen.getByLabelText("URL"), "https://example.org");
        await userEvent.click(screen.getByRole("button", { name: "Add" }));
      },
      delete: async () => userEvent.click(screen.getByRole("button", { name: "Delete Example" }))
    };
    await actions[operation]();
    expect(mockFetch).toHaveBeenCalledTimes(2);
    await userEvent.click(screen.getByRole("button", { name: "Clear" }));
    await screen.findByRole("link", { name: "New view" });
    await act(async () => mutation.resolve(new Response(null, { status: 204 })));

    expect(mockFetch).toHaveBeenCalledTimes(3);
    expect(window.location.search).toBe("");
    expect(screen.getByRole("link", { name: "New view" })).toBeInTheDocument();
  });

  it("keeps a new edit open when an earlier save finishes", async () => {
    const save = deferResponse();
    const other = makeBookmark({ id: 2, title: "Other bookmark" });
    mockFetch.mockResolvedValueOnce(bookmarksResponse([makeBookmark(), other]))
      .mockReturnValueOnce(save.promise)
      .mockResolvedValueOnce(bookmarksResponse([makeBookmark({ title: "Saved bookmark" }), other]));

    renderApp();
    await screen.findByRole("link", { name: "Example" });
    await userEvent.click(screen.getByRole("button", { name: "Edit Example" }));
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    await userEvent.click(screen.getByRole("button", { name: "Edit Other bookmark" }));
    await userEvent.type(screen.getByLabelText("Memo"), " with a new draft");
    await act(async () => save.resolve(Response.json({ bookmark: makeBookmark() })));

    expect(await screen.findByRole("link", { name: "Saved bookmark" })).toBeInTheDocument();
    expect(screen.getByLabelText("Memo")).toHaveValue("Useful reference with a new draft");
  });

  it("loads the initial search state from the URL", async () => {
    window.history.replaceState(null, "", "/?page=2&q=docs");
    mockFetch.mockResolvedValueOnce(
      bookmarksResponse([makeBookmark({ title: "URL state result" })], {
        page: 2,
        totalCount: 11,
        totalPages: 2
      })
    );

    renderApp();

    expect(await screen.findByRole("link", { name: "URL state result" })).toBeInTheDocument();
    expect(screen.getByLabelText("Search bookmarks")).toHaveValue("docs");
    expect(mockFetch).toHaveBeenLastCalledWith("/api/bookmarks?page=2&q=docs", {
      credentials: "include"
    });
  });

  it("shows error and preserves query on failed search", async () => {
    window.history.replaceState(null, "", "/?q=fail");
    mockFetch.mockResolvedValueOnce(Response.json({ error: "Search failed." }, { status: 500 }));

    renderApp();

    expect(await screen.findByText("Search failed.")).toBeInTheDocument();
    expect(screen.getByLabelText("Search bookmarks")).toHaveValue("fail");
    expect(mockFetch).toHaveBeenLastCalledWith("/api/bookmarks?page=1&q=fail", {
      credentials: "include"
    });
    expect(window.location.search).toBe("?q=fail");
  });

  it("reloads bookmarks when browser history changes", async () => {
    mockFetch
      .mockResolvedValueOnce(bookmarksResponse([]))
      .mockResolvedValueOnce(bookmarksResponse([makeBookmark({ title: "History result" })]));

    renderApp();

    await screen.findByText("No bookmarks yet.");
    act(() => {
      window.history.pushState(null, "", "/?q=history");
      window.dispatchEvent(new PopStateEvent("popstate"));
    });

    expect(await screen.findByRole("link", { name: "History result" })).toBeInTheDocument();
    expect(screen.getByLabelText("Search bookmarks")).toHaveValue("history");
    expect(mockFetch).toHaveBeenLastCalledWith("/api/bookmarks?page=1&q=history", {
      credentials: "include"
    });
  });
});
