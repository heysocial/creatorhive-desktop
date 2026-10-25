import { useEffect, useRef, useState, type ReactNode } from "react";
import { Bell, CircleUser, Keyboard, Loader2, Paintbrush, Receipt, Settings as Cog, Shield } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { ch, type DesktopSettings, type SessionUser } from "../../lib/bridge";
import { api, ApiError, queryClient } from "../../lib/api";
import { Avatar } from "../../lib/ui";
import { useShortcuts } from "../../overlays/Sheets";
import { InvoiceDetailsForm, useInvoiceProfile } from "../hub/InvoiceDetails";

/* The Settings window (⌘,): what this Mac does, and your account on the server. */

type Tab = "general" | "notifications" | "appearance" | "shortcuts" | "hub" | "privacy" | "account";
const TABS: { id: Tab; label: string; icon: ReactNode }[] = [
  { id: "general", label: "General", icon: <Cog /> },
  { id: "notifications", label: "Notifications", icon: <Bell /> },
  { id: "appearance", label: "Appearance", icon: <Paintbrush /> },
  { id: "shortcuts", label: "Shortcuts", icon: <Keyboard /> },
  { id: "hub", label: "Hub & invoices", icon: <Receipt /> },
  { id: "privacy", label: "Privacy", icon: <Shield /> },
  { id: "account", label: "Account", icon: <CircleUser /> },
];

