import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ArrowRight, CheckCircle2, ChevronDown, Clock, FileText, Link2, Loader2, Mail, MoreHorizontal, Paperclip, Phone, Trash2, X } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { ch } from "../../lib/bridge";
import { openLink } from "../../lib/html";
import { api, queryClient } from "../../lib/api";
import {
  ADVANCE_STATUSES, BOARD_LABELS, STATUS_LABELS, boardOf, closedUnpaidLine, daysBetween, dealTypeLabel, deleteDeal, isActiveDeal, isClosedOutStatus, isDeliveredOrLater, isDraftPending, landsLabel, landsOn, localToday, monDay,
  monDayYear, nextStatus, shortDay, staleText, unpaidText, useDeal, useDeals, withTz, type Deal, type DealStatus,
} from "../../lib/hub";
import { bytes, money } from "../../lib/format";
import { nav } from "../../lib/nav";
import { Monogram, StagePill, changePaidOn, editNotContractedNote, editUnpaidReason, moveDeal, pickStage as pickStageMenu, useLayer } from "./parts";
import { openDealForm } from "./DealForm";
import { InvoiceSection } from "./Invoices";

interface Brief { id: string; filename: string; kind: "pdf" | "word" | "image" | "link"; sizeBytes: number | null; site: string | null; url: string | null; createdAt: string }

function urgency(deal: Deal): { text: string; late: boolean; landing?: boolean } | null {
  // The closed-out stages have their own banner, and are never stale or overdue.
  if (isClosedOutStatus(deal.status)) return null;
  const today = localToday();
  // Paid for a day still ahead: not collected until then.
  const lands = landsOn(deal);
  if (lands) return { text: landsLabel(lands), late: false, landing: true };
  // Delivered and not paid: how long ago, red once it's overdue (14+ days), unless an expected payment day says more.
  const unpaid = deal.unpaid_days != null ? { text: unpaidText(deal.unpaid_days), late: Boolean(deal.payment_overdue) } : null;
  if (deal.status === "pending_payment") {
    if (!deal.payment_expected_at) return unpaid ?? { text: "Payment pending", late: false };
    const days = daysBetween(today, deal.payment_expected_at);
    if (days < 0) return { text: `Payment ${-days} ${days === -1 ? "day" : "days"} overdue`, late: true };
    if (days === 0) return { text: "Payment expected today", late: false };
    return { text: `Payment expected in ${days} ${days === 1 ? "day" : "days"}`, late: false };
  }
  if (isDraftPending(deal.status) && deal.draft_due_at) {
    const late = deal.draft_due_at <= today;
    return { text: deal.draft_due_at === today ? "Draft due today" : `Draft due ${monDay(deal.draft_due_at)}`, late };
  }
  if (unpaid) return unpaid;
  if (deal.status === "completed") return null;
  if (deal.stale_days != null) return { text: staleText(deal.stale_days), late: false };
  const days = daysBetween(deal.created_at, today);
  return { text: `${days} ${days === 1 ? "day" : "days"} in your pipeline`, late: false };
}

const BRIEF_EXT_TYPES: Record<string, string> = {
  pdf: "application/pdf", doc: "application/msword", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", heic: "image/heic", webp: "image/webp",
};

/** Upload one brief file to a deal and add it; false when it couldn't be. */
export async function uploadBrief(dealId: string, file: File) {
  // Briefs live in the website's private store (its upload token only allows that), typed by extension when the Mac gives no type.
  const type = file.type || BRIEF_EXT_TYPES[file.name.split(".").pop()?.toLowerCase() ?? ""] || "";
  const up = await ch.files.upload({ route: `/api/hub/deals/${dealId}/briefs/upload`, name: `briefs/${dealId}/${file.name}`, type, bytes: await file.arrayBuffer(), access: "private" });
  if (!up.ok) return false;
  return api(`/api/hub/deals/${dealId}/briefs`, { method: "POST", body: { pathname: up.pathname, filename: file.name } }).then(() => true, () => false);
}

