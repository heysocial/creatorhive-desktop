import { useEffect, useState, type CSSProperties, type FormEvent } from "react";
import { Check, Copy, Link2, Loader2, MailCheck, RefreshCw, RotateCcw, Trash2, UserX } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { ch } from "../../lib/bridge";
import { api, ApiError, queryClient } from "../../lib/api";
import type { Member, MemberBadge } from "../../lib/community";
import { STATUS_LABELS, type DealStatus } from "../../lib/hub";
import { openLink } from "../../lib/html";
import { openSettings } from "../../lib/links";
import { Avatar } from "../../lib/ui";
import { Modal } from "../hub/parts";
import "../../styles/admin-members.css";

/*
  What owner and team can do on the website's Members page (InviteMembers,
  the card's ⋯ menu and its dialogs), with the same rules:
  - Invite member and Pending invites (resend, copy link, revoke): owner and
    team; only the owner may invite to the team (/api/invites*).
  - Invite several at once (/api/invites/bulk), under the same rules.
  - Manage badge and Manage access: the owner (/api/members/[id]/badge|access),
    access for students only.
  - Make team member / Make student, and Remove member: the owner, on anyone
    but the owner and themselves (/api/members/[id]/role|status). Former
    members, with Reactivate: the owner (/api/members/former).
  - View briefs: owner and team, on anyone but themselves.
  Every route checks again for itself.
*/

export const isStaff = (role?: string) => role === "owner" || role === "team";

/** The directory row as the owner gets it: the plan and badge controls ride along. */
export interface AdminMember extends Member {
  accessAdmin?: { level: "academy" | "starter"; endsAt: string | null } | null;
  badgeAdmin?: { titleId: string | null; beeTierOverride: BeeTierKey | null; automaticBadge: MemberBadge } | null;
}

/* ---------- Pending invites ---------- */

type Delivery = "not_sent" | "pending" | "sent" | "failed";
interface PendingInvite {
  id: string;
  email: string;
  role: "student" | "team";
  /** The plan the account starts on; absent on invites made before plans. */
  accessLevel?: "academy" | "starter";
  expiresAt: string;
  invitedByName: string;
  link: string;
  deliveryStatus: Delivery;
}
type InviteResult = Pick<PendingInvite, "id" | "email" | "role" | "accessLevel" | "expiresAt" | "link" | "deliveryStatus">;

const INVITES_KEY = ["members", "invites"] as const;

function planLabel(role: PendingInvite["role"], accessLevel: PendingInvite["accessLevel"]) {
  if (role === "team") return "Team";
  return accessLevel === "starter" ? "Student · UGC Starter" : "Student · UGC Academy";
}

function expiryLabel(value: string) {
  const remaining = Math.ceil((new Date(value).getTime() - Date.now()) / 86_400_000);
  if (remaining <= 1) return "Expires today";
  return `Expires in ${remaining} days`;
}

const DELIVERY: Record<Delivery, string> = { sent: "Email sent", failed: "Email failed", pending: "Sending email…", not_sent: "Email not sent" };

function DeliveryChip({ status, short = false }: { status: Delivery; short?: boolean }) {
  return <span className="mad-delivery" data-status={status}>{short && status === "pending" ? "Sending…" : DELIVERY[status]}</span>;
}

export function usePendingInvites(enabled: boolean) {
  return useQuery({
    queryKey: INVITES_KEY,
    enabled,
    queryFn: async () => (await api<{ invites: PendingInvite[] }>("/api/invites")).invites,
  });
}

