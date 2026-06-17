import { useCallback, useEffect, useState } from "react";
import type { AuthResponse, AuthUser } from "../shared/auth";
import { AuthScreen } from "./AuthScreen";
import { BookmarkApp } from "./BookmarkApp";

// Decides which screen to show based on the current session. While the initial
// /api/auth/me check is in flight we show a small loading state; after that the
// user sees either the login screen or the bookmark app.
export function App() {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isChecking, setIsChecking] = useState(true);

  useEffect(() => {
    let active = true;

    const checkSession = async () => {
      try {
        const response = await fetch("/api/auth/me", { credentials: "include" });
        if (!active) {
          return;
        }

        if (response.ok) {
          const data = (await response.json()) as AuthResponse;
          setUser(data.user);
        } else {
          setUser(null);
        }
      } catch {
        if (active) {
          setUser(null);
        }
      } finally {
        if (active) {
          setIsChecking(false);
        }
      }
    };

    void checkSession();

    return () => {
      active = false;
    };
  }, []);

  const handleSignedOut = useCallback(() => {
    setUser(null);
  }, []);

  if (isChecking) {
    return (
      <main className="auth-shell">
        <div className="status">Loading...</div>
      </main>
    );
  }

  if (!user) {
    return <AuthScreen onAuthenticated={setUser} />;
  }

  return <BookmarkApp user={user} onLogout={handleSignedOut} onUnauthorized={handleSignedOut} />;
}
