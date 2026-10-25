import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowUpRight, CalendarClock, ChartNoAxesColumn, ChartNoAxesCombined, Check, CheckCircle2, ChevronDown, ChevronRight, CircleDollarSign, Clock3, Columns3, Download, Layers, Plus, Sparkles, Table2 } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../../lib/api";
import {
  BOARDS, BOARD_LABELS, BOARD_STATUSES, STATUS_LABELS, active, allDeals, contracted, daysBetween, dealTypeLabel, isDraftPending, localToday,
  monDay, monDayYear, potential, total, useCash, useDeals, type Board, type Cash, type Deal, type DealStatus,
} from "../../lib/hub";
import { money, plural } from "../../lib/format";
import { nav } from "../../lib/nav";
import { Modal, Monogram, StageButton, StagePill, moveDeal } from "./parts";
import { openDealForm } from "./DealForm";
import { openExport } from "./Export";
import { ShareHubButton } from "./ShareHub";

export type SmartView = "due" | "awaiting" | "retainers";

/* ---------- The overview band ---------- */

const TIER_LABELS: Record<string, string> = { newbie: "New Bee", hustle: "Hustle Bee", pro: "Pro Bee" };
const tierName = (tier: Cash["tier"]) => (tier.currentTier === "queen" ? tier.topTierName : TIER_LABELS[tier.currentTier] ?? tier.currentTier);

/* The website's DesktopTierProgress: three segments New → Hustle → Pro → top tier. */
function TierProgress({ cash }: { cash: Cash }) {
  const { tier } = cash;
  const config = { newbie: [0, 1000, 0], hustle: [1000, 3000, 1], pro: [3000, 10000, 2] }[tier.currentTier as "newbie"];
  const interval = config ? Math.max(0, Math.min(100, ((tier.collectedThisMonth - config[0]) / (config[1] - config[0])) * 100)) : 100;
  const visual = config ? ((config[2] + interval / 100) / 3) * 100 : 100;
  const reached = ["newbie", "hustle", "pro", "queen"].indexOf(tier.currentTier);
  const markers = [["New Bee", "$0"], ["Hustle Bee", "$1K"], ["Pro Bee", "$3K"], [tier.topTierName, "$10K"]];
  return (
    <section className="tier-progress">
      <div className="tp-summary">
        <div><span className="tp-tier"><Sparkles />{tierName(tier)}</span><p><b className="green">{money(tier.collectedThisMonth)}</b> collected this month</p></div>
        {tier.nextTier
          ? <div className="tp-next"><b>{money(tier.amountToNextTier ?? 0)}</b><span>to {tier.nextTier}</span><small>{Math.round(interval)}% through this tier</small></div>
          : <div className="tp-next"><b>Top tier reached</b><small>Keep building the hive</small></div>}
      </div>
      <div className="tp-track"><span style={{ width: `${visual}%` }} /><i style={{ left: "33.333%" }} /><i style={{ left: "66.666%" }} /></div>
      <div className="tp-markers">{markers.map(([label, amount], index) => <div key={label} className={index <= reached ? "reached" : ""}><span>{label}</span><small>{amount}</small></div>)}</div>
    </section>
  );
}

export function DealListDialog({ title, deals, onClose }: { title: string; deals: Deal[]; onClose: () => void }) {
  const byStage = BOARDS.flatMap((b) => BOARD_STATUSES[b]).map((s) => ({ status: s, deals: deals.filter((d) => d.status === s) })).filter((g) => g.deals.length);
  return (
    <Modal title={<span>{title} <span className="muted" style={{ fontWeight: 500 }}>{money(total(deals))} · {plural(deals.length, "deal")}</span></span>} onClose={onClose} width={520}>
      {byStage.length === 0 ? <p className="muted">No deals here.</p> : null}
      {byStage.map((group) => (
        <div key={group.status} className="drill-group">
          <div className="drill-head"><StagePill status={group.status} /><span className="muted">{money(total(group.deals))}</span></div>
          {group.deals.map((d) => (
            <button key={d.id} className="drill-row" onClick={() => { onClose(); openDeal(d.id); }}>
              <Monogram name={d.brand_name} size={26} /><span>{d.brand_name}</span><b>{money(d.amount_usd)}</b><ChevronRight />
            </button>
          ))}
        </div>
      ))}
    </Modal>
  );
}

