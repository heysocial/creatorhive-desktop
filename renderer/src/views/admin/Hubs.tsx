import { useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ArrowLeft, ArrowRight, Calculator, ChevronDown, ChevronUp, ChevronsUpDown, Eye, Plus, Search, X } from "lucide-react";
import { ApiError } from "../../lib/api";
import {
  HUBS_API, HUBS_RANGES, HUBS_RANGE_LABELS, missing, savePaymentEmail, useHubsSummary,
  type HubsMember, type HubsRange, type HubsRow, type HubsSummary,
} from "../../lib/adminHubs";
import { BOARDS, HubSource, allDeals, useDeals } from "../../lib/hub";
import { nav } from "../../lib/nav";
import { LbAvatar as Avatar, type MemberBadge } from "../people/LeaderboardParts";
import { Kanban, NeedsAttention, Overview } from "../hub/Deals";
import { Dashboard } from "../hub/Dashboard";
import { useLayer } from "../hub/parts";
import "../people/leaderboard-web.css";
import "../../styles/admin-hubs.css";

/*
  Admin → Hubs, as the website has it (app/admin/hubs, components/admin/
  HubsDashboard.tsx and HubsRoi.tsx): every student's Hub in one table, a
  student's ROI and payment emails in a pop-up, the ROI calculator, and one
  Hub read-only (Board, Dashboard, Cash). Owner and Hubs viewers only; Admin
  (Admin.tsx) shows this page only to them, and every route checks again.
*/

type SortKey = "name" | "collected" | "collectedAll" | "contracted" | "potential" | "closed" | "pipeline" | "avg" | "last";

const usd = (value: number) => `$${Math.round(value).toLocaleString("en-US")}`;
/** The pop-up's and calculator's: a minus sign for money owed. */
const usdSigned = (value: number) => `${value < 0 ? "−" : ""}$${Math.abs(Math.round(value)).toLocaleString("en-US")}`;
const avg = (row: HubsRow) => (row.closedCount ? row.closedUsd / row.closedCount : 0);
const name = (row: HubsRow) => row.members.map((m) => m.name).join(" & ");
const DAY_MS = 86_400_000;
const TIMEZONE = "America/Toronto";

function lastLabel(iso: string | null, now: number) {
  if (!iso) return "—";
  const days = Math.floor((now - Date.parse(iso)) / DAY_MS);
  if (days < 1) return "Today";
  if (days < 2) return "Yesterday";
  return `${days} days ago`;
}

function badgeEmoji(kind: string) {
  if (kind === "pro") return "🐝";
  if (kind === "top") return "👑";
  return null;
}

/** The website's admin Badge: the kind's colour and label, with the tier's emoji. */
function Badge({ badge }: { badge: MemberBadge }) {
  return (
    <span className={`member-badge member-badge--${badge.kind}`} title={badge.label}>
      {badgeEmoji(badge.kind) ? <span className="member-badge__emoji" aria-hidden>{badgeEmoji(badge.kind)}</span> : null}{badge.label}
    </span>
  );
}

/** What the page shows when the website doesn't have the route yet, or it failed. */
function LoadError({ error, what }: { error: unknown; what: string }) {
  if (missing(error)) {
    return (
      <div className="ah-missing">
        <b>Waiting on a website update</b>
        <span>The Mac reads Admin → Hubs from <code>{what}</code>, which the website doesn't have yet. It works here as soon as it's live.</span>
      </div>
    );
  }
  return <div className="ah-missing"><b>Couldn't load Hubs.</b><span>Check your connection and try again.</span></div>;
}

export function AdminHubs({ id }: { id?: string }) {
  return (
    <div className="page ah-page">
      <div className="mhead"><h1>Hubs</h1><span className="sub">Every student's Creator Hub</span></div>
      <div className="scroll ah-scroll">
        {id ? <HubView hubId={id} /> : <HubsList />}
      </div>
    </div>
  );
}

/* ---------- Every Hub (the website's HubsDashboard) ---------- */

