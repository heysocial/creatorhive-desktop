import { useMemo, useState } from "react";
import { ChevronRight, Download, Hourglass, Plus, Wallet } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../../lib/api";
import { DEAL_STATUSES, deliveredAgo, saveShowMoneyOut, sourcePath, staleText, useHubSource, useMoney, type DealStatus } from "../../lib/hub";
import { MoneySections } from "./Money";
import { money, plural } from "../../lib/format";
import { Modal, Monogram, StagePill } from "./parts";
import { openDeal } from "./Deals";
import { openDealForm } from "./DealForm";
import { openExport } from "./Export";

type Range = "7d" | "30d" | "90d" | "1y" | "all";
interface Figure { value: number; count?: number; previous?: number | null; dealIds?: string[] }
interface Breakdown { key: string; label: string; amount: number; count: number; dealIds: string[] }
/* `collected`: what it brought in over the range — for a retainer, its payments, not one payment's `amount`. Older servers leave it out. */
interface DashDeal { id: string; brandName: string; amount: number; status: DealStatus; paidAt: string | null; collected?: number }
interface Dash {
  range: Range;
  rangeLabel: string;
  /* closedUnpaid: Closed – Unpaid deals closed in the range, in no other figure; `declined` is that reason's share. Older servers leave it out.
     closedNotContracted: Closed – Not contracted ("Fell through"), its own figure, never added to closedUnpaid. Older servers leave it out. */
  headline: { collected: Figure; moneyInPlay: Figure; potential: Figure; totalDeals: Figure; averageDeal: Figure; closedUnpaid?: Figure & { declined?: number }; closedNotContracted?: Figure };
  /* `out`: money out that day (that month for All Time), in dollars with cents. Older servers leave it out. */
  trend: { date: string; label: string; amount: number; count: number; out?: number }[];
  revenueBySource: Breakdown[];
  revenueByIndustry: Breakdown[];
  revenueByPaymentMethod: Breakdown[];
  topBrands: Breakdown[];
  pipeline: {
    sections: { key: string; label: string; count: number; amount: number; dealIds: string[] }[];
    funnel: { pitched: number; secured: number; paid: number; pitchedIds: string[]; securedIds: string[]; paidIds: string[]; conversion: number; securedConversion: number };
  };
  deals: DashDeal[];
  attention: {
    // Overdue first (delivered 14+ days ago, not paid), as the server orders them; older servers leave out the newer fields.
    awaitingPayment: { id: string; brandName: string; amount: number; days: number; deliveredAt?: string | null; overdue?: boolean }[];
    awaitingCount: number; awaitingTotal: number; awaitingIds?: string[];
    overdueCount?: number; overdueTotal?: number; overdueIds?: string[];
    stale: { id: string; brandName: string; amount: number; days: number; status: DealStatus }[];
    staleCount: number; staleIds?: string[];
  };
}

const RANGES: { id: Range; label: string }[] = [{ id: "7d", label: "7D" }, { id: "30d", label: "30D" }, { id: "90d", label: "90D" }, { id: "1y", label: "1Y" }, { id: "all", label: "All" }];

interface Drill { title: string; figure: string; ids: string[] }

function DrillDialog({ drill, deals, onClose }: { drill: Drill; deals: DashDeal[]; onClose: () => void }) {
  const byId = new Map(deals.map((d) => [d.id, d]));
  const list = drill.ids.map((id) => byId.get(id)).filter(Boolean) as DashDeal[];
  const groups = DEAL_STATUSES.map((s) => ({ status: s, deals: list.filter((d) => d.status === s) })).filter((g) => g.deals.length);
  return (
    <Modal title={<span>{drill.title} <span className="muted" style={{ fontWeight: 500 }}>{drill.figure} · {plural(list.length, "deal")}</span></span>} onClose={onClose} width={520}>
      {groups.length === 0 ? <p className="muted">No deals behind this number yet.</p> : null}
      {groups.map((g) => (
        <div key={g.status} className="drill-group">
          <div className="drill-head"><StagePill status={g.status} /><span className="muted">{money(g.deals.reduce((t, d) => t + d.amount, 0))}</span></div>
          {g.deals.map((d) => (
            <button key={d.id} className="drill-row" onClick={() => { onClose(); openDeal(d.id); }}>
              <Monogram name={d.brandName} size={26} /><span>{d.brandName}</span><b>{money(d.amount)}</b><ChevronRight />
            </button>
          ))}
        </div>
      ))}
    </Modal>
  );
}

