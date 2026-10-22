import { useEffect, useMemo, useRef, useState } from "react";
import { CalendarClock, Check, ChevronDown, ChevronRight, Columns3, Download, Layers, Package, Plus, Scale, Sparkles, Table2, Wallet } from "lucide-react";
import {
  BOARDS, BOARD_LABELS, BOARD_STATUSES, STATUS_LABELS, active, allDeals, contracted, dealTypeLabel, isDraftPending, localToday,
  monDay, monDayYear, potential, total, useCash, useDeals, type Board, type Deal, type DealStatus,
} from "../../lib/hub";
import { money, plural } from "../../lib/format";
import { nav } from "../../lib/nav";
import { Avatar } from "../../lib/ui";
import { Modal, Monogram, StageButton, StagePill, moveDeal } from "./parts";
import { openDealForm } from "./DealForm";
import { openExport } from "./Export";

export type SmartView = "due" | "awaiting" | "retainers";

/* ---------- The overview band ---------- */

function TierBar() {
  const cash = useCash().data;
  if (!cash) return <div className="tier-bar skel" />;
  const { tier } = cash;
  return (
    <div className="tier-bar">
      <span className="tier-name">🐝 {cash.ladder.find((l) => l.current)?.name ?? tier.currentTier}</span>
      <span className="tier-track"><i style={{ width: `${Math.min(100, tier.tierProgressPercent)}%` }} /></span>
      <span className="muted">{tier.nextTier && tier.amountToNextTier ? `${money(tier.amountToNextTier)} to ${tier.nextTier} (${money(cash.ladder.find((l) => l.name === tier.nextTier)?.minimum ?? 0)} this month)` : "Top tier this month"}</span>
    </div>
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

function Tiles({ deals }: { deals: Deal[] }) {
  const cash = useCash().data;
  const [open, setOpen] = useState<null | "contracted" | "potential">(null);
  const inPlay = contracted(deals);
  const pot = potential(deals);
  const open_ = active(deals);
  const collected = cash?.tier.collectedThisMonth ?? 0;
  const delta = cash ? collected - cash.activity.previous_month_collected_usd : 0;
  return (
    <div className="tiles">
      <div className="tile split">
        <button onClick={() => setOpen("contracted")}>
          <span className="tl"><Wallet />Contracted</span><b>{money(total(inPlay))}</b><small>Money in Play · {plural(inPlay.length, "deal")}</small>
        </button>
        <button onClick={() => setOpen("potential")}>
          <span className="tl"><Sparkles />Potential</span><b>{money(total(pot))}</b><small>{plural(pot.length, "deal")} in Outreach</small>
        </button>
      </div>
      <div className="tile">
        <span className="tl"><CalendarClock />Collected</span><b>{money(collected)}</b>
        <small>{cash ? `${delta >= 0 ? "+" : "−"}${money(Math.abs(delta))} vs last month` : " "}</small>
        {cash && cash.by_person.length > 1 ? <small>{cash.by_person.map((p) => `${p.initials} ${money(p.collected_usd)}`).join(" · ")}</small> : null}
      </div>
      <div className="tile"><span className="tl"><Layers />Active deals</span><b>{open_.length}</b><small>across 3 sections</small></div>
      <div className="tile"><span className="tl"><Scale />Avg Deal Size</span><b>{money(open_.length ? Math.round(total(open_) / open_.length) : 0)}</b><small>across active deals</small></div>
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
        <Monogram name={deal.brand_name} size={26} />
        <b className="dc-brand">{deal.brand_name}</b>
        <span className="dc-amt">{deal.status === "completed" ? <Check /> : null}{money(deal.amount_usd)}</span>
      </div>
      <div className="dc-tags">
        <span className="tag-s">{dealTypeLabel(deal.deal_type)}</span>
        {payment ? <span className="tag-s">{payment}</span> : null}
        <PeopleChip deal={deal} shared={shared} />
      </div>
      {deal.deliverables ? <div className="dc-line"><Package />{deal.deliverables}</div> : null}
      {deal.status === "pending_payment" && deal.payment_expected_at ? <div className={`dc-line ${deal.payment_expected_at < localToday() ? "late-text" : ""}`}><CalendarClock />Payment expected {monDay(deal.payment_expected_at)}</div> : null}
      {isDraftPending(deal.status) && deal.draft_due_at ? <div className={`dc-line ${deal.draft_due_at <= localToday() ? "late-text" : ""}`}><CalendarClock />{deal.draft_due_at === localToday() ? "Draft due today" : `Draft due ${monDay(deal.draft_due_at)}`}</div> : null}
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
            {isOpen(key) ? list.map((d) => (
              <button key={d.id} className={`paid-row ${draggingId === d.id ? "ghost" : ""}`} onPointerDown={(e) => onDragStart(e, d)} onClick={() => openDeal(d.id)}>
                <Monogram name={d.brand_name} size={20} /><span>{d.brand_name}</span><span className="muted">{monDay(d.paid_at!)}</span><b>{money(d.amount_usd)}</b>
              </button>
            )) : null}
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

function Lane({ status, deals, shared, drag, start }: { status: DealStatus; deals: Deal[]; shared: boolean; drag: Drag | null; start: (e: React.PointerEvent, d: Deal) => void }) {
  const [all, setAll] = useState(false);
  const shown = all ? deals : deals.slice(0, LANE_LIMIT);
  const over = drag?.over === status && drag.deal.status !== status;
  return (
    <div className={`lane ${over ? "over" : ""}`} data-drop-status={status}>
      <div className="lane-head">
        <span className={`dot s-${status}`} /><b>{STATUS_LABELS[status]}</b><span className="muted">{deals.length}</span>
        <span className="lane-amt">{money(total(status === "completed" ? deals : active(deals)))}</span>
      </div>
      {over ? <div className="drop-hint">Drop to move to {STATUS_LABELS[status]}</div> : null}
      {status === "completed" ? <CompletedLane deals={deals} shared={shared} onDragStart={start} draggingId={drag?.deal.id ?? null} /> : (
        <div className="lane-body">
          {shown.map((d) => <DealCard key={d.id} deal={d} shared={shared} onDragStart={start} dragging={drag?.deal.id === d.id} />)}
          {deals.length > LANE_LIMIT ? <button className="show-more" onClick={() => setAll(!all)}>{all ? "Show fewer" : `Show ${deals.length - LANE_LIMIT} more`}</button> : null}
          {deals.length === 0 && !over ? <div className="lane-empty">{drag ? `Drop in ${STATUS_LABELS[status]}` : "Nothing here yet"}</div> : null}
          {deals.length === 0 && status === "pitching" && !drag ? <button className="show-more" onClick={() => openDealForm({ status: "pitching" })}>+ Add a pitch</button> : null}
        </div>
      )}
    </div>
  );
}

function Kanban({ board, deals, shared }: { board: Board; deals: Deal[]; shared: boolean }) {
  const { drag, start } = useDragDeals();
  return (
    <>
      <div className="kanban scroll-x">
        {BOARD_STATUSES[board].map((status) => (
          <Lane key={status} status={status} deals={deals.filter((d) => d.status === status)} shared={shared} drag={drag} start={start} />
        ))}
      </div>
      {drag ? (
        <div className="drag-card" style={{ left: drag.x - 40, top: drag.y - 20, width: drag.width }}>
          <div className="deal-card lifted"><div className="dc-top"><Monogram name={drag.deal.brand_name} size={26} /><b className="dc-brand">{drag.deal.brand_name}</b><span className="dc-amt">{money(drag.deal.amount_usd)}</span></div>
            <div className="dc-tags"><span className="tag-s">{dealTypeLabel(drag.deal.deal_type)}</span></div></div>
        </div>
      ) : null}
    </>
  );
}

function DealTable({ deals, shared }: { deals: Deal[]; shared: boolean }) {
  return (
    <div className="deal-table scroll">
      <div className="dt-row head"><span>Brand / details</span><span className="r">Amount</span><span>Status</span><span>Payment</span><span>Updated / paid</span></div>
      {deals.map((d) => (
        <div key={d.id} className="dt-row" onClick={() => openDeal(d.id)} role="button">
          <span className="dt-brand"><Monogram name={d.brand_name} size={26} /><span><b>{d.brand_name}</b><small>{[dealTypeLabel(d.deal_type), d.deliverables].filter(Boolean).join(" · ")}{shared && d.added_by ? ` · ${d.added_by.initials}` : ""}</small></span></span>
          <span className="r"><b>{money(d.amount_usd)}</b></span>
          <span onClick={(e) => e.stopPropagation()}><StageButton deal={d} onPick={(s) => void moveDeal(d, s)} /></span>
          <span className="muted">{d.payment_method_ref?.label ?? "—"}</span>
          <span className="muted">{d.status === "completed" && d.paid_at ? `Paid ${monDayYear(d.paid_at)}` : monDayYear(d.updated_at)}</span>
        </div>
      ))}
      {deals.length === 0 ? <div className="empty-state">No deals here yet.</div> : null}
    </div>
  );
}

/* ---------- Smart views ---------- */

export function smartDeals(view: SmartView, deals: Deal[]) {
  const today = localToday();
  const week = new Date(`${today}T12:00:00`);
  week.setDate(week.getDate() + 7);
  const inAWeek = week.toISOString().slice(0, 10);
  if (view === "due") return deals.filter((d) => isDraftPending(d.status) && d.draft_due_at && d.draft_due_at <= inAWeek).sort((a, b) => a.draft_due_at!.localeCompare(b.draft_due_at!));
  if (view === "awaiting") return deals.filter((d) => d.status === "pending_payment" || (d.status === "delivered" && d.payment_expected_at));
  return deals.filter((d) => d.deal_type === "retainer" && d.status !== "completed");
}
export const SMART_LABELS: Record<SmartView, { title: string; sub: string }> = {
  due: { title: "Due this week", sub: "Drafts due in the next 7 days, and any overdue" },
  awaiting: { title: "Awaiting payment", sub: "Delivered or pending, money on its way" },
  retainers: { title: "Retainers", sub: "Your ongoing retainer deals" },
};

/* ---------- The page ---------- */

export function Deals({ board: boardParam, smart }: { board?: Board; smart?: SmartView }) {
  const { data, isLoading, isError, refetch } = useDeals();
  const deals = allDeals(data);
  const [layout, setLayout] = useState<"kanban" | "table">(() => (localStorage.getItem("hub_desktop_deal_view") as "table") || "kanban");
  const [board, setBoard] = useState<Board>(boardParam ?? ((localStorage.getItem("ch.hub.board") as Board) || "outreach"));
  useEffect(() => { if (boardParam) setBoard(boardParam); }, [boardParam]);
  useEffect(() => { try { localStorage.setItem("hub_desktop_deal_view", layout); localStorage.setItem("ch.hub.board", board); } catch { /* fine */ } }, [layout, board]);
  const shared = data?.shared ?? false;

  const head = (
    <div className="mhead">
      <h1>{smart ? SMART_LABELS[smart].title : "Deals"}</h1>
      <span className="sub">{smart ? SMART_LABELS[smart].sub : "Move deals toward payday"}</span>
      <div className="acts">
        <button className="btn" onClick={() => openExport()}><Download />Export</button>
        {shared && data?.members.length ? <span className="shared-chip"><Avatar name={data.members.find((m) => m)?.name ?? ""} size={20} />Shared Hub</span> : null}
        <button className="btn honey" onClick={() => openDealForm({})}><Plus />New deal</button>
      </div>
    </div>
  );

  if (isError) return <div className="page">{head}<div className="empty-state"><div className="err-state">Couldn't load your deals.<button className="btn" onClick={() => void refetch()}>Try again</button></div></div></div>;

  if (smart) {
    const list = smartDeals(smart, deals);
    return (
      <div className="page">{head}
        <div className="hub-body scroll"><DealTable deals={list} shared={shared} /></div>
      </div>
    );
  }

  const boardDeals = data?.[board] ?? [];
  const activeOnBoard = active(boardDeals);
  return (
    <div className="page hub-deals">
      {head}
      <div className="hub-body">
        <div className="overview">
          <TierBar />
          <Tiles deals={deals} />
        </div>
        <div className="board-bar">
          <h2>{BOARD_LABELS[board]}</h2>
          <span className="muted">{BOARD_STATUSES[board].length} stages · {plural(activeOnBoard.length, "active deal")} · {money(total(activeOnBoard))}</span>
          <div className="acts">
            <div className="seg">{BOARDS.map((b) => <button key={b} className={board === b ? "on" : ""} onClick={() => setBoard(b)}>{BOARD_LABELS[b]}</button>)}</div>
            <div className="seg">
              <button className={layout === "kanban" ? "on" : ""} onClick={() => setLayout("kanban")}><Columns3 />Kanban</button>
              <button className={layout === "table" ? "on" : ""} onClick={() => setLayout("table")}><Table2 />Table</button>
            </div>
          </div>
        </div>
        {isLoading ? <div className="empty-state">Loading your deals…</div> : layout === "kanban" ? <Kanban board={board} deals={boardDeals} shared={shared} /> : <DealTable deals={boardDeals} shared={shared} />}
      </div>
    </div>
  );
}