/** The website's "Pending invites" card, above the directory. */
export function PendingInvites() {
  const invites = usePendingInvites(true);
  const [listError, setListError] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [resendingId, setResendingId] = useState<string | null>(null);
  const list = invites.data ?? [];
  const setList = (update: (current: PendingInvite[]) => PendingInvite[]) => queryClient.setQueryData<PendingInvite[]>(INVITES_KEY, (current) => update(current ?? []));

  async function copy(invite: Pick<PendingInvite, "id" | "link">) {
    try {
      await navigator.clipboard.writeText(invite.link);
      setCopiedId(invite.id);
      window.setTimeout(() => setCopiedId((current) => current === invite.id ? null : current), 1800);
    } catch {
      setListError("Could not copy the link. Select and copy it manually.");
    }
  }

  async function revoke(invite: PendingInvite) {
    if (!window.confirm(`Revoke this invite?\n\n${invite.email} will no longer be able to use this link.`)) return;
    setRevokingId(invite.id);
    const previous = list;
    setList((current) => current.filter((item) => item.id !== invite.id));
    try {
      await api(`/api/invites/${invite.id}`, { method: "DELETE" });
    } catch {
      queryClient.setQueryData(INVITES_KEY, previous);
      setListError("Could not revoke that invite. Try again.");
    } finally {
      setRevokingId(null);
    }
  }

  async function resend(invite: PendingInvite) {
    if (resendingId) return;
    const previousStatus = invite.deliveryStatus;
    setResendingId(invite.id);
    setListError(null);
    setList((current) => current.map((item) => item.id === invite.id ? { ...item, deliveryStatus: "pending" } : item));
    try {
      const data = await api<{ deliveryStatus: Delivery }>(`/api/invites/${invite.id}`, { method: "POST" });
      setList((current) => current.map((item) => item.id === invite.id ? { ...item, deliveryStatus: data.deliveryStatus } : item));
    } catch (error) {
      setList((current) => current.map((item) => item.id === invite.id ? { ...item, deliveryStatus: previousStatus } : item));
      const message = error instanceof ApiError && typeof error.data?.message === "string" ? error.data.message : null;
      setListError(message ?? "Could not resend that invite. Try again.");
    } finally {
      setResendingId(null);
    }
  }

  const failed = invites.isError ? "Could not load pending invites. Try again." : null;
  return (
    <section className="mad-pending card" aria-label="Pending invites">
      <div className="mad-pending-head">
        <div>
          <h2>Pending invites</h2>
          <p>Links expire after seven days and can only be used once.</p>
        </div>
        {!invites.isLoading ? <span className="mad-count">{list.length}</span> : null}
      </div>
      {invites.isLoading ? (
        <div className="mad-line"><Loader2 className="spin" /></div>
      ) : (failed || listError) && list.length === 0 ? (
        <div className="mad-error" role="alert">{listError ?? failed} <button className="link" onClick={() => { setListError(null); void invites.refetch(); }}>Try again</button></div>
      ) : list.length === 0 ? (
        <div className="mad-line"><MailCheck className="mad-ok" /><span>No pending invites</span></div>
      ) : (
        <div>
          {listError ? <div className="mad-error" role="alert">{listError}</div> : null}
          {list.map((invite) => (
            <div className="mad-invite" key={invite.id}>
              <div className="mad-who">
                <b className="selectable">{invite.email}</b>
                <span>{planLabel(invite.role, invite.accessLevel)} · {expiryLabel(invite.expiresAt)} · Invited by {invite.invitedByName}</span>
                <DeliveryChip status={invite.deliveryStatus} />
              </div>
              <div className="mad-acts">
                <button className="btn" disabled={Boolean(resendingId) || revokingId === invite.id} onClick={() => void resend(invite)}>
                  {resendingId === invite.id ? <Loader2 className="spin" /> : <RefreshCw />}Resend invite
                </button>
                <button className="btn" onClick={() => void copy(invite)}>
                  {copiedId === invite.id ? <Check /> : <Copy />}{copiedId === invite.id ? "Copied" : "Copy link"}
                </button>
                <button className="iconbtn" aria-label={`Revoke invite for ${invite.email}`} title="Revoke invite" disabled={revokingId === invite.id} onClick={() => void revoke(invite)}>
                  <Trash2 />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

/* ---------- Invite a member ---------- */

const INVITE_ERRORS: Record<string, string> = {
  invalid_email: "Enter a valid email address.",
  invalid_role: "Choose a valid role.",
  role_forbidden: "Only an owner can invite another team member.",
  account_exists: "An account already exists for this email.",
  invalid_access_level: "Choose UGC Academy or UGC Starter.",
  starter_requires_student: "UGC Starter is for students only.",
};

/** One line of a bulk invite's outcome — see `POST /api/invites/bulk`. */
type BulkInviteResult =
  | { email: string; status: "invited" | "invite_pending"; invite: Omit<InviteResult, "link">; link: string }
  | { email: string; status: "already_member"; deactivated: boolean }
  | { email: string; status: "invalid" | "failed" };

const BULK_INVITE_MAX = 50;

const BULK_ERRORS: Record<string, string> = {
  no_emails: "Paste at least one email address.",
  too_many: `Up to ${BULK_INVITE_MAX} emails at a time.`,
  role_forbidden: "Only an owner can invite another team member.",
  invalid_access_level: "Choose UGC Academy or UGC Starter.",
  starter_requires_student: "UGC Starter is for students only.",
};

/** The pasted list as the server will read it: split, lower-cased, de-duplicated. */
function countEmails(value: string) {
  return new Set(value.split(/[\s,;]+/).map((item) => item.trim().toLowerCase()).filter(Boolean)).size;
}

function bulkResultLabel(result: BulkInviteResult): { label: string; tone: Delivery } {
  switch (result.status) {
    case "invited":
      return result.invite.deliveryStatus === "sent"
        ? { label: "Invited · email sent", tone: "sent" }
        : { label: "Invited · email failed", tone: "failed" };
    case "invite_pending": return { label: "Already has an invite", tone: "pending" };
    case "already_member": return result.deactivated
      ? { label: "Former member · reactivate instead", tone: "not_sent" }
      : { label: "Already a member", tone: "not_sent" };
    case "invalid": return { label: "Not a valid email", tone: "failed" };
    default: return { label: "Failed", tone: "failed" };
  }
}

export function InviteDialog({ role, onClose }: { role: "owner" | "team"; onClose: () => void }) {
  const [email, setEmail] = useState("");
  // One person, or several pasted at once with one role and plan.
  const [mode, setMode] = useState<"one" | "many">("one");
  const [emails, setEmails] = useState("");
  const [bulkResults, setBulkResults] = useState<BulkInviteResult[] | null>(null);
  const [inviteRole, setInviteRole] = useState<"student" | "team">("student");
  // The plan: the full UGC Academy, or UGC Starter for six months from when they join.
  const [inviteAccess, setInviteAccess] = useState<"academy" | "starter">("academy");
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [created, setCreated] = useState<InviteResult | null>(null);
  const [copied, setCopied] = useState(false);

  async function submitBulk() {
    try {
      const data = await api<{ results: BulkInviteResult[] }>("/api/invites/bulk", {
        method: "POST",
        body: { emails, role: inviteRole, accessLevel: inviteRole === "student" ? inviteAccess : "academy" },
      });
      setBulkResults(data.results);
      void queryClient.invalidateQueries({ queryKey: INVITES_KEY });
    } catch (error) {
      const data = error instanceof ApiError ? error.data : null;
      setFormError(error instanceof ApiError && error.status > 0 && data
        ? BULK_ERRORS[String(data.error)] ?? "Could not create these invites. Try again."
        : "Could not create these invites. Check your connection and try again.");
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setFormError(null);
    if (mode === "many") {
      await submitBulk();
      setSubmitting(false);
      return;
    }
    try {
      const data = await api<{ invite: Omit<InviteResult, "link">; link: string }>("/api/invites/create", {
        method: "POST",
        body: { email, role: inviteRole, accessLevel: inviteRole === "student" ? inviteAccess : "academy" },
      });
      setCreated({ ...data.invite, link: data.link });
      void queryClient.invalidateQueries({ queryKey: INVITES_KEY });
    } catch (error) {
      const data = error instanceof ApiError ? error.data : null;
      // Already invited: the website shows that invite and its link.
      if (data?.error === "invite_pending" && data.invite && typeof data.link === "string") {
        setCreated({ ...(data.invite as Omit<InviteResult, "link">), link: data.link });
        void queryClient.invalidateQueries({ queryKey: INVITES_KEY });
      } else if (error instanceof ApiError && error.status > 0 && data) {
        setFormError(INVITE_ERRORS[String(data.error)] ?? "Could not create this invite. Try again.");
      } else {
        setFormError("Could not create this invite. Check your connection and try again.");
      }
    } finally {
      setSubmitting(false);
    }
  }

  async function copy() {
    if (!created) return;
    try {
      await navigator.clipboard.writeText(created.link);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setFormError("Could not copy the link. Select and copy it manually.");
    }
  }

  const description = bulkResults
    ? `${bulkResults.filter((result) => result.status === "invited").length} of ${bulkResults.length} invited. Each has seven days to create their account.`
    : created
    ? created.deliveryStatus === "sent"
      ? "The invitation email was sent. Keep the private link as a fallback."
      : created.deliveryStatus === "pending"
        ? "The invitation email is sending. Keep the private link as a fallback."
        : "Email delivery failed. Copy the private link and send it manually."
    : "They’ll have seven days to create their account.";

  return (
    <Modal
      title={bulkResults ? "Invites" : created ? "Invite ready" : mode === "many" ? "Invite members" : "Invite a member"}
      onClose={() => !submitting && onClose()}
      width={440}
      foot={bulkResults ? <button className="btn honey mad-wide" onClick={onClose}>Done</button> : created ? <button className="btn honey mad-wide" onClick={() => void copy()}>{copied ? <Check /> : <Copy />}{copied ? "Copied" : "Copy invite link"}</button> : undefined}
    >
      <div className="mad-dialog">
        <p className="mad-desc">{description}</p>
        {bulkResults ? (
          <ul className="mad-bulk-results" aria-label="Invite results">
            {bulkResults.map((result) => {
              const { label, tone } = bulkResultLabel(result);
              return (
                <li key={result.email}>
                  <span className="selectable">{result.email}</span>
                  <span className="mad-delivery" data-status={tone}>{label}</span>
                </li>
              );
            })}
          </ul>
        ) : created ? (
          <>
            <div className="mad-created">
              <span className="selectable">{created.email}</span>
              <span className="mad-chips">
                <span className="mad-role">{planLabel(created.role, created.accessLevel)}</span>
                <DeliveryChip status={created.deliveryStatus} short />
              </span>
            </div>
            <label className="mad-field">
              <span>Invite link</span>
              <textarea className="field area selectable" readOnly value={created.link} rows={3} onFocus={(event) => event.currentTarget.select()} />
            </label>
            <p className="mad-desc">{expiryLabel(created.expiresAt)}. Once redeemed, this link stops working.</p>
            {formError ? <div className="mad-error" role="alert">{formError}</div> : null}
          </>
        ) : (
          <form className="mad-form" onSubmit={submit}>
            <div className="seg mad-seg" role="group" aria-label="How many people">
              <button type="button" className={mode === "one" ? "on" : ""} aria-pressed={mode === "one"} disabled={submitting} onClick={() => { setMode("one"); setFormError(null); }}>One person</button>
              <button type="button" className={mode === "many" ? "on" : ""} aria-pressed={mode === "many"} disabled={submitting} onClick={() => { setMode("many"); setFormError(null); }}>Several</button>
            </div>
            {mode === "one" ? (
              <label className="mad-field">
                <span>Email</span>
                <input className="field" type="email" required maxLength={254} autoComplete="email" autoFocus placeholder="member@example.com"
                  value={email} onChange={(event) => setEmail(event.target.value)} disabled={submitting} />
              </label>
            ) : (
              <label className="mad-field">
                <span>Emails</span>
                <textarea className="field area mad-bulk-input" required rows={5} autoFocus placeholder={"ava@example.com\nben@example.com, cara@example.com"}
                  value={emails} onChange={(event) => setEmails(event.target.value)} disabled={submitting} />
                <small>
                  One per line, or separated by commas or spaces. Up to {BULK_INVITE_MAX}.
                  {emails.trim() ? ` ${countEmails(emails)} ${countEmails(emails) === 1 ? "email" : "emails"}.` : ""}
                </small>
              </label>
            )}
            <fieldset>
              <legend>Role</legend>
              <div className="mad-options">
                <label className={inviteRole === "student" ? "on" : undefined}>
                  <input type="radio" name="invite-role" value="student" checked={inviteRole === "student"} onChange={() => setInviteRole("student")} />
                  <span><b>Student</b><small>Community and learning access</small></span>
                </label>
                {role === "owner" ? (
                  <label className={inviteRole === "team" ? "on" : undefined}>
                    <input type="radio" name="invite-role" value="team" checked={inviteRole === "team"} onChange={() => setInviteRole("team")} />
                    <span><b>Team</b><small>Internal management access</small></span>
                  </label>
                ) : null}
              </div>
            </fieldset>
            {inviteRole === "student" ? (
              <fieldset>
                <legend>Plan</legend>
                <div className="mad-options">
                  <label className={inviteAccess === "academy" ? "on" : undefined}>
                    <input type="radio" name="invite-access" value="academy" checked={inviteAccess === "academy"} onChange={() => setInviteAccess("academy")} />
                    <span><b>UGC Academy</b><small>Everything: community, courses, coaching</small></span>
                  </label>
                  <label className={inviteAccess === "starter" ? "on" : undefined}>
                    <input type="radio" name="invite-access" value="starter" checked={inviteAccess === "starter"} onChange={() => setInviteAccess("starter")} />
                    <span><b>UGC Starter</b><small>Six months from when they join: Script Writer, Hub, New Bee, DMs with Vince, Wins</small></span>
                  </label>
                </div>
              </fieldset>
            ) : null}
            {formError ? <div className="mad-error" role="alert">{formError}</div> : null}
            <button type="submit" className="btn honey mad-wide" disabled={submitting}>
              {submitting ? <Loader2 className="spin" /> : null}
              {mode === "many" ? (countEmails(emails) > 1 ? `Create ${countEmails(emails)} invites` : "Create invites") : "Create invite"}
            </button>
          </form>
        )}
      </div>
    </Modal>
  );
}

/* ---------- The card's ⋯ menu ---------- */

export type MemberDialog = { kind: "badge" | "access" | "briefs"; member: AdminMember } | null;

/** Owner only, and never the owner or yourself: role and Remove member. */
const manageable = (member: AdminMember, viewer: { id: string; role?: string }) =>
  viewer.role === "owner" && member.id !== viewer.id && (member.role === "student" || member.role === "team");

/** Whether this card gets a ⋯ at all, as on the website. */
export function hasMemberActions(member: AdminMember, viewer: { id: string; role?: string }) {
  return member.id === viewer.id || viewer.role === "owner" || (isStaff(viewer.role) && member.id !== viewer.id);
}

/** The website's MemberActionsMenu, as a native menu. */
export async function memberActionsMenu(member: AdminMember, viewer: { id: string; role?: string }, open: (dialog: MemberDialog) => void) {
  const owner = viewer.role === "owner";
  const self = member.id === viewer.id;
  const items = [
    ...(owner ? [{ id: "badge", label: "Manage badge" }] : []),
    ...(owner && member.accessAdmin && member.role === "student" ? [{ id: "access", label: "Manage access" }] : []),
    ...(self ? [{ id: "edit", label: "Edit profile" }] : []),
    ...(manageable(member, viewer) ? [{ id: "role", label: member.role === "team" ? "Make student" : "Make team member" }] : []),
    ...(isStaff(viewer.role) && !self ? [{ id: "briefs", label: "View briefs" }] : []),
    ...(manageable(member, viewer) ? [{ type: "separator" as const }, { id: "remove", label: "Remove member…" }] : []),
  ];
  if (!items.length) return;
  const choice = await ch.menu.popup(items);
  if (choice === "edit") openSettings("account");
  else if (choice === "badge" || choice === "access" || choice === "briefs") open({ kind: choice, member });
  else if (choice === "role") await changeRole(member);
  else if (choice === "remove") await removeMember(member);
}

/**
 * Make team member / Make student. Owner only. A new team member gets the
 * full UGC Academy; someone made a student again is signed out everywhere.
 */
async function changeRole(member: AdminMember) {
  const toTeam = member.role === "student";
  const ok = window.confirm(toTeam
    ? `Make ${member.name} a team member?\n\nThey get team access: course admin, removing anyone’s posts and messages, inviting students, and Hey Social Inc. Their plan becomes the full UGC Academy.`
    : `Make ${member.name} a student?\n\nThey lose team access and are signed out everywhere. They sign back in as a student, on the full UGC Academy.`);
  if (!ok) return;
  try {
    await api(`/api/members/${member.id}/role`, { method: "PATCH", body: { role: toTeam ? "team" : "student" } });
    await queryClient.invalidateQueries({ queryKey: ["members"] });
    void queryClient.invalidateQueries({ queryKey: ["profile", member.id] });
  } catch {
    window.alert(`Could not change ${member.name}’s role. Try again.`);
  }
}

/**
 * Remove member: they can no longer sign in, and what they wrote stays,
 * shown to everyone as Former member. Undone from Former members.
 */
async function removeMember(member: AdminMember) {
  if (!window.confirm(`Remove ${member.name}?\n\nThey won’t be able to sign in. Their posts and messages stay, shown as Former member. You can reactivate them later.`)) return;
  try {
    await api(`/api/members/${member.id}/status`, { method: "PATCH", body: { status: "deactivated" } });
    queryClient.setQueryData<AdminMember[]>(["members"], (current) => current?.filter((m) => m.id !== member.id));
    void queryClient.invalidateQueries({ queryKey: ["members"] });
    void queryClient.invalidateQueries({ queryKey: FORMER_KEY });
    void queryClient.invalidateQueries({ queryKey: ["profile", member.id] });
  } catch {
    window.alert(`Could not remove ${member.name}. Try again.`);
  }
}

/* ---------- Former members ---------- */

interface FormerMember { id: string; name: string; email: string; role: string; avatarUrl: string | null; deactivatedAt: string | null }

const FORMER_KEY = ["members", "former"] as const;

/**
 * The website's Former members card, under Pending invites. Owner only: the
 * one place a removed member's real name shows. Hidden while there are none.
 */
export function FormerMembers() {
  const former = useQuery({ queryKey: FORMER_KEY, queryFn: async () => (await api<{ members: FormerMember[] }>("/api/members/former")).members });
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const list = former.data ?? [];

  async function reactivate(member: FormerMember) {
    if (!window.confirm(`Reactivate ${member.name}?\n\nThey can sign in again, and their name and photo come back everywhere.`)) return;
    setBusyId(member.id);
    setError(null);
    try {
      await api(`/api/members/${member.id}/status`, { method: "PATCH", body: { status: "active" } });
      queryClient.setQueryData<FormerMember[]>(FORMER_KEY, (current) => current?.filter((m) => m.id !== member.id));
      void queryClient.invalidateQueries({ queryKey: ["members"] });
      void queryClient.invalidateQueries({ queryKey: ["profile", member.id] });
    } catch {
      setError(`Could not reactivate ${member.name}. Try again.`);
    } finally {
      setBusyId(null);
    }
  }

  if (list.length === 0 && !error) return null;
  return (
    <section className="mad-pending card" aria-label="Former members">
      <div className="mad-pending-head">
        <div>
          <h2>Former members</h2>
          <p>They can’t sign in. Everyone else sees their posts and messages as Former member.</p>
        </div>
        <span className="mad-count">{list.length}</span>
      </div>
      {error ? <div className="mad-error" role="alert">{error}</div> : null}
      {list.length === 0 ? <div className="mad-line"><UserX /><span>No former members</span></div> : null}
      {list.map((member) => (
        <div className="mad-invite" key={member.id}>
          <div className="mad-former">
            <Avatar name={member.name} src={member.avatarUrl} seed={member.id} size={32} />
            <div className="mad-who">
              <b className="selectable">{member.name}</b>
              <span>{member.email} · {member.role === "team" ? "Team" : "Student"} · {member.deactivatedAt ? `Removed ${fmtDay(member.deactivatedAt)}` : "Removed"}</span>
            </div>
          </div>
          <div className="mad-acts">
            <button className="btn" disabled={Boolean(busyId)} onClick={() => void reactivate(member)}>
              {busyId === member.id ? <Loader2 className="spin" /> : <RotateCcw />}Reactivate
            </button>
          </div>
        </div>
      ))}
    </section>
  );
}

/** Put a saved member back into the directory, and drop their cached profile. */
function updateMember(id: string, patch: Partial<AdminMember>) {
  queryClient.setQueryData<AdminMember[]>(["members"], (current) => current?.map((m) => m.id === id ? { ...m, ...patch } : m));
  void queryClient.invalidateQueries({ queryKey: ["profile", id] });
}

/* ---------- Manage access ---------- */

const fmtDay = (iso: string) => new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });

/**
 * Manage access: UGC Academy, or UGC Starter until a date. Owner only — the
 * route refuses anyone else, and refuses staff as members (they are never
 * limited). Takes effect within two minutes, without signing them out.
 */
export function ManageAccessDialog({ member, onClose }: { member: AdminMember; onClose: () => void }) {
  const current = member.accessAdmin ?? { level: "academy" as const, endsAt: null };
  const [level, setLevel] = useState<"academy" | "starter">(current.level);
  const [endsOn, setEndsOn] = useState(() => {
    const end = current.endsAt ? new Date(current.endsAt) : (() => { const d = new Date(); d.setMonth(d.getMonth() + 6); return d; })();
    // The local day (the website takes the UTC one, a day late in the Americas).
    return `${end.getFullYear()}-${String(end.getMonth() + 1).padStart(2, "0")}-${String(end.getDate()).padStart(2, "0")}`;
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ended = current.level === "starter" && current.endsAt != null && new Date(current.endsAt).getTime() <= Date.now();

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const data = await api<{ member: { accessLevel: "academy" | "starter"; accessEndsAt: string | null; badge: MemberBadge } }>(`/api/members/${member.id}/access`, {
        method: "PATCH",
        body: level === "academy"
          ? { accessLevel: "academy" }
          // End of that day where the owner is, so "ends Apr 7" means through Apr 7.
          : { accessLevel: "starter", endsAt: new Date(`${endsOn}T23:59:59`).toISOString() },
      });
      updateMember(member.id, { badge: data.member.badge, accessAdmin: { level: data.member.accessLevel, endsAt: data.member.accessEndsAt } });
      onClose();
    } catch (saveError) {
      const messages: Record<string, string> = {
        access_requires_student: "Plans apply to students only.",
        invalid_ends_at: "Choose a valid end date.",
        member_not_found: "This member is no longer active.",
      };
      setError((saveError instanceof ApiError && messages[String(saveError.data?.error)]) || "Access could not be changed.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      title="Manage access"
      onClose={() => !saving && onClose()}
      width={420}
      foot={<>
        <button className="btn" onClick={onClose} disabled={saving}>Cancel</button>
        <button className="btn honey" onClick={() => void save()} disabled={saving}>{saving ? <Loader2 className="spin" /> : null}Save access</button>
      </>}
    >
      <div className="mad-dialog">
        <p className="mad-desc">
          {current.level === "starter"
            ? `${member.name} is on UGC Starter${current.endsAt ? `, ${ended ? "ended" : "ending"} ${fmtDay(current.endsAt)}` : ""}.`
            : `${member.name} has the full UGC Academy.`}
        </p>
        <label className="mad-field">
          <span>Plan</span>
          <select className="field" value={level} onChange={(event) => setLevel(event.target.value as "academy" | "starter")}>
            <option value="academy">UGC Academy — everything</option>
            <option value="starter">UGC Starter — limited</option>
          </select>
        </label>
        {level === "starter" ? (
          <label className="mad-field">
            <span>Ends on</span>
            <input className="field" type="date" value={endsOn} onChange={(event) => setEndsOn(event.target.value)} />
          </label>
        ) : (
          <p className="mad-desc">Opens every course, channel, event and DM, and adds them to #general.</p>
        )}
        {error ? <p className="mad-error" role="alert">{error}</p> : null}
      </div>
    </Modal>
  );
}

/* ---------- Manage badge ---------- */

export type BeeTierKey = "newbie" | "hustle" | "pro" | "pink_queen";
const BEE_TIERS: { key: BeeTierKey; name: string; range: string }[] = [
  { key: "newbie", name: "New Bee", range: "$0–999" },
  { key: "hustle", name: "Hustle Bee", range: "$1,000–2,999" },
  { key: "pro", name: "Pro Bee", range: "$3,000–9,999" },
  { key: "pink_queen", name: "King/Queen Bee", range: "$10,000+" },
];

export const TITLE_COLORS = [
  { key: "teal", label: "Teal", hex: "#2A9D8F" },
  { key: "blue", label: "Blue", hex: "#3B82F6" },
  { key: "indigo", label: "Indigo", hex: "#6366F1" },
  { key: "violet", label: "Violet", hex: "#8B5CF6" },
  { key: "orchid", label: "Orchid", hex: "#B453C6" },
  { key: "rose", label: "Rose", hex: "#D65A7A" },
  { key: "coral", label: "Coral", hex: "#E06B56" },
  { key: "amber", label: "Amber", hex: "#B7791F" },
  { key: "green", label: "Green", hex: "#3A9363" },
  { key: "slate", label: "Slate", hex: "#718096" },
] as const;
export type TitleColorKey = (typeof TITLE_COLORS)[number]["key"];
export const titleColorHex = (key: unknown) => TITLE_COLORS.find((color) => color.key === key)?.hex ?? TITLE_COLORS[0].hex;

export interface MemberTitle { id: string; name: string; countsAsCoach: boolean; colorKey: TitleColorKey; assignedCount: number; createdAt?: string; updatedAt?: string }

/** A custom title's badge, in its colour (the website's member-badge--team with a title colour). */
export function TitleBadge({ name, colorKey }: { name: string; colorKey: string }) {
  return <span className="mad-title-badge" style={{ "--title-color": titleColorHex(colorKey) } as CSSProperties}>{name}</span>;
}

function badgeEmoji(kind: string | null | undefined) {
  if (kind === "pro") return "🐝";
  if (kind === "top") return "👑";
  return null;
}

export function ManageBadgeDialog({ member, onClose }: { member: AdminMember; onClose: () => void }) {
  const [titles, setTitles] = useState<MemberTitle[]>([]);
  const [titlesLoading, setTitlesLoading] = useState(true);
  const [titleId, setTitleId] = useState(member.badgeAdmin?.titleId ?? "");
  const [tierOverride, setTierOverride] = useState<BeeTierKey | "">(member.badgeAdmin?.beeTierOverride ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isStudent = member.role === "student";

  useEffect(() => {
    let cancelled = false;
    api<{ titles: MemberTitle[] }>("/api/settings/member-titles")
      .then((data) => { if (!cancelled) setTitles(data.titles); })
      .catch(() => { if (!cancelled) setError("Member titles could not be loaded. You can still manage the tier override."); })
      .finally(() => { if (!cancelled) setTitlesLoading(false); });
    return () => { cancelled = true; };
  }, []);

  async function save() {
    if (saving || titlesLoading) return;
    setSaving(true);
    setError(null);
    try {
      const body: { titleId: string | null; beeTierOverride?: BeeTierKey | null } = { titleId: titleId || null };
      if (isStudent) body.beeTierOverride = tierOverride || null;
      const data = await api<{ member: { titleId: string | null; beeTierOverride: BeeTierKey | null; badge: MemberBadge } }>(`/api/members/${member.id}/badge`, { method: "PATCH", body });
      updateMember(member.id, {
        badge: data.member.badge,
        badgeAdmin: {
          titleId: data.member.titleId,
          beeTierOverride: data.member.beeTierOverride,
          automaticBadge: member.badgeAdmin?.automaticBadge ?? member.badge ?? { kind: "new", label: "New Bee" },
        },
      });
      onClose();
    } catch {
      setError("That badge could not be saved. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  const currentTitle = titles.find((title) => title.id === titleId);
  const fallbackBadge = member.badgeAdmin?.automaticBadge ?? member.badge;
  const previewLabel = currentTitle?.name
    ?? (isStudent && tierOverride ? BEE_TIERS.find((tier) => tier.key === tierOverride)?.name : fallbackBadge?.label)
    ?? "No badge";
  const previewKind = isStudent && tierOverride ? (tierOverride === "newbie" ? "new" : tierOverride === "pink_queen" ? "top" : tierOverride) : fallbackBadge?.kind ?? "new";
  const emoji = badgeEmoji(previewKind);

  return (
    <Modal
      title="Manage badge"
      onClose={onClose}
      width={420}
      foot={<>
        <button className="btn" onClick={onClose} disabled={saving}>Cancel</button>
        <button className="btn honey" onClick={() => void save()} disabled={saving || titlesLoading}>{saving ? <Loader2 className="spin" /> : null}Save badge</button>
      </>}
    >
      <div className="mad-dialog roomy">
        <p className="mad-desc">Choose the one badge shown next to {member.name} throughout CreatorHive.</p>
        <div className="mad-preview">
          <div><small>Badge preview</small><b>{member.name}</b></div>
          {currentTitle
            ? <TitleBadge name={currentTitle.name} colorKey={currentTitle.colorKey} />
            : <span className={`badge-pill k-${previewKind}`}>{emoji ? <span aria-hidden>{emoji} </span> : null}{previewLabel}</span>}
        </div>
        <label className="mad-field">
          <span>Custom title</span>
          <select className="field" value={titleId} disabled={titlesLoading} onChange={(event) => setTitleId(event.target.value)}>
            <option value="">No custom title</option>
            {titles.map((title) => <option value={title.id} key={title.id}>{title.name}{title.countsAsCoach ? " — counts as coach" : ""}</option>)}
          </select>
          <small>A custom title replaces the role or Bee tier badge.</small>
        </label>
        {isStudent ? (
          <label className="mad-field">
            <span>Bee tier</span>
            <select className="field" value={tierOverride} onChange={(event) => setTierOverride(event.target.value as BeeTierKey | "")}>
              <option value="">Automatic — {member.badgeAdmin?.automaticBadge.label ?? "calculated from income"}</option>
              {BEE_TIERS.map((tier) => <option value={tier.key} key={tier.key}>{tier.name} · {tier.range}</option>)}
            </select>
            <small>Remove the override at any time to return to the automatic income tier.</small>
          </label>
        ) : (
          <p className="mad-desc mad-rule">
            Without a custom title, {member.name} shows the role badge “{member.badgeAdmin?.automaticBadge.label ?? member.badge?.label ?? member.role}”.
          </p>
        )}
        {titlesLoading ? <div className="mad-desc mad-loading"><Loader2 className="spin" /> Loading titles…</div> : null}
        {error ? <p className="mad-error" role="alert">{error}</p> : null}
      </div>
    </Modal>
  );
}

/* ---------- View briefs ---------- */

interface Brief { id: string; filename: string; kind: "pdf" | "word" | "image" | "link"; sizeBytes: number | null; site?: string | null; url: string | null }
interface BriefDeal { dealId: string; brandName: string; status: DealStatus; briefs: Brief[] }

function formatSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/** For coaches: every brief a member has added to their deals, grouped by deal. Read-only. */
export function MemberBriefsDialog({ member, onClose }: { member: AdminMember; onClose: () => void }) {
  const briefs = useQuery({
    queryKey: ["members", "briefs", member.id],
    staleTime: 0,
    queryFn: async () => (await api<{ deals: BriefDeal[] }>(`/api/members/${member.id}/briefs`)).deals,
  });
  const open = (brief: Brief) => {
    if (!brief.url) return;
    if (brief.kind === "link") void openLink(brief.url);
    else void ch.files.quickLook(brief.url, brief.filename);
  };
  return (
    <Modal title={`${member.name}’s briefs`} onClose={onClose} width={500}>
      <div className="mad-dialog roomy">
        <p className="mad-desc">Files brands sent for their deals. Only they and coaches can see these.</p>
        {briefs.isError ? <p className="mad-desc">Briefs didn’t load. Close and try again.</p> : null}
        {briefs.isLoading ? <p className="mad-desc">Loading…</p> : null}
        {briefs.data?.length === 0 ? <p className="mad-desc">No briefs on any of their deals yet.</p> : null}
        {briefs.data?.map((deal) => (
          <section key={deal.dealId} className="mad-brief-deal">
            <h3>{deal.brandName} <span>· {STATUS_LABELS[deal.status] ?? deal.status}</span></h3>
            {deal.briefs.map((brief) => (
              <div key={brief.id} className="mad-brief">
                {brief.url
                  ? <button className="mad-brief-name" onClick={() => open(brief)}>{brief.kind === "link" ? <Link2 /> : null}{brief.filename}</button>
                  : <span className="mad-brief-name">{brief.filename}</span>}
                <span className="faint">{brief.kind === "link" ? brief.site ?? "Link" : formatSize(brief.sizeBytes ?? 0)}</span>
              </div>
            ))}
          </section>
        ))}
      </div>
    </Modal>
  );
}