/** A smooth line through every point that never overshoots them (monotone cubic), as the website draws it. */
function monotone(points: [number, number][]) {
  if (points.length < 2) return points.length ? `M${points[0][0]},${points[0][1]}` : "";
  const gaps: number[] = [];
  const slopes: number[] = [];
  for (let i = 0; i < points.length - 1; i += 1) {
    gaps.push(points[i + 1][0] - points[i][0]);
    slopes.push((points[i + 1][1] - points[i][1]) / gaps[i]);
  }
  const tangents = points.map((_, i) => {
    if (i === 0) return slopes[0];
    if (i === points.length - 1) return slopes[i - 1];
    if (slopes[i - 1] * slopes[i] <= 0) return 0;
    const span = gaps[i - 1] + gaps[i];
    return 3 * span / ((span + gaps[i]) / slopes[i - 1] + (span + gaps[i - 1]) / slopes[i]);
  });
  let path = `M${points[0][0].toFixed(2)},${points[0][1].toFixed(2)}`;
  for (let i = 0; i < points.length - 1; i += 1) {
    const third = gaps[i] / 3;
    const [x0, y0] = points[i];
    const [x1, y1] = points[i + 1];
    path += ` C${(x0 + third).toFixed(2)},${(y0 + tangents[i] * third).toFixed(2)} ${(x1 - third).toFixed(2)},${(y1 - tangents[i + 1] * third).toFixed(2)} ${x1.toFixed(2)},${y1.toFixed(2)}`;
  }
  return path;
}

