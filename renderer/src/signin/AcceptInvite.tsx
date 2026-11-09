import { useEffect, useState, type FormEvent } from "react";
import { ch, type SessionUser } from "../lib/bridge";

/*
  Set up an invited account in the app: creatorhive://accept-invite?token=…,
  opened by "Open your invite" on the website's /accept-invite/mac page.
  The same steps as the website's /accept-invite: check the token, take a name
  and password, redeem (POST /api/invites/redeem), then sign in.
*/

type Invite = { email: string; role: "student" | "team" };
type Phase =
  | { kind: "checking" }
  | { kind: "blocked"; title: string; message: string; signIn: boolean }
  | { kind: "ready"; invite: Invite };

const BLOCKED_TITLES: Record<string, string> = {
  invite_expired: "This invite has expired",
  invite_redeemed: "This invite was already used",
  account_exists: "You already have an account",
  invalid_invite: "This invite isn’t valid",
};

type InviteResponse = { ok: boolean; invite?: Invite; error?: string; message?: string };

export function AcceptInvite({ token, onSignedIn, onSignIn }: {
  token: string;
  onSignedIn: (user: SessionUser) => void;
  /** Leave for the sign-in screen, with this email filled in when there is one. */
  onSignIn: (email: string) => void;
}) {
  const [phase, setPhase] = useState<Phase>({ kind: "checking" });
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    void ch.api<InviteResponse>({ path: `/api/invites/redeem?token=${encodeURIComponent(token)}` }).then((result) => {
      if (!live) return;
      if (result.ok && result.data?.invite) return setPhase({ kind: "ready", invite: result.data.invite });
      if (result.status === 0) {
        return setPhase({ kind: "blocked", title: "Can’t reach CreatorHive", message: "Check your internet connection, then click “Open your invite” again.", signIn: false });
      }
      const code = result.data?.error ?? "invalid_invite";
      setPhase({
        kind: "blocked",
        title: BLOCKED_TITLES[code] ?? "This invite can’t be used",
        message: result.data?.message ?? "Ask the person who invited you for a new invite.",
        signIn: code === "account_exists" || code === "invite_redeemed",
      });
    });
    return () => { live = false; };
  }, [token]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (phase.kind !== "ready" || busy) return;
    if (!name.trim()) return setError("Enter your name.");
    if (password.length < 8 || new TextEncoder().encode(password).length > 72) return setError("Use 8 to 72 characters for your password.");
    setBusy(true);
    setError(null);
    const redeemed = await ch.api<InviteResponse>({ method: "POST", path: "/api/invites/redeem", body: { token, name: name.trim(), password } });
    if (!redeemed.ok) {
      setBusy(false);
      return setError(redeemed.status === 0 ? "Can’t reach CreatorHive. Check your connection and try again." : redeemed.data?.message ?? "Your account couldn’t be set up. Try again.");
    }
    const signedIn = await ch.auth.signIn(phase.invite.email, password);
    setBusy(false);
    if (signedIn.ok && signedIn.user) onSignedIn(signedIn.user);
    // The account exists now; signing in is all that's left.
    else onSignIn(phase.invite.email);
  }

  return (
    <div className="signin">
      <div className="signin-card">
        <div className="mark"><img src="./ch-logo.svg" alt="" /></div>
        <h1>{phase.kind === "blocked" ? phase.title : "Set up your account"}</h1>
        <p>{phase.kind === "blocked" ? phase.message : "You’ve been invited to CreatorHive. Choose your name and a password."}</p>

        {phase.kind === "checking" ? <div className="signin-note plain" role="status" style={{ marginTop: 28 }}>Checking your invite…</div> : null}

        {phase.kind === "blocked" ? (
          <div className="signin-form">
            <button type="button" className="btn honey lg" onClick={() => onSignIn("")}>{phase.signIn ? "Sign in" : "Back to sign in"}</button>
          </div>
        ) : null}

        {phase.kind === "ready" ? (
          <form className="signin-form" onSubmit={submit}>
            <label htmlFor="invite-email">Email</label>
            <input id="invite-email" className="field" type="email" value={phase.invite.email} readOnly aria-readonly />
            <label htmlFor="invite-name">Your name</label>
            <input id="invite-name" className="field" autoComplete="name" autoFocus maxLength={120} value={name} onChange={(event) => setName(event.target.value)} />
            <label htmlFor="invite-password">Choose a password</label>
            <input id="invite-password" className="field" type="password" autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} />
            {error ? <div className="signin-error" role="alert">{error}</div> : null}
            <button type="submit" className="btn honey lg" style={{ marginTop: 10 }} disabled={busy}>{busy ? "Setting up…" : "Create account"}</button>
            <button type="button" className="btn lg" style={{ marginTop: 6 }} onClick={() => onSignIn("")} disabled={busy}>I already have an account</button>
          </form>
        ) : null}
        <p className="signin-foot">By continuing, you’re joining CreatorHive’s private learning community.</p>
      </div>
    </div>
  );
}
