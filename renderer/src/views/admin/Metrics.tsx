import { useMemo, useState, type ReactNode } from "react";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { ChevronDown, ChevronsUpDown, MessageSquare } from "lucide-react";
import { api, ApiError, keys, queryClient, type Conversation } from "../../lib/api";
import { useAdminAccess } from "../../lib/admin";
import { nav } from "../../lib/nav";
import { Avatar } from "../../lib/ui";
import "../../styles/admin-metrics-moderation.css";

/*
  Admin → Metrics: the website's /admin/metrics (components/admin/MetricsDashboard.tsx),
  tiles, weekly charts, completion, a sortable member table and who needs a
  nudge. The owner's alone: the privacy policy promises the team never sees
  activity or minutes, so this only shows when /api/admin/access says owner,
  and the server checks again.

  The seam: the website draws this page on the server from lib/admin/metrics.ts
  (getAppMetrics), so the numbers come from GET /api/admin/metrics?range=&team=1,
  which answers { ok, metrics: AppMetrics } for the owner and 404 for anyone
  else. Until the website has that route, the page says so instead of guessing.
*/

type MetricsRange = "7d" | "launch" | "90d";
type SortKey = "time" | "last" | "completion";

const COMPLETION_ITEMS = ["Photo", "Bio", "Hub deal", "Invoice details", "Notifications"] as const;

interface MetricsMember {
  id: string;
  name: string;
  avatarUrl: string | null;
  role: string;
  joinedAt: string | null;
  lastActiveAt: string | null;
  daysActive14: number;
  minutes7: number;
  completion: boolean[];
  deals: number;
}

interface DayPoint { day: string; value: number }

/** lib/admin/metrics-shared.ts AppMetrics, as the endpoint sends it. */
export interface AppMetrics {
  range: MetricsRange;
  includeTeam: boolean;
  today: string;
  generatedAt: string;
  cohort: number;
  members: MetricsMember[];
  registrations: DayPoint[];
  dailyActive: DayPoint[];
  weeklyActive: DayPoint[];
  minutesPerActiveUser: DayPoint[];
  usageSince: string | null;
  kpis: {
    newThisWeek: number;
    newLastWeek: number;
    activeToday: number;
    peak: DayPoint | null;
    activeThisWeek: number;
    avgMinutes7: number | null;
  };
}

export const METRICS_ENDPOINT = "/api/admin/metrics";

async function fetchMetrics(range: MetricsRange, team: boolean) {
  return (await api<{ metrics: AppMetrics }>(`${METRICS_ENDPOINT}?range=${range}${team ? "&team=1" : ""}`)).metrics;
}

const RANGE_LABELS: Record<MetricsRange, string> = { "7d": "7 days", launch: "Since launch", "90d": "90 days" };
const DAY_MS = 86_400_000;

const pct = (member: MetricsMember) => Math.round(member.completion.filter(Boolean).length / COMPLETION_ITEMS.length * 100);
const inactiveDays = (member: MetricsMember, now: number) => member.lastActiveAt ? Math.floor((now - Date.parse(member.lastActiveAt)) / DAY_MS) : Infinity;
const needsNudge = (member: MetricsMember, now: number) => pct(member) <= 40 || inactiveDays(member, now) >= 7;

function dayLabel(day: string, withMonth: boolean) {
  const date = new Date(`${day}T12:00:00Z`);
  return withMonth ? date.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" }) : String(date.getUTCDate());
}

