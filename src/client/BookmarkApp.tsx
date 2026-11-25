import { FormEvent, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { Bookmark } from "../shared/bookmarks";
import type { AuthUser } from "../shared/auth";
import { readError } from "./readError";
import deleteIcon from "./assets/icons/delete.svg";
import editIcon from "./assets/icons/edit.svg";

type BookmarksResponse = {
  bookmarks: Bookmark[];
  page: number;
  pageSize: number;
  totalCount: number;
  totalPages: number;
};

type FormState = {
  url: string;
  tags: string;
  memo: string;
};

type BookmarkAppProps = {
  user: AuthUser;
  // Called after a successful logout so the gate can show the login screen.
  onLogout: () => void;
  // Called when an API request returns 401 (e.g. the session expired) so the
  // gate can send the user back to the login screen.
  onUnauthorized: () => void;
};

const emptyForm: FormState = {
  url: "",
  tags: "",
  memo: ""
};

const splitTags = (tags: string) =>
  tags
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean);

const readUrlState = () => {
  const params = new URLSearchParams(window.location.search);
  const pageParam = Number(params.get("page") ?? "1");

  return {
    page: Number.isInteger(pageParam) && pageParam > 0 ? pageParam : 1,
    query: params.get("q")?.trim() ?? ""
  };
};

const pushUrlState = (targetPage: number, targetQuery: string) => {
  const params = new URLSearchParams();
  const trimmedQuery = targetQuery.trim();

  if (targetPage > 1) {
    params.set("page", String(targetPage));
  }

  if (trimmedQuery) {
    params.set("q", trimmedQuery);
  }

  // pushState updates the address bar and browser history without reloading the
  // React app. Beginners can think of it as "change the URL for this screen".
  const nextUrl = params.toString() ? `?${params.toString()}` : window.location.pathname;
  window.history.pushState({ page: targetPage, query: trimmedQuery }, "", nextUrl);
};

