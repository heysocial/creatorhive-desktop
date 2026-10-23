import { useState } from "react";
import { Loader2, Users } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { api, ApiError, queryClient } from "../../lib/api";
import { Avatar } from "../../lib/ui";
import { Modal } from "./parts";

/*
  Share my Hub (the website's ShareHubPanel): invite a business partner by
  email, see who's in the Hub, remove a partner, leave a Hub, and answer an
  invite. Everything goes through /api/hub/sharing.
*/

type Role = "owner" | "partner";
interface SharingState {
  hub: { id: string; role: Role; shared: boolean };
  members: { id: string; name: string; initials: string; avatarUrl: string | null; role: Role; joinedAt: string; isMe: boolean }[];
  outgoingInvite: { id: string; invitedUser: { id: string; name: string; email: string }; createdAt: string } | null;
  incomingInvites: { id: string; from: { id: string; name: string; avatarUrl: string | null }; createdAt: string; myDealCount: number }[];
}

const first = (name: string) => name.trim().split(/\s+/)[0] || name;
const since = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

export function useHubSharing() {
  return useQuery({ queryKey: ["hub", "sharing"], staleTime: 30_000, queryFn: () => api<SharingState>("/api/hub/sharing") });
}

/** After any change: the sharing state, and the Hub itself (deals move with people). */
async function refresh() {
  await queryClient.invalidateQueries({ queryKey: ["hub"] });
}

function SharePanel({ state }: { state: SharingState }) {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const isOwner = state.hub.role === "owner";
  const partner = state.members.find((m) => m.role === "partner");
  const owner = state.members.find((m) => m.role === "owner");
  const invite = state.outgoingInvite;

  async function run(kind: string, action: () => Promise<unknown>) {
    setBusy(kind); setError(null);
    try { await action(); await refresh(); return true; }
    catch (e) { setError((e instanceof ApiError && typeof e.data?.message === "string" ? e.data.message : null) ?? "That didn't work. Try again."); return false; }
    finally { setBusy(null); }
  }

  const lead = !state.hub.shared
    ? "Run one Hub with your business partner. You'll both see and edit the same deals, board, Cash and Dashboard. Each deal still counts toward the person who added it, for badges and leaderboards."
    : isOwner && partner
      ? `You share this Hub with ${first(partner.name)}. You can remove ${first(partner.name)} at any time; deals ${first(partner.name)} added stay here.`
      : `You share ${owner ? `${first(owner.name)}'s` : "this"} Hub. You both see and edit every deal; each deal counts toward whoever added it.`;

  return (
    <div className="share-hub">
      <p className="muted" style={{ marginTop: 0 }}>{lead}</p>

      {isOwner && !state.hub.shared && !invite ? (
        <form className="share-form" onSubmit={async (e) => {
          e.preventDefault();
          if (!email.trim()) { setError("Type your partner's email."); return; }
          if (await run("invite", () => api("/api/hub/sharing/invites", { method: "POST", body: { email: email.trim() } }))) setEmail("");
        }}>
          <label htmlFor="hub-share-email" className="section-label">Partner's email</label>
          <div className="row" style={{ gap: 8 }}>
            <input id="hub-share-email" className="field" type="email" autoFocus autoComplete="off" placeholder="name@example.com" value={email} disabled={busy !== null} onChange={(e) => setEmail(e.target.value)} />
            <button className="btn honey" disabled={busy !== null}>{busy === "invite" ? <Loader2 className="spin" /> : null}Send invite</button>
          </div>
        </form>
      ) : null}

      {error ? <p className="late-text" role="alert">{error}</p> : null}

      {state.incomingInvites.map((incoming) => (
        <div key={incoming.id} className="share-row invite">
          <Avatar name={incoming.from.name} src={incoming.from.avatarUrl} seed={incoming.from.id} size={32} />
          <span className="t"><b>{incoming.from.name} invited you to share {first(incoming.from.name)}'s Hub</b>
            <small className="muted">{incoming.myDealCount ? `You can bring your ${incoming.myDealCount} ${incoming.myDealCount === 1 ? "deal" : "deals"} with you.` : "Accept to work from the same deals."}</small></span>
          <span className="row" style={{ gap: 6 }}>
            <button className="btn" disabled={busy !== null} onClick={() => void run("decline", () => api(`/api/hub/sharing/invites/${incoming.id}/decline`, { method: "POST" }))}>Decline</button>
            {incoming.myDealCount ? <button className="btn" disabled={busy !== null} onClick={() => void run("accept-empty", () => api(`/api/hub/sharing/invites/${incoming.id}/accept`, { method: "POST", body: { bringDeals: false } }))}>Accept without my deals</button> : null}
            <button className="btn honey" disabled={busy !== null} onClick={() => void run("accept", () => api(`/api/hub/sharing/invites/${incoming.id}/accept`, { method: "POST", body: { bringDeals: true } }))}>
              {busy === "accept" ? <Loader2 className="spin" /> : null}{incoming.myDealCount ? `Accept and bring ${incoming.myDealCount}` : "Accept"}
            </button>
          </span>
        </div>
      ))}

      <div className="share-list">
        {state.members.map((member) => (
          <div key={member.id} className="share-row">
            <Avatar name={member.name} src={member.avatarUrl} seed={member.id} size={32} />
            <span className="t"><b>{member.name}{member.isMe ? " (you)" : ""}</b><small className="muted">{member.role === "owner" ? "Owner" : `Partner since ${since(member.joinedAt)}`}</small></span>
            {isOwner && member.role === "partner" ? (
              <button className="btn" disabled={busy !== null} onClick={() => {
                const name = first(member.name);
                if (window.confirm(`Remove ${name}?\n\nDeals ${name} added stay in your Hub and keep counting toward ${name}. Deals ${name} brought in go back to ${name}.`)) void run("remove", () => api(`/api/hub/sharing/members/${member.id}`, { method: "DELETE" }));
              }}>{busy === "remove" ? <Loader2 className="spin" /> : null}Remove</button>
            ) : null}
            {!isOwner && member.isMe ? (
              <button className="btn" disabled={busy !== null} onClick={() => {
                const name = owner ? first(owner.name) : "this";
                if (window.confirm(`${owner ? `Leave ${name}'s Hub?` : "Leave this Hub?"}\n\nDeals you added while sharing stay in ${owner ? `${name}'s` : "this"} Hub and keep counting toward you. You go back to your own Hub, with any deals you brought in.`)) void run("leave", () => api("/api/hub/sharing/leave", { method: "POST" }));
              }}>{busy === "leave" ? <Loader2 className="spin" /> : null}Leave Hub</button>
            ) : null}
          </div>
        ))}
        {isOwner && invite ? (
          <div className="share-row">
            <Avatar name={invite.invitedUser.name} seed={invite.invitedUser.id} size={32} />
            <span className="t"><b>{invite.invitedUser.name}</b><small className="muted">Invite sent · waiting for {first(invite.invitedUser.name)}</small></span>
            <button className="btn" disabled={busy !== null} onClick={() => void run("cancel", () => api(`/api/hub/sharing/invites/${invite.id}`, { method: "DELETE" }))}>{busy === "cancel" ? <Loader2 className="spin" /> : null}Cancel invite</button>
          </div>
        ) : null}
      </div>
    </div>
  );
}