/** Add a link brief; the server names it after its site unless it's given a name. */
export function addBriefLink(dealId: string, url: string, name?: string) {
  return api(`/api/hub/deals/${dealId}/briefs`, { method: "POST", body: { url, ...(name ? { name } : {}) } }).then(() => true, () => false);
}

/** "https://" in front when it's missing, as a browser's address bar would; null when it isn't a web link. */
export function briefLink(value: string) {
  let typed = value.trim();
  if (!typed || /\s/.test(typed)) return null;
  if (!/^[a-z][a-z0-9+.-]*:(?!\d)/i.test(typed) && /^[^/]+\.[^/]+/.test(typed)) typed = `https://${typed}`;
  try {
    const url = new URL(typed);
    return (url.protocol === "https:" || url.protocol === "http:") && url.hostname && !url.username && !url.password ? url.toString() : null;
  } catch {
    return null;
  }
}

function Briefs({ deal }: { deal: Deal }) {
  const { data } = useQuery({
    queryKey: ["hub", "briefs", deal.id],
    queryFn: () => api<{ briefs: Brief[]; canEdit: boolean }>(`/api/hub/deals/${deal.id}/briefs`),
  });
  const [busy, setBusy] = useState(false);
  const picker = useRef<HTMLInputElement>(null);
  const briefs = data?.briefs ?? [];
  const full = briefs.length >= 5;
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["hub", "briefs", deal.id] });

  async function addFiles(files: File[]) {
    setBusy(true);
    for (const file of files.slice(0, 5 - briefs.length)) {
      if (!(await uploadBrief(deal.id, file))) window.alert(`${file.name} couldn't be uploaded (PDF, Word or pictures, up to 20 MB).`);
    }
    setBusy(false);
    void refresh();
  }

  async function addLink() {
    const url = await promptText("Add a link", "https://");
    if (!url) return;
    await api(`/api/hub/deals/${deal.id}/briefs`, { method: "POST", body: { url } }).catch(() => window.alert("That link couldn't be added."));
    void refresh();
  }

  async function menu(brief: Brief) {
    const choice = await ch.menu.popup([
      { id: "open", label: brief.kind === "link" ? "Open link" : "Quick Look" },
      ...(brief.kind !== "link" ? [{ id: "save", label: "Save to Downloads…" }] : []),
      { type: "separator" },
      { id: "delete", label: "Remove" },
    ]);
    if (choice === "open") openBrief(brief);
    if (choice === "save" && brief.url) void ch.files.save(brief.url, brief.filename);
    if (choice === "delete") { await api(`/api/hub/deals/${deal.id}/briefs/${brief.id}`, { method: "DELETE" }).catch(() => null); void refresh(); }
  }

  const openBrief = (brief: Brief) => {
    if (!brief.url) return;
    if (brief.kind === "link") void openLink(brief.url);
    else void ch.files.quickLook(brief.url, brief.filename);
  };

  return (
    <section className="dp-sec" onDragOver={(e) => e.dataTransfer.types.includes("Files") && e.preventDefault()} onDrop={(e) => { e.preventDefault(); void addFiles([...e.dataTransfer.files]); }}>
      <div className="dp-sec-head">
        <span className="section-label">Brief</span><span className="faint">{briefs.length} of 5</span>
        {data?.canEdit !== false ? (
          <span className="acts">
            {busy ? <Loader2 className="spin" /> : null}
            <button className="btn" disabled={full || busy} onClick={() => picker.current?.click()}><Paperclip />Add file</button>
            <button className="btn" disabled={full} onClick={() => void addLink()}><Link2 />Add link</button>
          </span>
        ) : null}
      </div>
      {briefs.length ? (
        <div className="briefs">
          {briefs.map((b) => (
            <button key={b.id} className="brief" onClick={() => openBrief(b)} onContextMenu={(e) => { e.preventDefault(); void menu(b); }}>
              <span className={`ficon ${b.kind}`}>{b.kind === "pdf" ? "PDF" : b.kind === "link" ? <Link2 /> : <FileText />}</span>
              <span className="fmeta"><b>{b.filename}</b><span>{b.kind === "link" ? b.site : bytes(b.sizeBytes ?? 0)}</span></span>
              <span className="more" onClick={(e) => { e.stopPropagation(); void menu(b); }}><MoreHorizontal /></span>
            </button>
          ))}
        </div>
      ) : <p className="faint dp-empty">Drop the brand's brief, mood board or contract here.</p>}
      <input ref={picker} type="file" multiple hidden accept=".pdf,.doc,.docx,image/*" onChange={(e) => { void addFiles([...(e.target.files ?? [])]); e.target.value = ""; }} />
    </section>
  );
}