const STEPS = [1, 2, 2.5, 3, 4, 5, 6, 8, 10];
/** A round step so three of them reach the top: $0, $2K, $4K, $6K. */
function niceStep(value: number) {
  if (value <= 0) return 100;
  const raw = value / 3;
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  return STEPS.map((s) => s * magnitude).find((c) => c >= raw) ?? raw;
}
const compact = (v: number) => (v >= 1000 ? `$${(v / 1000).toLocaleString("en-US", { maximumFractionDigits: 1 })}K` : `$${Math.round(v)}`);
const dollars = (v: number) => (Number.isInteger(v) ? money(v) : `$${v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);

/*
  The income graph, Shopify-style (the website's HubCollectedChart): Collected
  adding up over the range as a smooth line with a soft fill, and, with "Show
  money out", what went out over the same range on the same scale. No
  comparison with an earlier period.
*/
function Chart({ trend, rangeLabel, showOut, onShowOut }: { trend: Dash["trend"]; rangeLabel: string; showOut: boolean; onShowOut?: (on: boolean) => void }) {
  const width = 1000;
  const height = 100;
  const series = useMemo(() => {
    let collected = 0;
    let out = 0;
    return trend.map((t) => {
      collected += t.amount;
      out = Math.round((out + (t.out ?? 0)) * 100) / 100;
      return { ...t, total: collected, outTotal: out };
    });
  }, [trend]);
  const [hover, setHover] = useState<number | null>(null);
  const total = series.at(-1)?.total ?? 0;
  const outTotal = series.at(-1)?.outTotal ?? 0;
  const drawOut = showOut && outTotal > 0;
  const step = niceStep(Math.max(total, drawOut ? outTotal : 0));
  const max = step * 3;
  const last = Math.max(1, series.length - 1);
  const x = (i: number) => (series.length <= 1 ? 50 : (i / last) * 100);
  const y = (v: number) => (1 - v / max) * 100;
  const path = (pick: (p: (typeof series)[number]) => number) => monotone(series.map((p, i) => [(x(i) / 100) * width, (y(pick(p)) / 100) * height]));
  const line = path((p) => p.total);
  const outLine = drawOut ? path((p) => p.outTotal) : "";
  const tickCount = Math.min(5, series.length);
  const ticks = [...new Set(Array.from({ length: tickCount }, (_, i) => Math.round((i / Math.max(1, tickCount - 1)) * last)))];
  const h = hover !== null ? series[hover] : null;
  const words = rangeLabel === "All Time" ? "all time" : rangeLabel.toLowerCase();
  return (
    <div className="chart shopify">
      {onShowOut ? <label className="chart-switch"><button role="switch" aria-checked={showOut} className={`switch ${showOut ? "on" : ""}`} onClick={() => onShowOut(!showOut)}><i /></button>Show money out</label> : null}
      <div className="chart-body">
        <div className="chart-y">{[3, 2, 1, 0].map((n) => <span key={n} style={{ top: `${y(step * n)}%` }}>{compact(step * n)}</span>)}</div>
        <div className="chart-plot" onMouseLeave={() => setHover(null)} onMouseMove={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          setHover(Math.max(0, Math.min(series.length - 1, Math.round(((e.clientX - r.left) / r.width) * last))));
        }}>
          <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none">
            <defs><linearGradient id="mac-collected-fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" className="fill-top" /><stop offset="1" className="fill-bottom" /></linearGradient></defs>
            {[0, 1, 2, 3].map((n) => <line key={n} x1="0" x2={width} y1={y(step * n)} y2={y(step * n)} className="grid" vectorEffect="non-scaling-stroke" />)}
            {total > 0 ? <path d={`${line} L${width},${height} L0,${height} Z`} className="area" fill="url(#mac-collected-fill)" /> : null}
            <path key={`in-${rangeLabel}`} d={line} className="line" pathLength={1} vectorEffect="non-scaling-stroke" />
            {outLine ? <path key={`out-${rangeLabel}`} d={outLine} className="line out" pathLength={1} vectorEffect="non-scaling-stroke" /> : null}
          </svg>
          {hover === null && series.length > 1 && (total > 0 || drawOut) ? <>
            <span className="chart-end" style={{ top: `${y(total)}%` }}>{dollars(total)}</span>
            {drawOut ? <span className="chart-end out" style={{ top: `${y(outTotal)}%` }}>{dollars(outTotal)}</span> : null}
          </> : null}
          {h && hover !== null ? <>
            <span className="chart-guide" style={{ left: `${x(hover)}%` }} />
            <span className="chart-ring" style={{ left: `${x(hover)}%`, top: `${y(h.total)}%` }} />
            {drawOut ? <span className="chart-ring out" style={{ left: `${x(hover)}%`, top: `${y(h.outTotal)}%` }} /> : null}
            <div className={`chart-tip ${x(hover) > 70 ? "left" : ""}`} style={{ left: `${x(hover)}%` }}>
              <small>{h.label}</small>
              <span><i className="key" />Collected<b>{dollars(h.total)}</b></span>
              {h.count ? <small className="faint">{money(h.amount)} from {plural(h.count, "payment")}</small> : null}
              {drawOut ? <span><i className="key out" />Money out<b>{dollars(h.outTotal)}</b></span> : null}
            </div>
          </> : null}
        </div>
      </div>
      <div className="chart-x">{ticks.map((i) => <span key={i} style={{ left: `${x(i)}%` }} data-edge={i === 0 ? "start" : i === last ? "end" : undefined}>{series[i]?.label}</span>)}</div>
      <div className="chart-legend"><span><i className="key" />Collected · {words}</span>{drawOut ? <span><i className="key out" />Money out</span> : null}</div>
    </div>
  );
}

function Bars({ title, sub, note, rows, onDrill }: { title: string; sub?: string; note?: string; rows: Breakdown[]; onDrill: (d: Drill) => void }) {
  const max = Math.max(1, ...rows.map((r) => r.amount));
  return (
    <div className="card dash-card">
      <h3>{title}</h3>{sub ? <span className="faint">{sub}</span> : null}
      {rows.map((r) => (
        <button key={r.key} className="bar-row" onClick={() => onDrill({ title: r.label, figure: money(r.amount), ids: r.dealIds })}>
          <span className="bl">{r.label}</span><span className="bv">{money(r.amount)}</span>
          <span className="bt"><i style={{ width: `${(r.amount / max) * 100}%` }} /></span>
        </button>
      ))}
      {note ? <span className="faint" style={{ fontSize: 12, marginTop: 4 }}>{note}</span> : null}
    </div>
  );
}

const tagged = (rows: Breakdown[]) => rows.some((r) => r.key !== "not_set");

/* The website's wording for a range and the period it's compared with (HubAnalyticsDashboard). */
function during(rangeLabel: string) {
  if (rangeLabel === "All Time") return "of all time";
  if (rangeLabel === "This Month") return "this month";
  return `in the ${rangeLabel.toLowerCase()}`;
}
/* No comparisons anywhere (Simon, Nov 10): no change pill, no "the 30 days before", no "vs" line. */

/*
  Top brands as the website shows them: collected in the range plus money in
  play, per brand. Both come from the figures' own deal lists, so they use the
  very filters the Collected and Money in play numbers use.
*/
function topBrands(d: Dash) {
  const byId = new Map(d.deals.map((deal) => [deal.id, deal]));
  const brands = new Map<string, { brandName: string; collected: number; inPlay: number; dealIds: string[] }>();
  const add = (ids: string[] | undefined, key: "collected" | "inPlay") => {
    for (const id of ids ?? []) {
      const deal = byId.get(id);
      if (!deal) continue;
      const brand = brands.get(deal.brandName) ?? { brandName: deal.brandName, collected: 0, inPlay: 0, dealIds: [] };
      brand[key] += key === "collected" ? deal.collected ?? deal.amount : deal.amount;
      if (!brand.dealIds.includes(id)) brand.dealIds.push(id);
      brands.set(deal.brandName, brand);
    }
  };
  add(d.headline.collected.dealIds, "collected");
  add(d.headline.moneyInPlay.dealIds, "inPlay");
  return [...brands.values()].filter((b) => b.collected > 0 || b.inPlay > 0)
    .sort((a, b) => b.collected + b.inPlay - a.collected - a.inPlay || a.brandName.localeCompare(b.brandName))
    .slice(0, 6);
}

/** `fixedRange`: Admin → Hubs shows a student's last 30 days, as the website does. */
export function Dashboard({ fixedRange }: { fixedRange?: Range } = {}) {
  const src = useHubSource();
  const [chosen, setRange] = useState<Range>(() => (localStorage.getItem("ch.hub.range") as Range) || "30d");
  const range = fixedRange ?? chosen;
  const { data, isLoading, isError } = useQuery({
    queryKey: [...src.key, "dashboard", range],
    queryFn: async () => (await api<{ dashboard: Dash }>(sourcePath(src, `/dashboard?range=${range}`))).dashboard,
  });
  const [drill, setDrill] = useState<Drill | null>(null);
  const pick = (r: Range) => { setRange(r); try { localStorage.setItem("ch.hub.range", r); } catch { /* fine */ } };
  const d = data;
  const when = d ? during(d.rangeLabel) : "";
  // The member's own money in & out; Admin → Hubs (someone else's Hub) shows neither the switch nor the sections.
  const own = src.base === "/api/hub" && !fixedRange;
  const moneyData = useMoney().data;
  const [showOutLocal, setShowOutLocal] = useState<boolean | null>(null);
  const showOut = own ? showOutLocal ?? moneyData?.show_money_out ?? true : false;
  const brands = d ? topBrands(d) : [];
  const overdueCount = d?.attention.overdueCount ?? 0;
  const unpaid = d?.headline.closedUnpaid;
  const fell = d?.headline.closedNotContracted;

  return (
    <div className="page dash-page">
      <div className="mhead">
        <h1>Dashboard</h1><span className="sub">See what's earning, moving, and waiting.</span>
        <div className="acts">
          <button className="btn" onClick={() => openExport({ range })}><Download />Export</button>
          <button className="btn honey" onClick={() => openDealForm({})}><Plus />New deal</button>
        </div>
      </div>
      {isError ? <div className="empty-state">Couldn't load the dashboard.</div> : null}
      {isLoading ? <div className="empty-state">Loading…</div> : null}
      {d ? (
        <div className="dash-body">
          <div className="dash-main scroll">
            <div className="card dash-hero">
              <div className="dh-top">
                <button className="dh-fig" onClick={() => setDrill({ title: "Collected", figure: money(d.headline.collected.value), ids: d.headline.collected.dealIds ?? [] })}>
                  <span className="muted">Collected</span>
                  <span><b>{money(d.headline.collected.value)}</b></span>
                  <span className="muted">{plural(d.headline.collected.count ?? 0, "payout")} {when}</span>
                </button>
                <div className="seg">{RANGES.map((r) => <button key={r.id} className={range === r.id ? "on" : ""} onClick={() => pick(r.id)}>{r.label}</button>)}</div>
              </div>
              <Chart trend={d.trend} rangeLabel={d.rangeLabel} showOut={showOut}
                onShowOut={own ? (on) => { setShowOutLocal(on); void saveShowMoneyOut(on).catch(() => undefined); } : undefined} />
              <div className="dh-stats">
                <div>
                  <button onClick={() => setDrill({ title: "Money in play", figure: money(d.headline.moneyInPlay.value), ids: d.headline.moneyInPlay.dealIds ?? [] })}>
                    <span className="muted">Money in play</span><b>{money(d.headline.moneyInPlay.value)}</b><small className="muted">{plural(d.headline.moneyInPlay.count ?? 0, "deal")} secured, not yet paid</small>
                  </button>
                  <button className="pot-chip" onClick={() => setDrill({ title: "Potential", figure: money(d.headline.potential.value), ids: d.headline.potential.dealIds ?? [] })}>
                    Potential <b>{money(d.headline.potential.value)}</b> · {plural(d.headline.potential.count ?? 0, "deal")}<ChevronRight />
                  </button>
                </div>
                <button onClick={() => setDrill({ title: "Total deals", figure: String(d.headline.totalDeals.value), ids: d.headline.totalDeals.dealIds ?? [] })}>
                  <span className="muted">Total deals</span><b>{d.headline.totalDeals.value}</b><small className="muted">Added {when}</small>
                </button>
                <button onClick={() => setDrill({ title: "Avg deal size", figure: money(d.headline.averageDeal.value), ids: d.headline.averageDeal.dealIds ?? d.headline.totalDeals.dealIds ?? [] })}>
                  <span className="muted">Avg deal size</span><b>{money(d.headline.averageDeal.value)}</b><small className="muted">{d.range === "all" ? "Across every deal" : `Across the deals added ${when}`}</small>
                </button>
              </div>
              {/* Expected money that didn't pay out, by the day each deal closed; shown only when there is some. */}
              {unpaid && unpaid.value > 0 ? (
                <button className="dh-unpaid" onClick={() => setDrill({ title: "Didn't pay out", figure: money(unpaid.value), ids: unpaid.dealIds ?? [] })}>
                  <span className="muted">Didn't pay out</span><b>{money(unpaid.value)}</b>
                  <small className="muted">{[`${plural(unpaid.count ?? 0, "deal")} ${when}`, ...([["Declined", unpaid.declined ?? 0], ["Unresolved", unpaid.value - (unpaid.declined ?? 0)]] as const)
                    .filter(([, amount]) => amount > 0).map(([label, amount]) => `${label} ${money(amount)}`)].join(" · ")}</small>
                  <ChevronRight />
                </button>
              ) : null}
              {/* Closed – Not contracted: its own figure, never added to Didn't pay out; shown only when there is some. */}
              {fell && fell.value > 0 ? (
                <button className="dh-unpaid fell-through" onClick={() => setDrill({ title: "Fell through", figure: money(fell.value), ids: fell.dealIds ?? [] })}>
                  <span className="muted">Fell through</span><b>{money(fell.value)}</b>
                  <small className="muted">{plural(fell.count ?? 0, "deal")} {when} · fell through in negotiation</small>
                  <ChevronRight />
                </button>
              ) : null}
            </div>
            <div className="dash-grid">
              <div className="card dash-card">
                <h3>Active pipeline</h3><span className="faint">Where the money is</span>
                {d.pipeline.sections.map((s) => {
                  const max = Math.max(1, ...d.pipeline.sections.map((x) => x.amount));
                  return (
                    <button key={s.key} className={`bar-row sec-${s.key}`} onClick={() => setDrill({ title: s.label, figure: money(s.amount), ids: s.dealIds })}>
                      <span className="bl">{s.label}</span><span className="bv">{money(s.amount)}</span><span className="bt"><i style={{ width: `${(s.amount / max) * 100}%` }} /></span>
                    </button>
                  );
                })}
              </div>
              <div className="card dash-card">
                <h3>Funnel</h3><span className="faint">Deals added {d.range === "all" ? "ever" : `in the ${d.rangeLabel.toLowerCase()}`}</span>
                {[
                  { label: "Pitched", n: d.pipeline.funnel.pitched, ids: d.pipeline.funnel.pitchedIds, pct: null, cls: "grey" },
                  { label: "Secured+", n: d.pipeline.funnel.secured, ids: d.pipeline.funnel.securedIds, pct: d.pipeline.funnel.securedConversion, cls: "" },
                  { label: "Paid", n: d.pipeline.funnel.paid, ids: d.pipeline.funnel.paidIds, pct: d.pipeline.funnel.conversion, cls: "green" },
                ].map((f) => (
                  <button key={f.label} className={`bar-row ${f.cls}`} onClick={() => setDrill({ title: f.label, figure: String(f.n), ids: f.ids })}>
                    <span className="bl">{f.label}</span><span className="bv">{f.n}{f.pct !== null ? ` · ${f.pct}%` : ""}</span>
                    <span className="bt"><i style={{ width: `${d.pipeline.funnel.pitched ? (f.n / d.pipeline.funnel.pitched) * 100 : 0}%` }} /></span>
                  </button>
                ))}
              </div>
              <div className="card dash-card">
                <h3>Top brands</h3><span className="faint">Collected in {d.rangeLabel.toLowerCase()} + current money in play</span>
                {brands.length === 0 ? <p className="faint">Brands will appear here once deals are secured or collected.</p> : brands.map((b) => (
                  <button key={b.brandName} className="brand-row" onClick={() => setDrill({ title: b.brandName, figure: money(b.collected + b.inPlay), ids: b.dealIds })}>
                    <Monogram name={b.brandName} size={22} /><span>{b.brandName}<small className="faint">{money(b.collected)} collected · {money(b.inPlay)} in play</small></span><b>{money(b.collected + b.inPlay)}</b>
                  </button>
                ))}
              </div>
              {tagged(d.revenueBySource) ? <Bars title="By source" sub="Where collected deals came from" rows={d.revenueBySource} onDrill={setDrill}
                note="A deal with more than one source counts in full under each one, so these rows can add up to more than you collected." /> : null}
              {tagged(d.revenueByIndustry) ? <Bars title="By industry" sub="Niches paying you most" rows={d.revenueByIndustry} onDrill={setDrill} /> : null}
              {tagged(d.revenueByPaymentMethod) ? <Bars title="By payment method" sub="How brands paid you" rows={d.revenueByPaymentMethod} onDrill={setDrill} /> : null}
              {!tagged(d.revenueBySource) && !tagged(d.revenueByIndustry) && !tagged(d.revenueByPaymentMethod)
                ? <p className="faint dash-prompt">Source, industry and payment method breakdowns will appear once you tag your deals.</p> : null}
            </div>
            {/* New, and last: everything above is the Dashboard as it was (the website's hand-off §11.1). */}
            {own ? <MoneySections /> : null}
          </div>
          <aside className="dash-side scroll">
            <h3>Needs attention</h3>
            {d.attention.awaitingCount ? (
              <div className="att-box">
                <button className="t-card" onClick={() => setDrill({ title: "Awaiting payment", figure: money(d.attention.awaitingTotal), ids: d.attention.awaitingIds ?? d.attention.awaitingPayment.map((a) => a.id) })}>
                  <span className="t-ico honey"><Wallet /></span>
                  <span><b>Awaiting payment · {money(d.attention.awaitingTotal)}</b><small>{plural(d.attention.awaitingCount, "deal")} delivered, not paid yet</small></span>
                </button>
                {overdueCount ? (
                  <button className="att-link" onClick={() => setDrill({ title: "Overdue", figure: money(d.attention.overdueTotal ?? 0), ids: d.attention.overdueIds ?? d.attention.awaitingPayment.filter((a) => a.overdue).map((a) => a.id) })}>
                    <span className="tag-s late">{overdueCount} overdue</span><span className="faint">Delivered 14+ days ago</span><ChevronRight />
                  </button>
                ) : null}
                {d.attention.awaitingPayment.map((a) => (
                  <button key={a.id} className="att-row" onClick={() => openDeal(a.id)}>
                    <span><b>{a.brandName}</b><small>{a.deliveredAt ? deliveredAgo(a.days) : `${a.days}d`}</small></span>
                    {a.overdue ? <span className="tag-s late">Overdue</span> : null}<b>{money(a.amount)}</b>
                  </button>
                ))}
              </div>
            ) : null}
            {d.attention.staleCount ? (
              <div className="att-box">
                <button className="t-card" onClick={() => setDrill({ title: "Stale deals", figure: plural(d.attention.staleCount, "deal"), ids: d.attention.staleIds ?? d.attention.stale.map((s) => s.id) })}>
                  <span className="t-ico flame"><Hourglass /></span>
                  <span><b>{plural(d.attention.staleCount, "stale deal")}</b><small>No stage change in 7+ days</small></span>
                </button>
                {d.attention.stale.map((s) => (
                  <button key={s.id} className="att-row" onClick={() => openDeal(s.id)}>
                    <span><b>{s.brandName}</b><small>{staleText(s.days)}</small></span><b>{money(s.amount)}</b>
                  </button>
                ))}
              </div>
            ) : null}
            {!d.attention.awaitingCount && !d.attention.staleCount ? <p className="faint">Nothing waiting on you. Nice.</p> : null}
          </aside>
        </div>
      ) : null}
      {drill && d ? <DrillDialog drill={drill} deals={d.deals} onClose={() => setDrill(null)} /> : null}
    </div>
  );
}