/** The Hub header's entry point: "Share my Hub" while alone, "Shared with …" once shared. */
export function ShareHubButton() {
  const sharing = useHubSharing();
  const [open, setOpen] = useState(false);
  const state = sharing.data;
  const others = state?.members.filter((m) => !m.isMe) ?? [];
  const owner = state?.members.find((m) => m.role === "owner");
  const title = state?.hub.role === "partner" && owner ? `${first(owner.name)}'s Hub` : "Share my Hub";
  const invited = (state?.incomingInvites.length ?? 0) > 0;
  return (
    <>
      {state?.hub.shared ? (
        <button className="btn share-pill" onClick={() => setOpen(true)}>
          <span className="stack">{state.members.map((m) => <Avatar key={m.id} name={m.name} src={m.avatarUrl} seed={m.id} size={20} />)}</span>
          Shared with {others.map((m) => first(m.name)).join(", ")}
        </button>
      ) : (
        <button className={`btn ${invited ? "honey" : ""}`} onClick={() => setOpen(true)}><Users />{invited ? "Hub invite" : "Share my Hub"}</button>
      )}
      {open ? (
        <Modal title={title} width={520} onClose={() => setOpen(false)}>
          {state ? <SharePanel state={state} /> : <p className="muted">{sharing.isError ? "Couldn't load sharing. Try again." : "Loading…"}</p>}
        </Modal>
      ) : null}
    </>
  );
}
