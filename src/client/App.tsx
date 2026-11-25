import { useCallback, useEffect, useState } from "react";
import type { AuthResponse, AuthUser } from "../shared/auth";
import { AuthScreen } from "./AuthScreen";
import { BookmarkApp } from "./BookmarkApp";

export function App() {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [sessionStatus, setSessionStatus] = useState<"checking" | "ready" | "error">("checking");
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;

    const checkSession = async () => {
      try {
        const response = await fetch("/api/auth/me", { credentials: "include" });
        if (response.status === 401) {
          if (active) {
            setUser(null);
            setSessionStatus("ready");
          }
          return;
        }
        if (!response.ok) {
          throw new Error("Session check failed.");
        }

        const data = (await response.json()) as AuthResponse;
        if (active) {
          setUser(data.user);
          setSessionStatus("ready");
        }
      } catch {
        if (active) {
          setSessionStatus("error");
        }
      }
    };

    void checkSession();
    return () => {
      active = false;
    };
  }, [attempt]);

  const handleSignedOut = useCallback(() => {
    setUser(null);
  }, []);

  if (sessionStatus === "checking") {
    return (
      <main className="auth-shell">
        <div className="status">Loading...</div>
      </main>
    );
  }

  if (sessionStatus === "error") {
    return (
      <main className="auth-shell">
        <section className="auth-card">
          <p role="alert">Could not check your session.</p>
          <button type="button" onClick={() => {
            setSessionStatus("checking");
            setAttempt((previous) => previous + 1);
          }}>
            Retry
          </button>
        </section>
      </main>
    );
  }

  if (!user) {
    return <AuthScreen onAuthenticated={setUser} />;
  }

  return <BookmarkApp user={user} onLogout={handleSignedOut} onUnauthorized={handleSignedOut} />;
}
