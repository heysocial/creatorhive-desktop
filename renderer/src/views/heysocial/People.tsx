import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { ApiError, api, queryClient } from "../../lib/api";
import { useAdminAccess } from "../../lib/admin";
import { refreshHs } from "../../lib/heysocial";
import { Avatar } from "../../lib/ui";
import "../../styles/admin-heysocial.css";

/*
  Hey Social Inc. → People and access, the owner's alone, as the website's
  /hey-social/people. Owner and team accounts are in by role and can't be
  removed here. Anyone else is added as a member (sees open channels, can
  start channels) or a guest (only the channels they're added to). A
  contractor without an account gets a guest invite by email.
*/

interface Person {
  id: string;
  name: string;
  email: string;
  avatarUrl: string | null;
  role: string;
  access: "member" | "guest";
  /** `role`: owner and team, who are in by their account. `added`: by the owner here. */
  source: "role" | "added";
  channelCount: number;
}

interface PendingGuest { id: string; email: string; expiresAt: string }
interface Candidate { id: string; name: string; avatarUrl: string | null; role: string }
type Audience = "owner" | "team";

const PEOPLE_KEY = ["hey-social", "people"] as const;

function usePeople(enabled: boolean) {
  return useQuery({
    queryKey: PEOPLE_KEY,
    enabled,
    staleTime: 0,
    queryFn: () => api<{ people: Person[]; pendingGuests?: PendingGuest[]; audience: string }>("/api/hey-social/people"),
  });
}

/** Every refusal POST /api/invites/create can give, in the website's words. */
const GUEST_INVITE_ERRORS: Record<string, string> = {
  invalid_email: "Enter a valid email address.",
  account_exists: "This email already has a CreatorHive account. Search for them above and add them as a guest.",
  invite_pending: "This email already has an invite waiting. Revoke it under Members → Pending invites, then send a guest invite.",
  role_forbidden: "Only the owner can invite guests.",
  forbidden: "Only the owner can invite guests.",
  unauthorized: "You’re signed out. Sign in again, then send the invite.",
  invalid_role: "This invite couldn’t be sent. Try again.",
  invalid_access_level: "This invite couldn’t be sent. Try again.",
  starter_requires_student: "This invite couldn’t be sent. Try again.",
  "invalid json": "This invite couldn’t be sent. Try again.",
};

function guestInviteError(error: unknown) {
  if (!(error instanceof ApiError)) return undefined;
  // A guest invite already waiting is in the list on this page.
  const invite = error.data?.invite as { accessLevel?: string } | undefined;
  if (error.message === "invite_pending" && invite?.accessLevel === "guest") {
    return "This email already has a guest invite waiting. It’s listed below.";
  }
  return GUEST_INVITE_ERRORS[error.message];
}

/** The server's words when it chose some, the website's fallback when not. */
function message(error: unknown) {
  const text = error instanceof Error ? error.message : "";
  return !text || text.startsWith("HTTP") || /^something went wrong\.?$/i.test(text) || text === "failed" ? "That didn't work. Try again." : text;
}

