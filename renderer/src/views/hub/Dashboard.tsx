import { useMemo, useState } from "react";
import { ChevronRight, Download, Hourglass, Plus, Wallet } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../../lib/api";
import { DEAL_STATUSES, sourcePath, useHubSource, type DealStatus } from "../../lib/hub";
import { money, plural } from "../../lib/format";
import { Modal, Monogram, StagePill } from "./parts";
import { openDeal } from "./Deals";
import { openDealForm } from "./DealForm";
import { openExport } from "./Export";

type Range = "7d" | "30d" | "90d" | "1y" | "all";
interface Figure { value: number; count?: number; previous?: number | null; dealIds?: string[] }
interface Breakdown { key: string; label: string; amount: number; count: number; dealIds: string[] }
interface DashDeal { id: string; brandName: string; amount: number; status: DealStatus; paidAt: string | null }
interface Dash {
  range: Range;
  rangeLabel: string;
  headline: { collected: Figure; moneyInPlay: Figure; potential: Figure; totalDeals: Figure; averageDeal: Figure };
  trend: { date: string; label: string; amount: number; count: number }[];
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
    awaitingPayment: { id: string; brandName: string; amount: number; days: number }[];
    awaitingCount: number; awaitingTotal: number; awaitingIds?: string[];
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

function Chart({ trend }: { trend: Dash["trend"] }) {
  const width = 900;
  const height = 190;
  const points = useMemo(() => {
    let running = 0;
    return trend.map((t) => (running += t.amount));
  }, [trend]);
  const max = Math.max(1, ...points);
  const step = trend.length > 1 ? width / (trend.length - 1) : width;
  const coords = points.map((v, i) => [i * step, height - (v / max) * (height - 16) - 4]);
  const line = coords.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const area = `${line} L${width},${height} L0,${height} Z`;
  const ticks = trend.length > 1 ? [0, Math.floor(trend.length / 4), Math.floor(trend.length / 2), Math.floor((3 * trend.length) / 4), trend.length - 1] : [0];
  const [hover, setHover] = useState<number | null>(null);
  return (
    <div className="chart" onMouseLeave={() => setHover(null)} onMouseMove={(e) => {
      const r = e.currentTarget.getBoundingClientRect();
      setHover(Math.max(0, Math.min(trend.length - 1, Math.round(((e.clientX - r.left) / r.width) * (trend.length - 1)))));
    }}>
      <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none">
        {[0.25, 0.5, 0.75].map((f) => <line key={f} x1="0" x2={width} y1={height * f} y2={height * f} className="grid" />)}
        <path d={area} className="area" />
        <path d={line} className="line" vectorEffect="non-scaling-stroke" />
        {coords.length ? <circle cx={coords.at(-1)![0]} cy={coords.at(-1)![1]} r="4" className="dot" vectorEffect="non-scaling-stroke" /> : null}
        {hover !== null && coords[hover] ? <line x1={coords[hover][0]} x2={coords[hover][0]} y1="0" y2={height} className="hover" vectorEffect="non-scaling-stroke" /> : null}
      </svg>
      <div className="chart-x">{ticks.map((i) => <span key={i}>{trend[i]?.label}</span>)}</div>
      {hover !== null && trend[hover] ? <div className="chart-tip" style={{ left: `${(hover / Math.max(1, trend.length - 1)) * 100}%` }}><b>{money(points[hover])}</b><span>{trend[hover].label}{trend[hover].amount ? ` · +${money(trend[hover].amount)}` : ""}</span></div> : null}
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
function previousPeriod(range: Range) {
  return { "7d": "the 7 days before", "30d": "the 30 days before", "90d": "the 90 days before", "1y": "the 12 months before", all: null }[range];
}

/** "+$12" / "−3", or null when there is nothing to compare or nothing changed. */
function change(f: Figure, asMoney = false) {
  if (f.previous === null || f.previous === undefined) return null;
  const delta = Math.round(f.value - f.previous);
  if (!delta) return null;
  return { text: `${delta > 0 ? "+" : "−"}${asMoney ? money(Math.abs(delta)) : Math.abs(delta).toLocaleString("en-US")}`, up: delta > 0 };
}

/** A stat's foot line: its change against the period before, in words. */
function Comparison({ f, before, asMoney = false }: { f: Figure; before: string | null; asMoney?: boolean }) {
  if (f.previous === null || f.previous === undefined || !before) return <>Lifetime</>;
  const delta = change(f, asMoney);
  if (!delta) return <>No change vs {before}</>;
  return <><span className={`delta-text ${delta.up ? "up" : "down"}`}>{delta.text}</span> vs {before}</>;
}

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
      brand[key] += deal.amount;
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
  const collectedChange = d ? change(d.headline.collected, true) : null;
  const when = d ? during(d.rangeLabel) : "";
  const before = d ? previousPeriod(d.range) : null;
  const brands = d ? topBrands(d) : [];

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
                  <span><b>{money(d.headline.collected.value)}</b>{collectedChange ? <span className={`delta ${collectedChange.up ? "up" : "down"}`}>{collectedChange.text}</span> : null}</span>
                  <span className="muted">{plural(d.headline.collected.count ?? 0, "payout")} {when}{d.headline.collected.previous != null && before ? ` · ${money(d.headline.collected.previous)} ${before}` : ""}</span>
                </button>
                <div className="seg">{RANGES.map((r) => <button key={r.id} className={range === r.id ? "on" : ""} onClick={() => pick(r.id)}>{r.label}</button>)}</div>
              </div>
              <Chart trend={d.trend} />
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
                  <span className="muted">Total deals</span><b>{d.headline.totalDeals.value}</b><small className="muted"><Comparison f={d.headline.totalDeals} before={before} /></small>
                </button>
                <button onClick={() => setDrill({ title: "Avg deal size", figure: money(d.headline.averageDeal.value), ids: d.headline.averageDeal.dealIds ?? d.headline.totalDeals.dealIds ?? [] })}>
                  <span className="muted">Avg deal size</span><b>{money(d.headline.averageDeal.value)}</b><small className="muted"><Comparison f={d.headline.averageDeal} before={before} asMoney /></small>
                </button>
              </div>
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
          </div>
          <aside className="dash-side scroll">
            <h3>Needs attention</h3>
            {d.attention.awaitingCount ? (
              <button className="t-card" onClick={() => setDrill({ title: "Awaiting payment", figure: money(d.attention.awaitingTotal), ids: d.attention.awaitingIds ?? d.attention.awaitingPayment.map((a) => a.id) })}>
                <span className="t-ico honey"><Wallet /></span>
                <span><b>Awaiting payment · {money(d.attention.awaitingTotal)}</b><small>{d.attention.awaitingPayment.slice(0, 2).map((a) => `${a.brandName} ${a.days}d`).join(" · ")}{d.attention.awaitingCount > 2 ? ` · +${d.attention.awaitingCount - 2} more` : ""}</small></span>
              </button>
            ) : null}
            {d.attention.staleCount ? (
              <button className="t-card" onClick={() => setDrill({ title: "Stale deals", figure: plural(d.attention.staleCount, "deal"), ids: d.attention.staleIds ?? d.attention.stale.map((s) => s.id) })}>
                <span className="t-ico flame"><Hourglass /></span>
                <span><b>{plural(d.attention.staleCount, "stale deal")}</b><small>No update in 7+ days: {d.attention.stale.slice(0, 3).map((s) => s.brandName).join(", ")}</small></span>
              </button>
            ) : null}
            {!d.attention.awaitingCount && !d.attention.staleCount ? <p className="faint">Nothing waiting on you. Nice.</p> : null}
          </aside>
        </div>
      ) : null}
      {drill && d ? <DrillDialog drill={drill} deals={d.deals} onClose={() => setDrill(null)} /> : null}
    </div>
  );
}
