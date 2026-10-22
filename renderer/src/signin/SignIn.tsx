import { useEffect, useState, type FormEvent } from "react";
import { ch, type SessionUser } from "../lib/bridge";

const MESSAGES: Record<string, string> = {
  credentials: "That email and password don't match. Check them and try again.",
  offline: "Can't reach CreatorHive. Check your internet connection and try again.",
  missing: "Enter your email and password.",
  "no-account": "No CreatorHive account uses that Google email. Sign in with your email and password.",
  failed: "Google sign-in didn't finish. Try again.",
  timeout: "Google sign-in took too long. Try again.",
};

function GoogleMark() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden>
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 13 4 4 13 4 24s9 20 20 20 20-9 20-20c0-1.3-.1-2.4-.4-3.5z" />
      <path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
    </svg>
  );
}

export function SignIn({ onSignedIn }: { onSignedIn: (user: SessionUser) => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Hidden until the server offers it, so the app can ship before the website does.
  const [googleOffered, setGoogleOffered] = useState(false);
  const [googleWaiting, setGoogleWaiting] = useState(false);

  useEffect(() => {
    let live = true;
    void ch.auth.googleAvailable().then((offered) => live && setGoogleOffered(offered));
    return () => { live = false; };
  }, []);

  async function continueWithGoogle() {
    setGoogleWaiting(true);
    setError(null);
    const result = await ch.auth.google();
    setGoogleWaiting(false);
    if (result.ok && result.user) onSignedIn(result.user);
    else if (result.error !== "cancelled") setError(MESSAGES[result.error ?? ""] ?? MESSAGES.failed);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    const result = await ch.auth.signIn(email, password);
    setBusy(false);
    if (result.ok && result.user) onSignedIn(result.user);
    else setError(MESSAGES[result.error ?? ""] ?? MESSAGES.credentials);
  }

  return (
    <div className="signin">
      <div className="signin-card">
        <div className="mark"><img src="./ch-logo.svg" alt="" /></div>
        <h1>Welcome to CreatorHive</h1>
        <p>Sign in to your community, Hub and messages.</p>

        <form className="signin-form" onSubmit={submit}>
          {googleOffered ? (
            <>
              {googleWaiting ? (
                <div className="google-waiting" role="status">
                  <span>Finish signing in with Google in your browser…</span>
                  <button type="button" onClick={() => ch.auth.cancelGoogle()}>Cancel</button>
                </div>
              ) : (
                <button type="button" className="btn lg google" onClick={continueWithGoogle} disabled={busy}>
                  <GoogleMark />Continue with Google
                </button>
              )}
              <div className="divider">or sign in with email</div>
            </>
          ) : null}

          <label htmlFor="email">Email</label>
          <input id="email" className="field" type="email" autoComplete="username" autoFocus value={email}
            onChange={(event) => setEmail(event.target.value)} />
          <label htmlFor="password">
            Password
            <button type="button" onClick={() => ch.app.openSite("/forgot-password")}>Forgot password?</button>
          </label>
          <input id="password" className="field" type="password" autoComplete="current-password" value={password}
            onChange={(event) => setPassword(event.target.value)} />
          {error ? <div className="signin-error" role="alert">{error}</div> : null}
          <button type="submit" className="btn honey lg" style={{ marginTop: 10 }} disabled={busy || googleWaiting}>
            {busy ? "Signing in…" : "Sign in"}
          </button>
        </form>
        <p className="signin-foot">Invite-only. Contact your CSM if you don't have access yet.</p>
      </div>
    </div>
  );
}