function Overview({ deals }: { deals: Deal[] }) {
  const cash = useCash().data;
  const [open, setOpen] = useState<null | "contracted" | "potential">(null);
  const inPlay = contracted(deals);
  const pot = potential(deals);
  const live = active(deals);
  const collected = cash?.tier.collectedThisMonth ?? 0;
  const delta = cash ? collected - cash.activity.previous_month_collected_usd : 0;
  return (
    <div className="card hub-overview">
      {cash ? <TierProgress cash={cash} /> : <div className="tier-progress skel" />}
      <div className="hub-metrics">
        <div className="metric money-in-play">
          <span className="ml"><Clock3 />Money in Play</span>
          <div className="mip">
            <button onClick={() => setOpen("contracted")}><small>Contracted</small><b>{money(total(inPlay))}</b><span>{plural(inPlay.length, "deal")}<ChevronRight /></span></button>
            <button onClick={() => setOpen("potential")}><small>Potential</small><b className="muted-num">{money(total(pot))}</b><span>{plural(pot.length, "deal")}<ChevronRight /></span></button>
          </div>
        </div>
        <div className="metric"><span className="ml"><Check />Collected</span><b>{money(collected)}</b><small>{cash ? `${delta >= 0 ? "+" : "−"}${money(Math.abs(delta))} vs last month` : " "}</small>
          {cash && cash.by_person.length > 1 ? <small>{cash.by_person.map((p) => `${p.initials} ${money(p.collected_usd)}`).join(" · ")}</small> : null}</div>
        <div className="metric"><span className="ml"><Layers />Active deals</span><b>{live.length}</b><small>across 3 sections</small></div>
        <div className="metric"><span className="ml"><ChartNoAxesColumn />Avg Deal Size</span><b>{money(live.length ? Math.round(total(live) / live.length) : 0)}</b><small>across active deals</small></div>
      </div>
      {open === "contracted" ? <DealListDialog title="Contracted" deals={inPlay} onClose={() => setOpen(null)} /> : null}
      {open === "potential" ? <DealListDialog title="Potential" deals={pot} onClose={() => setOpen(null)} /> : null}
    </div>
  );
}

/* ---------- Cards ---------- */

export function openDeal(id: string) {
  nav.open({ kind: "hub", page: nav.get().view.kind === "hub" ? (nav.get().view as { page: "deals" }).page : "deals", ...(boardParam()), dealId: id }, "hub", "ch");
}
function boardParam() {
  const view = nav.get().view;
  if (view.kind !== "hub") return {};
  return { board: view.board, smart: view.smart };
}

function PeopleChip({ deal, shared }: { deal: Deal; shared: boolean }) {
  if (!shared || !deal.added_by) return null;
  const by = deal.updated_by && deal.updated_by.id !== deal.added_by.id ? ` · by ${deal.updated_by.initials}` : "";
  return <span className="tag-s">{deal.added_by.initials}{by}</span>;
}