function Toggle({ on, onChange, disabled }: { on: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return <button role="switch" aria-checked={on} disabled={disabled} className={`switch ${on ? "on" : ""}`} onClick={() => onChange(!on)}><i /></button>;
}
function Row({ title, sub, children }: { title: string; sub?: string; children: ReactNode }) {
  return <div className="set-row"><span><b>{title}</b>{sub ? <small>{sub}</small> : null}</span><span className="set-ctl">{children}</span></div>;
}
function Group({ title, children }: { title?: string; children: ReactNode }) {
  return <section className="set-group">{title ? <h3>{title}</h3> : null}<div className="set-card">{children}</div></section>;
}

function useDesktop() {
  const [settings, setSettings] = useState<DesktopSettings | null>(null);
  useEffect(() => { void ch.settings.get().then(setSettings); }, []);
  const update = async (patch: Partial<DesktopSettings>) => setSettings(await ch.settings.set(patch));
  return { settings, update };
}

interface Prefs { dmMessages: boolean; channelMessages: boolean; mentions: boolean; announcements: boolean; hubReminders: boolean; postComments: boolean; postReactions: boolean; eventReminders: boolean }
const PREF_ROWS: [keyof Prefs, string, string][] = [
  ["dmMessages", "Direct messages", "When someone sends you a DM"],
  ["mentions", "Mentions", "@you, @everyone and @channel"],
  ["channelMessages", "Thread replies", "Threads you started or replied in"],
  ["postComments", "Comments on your posts", "When someone comments on or replies to your post"],
  ["postReactions", "Reactions to your posts", "When someone reacts to your post"],
  ["announcements", "Announcements", "Important CreatorHive updates"],
  ["eventReminders", "Events", "10 minutes before, with a Join button"],
  ["hubReminders", "Deal reminders", "Drafts and payments due today"],
];

function Notifications() {
  const { settings, update } = useDesktop();
  const prefs = useQuery({ queryKey: ["notification-prefs"], queryFn: async () => (await api<{ preferences: Prefs }>("/api/notifications/preferences")).preferences });
  async function setPref(key: keyof Prefs, value: boolean) {
    const next = { ...prefs.data!, [key]: value };
    queryClient.setQueryData(["notification-prefs"], next);
    try { await api("/api/notifications/preferences", { method: "PATCH", body: next }); } catch { void prefs.refetch(); }
  }
  return (
    <>
      <Group title="On this Mac">
        <Row title="Show notifications" sub="Banners for what you choose below, even with the window closed">
          <Toggle on={settings?.notifications ?? false} onChange={(v) => void update({ notifications: v })} />
        </Row>
        <Row title="Sound" sub="Plays with each banner">
          <select value={settings?.sound ?? "honey"} onChange={(e) => void update({ sound: e.target.value as DesktopSettings["sound"] })}>
            <option value="honey">🐝 Honey chime</option><option value="system">Mac default</option><option value="none">None</option>
          </select>
        </Row>
        <Row title="Bounce the Dock icon" sub="Once, when a notification arrives and CreatorHive isn't in front">
          <Toggle on={settings?.bounceDock ?? true} onChange={(v) => void update({ bounceDock: v })} />
        </Row>
        <Row title="Dock badge counts">
          <div className="seg">{(["mentions", "off"] as const).map((m) => <button key={m} className={settings?.badge === m ? "on" : ""} onClick={() => void update({ badge: m })}>{m === "mentions" ? "DMs & mentions" : "Off"}</button>)}</div>
        </Row>
        <Row title="Pause notifications" sub={settings?.pausedUntil && settings.pausedUntil > Date.now() ? `Paused until ${new Date(settings.pausedUntil).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}` : "Mac Focus modes are respected too"}>
          <Toggle on={Boolean(settings?.pausedUntil && settings.pausedUntil > Date.now())} onChange={(v) => void update({ pausedUntil: v ? Date.now() + 3600_000 : 0 })} />
        </Row>
      </Group>
      <Group title="Send me notifications for">
        {prefs.data ? PREF_ROWS.map(([key, title, sub]) => (
          <Row key={key} title={title} sub={sub}><Toggle on={prefs.data![key]} onChange={(v) => void setPref(key, v)} /></Row>
        )) : <div className="set-row muted">{prefs.isError ? "Couldn't load your choices." : "Loading…"}</div>}
      </Group>
      <p className="faint set-note">These choices are your account's: they apply on the website and iPhone too.</p>
    </>
  );
}

function General() {
  const { settings, update } = useDesktop();
  const [version, setVersion] = useState("");
  useEffect(() => { void ch.info().then((i) => setVersion(i.version)); }, []);
  return (
    <>
      <Group>
        <Row title="Open at login" sub="Starts in the menu bar, ready for notifications"><Toggle on={settings?.openAtLogin ?? false} onChange={(v) => void update({ openAtLogin: v })} /></Row>
        <Row title="Keep running when the window is closed" sub="Closing the window leaves CreatorHive in the menu bar"><Toggle on={settings?.keepRunning ?? true} onChange={(v) => void update({ keepRunning: v })} /></Row>
      </Group>
      <Group title="About">
        <Row title={`Version ${version}`} sub="Updates download on their own and install when you quit"><button className="btn" onClick={() => ch.app.checkUpdates()}>Check for updates</button></Row>
      </Group>
    </>
  );
}

function Appearance() {
  const { settings, update } = useDesktop();
  return (
    <Group>
      <Row title="Theme" sub="Light, dark, or match the Mac">
        <div className="seg">{(["system", "light", "dark"] as const).map((t) => <button key={t} className={(settings?.theme ?? "system") === t ? "on" : ""} onClick={() => void update({ theme: t })}>{t === "system" ? "Match Mac" : t[0].toUpperCase() + t.slice(1)}</button>)}</div>
      </Row>
      <Row title="Text size" sub="⌘+ and ⌘− work anywhere too">
        <div className="seg">{([0.9, 1, 1.1, 1.2] as const).map((z) => <button key={z} className={(settings?.zoom ?? 1) === z ? "on" : ""} onClick={() => void update({ zoom: z })}>{Math.round(z * 100)}%</button>)}</div>
      </Row>
    </Group>
  );
}

function Shortcuts() {
  const shortcuts = useShortcuts();
  return (
    <>{shortcuts.map(([group, rows]) => (
      <Group key={group} title={group}>{rows.map(([label, keys]) => <Row key={label} title={label}><kbd className="kbd-lg">{keys}</kbd></Row>)}</Group>
    ))}</>
  );
}

function HubInvoices() {
  const profile = useInvoiceProfile();
  if (profile.isLoading) return <p className="muted">Loading…</p>;
  if (profile.isError) return <p className="muted">Couldn't load your invoice details.</p>;
  if (!profile.data) return <p className="muted">Invoices aren't switched on for your account yet.</p>;
  return <div className="set-card idf-card"><InvoiceDetailsForm profile={profile.data} /></div>;
}

function Privacy() {
  const { settings, update } = useDesktop();
  const income = useQuery({ queryKey: ["leaderboard", "income"], retry: false, queryFn: async () => { try { return await api<{ eligible: boolean; isSharing: boolean }>("/api/leaderboard/income"); } catch { return null; } } });
  const blocks = useQuery({ queryKey: ["blocks"], retry: false, queryFn: async () => { try { return (await api<{ blocks: { id: string; name: string; avatarUrl: string | null }[] }>("/api/moderation/blocks")).blocks; } catch { return null; } } });
  return (
    <>
      {income.data?.eligible ? (
        <Group title="Income leaderboard">
          <Row title="Show my income on the board" sub="Your collected amount this month, next to your name">
            <Toggle on={income.data.isSharing} onChange={async (v) => { await api("/api/leaderboard/income", { method: "PUT", body: { shareIncome: v } }).catch(() => null); void income.refetch(); }} />
          </Row>
        </Group>
      ) : null}
      {settings?.touchIdAvailable ? (
        <Group title="On this Mac">
          <Row title="Lock with Touch ID" sub="Asks for your fingerprint when CreatorHive opens and after the Mac sleeps or locks">
            <Toggle on={settings.touchId} onChange={(v) => void update({ touchId: v })} />
          </Row>
        </Group>
      ) : null}
      <Group title="Blocked members">
        {blocks.data?.length ? blocks.data.map((b) => (
          <Row key={b.id} title={b.name}><button className="btn" onClick={async () => { await api(`/api/moderation/blocks/${b.id}`, { method: "DELETE" }).catch(() => null); void blocks.refetch(); }}>Unblock</button></Row>
        )) : <div className="set-row muted">{blocks.isLoading ? "Loading…" : "You haven't blocked anyone."}</div>}
      </Group>
    </>
  );
}

interface Profile { name: string; avatarUrl: string | null; bio: string | null; instagram: string | null; location: string | null; headline: string | null; gender: "male" | "female" | "unspecified" | null }

function Account({ user }: { user: SessionUser }) {
  const profile = useQuery({ queryKey: ["my-profile"], queryFn: async () => (await api<{ profile: Profile }>("/api/profile")).profile });
  const [draft, setDraft] = useState<Partial<Profile>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [avatarBusy, setAvatarBusy] = useState(false);
  const picker = useRef<HTMLInputElement>(null);
  const v = { ...(profile.data ?? {}), ...draft } as Profile;
  const field = (key: keyof Profile, label: string, max: number, area = false) => (
    <Row title={label}>
      {area ? <textarea className="field area" maxLength={max} value={v[key] ?? ""} onChange={(e) => setDraft({ ...draft, [key]: e.target.value })} />
        : <input className="field" maxLength={max} value={v[key] ?? ""} onChange={(e) => setDraft({ ...draft, [key]: e.target.value })} />}
      {errors[key] ? <small className="late-text">{errors[key]}</small> : null}
    </Row>
  );
  return (
    <>
      <Group title="Profile">
        <div className="set-row">
          <span className="set-who"><Avatar name={v.name ?? user.name} src={v.avatarUrl} size={56} seed={user.id} /><span><b>{v.name}</b><small>{user.email}</small></span></span>
          <span className="set-ctl">
            <button className="btn" disabled={avatarBusy} onClick={() => picker.current?.click()}>{avatarBusy ? <Loader2 className="spin" /> : null}Change photo</button>
            <input ref={picker} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={async (e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (!file) return;
              setAvatarBusy(true);
              const result = await ch.files.uploadForm({ path: "/api/profile/avatar", field: "file", name: file.name, type: file.type, bytes: await file.arrayBuffer() });
              setAvatarBusy(false);
              if (!result.ok) window.alert(result.error === "avatar_upload_rate_limited" ? photoWait(result.data) : result.error === "avatar_file_too_large" ? "That photo is over 3 MB." : "Couldn't change your photo.");
              else profileChanged({ image: (result.data as { avatarUrl?: string } | undefined)?.avatarUrl ?? null });
              void profile.refetch();
            }} />
          </span>
        </div>
        {field("name", "Name", 80)}
        {field("headline", "Headline", 80)}
        {field("location", "Location", 100)}
        {field("instagram", "Instagram", 60)}
        {field("bio", "Bio", 160, true)}
        <Row title="Gender" sub="Sets King Bee or Queen Bee at the top tier">
          <select value={v.gender ?? ""} onChange={(e) => setDraft({ ...draft, gender: (e.target.value || null) as Profile["gender"] })}>
            <option value="">Not set</option><option value="female">Female</option><option value="male">Male</option><option value="unspecified">Prefer not to say</option>
          </select>
        </Row>
        <div className="set-row" style={{ justifyContent: "flex-end" }}>
          <button className="btn honey" disabled={busy || Object.keys(draft).length === 0} onClick={async () => {
            setBusy(true);
            setErrors({});
            try {
              const saved = await api<{ profile: Profile }>("/api/profile", { method: "PATCH", body: draft });
              setDraft({});
              void profile.refetch();
              profileChanged({ name: saved.profile.name });
            }
            catch (e) { if (e instanceof ApiError && e.data?.fieldErrors) setErrors(e.data.fieldErrors as Record<string, string>); else window.alert("Couldn't save your profile."); }
            finally { setBusy(false); }
          }}>Save profile</button>
        </div>
      </Group>
      <Group title="Sign-in">
        <ChangeEmail current={user.email} />
        <ChangePassword />
        <Row title="Sign out of this Mac"><button className="btn" onClick={() => void ch.auth.signOut()}>Sign out</button></Row>
      </Group>
      <DeleteAccount />
    </>
  );
}

/** "Try again in 7 minutes", from the wait the server sends with a rate limit. */
function photoWait(data: unknown) {
  const seconds = Number((data as { retryAfterSeconds?: unknown } | undefined)?.retryAfterSeconds);
  if (!Number.isFinite(seconds) || seconds <= 0) return "You can change your photo again in a few minutes.";
  const minutes = Math.ceil(seconds / 60);
  return `You changed your photo recently. Try again in ${minutes === 1 ? "a minute" : `${minutes} minutes`}.`;
}

/*
  The main window is its own renderer with its own cache: tell every window the
  profile changed (through the main process's relay), so your profile, the
  feed and the rail show the new name or photo straight away.
*/
function profileChanged(change: { name?: string; image?: string | null }) {
  void queryClient.invalidateQueries({ queryKey: ["profile"] });
  ch.app.relay({ topic: "profile", action: "changed", data: change });
}

/* The website's three lines of what goes (the iPhone shows the same). */
const ERASED = [
  "Your Hub — every deal, its contacts, and your recorded income",
  "Your course progress, streaks and points",
  "Your profile, photo and notification settings",
];

function deleteError(e: unknown) {
  const status = e instanceof ApiError ? e.status : 0;
  const code = e instanceof ApiError ? e.code : undefined;
  if (status === 403 || code === "current_password_incorrect") return "That password doesn't match. Your account has not been deleted.";
  if (code === "current_password_required") return "Enter your password to delete your account.";
  if (status === 401) return "Your session has ended. Sign in again to delete your account.";
  return "We couldn't delete your account. Check your connection and try again.";
}

/*
  Deleting the account, in the website's order: the password first, then one
  last confirmation, then the request. The server re-checks the password and
  erases the account; signing out afterwards leaves nothing of it on this Mac.
*/
function DeleteAccount() {
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function remove() {
    if (busy || !password) return;
    setError(null);
    if (!window.confirm("Delete your account?\n\nThis cannot be undone. Your Hub deals, progress and profile are erased. Posts and messages you sent stay in the community, but no longer show your name.")) return;
    setBusy(true);
    try {
      await api("/api/settings/account", { method: "DELETE", body: { currentPassword: password } });
    } catch (e) {
      setError(deleteError(e));
      setBusy(false);
      return;
    }
    // The account is gone whatever happens next.
    await ch.auth.signOut();
  }

  return (
    <Group title="Delete account">
      <div className="set-row set-form">
        <span>
          <b>Deleting your account is permanent</b>
          <small>There is no undo, and no way for the team to bring it back.</small>
          <small className="set-del-head">What is erased</small>
          <ul className="set-del-list">{ERASED.map((line) => <li key={line}><small>{line}</small></li>)}</ul>
          <small className="set-del-head">What stays</small>
          <small>Posts, comments and messages you sent remain in the community so other members' conversations still make sense. Your name and photo come off them.</small>
        </span>
      </div>
      <div className="set-row set-form">
        <span>
          <b>Password</b>
          <small>Your password is the confirmation. You'll be asked once more before anything is erased.</small>
        </span>
        <form className="set-fields" onSubmit={(e) => { e.preventDefault(); void remove(); }}>
          <input className="field" type="password" placeholder="Your password" autoComplete="current-password" value={password} disabled={busy} onChange={(e) => setPassword(e.target.value)} />
          {error ? <small className="late-text">{error}</small> : null}
          <span className="row" style={{ justifyContent: "flex-end", gap: 8 }}>
            <button className="btn" disabled={busy || !password}>{busy ? <Loader2 className="spin" /> : null}{busy ? "Deleting…" : "Delete my account"}</button>
          </span>
        </form>
      </div>
    </Group>
  );
}

const ACCOUNT_ERRORS: Record<string, string> = {
  current_password_incorrect: "Your current password isn't right.",
  invalid_email: "That doesn't look like an email address.",
  email_already_in_use: "Another account already uses that email.",
  invalid_new_password: "Your new password needs at least 8 characters.",
  password_unchanged: "That's your current password. Pick a new one.",
};
const accountError = (e: unknown) => (e instanceof ApiError && ACCOUNT_ERRORS[e.code ?? ""]) || "Couldn't save. Try again.";

/* Both changes ask for your current password, as the website does. */
function ChangeEmail({ current }: { current: string }) {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [state, setState] = useState<{ busy?: boolean; error?: string; done?: string }>({});
  const [shown, setShown] = useState(current);
  if (!open) return <Row title="Email" sub={state.done ? `Changed to ${state.done}` : shown}><button className="btn" onClick={() => { setOpen(true); setEmail(""); setPassword(""); setState({}); }}>Change email</button></Row>;
  return (
    <div className="set-row set-form">
      <span><b>Change email</b><small>You'll sign in with the new one from now on.</small></span>
      <form className="set-fields" onSubmit={async (e) => {
        e.preventDefault();
        setState({ busy: true });
        try {
          const result = await api<{ email: string }>("/api/settings/account", { method: "PATCH", body: { action: "email", email, currentPassword: password } });
          setShown(result.email); setState({ done: result.email }); setOpen(false);
        } catch (err) { setState({ error: accountError(err) }); }
      }}>
        <input className="field" type="email" placeholder="New email" autoFocus required maxLength={254} value={email} onChange={(e) => setEmail(e.target.value)} />
        <input className="field" type="password" placeholder="Current password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        {state.error ? <small className="late-text">{state.error}</small> : null}
        <span className="row" style={{ justifyContent: "flex-end", gap: 8 }}>
          <button type="button" className="btn" onClick={() => setOpen(false)}>Cancel</button>
          <button className="btn honey" disabled={state.busy || !email || !password}>{state.busy ? <Loader2 className="spin" /> : null}Save email</button>
        </span>
      </form>
    </div>
  );
}

function ChangePassword() {
  const [open, setOpen] = useState(false);
  const [fields, setFields] = useState({ current: "", next: "", again: "" });
  const [state, setState] = useState<{ busy?: boolean; error?: string; done?: boolean }>({});
  if (!open) return <Row title="Password" sub={state.done ? "Changed" : "At least 8 characters"}><button className="btn" onClick={() => { setOpen(true); setFields({ current: "", next: "", again: "" }); setState({}); }}>Change password</button></Row>;
  const set = (key: keyof typeof fields) => (e: React.ChangeEvent<HTMLInputElement>) => setFields({ ...fields, [key]: e.target.value });
  return (
    <div className="set-row set-form">
      <span><b>Change password</b><small>Other devices stay signed in.</small></span>
      <form className="set-fields" onSubmit={async (e) => {
        e.preventDefault();
        if (fields.next !== fields.again) { setState({ error: "The new passwords don't match." }); return; }
        setState({ busy: true });
        try {
          await api("/api/settings/account", { method: "PATCH", body: { action: "password", currentPassword: fields.current, newPassword: fields.next } });
          setState({ done: true }); setOpen(false);
        } catch (err) { setState({ error: accountError(err) }); }
      }}>
        <input className="field" type="password" placeholder="Current password" autoFocus required value={fields.current} onChange={set("current")} />
        <input className="field" type="password" placeholder="New password" required minLength={8} value={fields.next} onChange={set("next")} />
        <input className="field" type="password" placeholder="New password again" required value={fields.again} onChange={set("again")} />
        {state.error ? <small className="late-text">{state.error}</small> : null}
        <span className="row" style={{ justifyContent: "flex-end", gap: 8 }}>
          <button type="button" className="btn" onClick={() => setOpen(false)}>Cancel</button>
          <button className="btn honey" disabled={state.busy || !fields.current || fields.next.length < 8}>{state.busy ? <Loader2 className="spin" /> : null}Save password</button>
        </span>
      </form>
    </div>
  );
}

export function SettingsWindow({ user }: { user: SessionUser }) {
  const tabInHash = () => new URLSearchParams(location.hash.split("?")[1] ?? "").get("tab") as Tab | null;
  const [tab, setTab] = useState<Tab>(() => tabInHash() || "general");
  // Edit profile, invoice details and the like open this window on their tab.
  useEffect(() => {
    const follow = () => { const next = tabInHash(); if (next && TABS.some((t) => t.id === next)) setTab(next); };
    window.addEventListener("hashchange", follow);
    return () => window.removeEventListener("hashchange", follow);
  }, []);
  const current = TABS.find((t) => t.id === tab)!;
  return (
    <div className="settings-window">
      <div className="set-head">
        <div className="set-title">{current.label}</div>
        <div className="set-tabs">{TABS.map((t) => <button key={t.id} className={tab === t.id ? "on" : ""} onClick={() => setTab(t.id)}>{t.icon}<span>{t.label}</span></button>)}</div>
      </div>
      <div className="set-body scroll">
        {tab === "general" ? <General /> : null}
        {tab === "notifications" ? <Notifications /> : null}
        {tab === "appearance" ? <Appearance /> : null}
        {tab === "shortcuts" ? <Shortcuts /> : null}
        {tab === "hub" ? <HubInvoices /> : null}
        {tab === "privacy" ? <Privacy /> : null}
        {tab === "account" ? <Account user={user} /> : null}
      </div>
    </div>
  );
}
