import { FormEvent, useState } from "react";
import type { AuthResponse, AuthUser } from "../shared/auth";
import { readError } from "./readError";

type AuthScreenProps = {
  // Called with the signed-in user once login or signup succeeds.
  onAuthenticated: (user: AuthUser) => void;
};

type Mode = "login" | "signup";

const copy: Record<Mode, { title: string; submit: string; toggle: string; endpoint: string }> = {
  login: {
    title: "Log in",
    submit: "Log in",
    toggle: "Need an account? Create one",
    endpoint: "/api/auth/login"
  },
  signup: {
    title: "Create account",
    submit: "Create account",
    toggle: "Already have an account? Log in",
    endpoint: "/api/auth/signup"
  }
};

export function AuthScreen({ onAuthenticated }: AuthScreenProps) {
  const [mode, setMode] = useState<Mode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const current = copy[mode];

  const switchMode = () => {
    setMode((previous) => (previous === "login" ? "signup" : "login"));
    setError(null);
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    setIsSubmitting(true);
    setError(null);

    try {
      const response = await fetch(current.endpoint, {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        // Cookie-based auth: include credentials so the session cookie is set.
        credentials: "include",
        body: JSON.stringify({ email, password })
      });

      if (!response.ok) {
        throw new Error(await readError(response));
      }

      const data = (await response.json()) as AuthResponse;
      onAuthenticated(data.user);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Something went wrong.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <main className="auth-shell">
      <section className="auth-card" aria-labelledby="auth-title">
        <p className="eyebrow">Bookmark Demo</p>
        <h1 id="auth-title">{current.title}</h1>
        <p className="auth-subtitle">Sign in to view and manage your bookmarks.</p>

        {error ? (
          <div className="status status-error" role="alert">
            {error}
          </div>
        ) : null}

        <form className="auth-form" onSubmit={handleSubmit}>
          <label htmlFor="auth-email">
            Email
            <input
              id="auth-email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
            />
          </label>
          <label htmlFor="auth-password">
            Password
            <input
              id="auth-password"
              type="password"
              autoComplete={mode === "login" ? "current-password" : "new-password"}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
            />
          </label>
          <button type="submit" disabled={isSubmitting}>
            {isSubmitting ? "Please wait" : current.submit}
          </button>
        </form>

        <button type="button" className="auth-toggle" onClick={switchMode} disabled={isSubmitting}>
          {current.toggle}
        </button>
      </section>
    </main>
  );
}