/* A one-line question, since Electron has no window.prompt. */
let promptResolve: ((value: string | null) => void) | null = null;
let setPromptState: (s: { title: string; value: string } | null) => void = () => {};
export function promptText(title: string, value = "") {
  return new Promise<string | null>((resolve) => { promptResolve = resolve; setPromptState({ title, value }); });
}
export function PromptHost() {
  const [state, setState] = useState<{ title: string; value: string } | null>(null);
  useEffect(() => { setPromptState = setState; }, []);
  if (!state) return null;
  const done = (value: string | null) => { promptResolve?.(value); promptResolve = null; setState(null); };
  return <Prompt state={state} setState={setState} done={done} />;
}

function Prompt({ state, setState, done }: { state: { title: string; value: string }; setState: (s: { title: string; value: string }) => void; done: (value: string | null) => void }) {
  const box = useRef<HTMLDivElement>(null);
  useLayer(() => done(null), box);
  // On top of whatever asked, the deal pop-up included.
  return createPortal(
    <div className="scrim center" onMouseDown={(e) => e.target === e.currentTarget && done(null)}>
      <div ref={box} className="modal" role="dialog" aria-modal="true" aria-label={state.title} tabIndex={-1} style={{ width: 420 }}>
        <div className="modal-head">{state.title}</div>
        <div className="modal-body"><input className="field" autoFocus value={state.value} onChange={(e) => setState({ ...state, value: e.target.value })}
          onKeyDown={(e) => { if (e.key === "Enter") done(state.value.trim() || null); }} /></div>
        <div className="modal-foot"><button className="btn" onClick={() => done(null)}>Cancel</button><button className="btn honey" onClick={() => done(state.value.trim() || null)}>Add</button></div>
      </div>
    </div>,
    document.body,
  );
}

interface TimelineEntry { id: string; kind: "added" | "moved" | "paid"; label: string; note: string | null; dateLabel: string }