function HubsList() {
  const [range, setRange] = useState<HubsRange>("month");
  const summary = useHubsSummary(range);
  const data = summary.data;
  if (summary.isError && !data) return <LoadError error={summary.error} what={`GET ${HUBS_API}`} />;
  if (!data) return <div className="ah-loading">Loading…</div>;
  return <HubsDashboard summary={data} onRange={setRange} />;
}

function HubsDashboard({ summary, onRange }: { summary: HubsSummary; onRange: (range: HubsRange) => void }) {
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: "collected", desc: true });
  const [showEmpty, setShowEmpty] = useState(false);
  const [roiHub, setRoiHub] = useState<string | null>(null);
  // Looked up on each render, so the pop-up follows the refreshed numbers after a payment email is added.
  const roi = roiHub ? summary.rows.find((r) => r.hubId === roiHub) ?? null : null;
  const now = Date.parse(summary.generatedAt);
  const rangeLabel = HUBS_RANGE_LABELS[summary.range];
  const { rows } = summary;

  const totals = useMemo(() => rows.reduce((t, r) => ({
    collected: t.collected + r.collected, contracted: t.contracted + r.contracted, potential: t.potential + r.potential,
    closedCount: t.closedCount + r.closedCount, pipelineCount: t.pipelineCount + r.pipelineCount,
    earning: t.earning + (r.collected > 0 ? 1 : 0),
  }), { collected: 0, contracted: 0, potential: 0, closedCount: 0, pipelineCount: 0, earning: 0 }), [rows]);

  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const value = (row: HubsRow): number | string => {
      switch (sort.key) {
        case "name": return name(row).toLowerCase();
        case "closed": return row.closedCount;
        case "pipeline": return row.pipelineCount;
        case "avg": return avg(row);
        case "last": return row.lastActivityAt ? Date.parse(row.lastActivityAt) : 0;
        default: return row[sort.key];
      }
    };
    return rows.filter((row) => !needle || row.members.some((m) => m.name.toLowerCase().includes(needle)))
      .sort((a, b) => {
        const x = value(a), y = value(b);
        const order = typeof x === "string" ? x.localeCompare(y as string) : (x as number) - (y as number);
        return (sort.desc ? -order : order) || b.collectedAll - a.collectedAll;
      });
  }, [rows, query, sort]);

  const delta = summary.previousCollected === null ? null : totals.collected - summary.previousCollected;
  const previousLabel = summary.range === "month" ? "last month" : summary.range === "last_month" ? "the month before" : "the 90 days before";
  const head = (key: SortKey, label: string, right = true) => (
    <th className={right ? "ah-r" : undefined} aria-sort={sort.key === key ? (sort.desc ? "descending" : "ascending") : "none"}>
      <button type="button" className="ah-sortHead" data-active={sort.key === key || undefined} onClick={() => setSort((s) => ({ key, desc: s.key === key ? !s.desc : key !== "name" }))}>
        {label}{sort.key === key ? (sort.desc ? <ChevronDown size={12} aria-hidden /> : <ChevronUp size={12} aria-hidden />) : <ChevronsUpDown size={12} aria-hidden />}
      </button>
    </th>
  );

  return (
    <div className="lb-web ah">
      <div className="ah-hubs">
        <div className="ah-bar">
          <div className="ui-segmented" role="group" aria-label="Period">
            {HUBS_RANGES.map((range) => (
              <button key={range} type="button" className="ui-chip" aria-pressed={range === summary.range} onClick={() => onRange(range)}>{HUBS_RANGE_LABELS[range]}</button>
            ))}
          </div>
          <span className="ah-muted">{rows.length} Hubs · {summary.studentCount} students · shared Hubs counted once</span>
          <span className="ah-asof">Updated {new Date(summary.generatedAt).toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: TIMEZONE, timeZoneName: "short" })}</span>
        </div>

        <section className="ah-kpis" aria-label="Totals">
          <article className="ah-lead">
            <span>Collected · {rangeLabel.toLowerCase()}</span><b>{usd(totals.collected)}</b>
            <small>{delta === null ? `from ${totals.closedCount} paid deals` : <><em data-up={delta >= 0 || undefined}>{delta >= 0 ? "▲" : "▼"} {usd(Math.abs(delta))}</em> vs {previousLabel}</>}</small>
          </article>
          <article><span>Contracted</span><b>{usd(totals.contracted)}</b><small>Deal Secured onward, unpaid</small></article>
          <article><span>Potential</span><b>{usd(totals.potential)}</b><small>Pitching + Deliverables / Contract</small></article>
          <article><span>Deals closed</span><b>{totals.closedCount}</b><small>{usd(totals.collected)} · avg {usd(totals.closedCount ? totals.collected / totals.closedCount : 0)}</small></article>
          <article><span>In the pipeline</span><b>{totals.pipelineCount}</b><small>open deals right now</small></article>
          <article><span>Hubs earning</span><b>{totals.earning}<i> / {rows.length}</i></b><small>collected something {summary.range === "all" ? "so far" : rangeLabel.toLowerCase()}</small></article>
        </section>

        <RoiCalculator basis={summary.earningBasis} firstPayday={summary.firstPayday} />

        <article className="ah-card">
          <div className="ah-tableHead">
            <h3>Students' Hubs <span>{shown.length === rows.length ? `${rows.length} with deals` : `${shown.length} of ${rows.length}`}</span></h3>
            <label className="ah-search"><Search size={15} aria-hidden /><input type="search" placeholder="Search by name" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search by name" /></label>
          </div>
          <div className="ah-tableScroll">
            <table>
              <thead><tr>
                {head("name", "Student", false)}
                {head("collected", rangeLabel)}
                {summary.range === "all" ? null : head("collectedAll", "All time")}
                {head("contracted", "Contracted")}
                {head("potential", "Potential")}
                {head("closed", "Deals closed")}
                {head("pipeline", "In pipeline")}
                {head("avg", "Avg deal")}
                {head("last", "Last activity")}
              </tr></thead>
              <tbody>
                {shown.map((row) => {
                  const stale = !row.lastActivityAt || now - Date.parse(row.lastActivityAt) > 7 * DAY_MS;
                  return (
                    <tr key={row.hubId}>
                      <td><button type="button" className="ah-who" onClick={() => setRoiHub(row.hubId)} aria-haspopup="dialog">
                        <span className="ah-avatars">{row.members.map((m) => <Avatar key={m.id} name={m.name} id={m.id} src={m.avatarUrl} size={28} />)}</span>
                        <span className="ah-whoText"><span><b>{name(row)}</b>{row.members.length > 1 ? <em className="ah-shared">Shared Hub</em> : null}</span><span className="ah-badges">{row.members.map((m) => <Badge key={m.id} badge={m.badge} />)}</span></span>
                      </button></td>
                      <td className="ah-r ah-money">{row.collected ? usd(row.collected) : <span className="ah-zero">$0</span>}</td>
                      {summary.range === "all" ? null : <td className="ah-r">{usd(row.collectedAll)}</td>}
                      <td className="ah-r">{row.contracted ? usd(row.contracted) : <span className="ah-zero">—</span>}</td>
                      <td className="ah-r">{row.potential ? usd(row.potential) : <span className="ah-zero">—</span>}</td>
                      <td className="ah-r">{row.closedCount || <span className="ah-zero">0</span>}</td>
                      <td className="ah-r">{row.pipelineCount}</td>
                      <td className="ah-r">{row.closedCount ? usd(avg(row)) : <span className="ah-zero">—</span>}</td>
                      <td className={`ah-r ${stale ? "ah-stale" : ""}`}>{lastLabel(row.lastActivityAt, now)}</td>
                    </tr>
                  );
                })}
                {shown.length === 0 ? <tr><td colSpan={9} className="ah-none">No student matches “{query}”.</td></tr> : null}
              </tbody>
              {shown.length > 1 ? (
                <tfoot><tr>
                  <td>Total</td>
                  <td className="ah-r">{usd(shown.reduce((s, r) => s + r.collected, 0))}</td>
                  {summary.range === "all" ? null : <td className="ah-r">{usd(shown.reduce((s, r) => s + r.collectedAll, 0))}</td>}
                  <td className="ah-r">{usd(shown.reduce((s, r) => s + r.contracted, 0))}</td>
                  <td className="ah-r">{usd(shown.reduce((s, r) => s + r.potential, 0))}</td>
                  <td className="ah-r">{shown.reduce((s, r) => s + r.closedCount, 0)}</td>
                  <td className="ah-r">{shown.reduce((s, r) => s + r.pipelineCount, 0)}</td>
                  <td colSpan={2} />
                </tr></tfoot>
              ) : null}
            </table>
          </div>
          <div className="ah-more">
            <button type="button" className="ah-link" onClick={() => setShowEmpty((v) => !v)}>{showEmpty ? "Hide" : "Show"} {summary.empty.length} students with no deals yet</button>
            <span>Click a student for their ROI and their Hub, read-only. Grey last activity = nothing in 7+ days.</span>
          </div>
          {showEmpty ? <div className="ah-emptyList">{summary.empty.map((m) => <span key={m.id}><Avatar name={m.name} id={m.id} src={m.avatarUrl} size={22} />{m.name}</span>)}</div> : null}
        </article>
      </div>
      {roi ? <RoiPopup row={roi} sources={summary.payments} onClose={() => setRoiHub(null)} /> : null}
    </div>
  );
}

