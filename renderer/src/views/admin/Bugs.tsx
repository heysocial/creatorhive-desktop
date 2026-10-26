import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, Bell, Bug, Check, ClipboardCopy, Globe, Laptop, Search, Server, Smartphone, X } from "lucide-react";
import { ApiError } from "../../lib/api";
import {
  BUG_STATUSES, PLATFORM_LABEL, STATUS_LABEL, bugOccurrencesFrom, setBugStatus, useBug, useBugs,
  type BugDetail, type BugFilters, type BugGroup, type BugOccurrence, type BugPlatform, type BugPlatformFilter, type BugStatus, type BugStatusFilter,
} from "../../lib/adminBugs";
import { nav } from "../../lib/nav";
import { LbAvatar as Avatar } from "../people/LeaderboardParts";
import "../people/leaderboard-web.css";
import "../../styles/admin-bugs.css";

/*
  Admin → Bugs, as the website has it (app/admin/bugs, components/admin/
  Bugs.tsx): every error group the website, the iPhone app, the Mac app and the
  server recorded, Live every 15 seconds, and one group's page with its status,
  Copy for Claude Code, who hit it, every time and the stack. Owner only;
  Admin (Admin.tsx) shows it only when the website lists the tab, and every
  route checks again. The Mac's pane is narrower, so the list leaves out
  "First seen" (it's on the group's own page).
*/

const ICON: Record<BugPlatform, typeof Globe> = { web: Globe, ios: Smartphone, mac: Laptop, server: Server };

/** "12 min ago", "2 h ago", "Today 8:37", "Yesterday 21:40", "Oct 21" (with the time when `absolute`). */
function ago(iso: string, absolute = false, now = Date.now()): string {
  const at = new Date(iso);
  const minutes = Math.round((now - at.getTime()) / 60_000);
  if (!absolute && minutes < 1) return "just now";
  if (!absolute && minutes < 60) return `${minutes} min ago`;
  if (!absolute && minutes < 180) return `${Math.round(minutes / 60)} h ago`;
  const day = (d: Date) => d.toDateString();
  const time = at.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: false });
  if (day(at) === day(new Date(now))) return `Today ${time}`;
  if (day(at) === day(new Date(now - 86_400_000))) return `Yesterday ${time}`;
  return at.toLocaleDateString("en-US", { month: "short", day: "numeric" }) + (absolute ? ` ${time}` : "");
}

/** "Oct 24, 21:23", as the website's formatStamp. */
const stamp = (iso: string) => new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(iso));

function Platform({ platform, version }: { platform: BugPlatform; version: string | null }) {
  const Icon = ICON[platform];
  return <span className="bg-platform"><Icon size={14} aria-hidden /><span><b>{PLATFORM_LABEL[platform]}</b>{version ? <small>{version}</small> : null}</span></span>;
}

function StatusPill({ status }: { status: BugStatus }) {
  return <span className="bg-status" data-status={status}>{STATUS_LABEL[status]}</span>;
}

function Spark({ values }: { values: number[] }) {
  const max = Math.max(1, ...values);
  const total = values.reduce((sum, v) => sum + v, 0);
  return <span className="bg-spark" role="img" aria-label={`${total} in the last 14 days`}>
    {values.map((v, i) => <i key={i} style={{ height: `${Math.max(2, (v / max) * 18)}px` }} data-on={v > 0 || undefined} />)}
  </span>;
}

function LoadError({ error }: { error: unknown }) {
  const gone = error instanceof ApiError && error.status === 404;
  return <div className="bg-missing">
    <b>{gone ? "Not available" : "Couldn't load Bugs."}</b>
    <span>{gone ? "This error group doesn't exist any more, or Bugs isn't open to your account." : "Check your connection and try again."}</span>
  </div>;
}

const STATUS_CHIPS: Array<{ key: BugStatusFilter; label: string; badge?: boolean }> = [
  { key: "open", label: "Open", badge: true },
  { key: "new", label: "New", badge: true },
  { key: "investigating", label: "Investigating" },
  { key: "fixed", label: "Fixed" },
  { key: "ignored", label: "Ignored" },
  { key: "all", label: "All" },
];

const PLATFORM_CHIPS: Array<{ key: BugPlatformFilter; label: string }> = [
  { key: "all", label: "All" },
  { key: "web", label: "Website" },
  { key: "ios", label: "iPhone" },
  { key: "mac", label: "Mac" },
  { key: "server", label: "Server" },
];

// The filters stay while you open a group and come back, as the website keeps them in its address.
let remembered: BugFilters & { live: boolean } = { status: "open", platform: "all", q: "", live: true };