function DealCard({ deal, shared, onDragStart, dragging }: { deal: Deal; shared: boolean; onDragStart: (e: React.PointerEvent, deal: Deal) => void; dragging: boolean }) {
  const payment = deal.payment_method_ref?.label;
  return (
    <div className={`deal-card ${dragging ? "ghost" : ""}`} onPointerDown={(e) => onDragStart(e, deal)} onClick={() => openDeal(deal.id)}
      role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === "Enter") openDeal(deal.id); }}>
      <div className="dc-top">
        <b className="dc-brand">{deal.brand_name}</b>
        <span className="dc-amt">{money(deal.amount_usd)}{deal.status === "completed" ? <CheckCircle2 /> : null}</span>
      </div>
      <div className="dc-tags">
        <span className="tag-s">{dealTypeLabel(deal.deal_type)}</span>
        {payment ? <span className="tag-s">{payment}</span> : null}
        <PeopleChip deal={deal} shared={shared} />
      </div>
      {deal.deliverables ? <div className="dc-line">{deal.deliverables}</div> : null}
      {deal.status === "pending_payment" && deal.payment_expected_at ? <div className={`dc-due ${deal.payment_expected_at < localToday() ? "late-text" : ""}`}>Payment expected {monDay(deal.payment_expected_at)}</div> : null}
      {isDraftPending(deal.status) && deal.draft_due_at ? <div className="dc-due">Draft due {monDay(deal.draft_due_at)}</div> : null}
      <div onPointerDown={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()}><StageButton deal={deal} onPick={(s) => void moveDeal(deal, s)} /></div>
    </div>
  );
}

/* ---------- Completed lane: grouped by the month it was paid ---------- */

function CompletedLane({ deals, shared, onDragStart, draggingId }: { deals: Deal[]; shared: boolean; onDragStart: (e: React.PointerEvent, d: Deal) => void; draggingId: string | null }) {
  const [open, setOpen] = useState<Record<string, boolean>>(() => {
    try { return JSON.parse(localStorage.getItem("hub.completed.open.v1") ?? "{}"); } catch { return {}; }
  });
  useEffect(() => { try { localStorage.setItem("hub.completed.open.v1", JSON.stringify(open)); } catch { /* fine */ } }, [open]);
  const groups = useMemo(() => {
    const paid = deals.filter((d) => d.paid_at).sort((a, b) => new Date(b.paid_at!).getTime() - new Date(a.paid_at!).getTime());
    const months = new Map<string, Deal[]>();
    for (const d of paid) {
      const date = new Date(d.paid_at!);
      const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
      months.set(key, [...(months.get(key) ?? []), d]);
    }
    return { months: [...months.entries()], unknown: deals.filter((d) => !d.paid_at) };
  }, [deals]);
  const thisYear = new Date().getFullYear();
  const newest = groups.months[0]?.[0];
  let lastQuarter = "";
  const recent = groups.months.filter(([key]) => Number(key.slice(0, 4)) >= thisYear - 1);
  const archive = groups.months.filter(([key]) => Number(key.slice(0, 4)) < thisYear - 1);
  const isOpen = (key: string) => open[key] ?? key === newest;
  const quarterTotal = (year: string, q: number) => recent.filter(([k]) => k.startsWith(year) && Math.ceil(Number(k.slice(5)) / 3) === q).reduce((t, [, list]) => t + total(list), 0);

  return (
    <div className="lane-body">
      {recent.map(([key, list]) => {
        const year = key.slice(0, 4);
        const q = Math.ceil(Number(key.slice(5)) / 3);
        const quarter = `Q${q} ${year}`;
        const showQuarter = quarter !== lastQuarter;
        lastQuarter = quarter;
        const label = new Date(`${key}-15T12:00:00`).toLocaleDateString("en-US", { month: "long" });
        const current = year === String(thisYear) && q === Math.ceil((new Date().getMonth() + 1) / 3);
        return (
          <div key={key}>
            {showQuarter ? <div className="quarter"><span>{quarter}</span><span>{money(quarterTotal(year, q))}{current ? " so far" : ""}</span></div> : null}
            <button className="month" onClick={() => setOpen({ ...open, [key]: !isOpen(key) })}>
              {isOpen(key) ? <ChevronDown /> : <ChevronRight />}<b>{label}</b><span className="muted">{plural(list.length, "deal")}</span><span className="m-amt">{money(total(list))}</span>
            </button>
            {isOpen(key) ? (
              <div className="month-cards">{list.map((d) => <DealCard key={d.id} deal={d} shared={shared} onDragStart={onDragStart} dragging={draggingId === d.id} />)}</div>
            ) : null}
          </div>
        );
      })}
      {archive.length ? (
        <>
          <button className="month" onClick={() => setOpen({ ...open, archive: !open.archive })}>
            {open.archive ? <ChevronDown /> : <ChevronRight />}<b>Archive · Earlier years</b><span className="muted">{archive.reduce((n, [, l]) => n + l.length, 0)}</span><span className="m-amt">{money(archive.reduce((t, [, l]) => t + total(l), 0))}</span>
          </button>
          {open.archive ? archive.flatMap(([, list]) => list).map((d) => (
            <button key={d.id} className="paid-row" onClick={() => openDeal(d.id)}><Monogram name={d.brand_name} size={20} /><span>{d.brand_name}</span><span className="muted">{monDayYear(d.paid_at!)}</span><b>{money(d.amount_usd)}</b></button>
          )) : null}
        </>
      ) : null}
      {groups.unknown.length ? (
        <>
          <button className="month" onClick={() => setOpen({ ...open, unknown: !open.unknown })}>
            {open.unknown ? <ChevronDown /> : <ChevronRight />}<b>Paid date unknown</b><span className="muted">{groups.unknown.length}</span><span className="m-amt">{money(total(groups.unknown))}</span>
          </button>
          {open.unknown ? (
            <>
              <p className="faint lane-note">Not counted in any month or in Cash until a paid date is added.</p>
              {groups.unknown.map((d) => <DealCard key={d.id} deal={d} shared={shared} onDragStart={onDragStart} dragging={draggingId === d.id} />)}
            </>
          ) : null}
        </>
      ) : null}
      {deals.length === 0 ? <div className="lane-empty">Nothing here yet</div> : null}
    </div>
  );
}