/* ---------- A student's ROI (the website's HubsRoi) ---------- */

/** Says which platform could not be read, so a missing payment is never mistaken for none. */
function sourceNotice(sources: HubsSummary["payments"]) {
  const down = (["whop", "fanbasis"] as const).filter((key) => sources[key] !== "ok").map((key) => (key === "whop" ? "Whop" : "Fanbasis"));
  if (!down.length) return null;
  return `${down.join(" and ")} ${down.length > 1 ? "aren't" : "isn't"} connected right now, so ${down.length > 1 ? "their" : "its"} payments are missing.`;
}

const dateLabel = (iso: string) => new Date(`${iso.slice(0, 10)}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });

/** A student's return on the program: what they paid us (Whop + Fanbasis, by email) against what their Hub collected. */
function RoiPopup({ row, sources, onClose }: { row: HubsRow; sources: HubsSummary["payments"]; onClose: () => void }) {
  const box = useRef<HTMLDivElement>(null);
  useLayer(onClose, box);

  const payments = row.members.flatMap((m) => (m.payments ?? []).map((p) => ({ ...p, who: m.name })));
  const paid = payments.reduce((sum, p) => sum + p.amountUsd, 0);
  const collected = row.collectedAll;
  const net = collected - paid;
  const pct = paid ? Math.round((net / paid) * 100) : 0;
  const paidBack = paid > 0 && collected >= paid;
  const progress = paid ? Math.min(100, (collected / paid) * 100) : 0;
  const shared = row.members.length > 1;
  const title = row.members.map((m) => m.name).join(" & ");
  const notice = sourceNotice(sources);

  return createPortal(
    <div className="lb-web ah ah-portal">
      <div className="ah-scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
        <div ref={box} tabIndex={-1} className="ah-popup" role="dialog" aria-modal="true" aria-labelledby="roi-title">
          <header className="ah-popHead">
            <span className="ah-avatars">{row.members.map((m) => <Avatar key={m.id} name={m.name} id={m.id} src={m.avatarUrl} size={36} />)}</span>
            <div><h3 id="roi-title">{title}</h3><small>{row.members.map((m) => m.email).join(" · ")}</small></div>
            <button type="button" className="ah-close" onClick={onClose} aria-label="Close"><X size={16} /></button>
          </header>

          {notice ? <span className="ah-example">{notice}</span> : null}

          {paid === 0 ? (
            <div className="ah-noPay">
              <b>{sources.whop === "ok" || sources.fanbasis === "ok" ? "No payment found" : "Payments aren't connected yet"}</b>
              <span>Nothing in Whop or Fanbasis under {row.members.length > 1 ? "these emails" : "this email"}. If they paid with another email, add it below.</span>
              <div className="ah-roiLine"><span>Collected from brand deals</span><b>{usdSigned(collected)}</b></div>
            </div>
          ) : (
            <>
              <div className="ah-roiHero" data-back={paidBack || undefined}>
                <div><span>ROI</span><b>{pct >= 0 ? "+" : "−"}{Math.abs(pct)}%</b><small>{net >= 0 ? `${usdSigned(net)} more than the program cost` : `${usdSigned(-net)} to go`}</small></div>
                {paidBack ? <em className="ah-paidBack">Paid back ✓</em> : <em className="ah-notYet">{Math.round(progress)}% paid back</em>}
              </div>
              <div className="ah-track"><i style={{ width: `${progress}%` }} /></div>
              <div className="ah-roiLine"><span>Paid for the program</span><b>{usdSigned(paid)}</b></div>
              <div className="ah-roiLine"><span>Collected from brand deals{shared ? " (shared Hub)" : ""}</span><b>{usdSigned(collected)}</b></div>
              <div className="ah-roiLine ah-roiNet"><span>Collected minus paid</span><b>{usdSigned(net)}</b></div>
              <details className="ah-payList" open>
                <summary>{payments.length} {payments.length === 1 ? "payment" : "payments"}</summary>
                {payments.map((p, i) => (
                  <div key={i} className="ah-payRow">
                    <span className="ah-src" data-src={p.source}>{p.source}</span>
                    <span className="ah-payText"><b>{p.product}</b><small>{dateLabel(p.paidAt)}{shared ? ` · ${p.who.split(" ")[0]}` : ""}{p.email ? ` · ${p.email}` : ""}</small></span>
                    <b>{usdSigned(p.amountUsd)}</b>
                  </div>
                ))}
              </details>
            </>
          )}

          <PaymentEmails row={row} />

          <footer className="ah-popFoot">
            <span>Paid = every successful CreatorHive program payment in Whop and Fanbasis under these emails, refunds taken off. Collected = all time.</span>
            <button type="button" className="ah-openHub" onClick={() => { onClose(); nav.open({ kind: "admin", page: "hubs", id: row.hubId }); }}>Open Hub <ArrowRight size={14} aria-hidden /></button>
          </footer>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/**
 * The emails a student's payments are looked up by: their app email, plus any
 * added here (another address, or a partner or relative who paid).
 */
function PaymentEmails({ row }: { row: HubsRow }) {
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send(method: "POST" | "DELETE", member: HubsMember, email: string) {
    setBusy(true);
    setError(null);
    try {
      await savePaymentEmail(method, member.id, email);
      if (method === "POST") setDraft((d) => ({ ...d, [member.id]: "" }));
    } catch (e) {
      setError(e instanceof ApiError && e.code === "invalid_email" ? "That doesn't look like an email address." : "Couldn't save. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <details className="ah-payEmails">
      <summary>Payment emails</summary>
      {row.members.map((m) => (
        <div key={m.id} className="ah-payEmailsFor">
          {row.members.length > 1 ? <b>{m.name}</b> : null}
          <ul>
            <li><span>{m.email}</span><em>app email</em></li>
            {(m.paymentEmails ?? []).map((email) => (
              <li key={email}><span>{email}</span>
                <button type="button" onClick={() => void send("DELETE", m, email)} disabled={busy} aria-label={`Remove ${email}`}><X size={13} /></button>
              </li>
            ))}
          </ul>
          <form className="ah-payEmailAdd" onSubmit={(e) => { e.preventDefault(); if (draft[m.id]?.trim()) void send("POST", m, draft[m.id]); }}>
            <input id={`pay-email-${m.id}`} type="email" placeholder="Another email they paid with" value={draft[m.id] ?? ""} onChange={(e) => setDraft((d) => ({ ...d, [m.id]: e.target.value }))} aria-label={`Another payment email for ${m.name}`} />
            <button type="submit" disabled={busy || !draft[m.id]?.trim()}><Plus size={14} aria-hidden /> Add</button>
          </form>
        </div>
      ))}
      {error ? <small className="ah-payEmailError">{error}</small> : null}
    </details>
  );
}

/* ---------- The ROI calculator ---------- */

type Mode = "once" | "monthly";

/**
 * The month a student has earned back what they paid. Earning starts after
 * `lead` months (the average time to a first payday), then runs at `earn` a
 * month; a plan's payments stop after `months`. Checked over 5 years.
 */
function paybackMonth(mode: Mode, amount: number, months: number, earn: number, lead: number) {
  if (earn <= 0 || amount <= 0) return null;
  for (let m = 1; m <= 60; m += 1) {
    const earned = earn * Math.max(0, m - lead);
    const paid = mode === "once" ? amount : amount * Math.min(m, months);
    if (earned >= paid) return m;
  }
  return null;
}

const monthsLabel = (n: number | null) => (n === null ? "Over 5 years" : n === 1 ? "1 month" : `${n} months`);
const leadLabel = (lead: number) => (lead < 0.5 ? "under 2 weeks" : lead < 1.5 ? "about 1 month" : `about ${Math.round(lead)} months`);

/** How long the program takes to pay for itself, from our students' real earnings. */
function RoiCalculator({ basis, firstPayday }: { basis: HubsSummary["earningBasis"]; firstPayday: HubsSummary["firstPayday"] }) {
  const [mode, setMode] = useState<Mode>("once");
  const [amount, setAmount] = useState("4000");
  const [months, setMonths] = useState("12");
  const values = [...basis.monthlyByHub].sort((a, b) => a - b);
  const average = values.length ? values.reduce((s, v) => s + v, 0) / values.length : 0;
  const median = values.length ? (values.length % 2 ? values[(values.length - 1) / 2] : (values[values.length / 2 - 1] + values[values.length / 2]) / 2) : 0;
  const lead = firstPayday?.averageMonths ?? 0;
  const n = Number(amount.replace(/[^0-9.]/g, "")) || 0;
  const plan = Math.max(1, Math.round(Number(months) || 1));
  const total = mode === "once" ? n : n * plan;
  const atAverage = paybackMonth(mode, n, plan, average, lead);
  const atMedian = paybackMonth(mode, n, plan, median, lead);
  const from = new Date(basis.from).toLocaleDateString("en-US", { month: "short", timeZone: TIMEZONE });
  const to = new Date(new Date(basis.to).getTime() - DAY_MS).toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: TIMEZONE });

  return (
    <section className="ah-calc" aria-labelledby="calc-title">
      <div className="ah-calcIn">
        <h3 id="calc-title"><Calculator size={16} aria-hidden /> ROI calculator</h3>
        <div className="ui-segmented" role="group" aria-label="Payment type">
          <button type="button" className="ui-chip" aria-pressed={mode === "once"} onClick={() => { setMode("once"); setAmount("4000"); }}>One-time</button>
          <button type="button" className="ui-chip" aria-pressed={mode === "monthly"} onClick={() => { setMode("monthly"); setAmount("333"); }}>Monthly</button>
        </div>
        <div className="ah-calcFields">
          <label htmlFor="calc-amount">{mode === "once" ? "Investment" : "Per month"}
            <span className="ah-calcMoney"><i>$</i><input id="calc-amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} /></span>
          </label>
          {mode === "monthly" ? (
            <label htmlFor="calc-months">For
              <span className="ah-calcMoney"><input id="calc-months" inputMode="numeric" value={months} onChange={(e) => setMonths(e.target.value)} /><i>months</i></span>
            </label>
          ) : null}
        </div>
        <small className="ah-calcTotal">Total {usdSigned(total)}</small>
      </div>
      <div className="ah-calcOut">
        <span className="ah-calcAsk">Time to earn it back</span>
        <div className="ah-calcResult" data-lead>
          <span>Average student</span>
          <b>{monthsLabel(atAverage)}</b>
          <small>{firstPayday ? `${leadLabel(lead)} to a first paid deal, then ` : ""}earning {usdSigned(average)}/month</small>
        </div>
        <p className="ah-calcMedian">At the median, {usdSigned(median)}/month: <b>{monthsLabel(atMedian)}</b></p>
        <small className="ah-calcNote">
          Earnings: the {values.length} student Hubs that collected money {from}–{to} (last 3 full months).{" "}
          {firstPayday ? `First paid deal: average time from first program payment, across ${firstPayday.count} students.` : "Time to a first paid deal appears once Whop and Fanbasis are connected."}
        </small>
      </div>
    </section>
  );
}

/* ---------- One Hub, read-only (the website's /admin/hubs/[hubId]) ---------- */

const VIEWS = [["board", "Board"], ["dashboard", "Dashboard"], ["cash", "Cash"]] as const;
type HubTab = (typeof VIEWS)[number][0];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function HubView({ hubId }: { hubId: string }) {
  const summary = useHubsSummary("month");
  const [view, setView] = useState<HubTab>("board");
  const back = <button type="button" className="ah-back" onClick={() => nav.open({ kind: "admin", page: "hubs" })}><ArrowLeft size={15} aria-hidden /> All Hubs</button>;
  if (summary.isError) return <div className="lb-web ah"><div className="ah-view">{back}<LoadError error={summary.error} what={`GET ${HUBS_API}`} /></div></div>;
  if (!summary.data) return <div className="ah-loading">Loading…</div>;
  const row = UUID.test(hubId) ? summary.data.rows.find((r) => r.hubId === hubId) : undefined;
  if (!row) return <div className="lb-web ah"><div className="ah-view">{back}<div className="ah-missing"><b>This Hub isn't here.</b><span>It may have no deals yet, or its student has left.</span></div></div></div>;
  const { members } = row;
  const names = members.map((m) => m.name.split(" ")[0]).join(" & ");

  return (
    <>
      <div className="lb-web ah">
        <div className="ah-view">
          {back}
          <div className="ah-viewHead">
            <span className="ah-avatars">{members.map((m) => <Avatar key={m.id} name={m.name} id={m.id} src={m.avatarUrl} size={40} />)}</span>
            <h2>{names}'s Hub</h2>
            <span className="ah-badges">{members.map((m) => <Badge key={m.id} badge={m.badge} />)}</span>
            <span className="ah-readonly"><Eye size={14} aria-hidden /> Read-only · only Admin can see this view</span>
          </div>
          <div className="ah-stats">
            <div><span>Collected this month</span><b>{usd(row.collected)}</b></div>
            <div><span>All time</span><b>{usd(row.collectedAll)}</b></div>
            <div><span>Contracted</span><b>{usd(row.contracted)}</b></div>
            <div><span>Potential</span><b>{usd(row.potential)}</b></div>
            <div><span>In the pipeline</span><b>{row.pipelineCount}</b></div>
            <div><span>Avg deal (this month)</span><b>{row.closedCount ? usd(row.closedUsd / row.closedCount) : "—"}</b></div>
          </div>
          <nav className="ah-viewTabs" aria-label="Hub view">
            {VIEWS.map(([key, label]) => <button key={key} type="button" aria-current={key === view ? "page" : undefined} onClick={() => setView(key)}>{label}</button>)}
          </nav>
        </div>
      </div>
      {/* The student's own Hub views, reading their Hub; `inert` switches every control off, as on the website. */}
      <HubSource.Provider value={{ base: `${HUBS_API}/${hubId}`, key: ["admin", "hubs", hubId], tz: TIMEZONE }}>
        <div className="ah-board" inert>
          {view === "dashboard" ? <Dashboard fixedRange="30d" /> : <HubDeals hubId={hubId} cash={view === "cash"} />}
        </div>
      </HubSource.Provider>
    </>
  );
}

/** Board: the three sections. Cash: the Hub's home (tier, money, the board and Needs attention). */
function HubDeals({ hubId, cash }: { hubId: string; cash: boolean }) {
  const { data, isError, error } = useDeals();
  if (isError) return <LoadError error={error} what={`GET ${HUBS_API}/${hubId}/deals`} />;
  if (!data) return <div className="ah-loading">Loading…</div>;
  const kanban = <Kanban boards={BOARDS} data={data} shared={data.shared} />;
  if (!cash) return kanban;
  const deals = allDeals(data);
  return (
    <div className="ah-cash">
      <Overview deals={deals} />
      <div className="pipeline"><div className="pipeline-main">{kanban}</div><NeedsAttention deals={deals} /></div>
    </div>
  );
}