function BugsList() {
  const [status, setStatus] = useState<BugStatusFilter>(remembered.status);
  const [platform, setPlatform] = useState<BugPlatformFilter>(remembered.platform);
  const [q, setQ] = useState(remembered.q);
  const [search, setSearch] = useState(remembered.q);
  const [live, setLive] = useState(remembered.live);
  useEffect(() => {
    const timer = setTimeout(() => setSearch(q.trim()), q.trim() === search ? 0 : 250);
    return () => clearTimeout(timer);
  }, [q, search]);
  useEffect(() => { remembered = { status, platform, q: search, live }; }, [status, platform, search, live]);
  const filters = useMemo(() => ({ status, platform, q: search }), [status, platform, search]);
  const list = useBugs(filters, live);

  if (list.isPending) return <div className="bg-loading">Loading…</div>;
  if (!list.data) return <LoadError error={list.error} />;
  const { kpis, counts, groups } = list.data;
  const filtered = status !== "all" || platform !== "all" || search;

  return <div className="bg-bugs">
    <div className="bg-kpis">
      <article><span>New this week</span><b>{kpis.newThisWeek}</b><small>{kpis.newSinceYesterday} since yesterday</small></article>
      <article><span>Errors today</span><b>{kpis.errorsToday}</b><small>{kpis.errorsYesterday} yesterday</small></article>
      <article><span>People affected</span><b>{kpis.peopleThisWeek}</b><small>this week · of {kpis.members} members</small></article>
      <article><span>Open</span><b>{kpis.open}</b><small>new or investigating</small></article>
    </div>

    <div className="bg-bar">
      <div className="ui-segmented" role="group" aria-label="Status">
        {STATUS_CHIPS.map((chip) => <button key={chip.key} type="button" className="ui-chip" aria-pressed={status === chip.key} onClick={() => setStatus(chip.key)}>
          {chip.label}{chip.badge && counts.status[chip.key] > 0 ? <em className="bg-n">{counts.status[chip.key]}</em> : null}
        </button>)}
      </div>
      <div className="ui-segmented" role="group" aria-label="Platform">
        {PLATFORM_CHIPS.map((chip) => {
          const Icon = chip.key === "all" ? null : ICON[chip.key];
          const n = counts.platform[chip.key];
          return <button key={chip.key} type="button" className="ui-chip" aria-pressed={platform === chip.key} onClick={() => setPlatform(chip.key)} title={`${n} ${n === 1 ? "error" : "errors"}`}>
            <span className="bg-chipRow">{Icon ? <Icon size={13} aria-hidden /> : null}{chip.label}</span>
          </button>;
        })}
      </div>
      <label className="bg-search">
        <Search size={14} aria-hidden />
        <input placeholder="Search errors" value={q} onChange={(event) => setQ(event.target.value)} aria-label="Search errors" />
        {q ? <button type="button" className="bg-searchClear" onClick={() => setQ("")} aria-label="Clear search"><X size={13} /></button> : null}
      </label>
      <button type="button" className="bg-live" data-paused={!live || undefined} onClick={() => setLive((on) => !on)} aria-pressed={live}
        title={live ? "Refreshing every 15 seconds — click to pause" : "Paused — click to refresh live"}>
        <i />{live ? "Live" : "Paused"}
      </button>
    </div>
    {list.isRefetchError ? <p className="bg-error" role="status">Couldn't refresh. Showing what was loaded last.</p> : null}

    <section className="bg-tableCard">
      {groups.length === 0
        ? <div className="bg-empty">
          <Bug size={22} aria-hidden />
          <b>{filtered ? "No errors match" : "No errors recorded"}</b>
          <span>{filtered
            ? search ? `Nothing matches “${search}”. Try another search, or All statuses.`
              : status === "open" ? "Nothing new or being investigated. Try All to see fixed and ignored ones." : "Try another status or platform."
            : "When the website, the iPhone app, the Mac app or the server reports an error, it shows up here."}</span>
        </div>
        : <div className="bg-tableScroll"><table>
          <thead><tr><th>Error</th><th>Where</th><th>Platform</th><th className="bg-r">Times</th><th>Last 14 days</th><th className="bg-r">People</th><th>Last seen</th><th>Status</th></tr></thead>
          <tbody>{groups.map((bug) => <BugRow key={bug.fingerprint} bug={bug} />)}</tbody>
        </table></div>}
      {list.data.truncated ? <div className="bg-foot">Showing the 200 most relevant. Search or filter to narrow it.</div> : null}
      <div className="bg-foot"><Bell size={13} aria-hidden /> New errors alert you right away by push and email. Same error again: at most once every 6 hours. Ignored errors never alert.</div>
    </section>
  </div>;
}

const openBug = (fingerprint: string) => nav.open({ kind: "admin", page: "bugs", id: fingerprint });

function BugRow({ bug }: { bug: BugGroup }) {
  return <tr data-new={bug.status === "new" || undefined} onClick={() => openBug(bug.fingerprint)}>
    <td className="bg-errorCell">
      <button type="button" className="bg-titlebtn" onClick={(event) => { event.stopPropagation(); openBug(bug.fingerprint); }}><b title={bug.message}>{bug.title}</b></button>
      <small><span className="bg-detailText" title={bug.detail ?? undefined}>{bug.kindLabel}{bug.detail ? ` · ${bug.detail}` : ""}</span>{bug.source === "vercel" ? <em className="bg-vercel">Vercel logs</em> : null}</small>
    </td>
    <td className="bg-where">{bug.platform === "ios" || bug.platform === "mac" ? bug.screen : bug.where ?? "—"}</td>
    <td><Platform platform={bug.platform} version={bug.versionLabel} /></td>
    <td className="bg-r"><b>{bug.times}</b></td>
    <td><Spark values={bug.daily} /></td>
    <td className="bg-r">{bug.people || "—"}</td>
    <td className="bg-muted">{ago(bug.lastSeenAt)}</td>
    <td><StatusPill status={bug.status} /></td>
  </tr>;
}

// ——— One group ———

function BugView({ fingerprint }: { fingerprint: string }) {
  const query = useBug(fingerprint, true);
  // Show all: the pages after the first, loaded once; the first page stays live.
  const [rest, setRest] = useState<BugOccurrence[] | null>(null);
  const [loadingRest, setLoadingRest] = useState(false);
  const [copied, setCopied] = useState<"copied" | "failed" | null>(null);
  const [saving, setSaving] = useState<BugStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  const back = <button type="button" className="bg-back" onClick={() => nav.open({ kind: "admin", page: "bugs" })}><ArrowLeft size={15} aria-hidden /> All errors</button>;
  if (query.isPending) return <div className="bg-bugs">{back}<div className="bg-loading">Loading…</div></div>;
  if (!query.data) return <div className="bg-bugs">{back}<LoadError error={query.error} /></div>;
  const detail: BugDetail = query.data;
  const group = saving ? { ...detail.group, status: saving } : detail.group;
  const { who } = detail;

  const seen = new Set<string>();
  const occurrences = [...detail.occurrences.items, ...(rest ?? [])].filter((o) => !seen.has(o.id) && seen.add(o.id));
  const total = detail.occurrences.total;

  async function changeStatus(next: BugStatus) {
    if (next === group.status || saving) return;
    setSaving(next);
    setError(null);
    try {
      await setBugStatus(fingerprint, next);
    } catch {
      setError("Couldn't change the status. Try again.");
    } finally {
      setSaving(null);
    }
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(detail.claudeText);
      setCopied("copied");
    } catch {
      setCopied("failed");
    }
  }

  async function showAll() {
    setLoadingRest(true);
    try {
      const pages: BugOccurrence[] = [];
      let offset = detail.occurrences.items.length;
      for (;;) {
        const page = await bugOccurrencesFrom(fingerprint, offset);
        pages.push(...page.items);
        offset += page.items.length;
        if (!page.hasMore || page.items.length === 0) break;
      }
      setRest(pages);
    } catch {
      setError("Couldn't load every occurrence. Try again.");
    } finally {
      setLoadingRest(false);
    }
  }

  const versions = detail.versions.map((v) => `${v.label} (${v.count})`).join(" · ") || "—";
  const screens = detail.screens.slice(0, 4).map((s) => `${s.screen} (${s.count})`).join(" · ") || "—";
  const peopleLabel = `${group.people} ${group.people === 1 ? "person" : "people"}`;

  return <div className="bg-bugs">
    {back}
    <div className="bg-detailHead">
      <div className="bg-detailTitle">
        <span className="bg-eyebrowRow">
          <Platform platform={group.platform} version={group.versionLabel} />
          <span className="bg-kind">{group.kindLabel}</span>
          <StatusPill status={group.status} />
          {group.source === "vercel" ? <em className="bg-vercel">Vercel logs</em> : null}
        </span>
        <h2>{group.title}</h2>
        {group.detail ? <code>{group.detail}</code> : null}
        {group.statusChangedAt
          ? <span className="bg-changed">{STATUS_LABEL[group.status]} {stamp(group.statusChangedAt)}{detail.statusChangedBy ? ` by ${detail.statusChangedBy.name}` : " — it happened again after being marked Fixed"}</span>
          : null}
      </div>
      <div className="bg-actions">
        <div className={`ui-segmented${saving ? " bg-segBusy" : ""}`} role="group" aria-label="Status">
          {BUG_STATUSES.map((s) => <button key={s} type="button" className="ui-chip" aria-pressed={s === group.status} onClick={() => void changeStatus(s)}>{STATUS_LABEL[s]}</button>)}
        </div>
        <button type="button" className="bg-copy" onClick={() => void copy()}>
          {copied === "copied" ? <><Check size={15} aria-hidden /> Copied</> : <><ClipboardCopy size={15} aria-hidden /> Copy for Claude Code</>}
        </button>
      </div>
    </div>
    {error ? <p className="bg-error" role="alert">{error}</p> : null}

    <div className="bg-facts">
      <div><span>Times</span><b>{group.times}</b></div>
      <div><span>People</span><b>{group.people}</b></div>
      <div><span>First seen</span><b>{stamp(group.firstSeenAt)}</b></div>
      <div><span>Last seen</span><b>{ago(group.lastSeenAt)}</b></div>
      <div><span>{group.platform === "server" || group.platform === "web" ? "Deploys" : "App versions"}</span><b className="bg-small">{versions}</b></div>
      <div><span>{group.platform === "ios" || group.platform === "mac" ? "Screens" : "Routes"}</span><b className="bg-small">{screens}</b></div>
    </div>

    {copied ? <section className="bg-card">
      <h3>{copied === "copied" ? <>Copied to your clipboard <span>paste it into Claude Code</span></> : <>Couldn't reach your clipboard <span>select the text below and copy it</span></>}</h3>
      <pre className="bg-claude">{detail.claudeText}</pre>
    </section> : null}

    <div className="bg-split">
      <section className="bg-card">
        <h3>Who hit it <span>{peopleLabel}{who.signedOutTimes ? ` · ${who.signedOutTimes} ${who.signedOutTimes === 1 ? "time" : "times"} signed out` : ""}</span></h3>
        {detail.people.length === 0
          ? <p className="bg-cardEmpty">{group.platform === "server" ? "Server errors aren't tied to a member." : "Nobody was signed in when this happened."}</p>
          : detail.people.map((p) => <div key={p.id} className="bg-person">
            <Avatar name={p.name} id={p.id} src={p.avatarUrl} size={30} />
            <button type="button" className="bg-personLink" onClick={() => nav.open({ kind: "profile", id: p.id }, "home", "ch")}>
              <span><b>{p.name}{p.role === "team" ? " · Team" : p.role === "owner" ? " · Owner" : ""}</b><small>{p.device}</small></span>
            </button>
            <em>{p.times}×</em>
            <small className="bg-muted">{ago(p.lastSeenAt)}</small>
          </div>)}
      </section>
      <section className="bg-card">
        <h3>Every time <span>newest first{total > occurrences.length ? ` · ${occurrences.length} of ${total}` : ""}</span></h3>
        {occurrences.length === 0
          ? <p className="bg-cardEmpty">No occurrences in the last 90 days. Older ones are deleted; the counts above are for all time.</p>
          : occurrences.map((o) => <div key={o.id} className="bg-occ">
            <b>{ago(o.at, true)}</b>
            <span title={o.user?.name}>{o.user ? o.user.name : "Signed out"}</span>
            <code title={o.route ?? undefined}>{o.route ?? "—"}</code>
            <small>{o.build}</small>
          </div>)}
        {total > occurrences.length
          ? <button type="button" className="bg-link" disabled={loadingRest} onClick={() => void showAll()}>{loadingRest ? "Loading…" : `Show all ${total}`}</button>
          : null}
      </section>
    </div>

    {detail.related.length ? <section className="bg-card">
      <h3>Same message elsewhere <span>other platforms</span></h3>
      {detail.related.map((r) => <div key={r.fingerprint} className="bg-related">
        <Platform platform={r.platform} version={null} />
        <button type="button" className="bg-relatedLink" onClick={() => openBug(r.fingerprint)}>{r.title}</button>
        <code className="bg-muted">{r.where ?? ""}</code>
        <span className="bg-muted">{r.times}× · {ago(r.lastSeenAt)}</span>
        <StatusPill status={r.status} />
      </div>)}
    </section> : null}

    <section className="bg-card">
      <h3>Stack trace <span>latest occurrence</span></h3>
      {detail.latest?.stack
        ? <pre className="bg-stack">{detail.latest.stack}</pre>
        : <p className="bg-cardEmpty">No stack was sent with this error.</p>}
      {detail.latest?.componentStack ? <>
        <h3 className="bg-subhead">Component stack</h3>
        <pre className="bg-stack">{detail.latest.componentStack}</pre>
      </> : null}
    </section>
  </div>;
}

export function AdminBugs({ id }: { id?: string }) {
  return (
    <div className="page bg-page">
      <div className="mhead"><h1>Bugs</h1><span className="sub">Every error people hit, live</span></div>
      <div className="scroll bg-scroll">
        <div className="lb-web bg">{id ? <BugView key={id} fingerprint={id} /> : <BugsList />}</div>
      </div>
    </div>
  );
}
