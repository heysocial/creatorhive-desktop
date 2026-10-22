import { useEffect, useRef, useState, type ReactNode } from "react";
import { Bell, CircleUser, Keyboard, Loader2, Paintbrush, Receipt, Settings as Cog, Shield } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { ch, type DesktopSettings, type SessionUser } from "../../lib/bridge";
import { api, ApiError, queryClient } from "../../lib/api";
import { Avatar } from "../../lib/ui";
import { SHORTCUTS } from "../../overlays/Sheets";

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
  return (
    <>{SHORTCUTS.map(([group, rows]) => (
      <Group key={group} title={group}>{rows.map(([label, keys]) => <Row key={label} title={label}><kbd className="kbd-lg">{keys}</kbd></Row>)}</Group>
    ))}</>
  );
}

interface InvoiceProfile { businessName: string; ownerName: string; email: string; paypal: string; zelle: string; cashapp: string; defaultTermsDays: number; numberPrefix: string; nextNumber: number; isSetUp: boolean }

function HubInvoices() {
  const profile = useQuery({ queryKey: ["invoice-profile"], retry: false, queryFn: async () => { try { return (await api<{ profile: InvoiceProfile }>("/api/invoice-profile")).profile; } catch { return null; } } });
  const [draft, setDraft] = useState<Partial<InvoiceProfile>>({});
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  if (profile.isLoading) return <p className="muted">Loading…</p>;
  if (!profile.data) return <p className="muted">Invoices aren't switched on for your account yet.</p>;
  const v = { ...profile.data, ...draft };
  const field = (key: keyof InvoiceProfile, label: string, type = "text") => (
    <Row title={label}><input className="field" type={type} value={String(v[key] ?? "")} onChange={(e) => { setDraft({ ...draft, [key]: type === "number" ? Number(e.target.value) : e.target.value }); setSaved(false); }} /></Row>
  );
  return (
    <>
      <Group title="Invoice details">
        {field("businessName", "Business name")}
        {field("ownerName", "Your name")}
        {field("email", "Email (clients reply here)", "email")}
        {field("defaultTermsDays", "Default terms (days)", "number")}
        {field("numberPrefix", "Invoice number prefix")}
      </Group>
      <Group title="How clients pay you">
        {field("paypal", "PayPal")}
        {field("zelle", "Zelle")}
        {field("cashapp", "Cash App")}
      </Group>
      <div className="row" style={{ justifyContent: "flex-end", gap: 10 }}>
        {saved ? <span className="muted">Saved</span> : null}
        <button className="btn" onClick={() => ch.app.openSite("/settings/invoice")}>Logo and bank details on the website</button>
        <button className="btn honey" disabled={saving || Object.keys(draft).length === 0} onClick={async () => {
          setSaving(true);
          try { await api("/api/invoice-profile", { method: "PUT", body: draft }); setDraft({}); setSaved(true); void profile.refetch(); } catch { window.alert("Couldn't save."); } finally { setSaving(false); }
        }}>{saving ? <Loader2 className="spin" /> : null}Save</button>
      </div>
    </>
  );
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

interface Profile { name: string; avatarUrl: string | null; bio: string | null; instagram: string | null; location: string | null; headline: string | null }

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
          <span className="row"><Avatar name={v.name ?? user.name} src={v.avatarUrl} size={56} seed={user.id} /><span><b>{v.name}</b><small>{user.email}</small></span></span>
          <span className="set-ctl">
            <button className="btn" disabled={avatarBusy} onClick={() => picker.current?.click()}>{avatarBusy ? <Loader2 className="spin" /> : null}Change photo</button>
            <input ref={picker} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={async (e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (!file) return;
              setAvatarBusy(true);
              const result = await ch.files.uploadForm({ path: "/api/profile/avatar", field: "file", name: file.name, type: file.type, bytes: await file.arrayBuffer() });
              setAvatarBusy(false);
              if (!result.ok) window.alert(result.error === "avatar_upload_rate_limited" ? "You can change your photo again in a few minutes." : result.error === "avatar_file_too_large" ? "That photo is over 3 MB." : "Couldn't change your photo.");
              void profile.refetch();
            }} />
          </span>
        </div>
        {field("name", "Name", 80)}
        {field("headline", "Headline", 80)}
        {field("location", "Location", 100)}
        {field("instagram", "Instagram", 60)}
        {field("bio", "Bio", 160, true)}
        <div className="set-row" style={{ justifyContent: "flex-end" }}>
          <button className="btn honey" disabled={busy || Object.keys(draft).length === 0} onClick={async () => {
            setBusy(true);
            setErrors({});
            try { await api("/api/profile", { method: "PATCH", body: draft }); setDraft({}); void profile.refetch(); void queryClient.invalidateQueries({ queryKey: ["profile"] }); }
            catch (e) { if (e instanceof ApiError && e.data?.fieldErrors) setErrors(e.data.fieldErrors as Record<string, string>); else window.alert("Couldn't save your profile."); }
            finally { setBusy(false); }
          }}>Save profile</button>
        </div>
      </Group>
      <Group title="Sign-in">
        <Row title="Email and password" sub={user.email}><button className="btn" onClick={() => ch.app.openSite("/settings")}>Change on the website</button></Row>
        <Row title="Sign out of this Mac"><button className="btn" onClick={() => void ch.auth.signOut()}>Sign out</button></Row>
      </Group>
    </>
  );
}

export function SettingsWindow({ user }: { user: SessionUser }) {
  const [tab, setTab] = useState<Tab>(() => (new URLSearchParams(location.hash.split("?")[1] ?? "").get("tab") as Tab) || "general");
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