export function HsPeople() {
  const access = useAdminAccess();
  const owner = Boolean(access.data?.owner);
  const people = usePeople(owner);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Candidate[]>([]);
  const [inviteEmail, setInviteEmail] = useState("");

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) { setResults([]); return; }
    const timer = window.setTimeout(() => {
      api<{ members: Candidate[] }>(`/api/members?view=picker&limit=8&q=${encodeURIComponent(q)}`)
        .then((data) => setResults(data.members ?? []))
        .catch(() => setResults([]));
    }, 200);
    return () => window.clearTimeout(timer);
  }, [query]);

  if (access.isLoading) return null;
  // The website answers 404 to anyone but the owner.
  if (!owner) return <div className="empty-state"><p>Nothing to show here.</p></div>;

  async function send(key: string, path: string, init: { method: string; body?: unknown }, done: string, describe?: (error: unknown) => string | undefined) {
    setBusy(key);
    setError(null);
    setNotice(null);
    try {
      await api(path, init);
      setNotice(done);
      await queryClient.invalidateQueries({ queryKey: PEOPLE_KEY });
      void refreshHs();
      return true;
    } catch (e) {
      setError(describe?.(e) ?? message(e));
      return false;
    } finally {
      setBusy(null);
    }
  }

  async function add(candidate: Candidate, level: "member" | "guest") {
    const ok = await send(`add:${candidate.id}`, "/api/hey-social/people", { method: "POST", body: { userId: candidate.id, access: level } },
      `${candidate.name} is in Hey Social Inc. as a ${level}.`);
    if (ok) { setQuery(""); setResults([]); }
  }

  async function remove(person: Person) {
    if (!window.confirm(`Remove ${person.name} from Hey Social Inc.?\n\nThey leave every Hey Social channel and lose access to its DMs. Their messages stay.`)) return;
    await send(`remove:${person.id}`, `/api/hey-social/people?userId=${encodeURIComponent(person.id)}`, { method: "DELETE" },
      `${person.name} was removed from Hey Social Inc.`);
  }

  async function invite(event: React.FormEvent) {
    event.preventDefault();
    const email = inviteEmail.trim();
    if (!email) return;
    const ok = await send("invite", "/api/invites/create", { method: "POST", body: { email, role: "student", accessLevel: "guest" } },
      `Guest invite sent to ${email}.`, guestInviteError);
    if (ok) setInviteEmail("");
  }

  const audience: Audience = people.data?.audience === "team" ? "team" : "owner";
  async function setSwitch(next: Audience) {
    await send("audience", "/api/hey-social/people", { method: "PATCH", body: { audience: next } },
      next === "team" ? "Hey Social Inc. is on for the whole team." : "Hey Social Inc. is back to you only.");
  }

  const list = people.data?.people;
  const pending = people.data?.pendingGuests ?? [];
  const inIds = new Set((list ?? []).map((person) => person.id));
  const spin = (key: string) => (busy === key ? <Loader2 className="spin" /> : null);

  return (
    <div className="page">
      <div className="mhead"><h1>People and access</h1></div>
      <div className="scroll page-body hsp">
        <div className="hsp-page">
          <header className="hsp-header">
            <h2>People</h2>
            <p>Everyone in Hey Social Inc. Owner and team accounts are in automatically. Students never see this workspace.</p>
          </header>

          {notice ? <p className="hsp-notice" role="status">{notice}</p> : null}
          {error ? <p className="hsp-error" role="alert">{error}</p> : null}

          <section className="hsp-card">
            <div className="hsp-card-head"><h3>Who can open Hey Social Inc.</h3></div>
            <div className="hsp-switch">
              <p>
                {audience === "team"
                  ? "On for everyone in the list below: team accounts and the people you added."
                  : "Only you, while it's being set up. The team doesn't see it in the switcher yet."}
              </p>
              <button className={`btn ${audience === "team" ? "" : "honey"}`} disabled={!people.data || busy === "audience"} onClick={() => void setSwitch(audience === "team" ? "owner" : "team")}>
                {spin("audience")}{audience === "team" ? "Switch back to just me" : "Turn on for the team"}
              </button>
            </div>
          </section>

          <section className="hsp-card">
            <div className="hsp-card-head">
              <h3>In the workspace</h3>
              {list ? <small>{list.length} {list.length === 1 ? "person" : "people"}</small> : null}
            </div>
            {people.isError && !list ? (
              <div className="hsp-empty">Couldn’t load people. {message(people.error)} <button className="link" onClick={() => void people.refetch()}>Try again</button></div>
            ) : !list ? (
              <div className="hsp-empty"><Loader2 className="spin" /></div>
            ) : list.map((person) => (
              <div key={person.id} className="hsp-row">
                <Avatar name={person.name} src={person.avatarUrl} seed={person.id} size={36} />
                <span className="hsp-who">
                  <b>{person.name}</b>
                  <small>
                    {person.email}
                    {person.source === "role" ? ` · ${person.role === "owner" ? "Owner" : "Team"} account` : ` · ${person.channelCount} ${person.channelCount === 1 ? "channel" : "channels"}`}
                  </small>
                </span>
                <span className="hsp-actions">
                  {person.source === "role" ? (
                    <span className="hsp-pill member">Member</span>
                  ) : (
                    <>
                      <select className="hsp-select" aria-label={`Access for ${person.name}`} value={person.access} disabled={busy !== null}
                        onChange={(event) => void send(`access:${person.id}`, "/api/hey-social/people", { method: "PATCH", body: { userId: person.id, access: event.target.value } },
                          `${person.name} is now a ${event.target.value}.`)}>
                        <option value="member">Member</option>
                        <option value="guest">Guest</option>
                      </select>
                      <button className="btn" disabled={busy === `remove:${person.id}`} onClick={() => void remove(person)}>{spin(`remove:${person.id}`)}Remove</button>
                    </>
                  )}
                </span>
              </div>
            ))}
          </section>

          <section className="hsp-card">
            <div className="hsp-card-head"><h3>Add someone with an account</h3></div>
            <div className="hsp-search">
              <input className="field" value={query} placeholder="Search by name" aria-label="Search by name" onChange={(event) => setQuery(event.target.value)} />
            </div>
            <div>
              {results.filter((candidate) => !inIds.has(candidate.id)).map((candidate) => (
                <div key={candidate.id} className="hsp-row">
                  <Avatar name={candidate.name} src={candidate.avatarUrl} seed={candidate.id} size={36} />
                  <span className="hsp-who"><b>{candidate.name}</b><small>CreatorHive account</small></span>
                  <span className="hsp-actions">
                    <button className="btn honey" disabled={busy !== null} onClick={() => void add(candidate, "member")}>{spin(`add:${candidate.id}`)}Add as member</button>
                    <button className="btn" disabled={busy !== null} onClick={() => void add(candidate, "guest")}>Add as guest</button>
                  </span>
                </div>
              ))}
              {query.trim().length >= 2 && results.length === 0 ? <p className="hsp-empty">No accounts match “{query.trim()}”.</p> : null}
            </div>
            <p className="hsp-note">A guest added here keeps their CreatorHive access. To give a contractor Hey Social Inc. only, invite them by email below.</p>
          </section>

          <section className="hsp-card">
            <div className="hsp-card-head"><h3>Invite a contractor as a guest</h3></div>
            <p className="hsp-note">They get an account for Hey Social Inc. only: no CreatorHive, and only the channels you add them to.</p>
            <form className="hsp-invite" onSubmit={invite}>
              <input className="field" type="email" required maxLength={254} autoComplete="off" placeholder="name@company.com" aria-label="Email"
                value={inviteEmail} onChange={(event) => setInviteEmail(event.target.value)} />
              <button type="submit" className="btn honey" disabled={busy === "invite"}>{spin("invite")}Send invite</button>
            </form>
            {pending.map((guest) => (
              <div key={guest.id} className="hsp-row">
                <Avatar name={guest.email} seed={guest.id} size={36} />
                <span className="hsp-who">
                  <b>{guest.email}</b>
                  <small>Invite sent · expires {new Date(guest.expiresAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</small>
                </span>
                <span className="hsp-pill guest">Guest</span>
              </div>
            ))}
          </section>
        </div>
      </div>
    </div>
  );
}