export function BookmarkApp({ user, onLogout, onUnauthorized }: BookmarkAppProps) {
  const [bookmarks, setBookmarks] = useState<Bookmark[]>([]);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editForm, setEditForm] = useState<FormState>(emptyForm);
  const [searchInput, setSearchInput] = useState("");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalCount, setTotalCount] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [logoutError, setLogoutError] = useState<string | null>(null);
  const sessionGeneration = useRef(0);
  const listGeneration = useRef(0);
  const editGeneration = useRef(0);

  // Invalidate work as soon as this session ends or the screen unmounts.
  useLayoutEffect(() => () => {
    sessionGeneration.current++;
  }, []);

  const fetchWithAuth = useCallback(
    async (input: string, init: RequestInit | undefined, isCurrent: () => boolean) => {
      const response = await fetch(input, { ...init, credentials: "include" });
      if (response.status === 401) {
        if (isCurrent()) {
          sessionGeneration.current++;
          onUnauthorized();
        }
        return null;
      }

      return response;
    },
    [onUnauthorized]
  );

  const loadBookmarks = useCallback(async (targetPage: number, targetQuery: string) => {
    const session = sessionGeneration.current;
    const request = ++listGeneration.current;
    const isCurrent = () => session === sessionGeneration.current && request === listGeneration.current;
    setIsLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams({ page: String(targetPage) });
      const trimmedQuery = targetQuery.trim();
      if (trimmedQuery) {
        params.set("q", trimmedQuery);
      }

      const response = await fetchWithAuth(`/api/bookmarks?${params.toString()}`, undefined, isCurrent);
      if (!response || !isCurrent()) {
        return;
      }
      if (!response.ok) {
        throw new Error(await readError(response));
      }

      const data = (await response.json()) as BookmarksResponse;
      if (isCurrent()) {
        setBookmarks(data.bookmarks);
        setPage(data.page);
        setTotalPages(data.totalPages);
        setTotalCount(data.totalCount);
      }
    } catch (loadError) {
      if (isCurrent()) {
        setError(loadError instanceof Error ? loadError.message : "Failed to load bookmarks.");
      }
    } finally {
      if (isCurrent()) {
        setIsLoading(false);
      }
    }
  }, [fetchWithAuth]);

  const cancelEditing = useCallback(() => {
    editGeneration.current++;
    setEditingId(null);
    setEditForm(emptyForm);
  }, []);

  useEffect(() => {
    const syncFromUrl = () => {
      const nextState = readUrlState();
      cancelEditing();
      setSearchInput(nextState.query);
      setQuery(nextState.query);
      void loadBookmarks(nextState.page, nextState.query);
    };

    syncFromUrl();
    window.addEventListener("popstate", syncFromUrl);
    return () => {
      window.removeEventListener("popstate", syncFromUrl);
    };
  }, [cancelEditing, loadBookmarks]);

  const updateForm = (field: keyof FormState, value: string) => {
    setForm((current) => ({ ...current, [field]: value }));
  };

  const updateEditForm = (field: keyof FormState, value: string) => {
    editGeneration.current++;
    setEditForm((current) => ({ ...current, [field]: value }));
  };

  const handleLogout = async () => {
    const session = sessionGeneration.current;
    setIsLoggingOut(true);
    setLogoutError(null);
    try {
      const response = await fetch("/api/auth/logout", { method: "POST", credentials: "include" });
      if (!response.ok) {
        throw new Error("Logout failed");
      }
      if (session === sessionGeneration.current) {
        sessionGeneration.current++;
        onLogout();
      }
    } catch {
      if (session === sessionGeneration.current) {
        setLogoutError("Could not log out. Please try again.");
      }
    } finally {
      if (session === sessionGeneration.current) {
        setIsLoggingOut(false);
      }
    }
  };

  // Mutations may finish after search, pagination, or signout changed the screen.
  const captureView = () => {
    const session = sessionGeneration.current;
    const list = listGeneration.current;
    const isSameSession = () => session === sessionGeneration.current;
    return {
      isSameSession,
      isSameView: () => isSameSession() && list === listGeneration.current
    };
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    // Keep the browser from doing a full page reload when the form submits.
    event.preventDefault();

    const { isSameSession, isSameView } = captureView();
    setIsSaving(true);
    setError(null);

    try {
      // Creation starts with only a URL. Tags and memo are added later from Edit.
      const response = await fetchWithAuth("/api/bookmarks", {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify({ url: form.url })
      }, isSameSession);
      if (!response) {
        return;
      }

      if (!response.ok) {
        throw new Error(await readError(response));
      }

      if (isSameSession()) {
        setForm((current) => current === form ? emptyForm : current);
      }
      if (!isSameView()) {
        return;
      }
      pushUrlState(1, query);
      await loadBookmarks(1, query);
    } catch (saveError) {
      if (isSameView()) {
        setError(saveError instanceof Error ? saveError.message : "Failed to save bookmark.");
      }
    } finally {
      if (isSameSession()) {
        setIsSaving(false);
      }
    }
  };

  const startEditing = (bookmark: Bookmark) => {
    editGeneration.current++;
    setEditingId(bookmark.id);
    setEditForm({
      url: bookmark.url,
      tags: bookmark.tags,
      memo: bookmark.memo
    });
  };

  const handleUpdate = async (event: FormEvent<HTMLFormElement>, id: number) => {
    event.preventDefault();

    const { isSameSession, isSameView } = captureView();
    const edit = editGeneration.current;
    setIsSaving(true);
    setError(null);

    try {
      const response = await fetchWithAuth(`/api/bookmarks/${id}`, {
        method: "PUT",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify(editForm)
      }, isSameSession);
      if (!response) {
        return;
      }

      if (!response.ok) {
        throw new Error(await readError(response));
      }

      if (isSameView()) {
        if (edit === editGeneration.current) {
          cancelEditing();
        }
        await loadBookmarks(page, query);
      }
    } catch (updateError) {
      if (isSameView()) {
        setError(updateError instanceof Error ? updateError.message : "Failed to update bookmark.");
      }
    } finally {
      if (isSameSession()) {
        setIsSaving(false);
      }
    }
  };

  const handleDelete = async (bookmark: Bookmark) => {
    if (!window.confirm(`Delete "${bookmark.title}"?`)) {
      return;
    }

    const { isSameSession, isSameView } = captureView();
    setIsSaving(true);
    setError(null);

    try {
      const response = await fetchWithAuth(`/api/bookmarks/${bookmark.id}`, {
        method: "DELETE"
      }, isSameSession);
      if (!response) {
        return;
      }

      if (!response.ok) {
        throw new Error(await readError(response));
      }

      if (!isSameView()) {
        return;
      }
      const targetPage = bookmarks.length === 1 && page > 1 ? page - 1 : page;
      pushUrlState(targetPage, query);
      await loadBookmarks(targetPage, query);
    } catch (deleteError) {
      if (isSameView()) {
        setError(deleteError instanceof Error ? deleteError.message : "Failed to delete bookmark.");
      }
    } finally {
      if (isSameSession()) {
        setIsSaving(false);
      }
    }
  };

  const goToPage = async (targetPage: number) => {
    if (targetPage < 1 || targetPage > totalPages || targetPage === page) {
      return;
    }

    cancelEditing();
    pushUrlState(targetPage, query);
    await loadBookmarks(targetPage, query);
  };

  const handleSearch = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const nextQuery = searchInput.trim();
    // Store the active query separately from what the user is typing. This keeps
    // pagination stable until the user submits the search form.
    setQuery(nextQuery);
    cancelEditing();
    pushUrlState(1, nextQuery);
    await loadBookmarks(1, nextQuery);
  };

  const clearSearch = async () => {
    setSearchInput("");
    setQuery("");
    cancelEditing();
    pushUrlState(1, "");
    await loadBookmarks(1, "");
  };

  return (
    <main className="app-shell">
      <header className="account-bar">
        <span className="account-email">
          Signed in as {user.email}
        </span>
        <button type="button" className="secondary-button" onClick={handleLogout} disabled={isLoggingOut}>
          Log out
        </button>
      </header>

      {logoutError ? <div className="status status-error" role="alert">{logoutError}</div> : null}

      <section className="toolbar" aria-labelledby="app-title">
        <div>
          <p className="eyebrow">Personal bookmarks</p>
          <h1 id="app-title">Bookmark Demo</h1>
        </div>
        <form className="bookmark-form" onSubmit={handleSubmit}>
          {/* The label is visually hidden but still available to screen readers. */}
          <label className="sr-only" htmlFor="bookmark-url">
            URL
          </label>
          <input
            id="bookmark-url"
            type="url"
            value={form.url}
            onChange={(event) => updateForm("url", event.target.value)}
            placeholder="https://example.com"
            required
          />
          <button type="submit" disabled={isSaving || isLoading}>
            {isSaving ? "Saving" : "Add"}
          </button>
        </form>
      </section>

      {error ? (
        <div className="status status-error" role="alert">
          {error}
        </div>
      ) : null}

      <form className="search-form" onSubmit={handleSearch}>
        <label className="sr-only" htmlFor="bookmark-search">
          Search bookmarks
        </label>
        <input
          id="bookmark-search"
          type="search"
          value={searchInput}
          onChange={(event) => setSearchInput(event.target.value)}
          placeholder="Search URL, title, tags, or memo"
        />
        <button type="submit" disabled={isLoading}>
          Search
        </button>
        {query ? (
          <button type="button" className="secondary-button" onClick={clearSearch}>
            Clear
          </button>
        ) : null}
      </form>

      <section className="bookmark-list" aria-label="Bookmarks">
        <div className="list-summary">
          <span>
            {totalCount} bookmarks{query ? ` matching "${query}"` : ""}
          </span>
          <span>
            Page {page} of {totalPages}
          </span>
        </div>

        {isLoading ? <div className="status">Loading bookmarks...</div> : null}

        {!isLoading && bookmarks.length === 0 ? (
          <div className="empty-state">No bookmarks yet.</div>
        ) : null}

        {bookmarks.map((bookmark) => (
          <article className="bookmark-item" key={bookmark.id}>
            {editingId === bookmark.id ? (
              <form className="edit-form" onSubmit={(event) => handleUpdate(event, bookmark.id)}>
                <label>
                  URL
                  <input
                    type="url"
                    value={editForm.url}
                    onChange={(event) => updateEditForm("url", event.target.value)}
                    required
                  />
                </label>
                <label>
                  Tags
                  <input
                    type="text"
                    value={editForm.tags}
                    onChange={(event) => updateEditForm("tags", event.target.value)}
                    placeholder="work, docs, ideas"
                  />
                </label>
                <label>
                  Memo
                  <textarea
                    value={editForm.memo}
                    onChange={(event) => updateEditForm("memo", event.target.value)}
                    placeholder="Notes"
                  />
                </label>
                <div className="item-actions">
                  <button type="submit" disabled={isSaving || isLoading}>
                    Save
                  </button>
                  <button type="button" className="secondary-button" onClick={cancelEditing}>
                    Cancel
                  </button>
                </div>
              </form>
            ) : (
              <>
                <div className="bookmark-content">
                  <a href={bookmark.url} target="_blank" rel="noreferrer">
                    {bookmark.title}
                  </a>
                  <span className="bookmark-url">{bookmark.url}</span>
                  {bookmark.tags ? (
                    <div className="bookmark-tags" aria-label="Tags">
                      {splitTags(bookmark.tags).map((tag) => (
                        <span className="bookmark-tag" key={tag}>
                          {tag}
                        </span>
                      ))}
                    </div>
                  ) : null}
                  {bookmark.memo ? <p className="bookmark-memo">{bookmark.memo}</p> : null}
                </div>
                <div className="item-actions icon-actions">
                  <button
                    type="button"
                    className="icon-button"
                    onClick={() => startEditing(bookmark)}
                    aria-label={`Edit ${bookmark.title}`}
                    title="Edit"
                  >
                    <img src={editIcon} alt="" aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    className="icon-button danger-icon-button"
                    onClick={() => handleDelete(bookmark)}
                    disabled={isSaving || isLoading}
                    aria-label={`Delete ${bookmark.title}`}
                    title="Delete"
                  >
                    <img src={deleteIcon} alt="" aria-hidden="true" />
                  </button>
                </div>
              </>
            )}
          </article>
        ))}
      </section>

      <nav className="pagination" aria-label="Pagination">
        <button type="button" onClick={() => goToPage(page - 1)} disabled={page <= 1 || isLoading}>
          Previous
        </button>
        <span>
          {page} / {totalPages}
        </span>
        <button
          type="button"
          onClick={() => goToPage(page + 1)}
          disabled={page >= totalPages || isLoading}
        >
          Next
        </button>
      </nav>
    </main>
  );
}