function minutesLabel(minutes: number) {
  if (minutes < 60) return `${minutes}m`;
  return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, "0")}m`;
}

function lastActiveLabel(iso: string | null, now: number) {
  if (!iso) return "Never";
  const days = Math.floor((now - Date.parse(iso)) / DAY_MS);
  const sameDay = new Date(iso).toISOString().slice(0, 10) === new Date(now).toISOString().slice(0, 10);
  if (sameDay) return "Today";
  if (days <= 1) return "Yesterday";
  return `${days} days ago`;
}

// The website keeps the range and the team switch in the URL; here they last the session, so Back finds them as left.
const chosen: { range: MetricsRange; team: boolean } = { range: "launch", team: false };

export function AdminMetrics(_props: { id?: string }) {
  const owner = useAdminAccess().data?.owner ?? false;
  const [range, setRange] = useState<MetricsRange>(chosen.range);
  const [team, setTeam] = useState(chosen.team);
  chosen.range = range;
  chosen.team = team;
  const query = useQuery({
    queryKey: ["admin", "metrics", range, team],
    enabled: owner,
    placeholderData: keepPreviousData,
    queryFn: () => fetchMetrics(range, team),
  });

  let body: ReactNode;
  if (!owner) body = <p className="mx-empty">Metrics are the owner's alone.</p>;
  else if (query.data) body = <MetricsDashboard metrics={query.data} onRange={setRange} onTeam={setTeam} />;
  else if (query.isError) {
    const missing = query.error instanceof ApiError && query.error.status === 404;
    body = <div className="ui-empty-state">
      <div className="ui-empty-state__title">{missing ? "Metrics need a website update" : "Metrics could not load"}</div>
      <div className="ui-empty-state__description">{missing ? "The website shows this page from its server, and doesn't yet send these numbers to the Mac app. Open Admin → Metrics on the website for now." : "Try again in a moment."}</div>
      {missing ? null : <button className="ui-button ui-button--secondary ui-button--sm" onClick={() => void query.refetch()}>Try again</button>}
    </div>;
  } else body = <div className="mx-loading"><div className="skeleton" style={{ height: 92 }} /><div className="skeleton" style={{ height: 240 }} /><div className="skeleton" style={{ height: 240 }} /></div>;

  return (
    <div className="page admx">
      <div className="admx-scroll">
        <header className="admx-head"><span className="admx-eyebrow">Owner only</span><h1>Metrics</h1></header>
        {body}
      </div>
    </div>
  );
}

function MetricsDashboard({ metrics, onRange, onTeam }: { metrics: AppMetrics; onRange: (range: MetricsRange) => void; onTeam: (team: boolean) => void }) {
  const [sort, setSort] = useState<SortKey>("time");
  const [showAll, setShowAll] = useState(false);
  const now = Date.parse(metrics.generatedAt);
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  const { kpis, members } = metrics;
  const who = metrics.includeTeam ? "members" : "students";

  const avgCompletion = members.length ? Math.round(members.reduce((sum, m) => sum + pct(m), 0) / members.length) : 0;
  const itemCounts = COMPLETION_ITEMS.map((_, index) => members.filter((m) => m.completion[index]).length);
  const hasUsage = metrics.usageSince !== null;

  const sorted = useMemo(() => [...members].sort((a, b) => {
    if (sort === "time") return b.minutes7 - a.minutes7 || (Date.parse(b.lastActiveAt ?? "0") - Date.parse(a.lastActiveAt ?? "0"));
    if (sort === "last") return Date.parse(b.lastActiveAt ?? "0") - Date.parse(a.lastActiveAt ?? "0");
    return pct(b) - pct(a) || a.name.localeCompare(b.name);
  }), [members, sort]);
  const nudges = members.filter((m) => needsNudge(m, now))
    .sort((a, b) => Number(inactiveDays(b, now) >= 7) - Number(inactiveDays(a, now) >= 7) || pct(a) - pct(b));

  const peak = kpis.peak ? `peak ${kpis.peak.value} on ${new Date(`${kpis.peak.day}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" })}` : "";
  const rows = showAll ? sorted : sorted.slice(0, 12);

  return <div className="mx">
    <div className="mx-bar">
      <div className="ui-segmented" role="group" aria-label="Period">
        {(Object.keys(RANGE_LABELS) as MetricsRange[]).map((range) => <button key={range} type="button" className="ui-chip" aria-pressed={range === metrics.range} onClick={() => onRange(range)}>{RANGE_LABELS[range]}</button>)}
      </div>
      <button type="button" className="mx-pill" role="switch" aria-checked={metrics.includeTeam} onClick={() => onTeam(!metrics.includeTeam)}>
        <span className="mx-switch" data-on={metrics.includeTeam || undefined} aria-hidden />
        Include team
        <span className="mx-muted">{metrics.cohort} {who} · you and App Review left out</span>
      </button>
      <span className="mx-asof">Updated {new Date(metrics.generatedAt).toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone, timeZoneName: "short" })}</span>
    </div>

    <section className="mx-kpis" aria-label="Summary">
      <article><span>New this week</span><b>{kpis.newThisWeek}</b><small>{kpis.newLastWeek} the week before</small></article>
      <article><span>Active today</span><b>{kpis.activeToday}</b><small>of {metrics.cohort} {who}{peak ? ` · ${peak}` : ""}</small></article>
      <article><span>Active this week</span><b>{kpis.activeThisWeek}</b><small>{metrics.cohort ? Math.round(kpis.activeThisWeek / metrics.cohort * 100) : 0}% of {who}</small></article>
      <article><span>Time per active user</span><b>{kpis.avgMinutes7 === null ? "—" : `${kpis.avgMinutes7} min`}</b><small>{kpis.avgMinutes7 === null ? "Recording started — numbers appear after today" : "a day, on average, last 7 days"}</small></article>
      <article><span>Profile completion</span><b>{avgCompletion}%</b><small>average across {COMPLETION_ITEMS.length} items</small></article>
    </section>

    <section className="mx-grid">
      <Card title="New registrations" sub="per week" note="By the date each member joined.">
        <Bars data={metrics.registrations} label={(p) => dayLabel(p.day, true)} />
      </Card>
      <Card title="Daily active users" sub="opened the app that day" note="Website + iPhone. Counted from Oct 4, 2026.">
        <Line data={metrics.dailyActive} />
      </Card>
      <Card title="Weekly active users" sub="per week" note={`This week: ${kpis.activeThisWeek} of ${metrics.cohort} ${who}.`}>
        <Bars data={metrics.weeklyActive} label={(p) => dayLabel(p.day, true)} />
      </Card>
      <Card title="Time in the app" sub="average minutes per active user, per day" note={hasUsage ? `Recorded since ${dayLabel(metrics.usageSince!, true)}: minutes with the app open and used in the last 5 minutes.` : "Starts recording today: minutes with the app open and used in the last 5 minutes."}>
        {metrics.minutesPerActiveUser.length ? <Bars data={metrics.minutesPerActiveUser} label={(p, i) => dayLabel(p.day, i === 0)} soft /> : <p className="mx-empty">No minutes recorded yet.</p>}
      </Card>
    </section>

    <section className="mx-card mx-items">
      <h3>Profile completion <span>share of {who} who have each</span></h3>
      <div className="mx-item-row">
        {COMPLETION_ITEMS.map((item, index) => {
          const share = members.length ? Math.round(itemCounts[index] / members.length * 100) : 0;
          return <div key={item}>
            <div className="mx-item-label"><b>{item}</b><span>{share}%</span></div>
            <div className="mx-track"><i style={{ width: `${share}%` }} /></div>
            <small>{itemCounts[index]} of {members.length}</small>
          </div>;
        })}
      </div>
    </section>

    <section className="mx-split">
      <article className="mx-card mx-table-card">
        <div className="mx-table-head">
          <h3>Members <span>{members.length} {who}</span></h3>
          <div className="mx-sort-by">Sort by
            <div className="ui-segmented" role="group" aria-label="Sort members">
              {([["time", "Time in app"], ["last", "Last active"], ["completion", "Completion"]] as const).map(([key, label]) =>
                <button key={key} type="button" className="ui-chip" aria-pressed={sort === key} onClick={() => setSort(key)}>{label}</button>)}
            </div>
          </div>
        </div>
        <div className="mx-table-scroll">
          <table>
            <thead><tr>
              <th>Member</th><th>Joined</th>
              <SortHeader label="Last active" active={sort === "last"} onClick={() => setSort("last")} />
              <th className="mx-r">Days active</th>
              <SortHeader label="Time, 7 days" active={sort === "time"} onClick={() => setSort("time")} right />
              <SortHeader label="Completion" active={sort === "completion"} onClick={() => setSort("completion")} />
              <th className="mx-r">Hub deals</th>
            </tr></thead>
            <tbody>
              {rows.map((member) => {
                const share = pct(member);
                const away = inactiveDays(member, now) >= 7;
                return <tr key={member.id}>
                  <td><button type="button" className="mx-who" onClick={() => nav.open({ kind: "profile", id: member.id })}><Avatar name={member.name} seed={member.id} src={member.avatarUrl} size={28} /><b>{member.name}</b>{member.role === "team" ? <em className="mx-role">Team</em> : null}</button></td>
                  <td className="mx-muted">{member.joinedAt ? new Date(member.joinedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" }) : "—"}</td>
                  <td className={away ? "mx-warn" : undefined}>{lastActiveLabel(member.lastActiveAt, now)}</td>
                  <td className="mx-r">{member.daysActive14}<span className="mx-muted"> / 14</span></td>
                  <td className="mx-r mx-time">{hasUsage ? minutesLabel(member.minutes7) : "—"}</td>
                  <td><div className="mx-comp">
                    <span className="mx-dots">{member.completion.map((done, index) => <i key={COMPLETION_ITEMS[index]} data-on={done || undefined} title={`${COMPLETION_ITEMS[index]}: ${done ? "done" : "missing"}`} />)}</span>
                    <b className={share <= 40 ? "mx-low" : undefined}>{share}%</b>
                  </div></td>
                  <td className="mx-r">{member.deals}</td>
                </tr>;
              })}
            </tbody>
          </table>
        </div>
        <div className="mx-more">
          {members.length > 12 ? <button type="button" className="mx-link" onClick={() => setShowAll((v) => !v)}>{showAll ? "Show fewer" : `Show all ${members.length}`}</button> : null}
          <span>Dots: {COMPLETION_ITEMS.join(", ")}</span>
        </div>
      </article>

      <aside className="mx-card mx-nudge">
        <h3>Who needs a nudge <span>{nudges.length} {nudges.length === 1 ? who.slice(0, -1) : who}</span></h3>
        <p className="mx-note">Inactive 7+ days, or 40% complete or less.</p>
        {nudges.length === 0 ? <p className="mx-empty">Nobody right now.</p> : nudges.map((member) => <NudgeRow key={member.id} member={member} now={now} />)}
      </aside>
    </section>
  </div>;
}

function SortHeader({ label, active, onClick, right }: { label: string; active: boolean; onClick: () => void; right?: boolean }) {
  return <th className={right ? "mx-r" : undefined} aria-sort={active ? "descending" : "none"}>
    <button type="button" className="mx-sort-head" data-active={active || undefined} onClick={onClick}>
      {label} {active ? <ChevronDown size={12} aria-hidden /> : <ChevronsUpDown size={12} aria-hidden />}
    </button>
  </th>;
}

function NudgeRow({ member, now }: { member: MetricsMember; now: number }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const away = inactiveDays(member, now) >= 7;
  const missing = COMPLETION_ITEMS.filter((_, index) => !member.completion[index]);

  // The website's Message: start (or find) the DM and open it, in Direct messages.
  async function message() {
    setBusy(true);
    setError(false);
    try {
      const { conversation } = await api<{ conversation: Conversation }>("/api/dms", { method: "POST", body: { userId: member.id } });
      await queryClient.invalidateQueries({ queryKey: keys.conversations("creatorhive") });
      nav.open({ kind: "dm", id: conversation.id }, "dms", "ch");
    } catch {
      setError(true);
      setBusy(false);
    }
  }

  return <div className="mx-nudge-row">
    <Avatar name={member.name} seed={member.id} src={member.avatarUrl} size={28} />
    <div className="mx-nudge-text">
      <b>{member.name}</b>
      <div className="mx-chips">
        {away ? <span className="mx-hot">{Number.isFinite(inactiveDays(member, now)) ? `Inactive ${inactiveDays(member, now)} days` : "Never active"}</span> : null}
        <span>{pct(member)}% complete</span>
      </div>
      {missing.length ? <small>Missing: {missing.join(", ")}</small> : null}
      {error ? <small className="mx-warn">Couldn't open the conversation. Try again.</small> : null}
    </div>
    <button type="button" className="ui-button ui-button--secondary ui-button--sm" onClick={() => void message()} disabled={busy} aria-busy={busy || undefined}>
      {busy ? <span className="admx-spinner" aria-hidden /> : <MessageSquare size={14} aria-hidden />} Message
    </button>
  </div>;
}

function Card({ title, sub, note, children }: { title: string; sub: string; note: string; children: ReactNode }) {
  return <article className="mx-card">
    <h3>{title} <span>{sub}</span></h3>
    {children}
    <p className="mx-note">{note}</p>
  </article>;
}

const W = 520, H = 150, PAD = 26;

function niceMax(values: number[]) {
  const max = Math.max(...values, 1);
  return max <= 4 ? 4 : max % 2 ? max + 1 : max;
}

function Bars({ data, label, soft }: { data: DayPoint[]; label: (point: DayPoint, index: number) => string; soft?: boolean }) {
  const max = niceMax(data.map((p) => p.value));
  const bw = (W - PAD) / Math.max(data.length, 1);
  const every = Math.ceil(data.length / 10);
  return <svg viewBox={`0 0 ${W} ${H + 26}`} width="100%" height={H + 26} role="img" aria-label={data.map((p) => `${label(p, 0)}: ${p.value}`).join(", ")}>
    {[0, max / 2, max].map((tick) => { const y = H - (tick / max) * (H - 14); return <g key={tick}><line x1={PAD} x2={W} y1={y} y2={y} stroke="var(--border)" /><text x={PAD - 6} y={y + 4} textAnchor="end" fontSize="11" fill="var(--text-subtle)">{tick}</text></g>; })}
    {data.map((point, index) => {
      const bh = (point.value / max) * (H - 14), x = PAD + index * bw + bw * 0.18, width = bw * 0.64;
      return <g key={point.day}>
        {point.value > 0 ? <><rect x={x} y={H - bh} width={width} height={bh} rx={4} className={soft ? "mx-bar-soft" : "mx-bar-fill"} /><text x={x + width / 2} y={H - bh - 5} textAnchor="middle" fontSize="11.5" fontWeight="700" fill="var(--text)">{point.value}</text></> : null}
        {index % every === 0 || index === data.length - 1 ? <text x={x + width / 2} y={H + 17} textAnchor="middle" fontSize="11" fill="var(--text-muted)">{label(point, index)}</text> : null}
      </g>;
    })}
  </svg>;
}

function Line({ data }: { data: DayPoint[] }) {
  const max = niceMax(data.map((p) => p.value));
  const step = (W - PAD - 10) / Math.max(data.length - 1, 1);
  const x = (i: number) => PAD + 5 + i * step;
  const y = (v: number) => H - (v / max) * (H - 14);
  const points = data.map((p, i) => `${x(i)},${y(p.value)}`).join(" ");
  const every = Math.ceil(data.length / 8);
  const last = data.at(-1);
  const peakIndex = data.reduce((best, p, i) => (p.value > data[best].value ? i : best), 0);
  return <svg viewBox={`0 0 ${W} ${H + 26}`} width="100%" height={H + 26} role="img" aria-label={data.map((p) => `${p.day}: ${p.value}`).join(", ")}>
    {[0, max / 2, max].map((tick) => <g key={tick}><line x1={PAD} x2={W} y1={y(tick)} y2={y(tick)} stroke="var(--border)" /><text x={PAD - 6} y={y(tick) + 4} textAnchor="end" fontSize="11" fill="var(--text-subtle)">{tick}</text></g>)}
    {data.length > 1 ? <polygon points={`${x(0)},${y(0)} ${points} ${x(data.length - 1)},${y(0)}`} className="mx-area" /> : null}
    <polyline points={points} fill="none" className="mx-line-stroke" strokeWidth={2.2} strokeLinejoin="round" />
    {data.map((p, i) => (i % every === 0 || i === data.length - 1) ? <text key={p.day} x={x(i)} y={H + 17} textAnchor="middle" fontSize="11" fill="var(--text-muted)">{dayLabel(p.day, i === 0 || dayLabel(p.day, false) === "1")}</text> : null)}
    {data[peakIndex] && peakIndex !== data.length - 1 && data[peakIndex].value > 0 ? <text x={x(peakIndex)} y={y(data[peakIndex].value) - 9} textAnchor="middle" fontSize="11.5" fontWeight="700" fill="var(--text)">{data[peakIndex].value}</text> : null}
    {last ? <><circle cx={x(data.length - 1)} cy={y(last.value)} r={4.5} className="mx-dot" /><text x={x(data.length - 1) - 8} y={y(last.value) - 10} textAnchor="end" fontSize="11.5" fontWeight="700" fill="var(--text)">{last.value} today</text></> : null}
  </svg>;
}