/* ---------- Kanban with drag and drop ---------- */

interface Drag { deal: Deal; x: number; y: number; startX: number; startY: number; moved: boolean; over: DealStatus | null; width: number }

function useDragDeals() {
  const [drag, setDrag] = useState<Drag | null>(null);
  const ref = useRef<Drag | null>(null);
  ref.current = drag;

  function start(event: React.PointerEvent, deal: Deal) {
    if (event.button !== 0) return;
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    const begin: Drag = { deal, x: event.clientX, y: event.clientY, startX: event.clientX, startY: event.clientY, moved: false, over: null, width: rect.width };
    setDrag(begin);
    const move = (e: PointerEvent) => {
      const current = ref.current;
      if (!current) return;
      const moved = current.moved || Math.hypot(e.clientX - current.startX, e.clientY - current.startY) > 6;
      const target = document.elementFromPoint(e.clientX, e.clientY)?.closest<HTMLElement>("[data-drop-status]");
      setDrag({ ...current, x: e.clientX, y: e.clientY, moved, over: (target?.dataset.dropStatus as DealStatus) ?? null });
      // Scroll the board near its edges.
      const scroller = document.querySelector<HTMLElement>(".kanban");
      if (moved && scroller) {
        const r = scroller.getBoundingClientRect();
        if (e.clientX > r.right - 48) scroller.scrollLeft += 14;
        if (e.clientX < r.left + 48) scroller.scrollLeft -= 14;
      }
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      const current = ref.current;
      setDrag(null);
      if (current?.moved) {
        // Swallow the click that follows a drag.
        window.addEventListener("click", (e) => { e.stopPropagation(); e.preventDefault(); }, { capture: true, once: true });
        if (current.over && current.over !== current.deal.status) void moveDeal(current.deal, current.over);
      }
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }
  return { drag: drag?.moved ? drag : null, start };
}

const LANE_LIMIT = 10;
const BOARD_DOT: Record<Board, string> = { outreach: "#A3A3A3", campaigns: "var(--ink)", payment: "#8FD8A8" };

/** One stage inside a section: its pill, its cards, and where a dragged deal can land. */
function StageGroup({ status, deals, shared, drag, start }: { status: DealStatus; deals: Deal[]; shared: boolean; drag: Drag | null; start: (e: React.PointerEvent, d: Deal) => void }) {
  const [all, setAll] = useState(false);
  const shown = all ? deals : deals.slice(0, LANE_LIMIT);
  const over = drag?.over === status && drag.deal.status !== status;
  return (
    <div className={`stage-group ${over ? "over" : ""}`} data-drop-status={status}>
      <span className={`stage-pill s-${status}`}>{STATUS_LABELS[status]} <b>{deals.length}</b></span>
      {/* Laid over the group, so nothing moves under the pointer while dragging. */}
      {over ? <div className="drop-hint" aria-label={`Drop in ${STATUS_LABELS[status]}`}>Drop here</div> : null}
      {status === "completed" ? <CompletedLane deals={deals} shared={shared} onDragStart={start} draggingId={drag?.deal.id ?? null} /> : (
        <div className="sg-cards">
          {shown.map((d) => <DealCard key={d.id} deal={d} shared={shared} onDragStart={start} dragging={drag?.deal.id === d.id} />)}
          {deals.length > LANE_LIMIT ? <button className="show-more" onClick={() => setAll(!all)}>{all ? "Show fewer" : `Show ${deals.length - LANE_LIMIT} more`}</button> : null}
          {deals.length === 0 && status === "pitching" ? <button className="show-more" style={drag ? { visibility: "hidden" } : undefined} onClick={() => openDealForm({ status: "pitching" })}>+ Add a pitch</button> : null}
        </div>
      )}
    </div>
  );
}

function SectionHead({ board, deals }: { board: Board; deals: Deal[] }) {
  const live = active(deals);
  return (
    <div className="ks-head">
      <h3><i style={{ background: BOARD_DOT[board] }} />{BOARD_LABELS[board]}</h3>
      <span className="muted">{BOARD_STATUSES[board].length} stages · {plural(live.length, "active deal")} · {money(total(live))}</span>
    </div>
  );
}

function Kanban({ boards, data, shared }: { boards: Board[]; data: Record<Board, Deal[]>; shared: boolean }) {
  const { drag, start } = useDragDeals();
  return (
    <>
      <div className={`kanban-sections n${boards.length}`}>
        {boards.map((board) => (
          <section key={board} className="k-section">
            <SectionHead board={board} deals={data[board]} />
            {BOARD_STATUSES[board].map((status) => <StageGroup key={status} status={status} deals={data[board].filter((d) => d.status === status)} shared={shared} drag={drag} start={start} />)}
          </section>
        ))}
      </div>
      {drag ? (
        <div className="drag-card" style={{ left: drag.x - 40, top: drag.y - 20, width: drag.width }}>
          <div className="deal-card lifted"><div className="dc-top"><b className="dc-brand">{drag.deal.brand_name}</b><span className="dc-amt">{money(drag.deal.amount_usd)}</span></div>
            <div className="dc-tags"><span className="tag-s">{dealTypeLabel(drag.deal.deal_type)}</span></div></div>
        </div>
      ) : null}
    </>
  );
}

function DealTable({ deals, shared }: { deals: Deal[]; shared: boolean }) {
  return (
    <div className="deal-table">
      <div className="dt-row head"><span>Brand / details</span><span>Amount</span><span>Status</span><span>Payment</span><span>Updated / paid</span></div>
      {deals.map((d) => (
        <div key={d.id} className={`dt-row ${d.status === "completed" ? "done" : ""}`} onClick={() => openDeal(d.id)} role="button">
          <span className="dt-brand"><b>{d.brand_name}</b><small>{[dealTypeLabel(d.deal_type), d.deliverables].filter(Boolean).join(" · ")}{shared && d.added_by ? ` · ${d.added_by.initials}` : ""}</small></span>
          <span className="dt-amt"><b>{money(d.amount_usd)}</b>{d.status === "completed" ? <CheckCircle2 /> : null}</span>
          <span onClick={(e) => e.stopPropagation()}><StageButton deal={d} onPick={(s) => void moveDeal(d, s)} /></span>
          <span className="muted">{d.payment_method_ref?.label ?? "—"}</span>
          <span className="muted">{d.status === "completed" && d.paid_at ? monDayYear(d.paid_at) : monDayYear(d.updated_at)}</span>
        </div>
      ))}
      {deals.length === 0 ? <div className="empty-state">No deals here yet.</div> : null}
    </div>
  );
}

function TableSections({ boards, data, shared }: { boards: Board[]; data: Record<Board, Deal[]>; shared: boolean }) {
  return (
    <div className="table-sections">
      {boards.map((board) => {
        const live = active(data[board]);
        return (
          <section key={board} className="card t-section">
            <div className="ts-head"><h3><i style={{ background: BOARD_DOT[board] }} />{BOARD_LABELS[board]}</h3><span className="muted">{live.length} active · {money(total(live))}</span></div>
            <DealTable deals={data[board]} shared={shared} />
          </section>
        );
      })}
    </div>
  );
}

/* The website's "Needs attention": drafts due within a week (or late), and pending payments. */
function NeedsAttention({ deals }: { deals: Deal[] }) {
  const today = localToday();
  const due = (days: number) => (days < 0 ? `${-days} day${days === -1 ? "" : "s"} overdue` : days === 0 ? "due today" : `due in ${days} day${days === 1 ? "" : "s"}`);
  const items = deals.flatMap((d) => {
    if (d.status === "completed") return [];
    const out: { key: string; id: string; title: string; detail: string; priority: number; payment: boolean }[] = [];
    if (d.draft_due_at && isDraftPending(d.status)) {
      const days = daysBetween(today, d.draft_due_at);
      if (days <= 7) out.push({ key: `${d.id}-draft`, id: d.id, title: `${d.brand_name} draft`, detail: due(days), priority: days, payment: false });
    }
    if (d.status === "pending_payment") {
      const days = d.payment_expected_at ? daysBetween(today, d.payment_expected_at) : null;
      out.push({ key: `${d.id}-pay`, id: d.id, title: `${d.brand_name} · ${money(d.amount_usd)}`, detail: days === null ? "Pending payment" : `Payment ${due(days)}`, priority: days ?? 8, payment: true });
    }
    return out;
  }).sort((a, b) => a.priority - b.priority).slice(0, 4);
  return (
    <aside className="card needs-attention">
      <header><span className="eyebrow-caps">Keep things moving</span><h2>Needs attention</h2></header>
      {items.length ? items.map((it) => (
        <button key={it.key} className="na-row" onClick={() => openDeal(it.id)}>
          <span className="na-ico">{it.payment ? <CircleDollarSign /> : <CalendarClock />}</span>
          <span><b>{it.title}</b><small>{it.detail}</small></span><ArrowUpRight />
        </button>
      )) : <p className="na-clear"><Sparkles />Nothing needs your attention right now.</p>}
      <p className="na-foot">Based on the dates you entered for your deals.</p>
    </aside>
  );
}

/* ---------- Smart views ---------- */

export function smartDeals(view: SmartView, deals: Deal[]) {
  const today = localToday();
  const week = new Date(`${today}T12:00:00`);
  week.setDate(week.getDate() + 7);
  const inAWeek = week.toISOString().slice(0, 10);
  if (view === "due") return deals.filter((d) => isDraftPending(d.status) && d.draft_due_at && d.draft_due_at <= inAWeek).sort((a, b) => a.draft_due_at!.localeCompare(b.draft_due_at!));
  // As the Dashboard and the website count it: deals in Pending Payment.
  if (view === "awaiting") return deals.filter((d) => d.status === "pending_payment");
  return deals.filter((d) => d.deal_type === "retainer" && d.status !== "completed");
}
export const SMART_LABELS: Record<SmartView, { title: string; sub: string }> = {
  due: { title: "Due this week", sub: "Drafts due in the next 7 days, and any overdue" },
  awaiting: { title: "Awaiting payment", sub: "Deals in Pending payment: delivered, and the money hasn't come in yet" },
  retainers: { title: "Retainers", sub: "Your ongoing retainer deals" },
};

/* ---------- The page ---------- */

export function Deals({ board: boardParam, smart }: { board?: Board; smart?: SmartView }) {
  const { data, isLoading, isError, refetch } = useDeals();
  const deals = allDeals(data);
  const clients = useQuery({ queryKey: ["hub", "contacts"], staleTime: 60_000, queryFn: () => api<{ contacts: unknown[] }>("/api/hub/contacts") }).data;
  const [layout, setLayout] = useState<"kanban" | "table">(() => (localStorage.getItem("hub_desktop_deal_view") as "table") || "kanban");
  useEffect(() => { try { localStorage.setItem("hub_desktop_deal_view", layout); } catch { /* fine */ } }, [layout]);
  const shared = data?.shared ?? false;
  const boards: Board[] = boardParam ? [boardParam] : BOARDS;

  const header = (
    <div className="hub-header">
      <div>
        <span className="eyebrow-caps">Personal CRM</span>
        <h1>Creator Hub</h1>
        <p className="muted">Your deals, one hive</p>
      </div>
      <div className="acts">
        <button className="btn" onClick={() => openExport()}><Download />Export</button>
        <ShareHubButton />
        <button className="btn" onClick={() => nav.open({ kind: "hub", page: "dashboard" }, "hub", "ch")}><ChartNoAxesCombined />View full dashboard</button>
        <button className="btn honey" onClick={() => openDealForm({})}><Plus />New deal</button>
      </div>
    </div>
  );
  const tabs = (
    <div className="hub-tabs">
      <button className="on">Deals <span className="count honey">{deals.length}</span></button>
      <button onClick={() => nav.open({ kind: "hub", page: "clients" }, "hub", "ch")}>Past clients <span className="count">{clients?.contacts.length ?? ""}</span></button>
    </div>
  );

  if (isError) return <div className="page"><div className="empty-state"><div className="err-state">Couldn't load your deals.<button className="btn" onClick={() => void refetch()}>Try again</button></div></div></div>;

  if (smart) {
    return (
      <div className="page">
        <div className="mhead"><h1>{SMART_LABELS[smart].title}</h1><span className="sub">{SMART_LABELS[smart].sub}</span></div>
        <div className="hub-page scroll"><section className="card t-section"><DealTable deals={smartDeals(smart, deals)} shared={shared} /></section></div>
      </div>
    );
  }

  return (
    <div className="page">
      <div className="hub-page scroll">
        {header}
        {tabs}
        <Overview deals={deals} />
        <div className="pipeline">
          <div className="pipeline-main">
            <div className="pipeline-head">
              <div><span className="eyebrow-caps">Your pipeline</span><h2>{boardParam ? BOARD_LABELS[boardParam] : "Move deals toward payday"}</h2></div>
              <div className="seg dark">
                <button className={layout === "kanban" ? "on" : ""} onClick={() => setLayout("kanban")}><Columns3 />Kanban</button>
                <button className={layout === "table" ? "on" : ""} onClick={() => setLayout("table")}><Table2 />Table</button>
              </div>
            </div>
            {isLoading || !data ? <div className="empty-state">Loading your deals…</div>
              : layout === "kanban" ? <Kanban boards={boards} data={data} shared={shared} /> : <TableSections boards={boards} data={data} shared={shared} />}
          </div>
          <NeedsAttention deals={deals} />
        </div>
      </div>
    </div>
  );
}