/** The deal's stage history, as the website's deal page shows it. */
function History({ deal }: { deal: Deal }) {
  const { data, isError } = useQuery({
    queryKey: ["hub", "history", deal.id, deal.status, deal.paid_at],
    retry: false,
    queryFn: () => api<{ timeline: { entries: TimelineEntry[]; complete: boolean } }>(withTz(`/api/hub/deals/${deal.id}/history`)),
  });
  if (isError) return null;
  return (
    <section className="dp-sec">
      <span className="section-label">History</span>
      {!data ? <p className="faint dp-empty">Loading…</p> : (
        <ol className="timeline">
          {[...data.timeline.entries].reverse().map((e) => (
            <li key={e.id} className={`tl-${e.kind}`}>
              <i />
              <span><b>{e.label}</b>{e.note ? <small className="faint">{e.note}</small> : null}</span>
              <span className="faint">{e.dateLabel}</span>
            </li>
          ))}
          {!data.timeline.complete ? <li className="tl-start"><i /><span className="faint">Stage history starts here — earlier changes weren't recorded.</span></li> : null}
        </ol>
      )}
    </section>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="dp-row"><span className="muted">{label}</span><span>{children}</span></div>;
}

export function DealPanel({ id, onClose, popout = false }: { id: string; onClose: () => void; popout?: boolean }) {
  const deal = useDeal(id);
  const shared = useDeals().data?.shared ?? false;
  const [moving, setMoving] = useState(false);
  const box = useRef<HTMLElement>(null);
  // The pop-up is the bottom layer: Esc closes it only when nothing it opened is showing.
  useLayer(onClose, box, !popout);

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (document.querySelector(".modal")) return;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "e" && deal) { e.preventDefault(); openDealForm({ deal }); }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [deal]);

  if (!deal) {
    return <div className={popout ? "deal-window" : "scrim side deal-scrim"} onMouseDown={(e) => e.target === e.currentTarget && onClose()}><aside ref={box} className="deal-panel" tabIndex={-1}><div className="empty-state">Loading…</div></aside></div>;
  }

  const next = deal.status === "pending_payment" ? "completed" : nextStatus(deal.status);
  const u = urgency(deal);
  const lands = landsOn(deal);
  const index = ADVANCE_STATUSES.indexOf(deal.status);
  const unpaidClosed = deal.status === "closed_unpaid";
  const notContracted = deal.status === "closed_not_contracted";
  // Either closed stage: kept, greyed, counted in no total, no stage story.
  const closed = unpaidClosed || notContracted;
  const started = monDay(deal.created_at);
  const daysIn = daysBetween(deal.created_at, localToday());

  async function more() {
    const choice = await ch.menu.popup([
      { id: "edit", label: "Edit deal", accelerator: "CommandOrControl+E" },
      { id: "duplicate", label: "Duplicate deal" },
      { type: "separator" },
      ...(!popout ? [{ id: "window", label: "Open in new window" }] : []),
      { id: "link", label: "Copy link to deal" },
      { type: "separator" },
      { id: "delete", label: "Delete deal…" },
    ]);
    if (choice === "edit") openDealForm({ deal: deal! });
    if (choice === "duplicate") openDealForm({ duplicateOf: deal! });
    if (choice === "window") ch.window.popout({ kind: "deal", id: deal!.id, title: deal!.brand_name });
    if (choice === "link") void navigator.clipboard.writeText(`${(await ch.info()).origin}/hub/deals/${deal!.id}`);
    if (choice === "delete" && window.confirm(`Delete this deal?\n\nThis can't be undone.`)) {
      try { await deleteDeal(deal!.id); onClose(); } catch { window.alert("Couldn't delete the deal."); }
    }
  }

  async function moveTo(status: DealStatus) {
    setMoving(true);
    await moveDeal(deal!, status);
    setMoving(false);
  }

  async function pickStage() {
    const choice = await pickStageMenu(deal!.status);
    if (choice) void moveTo(choice);
  }

  const panel = (
    <aside ref={box} className="deal-panel" role="dialog" aria-modal={!popout} aria-label={deal.brand_name} tabIndex={-1}>
      <div className={`dp-head ${popout ? "popout-head" : ""}`}>
        <Monogram name={deal.brand_name} size={28} />
        <b className="dp-brand">{deal.brand_name}</b>
        <StagePill status={deal.status} />
        <span className="faint">Deal · {BOARD_LABELS[boardOf(deal.status)]}</span>
        <div className="acts">
          {shared && deal.added_by ? <span className="tag-s">Added by {deal.added_by.name.split(" ")[0]}</span> : null}
          <button className="iconbtn" title="More" onClick={() => void more()}><MoreHorizontal /></button>
          {!popout ? <button className="iconbtn" title="Close (Esc)" onClick={onClose}><X /></button> : null}
        </div>
      </div>
      <div className="dp-cols">
        <div className="dp-main scroll">
          <div className="faint">{dealTypeLabel(deal.deal_type)} · started {started} · {daysIn} {daysIn === 1 ? "day" : "days"} in</div>
          <div className={`dp-amount ${closed ? "closed-unpaid" : ""}`}><b>{money(deal.amount_usd)}</b>{closed ? <span className="muted">Expected · not counted in any total</span> : null}{u ? <span className={`urgent ${u.late ? "late" : ""} ${u.landing ? "landing" : ""}`}><Clock />{u.text}</span> : null}{deal.payment_overdue && !closed ? <span className="tag-s late">Overdue</span> : null}</div>
          {notContracted ? (
            /* It fell through in negotiation: the note, and the way back is Move stage. No They paid, no invoice offer. */
            <div className="closed-banner not-contracted">
              <b>{closedUnpaidLine(deal)}</b>
              {deal.unpaid_note ? <p className="selectable">“{deal.unpaid_note}”</p> : null}
              <div className="row">
                <button className="btn" disabled={moving} onClick={() => void editNotContractedNote(deal)}>Edit note</button>
              </div>
              <small className="faint">If talks pick up again, pick a stage under Move stage.</small>
            </div>
          ) : null}
          {unpaidClosed ? (
            /* Why it closed, and the ways out: they paid after all (the Paid on question, then Completed, counted as normal), or Move stage to reopen it. */
            <div className="closed-banner">
              <b>{closedUnpaidLine(deal)}</b>
              {deal.unpaid_note ? <p className="selectable">“{deal.unpaid_note}”</p> : null}
              <div className="row">
                <button className="btn honey" disabled={moving} onClick={() => void moveTo("completed")}>{moving ? <Loader2 className="spin" /> : <CheckCircle2 />}They paid</button>
                <button className="btn" disabled={moving} onClick={() => void editUnpaidReason(deal)}>Edit reason</button>
              </div>
              <small className="faint">To reopen it without a payment, pick a stage under Move stage.</small>
            </div>
          ) : null}
          <div className="dp-actions">
            {next ? (
              <button className="btn honey lg" disabled={moving} onClick={() => void moveTo(next)}>
                {moving ? <Loader2 className="spin" /> : <ArrowRight />}{deal.status === "pending_payment" ? "Mark paid & complete" : `Move to ${STATUS_LABELS[next]}`}
              </button>
            ) : null}
            <button className="btn lg" onClick={() => void pickStage()}>Move stage<ChevronDown /></button>
          </div>
          {isActiveDeal(deal.status) ? (
            /* As on the website: an open deal can end in either closed stage on purpose. */
            <div className="dp-close-links">
              <button className="link" disabled={moving} onClick={() => void moveTo("closed_unpaid")}>Close as unpaid…</button>
              <button className="link" disabled={moving} onClick={() => void moveTo("closed_not_contracted")}>Close as not contracted…</button>
            </div>
          ) : null}
          {!closed ? (
            <>
              <div className="story">
                {ADVANCE_STATUSES.map((s, i) => <i key={s} className={i <= index ? `on s-${s}` : ""} title={STATUS_LABELS[s]} />)}
              </div>
              <div className="story-labels faint"><span>Pitching</span><span>Completed</span></div>
            </>
          ) : null}
          <Briefs deal={deal} />
          {deal.deliverables || deal.deliverables_count ? (
            <section className="dp-sec">
              <span className="section-label">Deliverables</span>
              {deal.deliverables_count ? <div className="muted">{deal.deliverables_count} deliverables agreed</div> : null}
              {deal.deliverables ? <div className="dp-box selectable">{deal.deliverables}</div> : null}
            </section>
          ) : null}
          <section className="dp-sec">
            <div className="dp-sec-head"><span className="section-label">Notes</span><span className="acts"><button className="btn" onClick={() => openDealForm({ deal })}>Edit</button></span></div>
            {deal.notes ? <div className="dp-box selectable" style={{ whiteSpace: "pre-wrap" }}>{deal.notes}</div> : <p className="faint dp-empty">No notes yet.</p>}
          </section>
        </div>
        <div className="dp-side scroll">
          <InvoiceSection deal={deal} />
          {deal.payment_expected_at || deal.payment_terms_days != null || deal.payment_method_ref || deal.paid_at || isDeliveredOrLater(deal.status) || closed ? (
            <section className="dp-sec">
              <span className="section-label">Payment</span>
              {/* Set by the server on the move to Delivered; changed or cleared in Edit deal, like the other dates. */}
              {isDeliveredOrLater(deal.status) ? <Row label="Delivered on">{deal.delivered_at ? shortDay(deal.delivered_at) : <button className="link" onClick={() => openDealForm({ deal })}>Add date</button>}</Row> : null}
              {deal.payment_expected_at ? <Row label="Expected">{monDay(deal.payment_expected_at)}</Row> : null}
              {deal.payment_terms_days != null ? <Row label="Terms">{deal.payment_terms_days === 0 ? "Due on receipt" : `Net ${deal.payment_terms_days}`}</Row> : null}
              {deal.payment_method_ref ? <Row label="Via">{deal.payment_method_ref.label}</Row> : null}
              {notContracted && deal.closed_unpaid_at ? <Row label="Not contracted">{shortDay(deal.closed_unpaid_at)} · Fell through</Row> : null}
              {unpaidClosed && deal.closed_unpaid_at ? <Row label="Closed unpaid">{shortDay(deal.closed_unpaid_at)} · {deal.unpaid_reason === "declined" ? "Declined" : "Unresolved"}</Row> : null}
              {/* Paid for a day still ahead reads "Lands on", and counts from then; either way the day can change here. */}
              {deal.status === "completed" ? (
                <Row label={lands ? "Lands on" : "Paid on"}>
                  {deal.paid_at ? (
                    <span className="paid-on">
                      <span className={lands ? "landing-text" : ""}>{monDayYear(deal.paid_on ?? deal.paid_at)}</span>
                      <button className="link" onClick={() => void changePaidOn(deal)}>Change</button>
                      {lands ? <small className="landing-text">Counts in Cash from then</small> : null}
                    </span>
                  ) : <button className="link" onClick={() => void changePaidOn(deal)}>Unknown · Add it</button>}
                </Row>
              ) : null}
            </section>
          ) : null}
          {deal.contact_name || deal.contact_email || deal.contact_phone ? (
            <section className="dp-sec">
              <span className="section-label">Contact</span>
              <div className="contact">
                <Monogram name={deal.contact_name || deal.brand_name} size={34} />
                <span>
                  <b>{deal.contact_name || deal.brand_name}</b>
                  {deal.contact_email ? <button className="link" onClick={() => ch.app.openExternal(`mailto:${deal.contact_email}`)}><Mail />{deal.contact_email}</button> : null}
                  {deal.contact_phone ? <span className="muted"><Phone />{deal.contact_phone}</span> : null}
                </span>
              </div>
            </section>
          ) : null}
          <section className="dp-sec">
            <span className="section-label">Details</span>
            <Row label="Deal type">{dealTypeLabel(deal.deal_type)}</Row>
            {deal.draft_due_at ? <Row label="Draft due">{deal.draft_due_at === localToday() ? `Today, ${monDay(deal.draft_due_at)}` : monDay(deal.draft_due_at)}</Row> : null}
            <Row label="Created">{monDayYear(deal.created_at)}</Row>
            {deal.deal_sources.length ? <Row label={deal.deal_sources.length > 1 ? "Sources" : "Source"}><span className="tag-list">{deal.deal_sources.map((s) => <span key={s.id} className="tag-s">{s.label}</span>)}</span></Row> : null}
            {deal.industry_ref ? <Row label="Industry">{deal.industry_ref.label}</Row> : null}
            {!deal.industry_ref || !deal.deal_sources.length || !deal.draft_due_at ? <button className="link add" onClick={() => openDealForm({ deal })}>+ Add details</button> : null}
          </section>
          <History deal={deal} />
          <section className="dp-sec">
            <button className="link danger" onClick={() => void more()}><Trash2 />More actions…</button>
          </section>
        </div>
      </div>
    </aside>
  );

  if (popout) return <div className="deal-window">{panel}</div>;
  return <div className="scrim side deal-scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>{panel}</div>;
}

/** The deal shown over whatever Hub page is open (the address carries ?dealId). */
export function DealOverlay({ id }: { id: string }) {
  return <DealPanel id={id} onClose={() => {
    const { view } = nav.get();
    if (view.kind === "hub") nav.open({ ...view, dealId: undefined });
  }} />;
}

