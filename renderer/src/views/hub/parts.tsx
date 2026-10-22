import { useEffect, useState, type ReactNode } from "react";
import { ChevronDown, X } from "lucide-react";
import { ch } from "../../lib/bridge";
import {
  BOARDS, BOARD_LABELS, BOARD_STATUSES, STATUS_LABELS, addDaysIso, errorText, localToday, patchDeal,
  type Deal, type DealStatus, type Payday,
} from "../../lib/hub";
import { money } from "../../lib/format";
import { nav } from "../../lib/nav";

export function StagePill({ status, small = false }: { status: DealStatus; small?: boolean }) {
  return <span className={`stage-pill s-${status} ${small ? "sm" : ""}`}>{STATUS_LABELS[status]}</span>;
}

/** The stage dropdown on a card: a native menu with every stage, grouped by board. */
export function StageButton({ deal, onPick }: { deal: Deal; onPick: (status: DealStatus) => void }) {
  return (
    <button className={`stage-btn s-${deal.status}`} onClick={async (event) => {
      event.stopPropagation();
      const items = BOARDS.flatMap((board, i) => [
        ...(i ? [{ type: "separator" as const }] : []),
        { id: `h-${board}`, label: BOARD_LABELS[board], enabled: false },
        ...BOARD_STATUSES[board].map((s) => ({ id: s, label: STATUS_LABELS[s], checked: s === deal.status })),
      ]);
      const choice = await ch.menu.popup(items);
      if (choice && !choice.startsWith("h-") && choice !== deal.status) onPick(choice as DealStatus);
    }}>
      {STATUS_LABELS[deal.status]}<ChevronDown />
    </button>
  );
}

export function Monogram({ name, size = 30 }: { name: string; size?: number }) {
  let hash = 0;
  for (const c of name) hash = (hash * 31 + c.charCodeAt(0)) | 0;
  const colors = ["#5B8C5A", "#C9536B", "#7A5AC8", "#D9822B", "#3E7CB1", "#8C6D4F", "#C2571A", "#2F8F83", "#B24C8C", "#5B6B7A"];
  return (
    <span className="mono" style={{ width: size, height: size, background: colors[Math.abs(hash) % colors.length], fontSize: Math.round(size * 0.45) }}>
      {name.trim().charAt(0).toUpperCase() || "?"}
    </span>
  );
}

export function Modal({ title, onClose, children, width = 460, foot }: { title?: ReactNode; onClose: () => void; children: ReactNode; width?: number; foot?: ReactNode }) {
  useEffect(() => {
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); onClose(); } };
    window.addEventListener("keydown", key, true);
    return () => window.removeEventListener("keydown", key, true);
  }, [onClose]);
  return (
    <div className="scrim center" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" style={{ width }}>
        {title ? <div className="modal-head">{title}<button className="iconbtn" onClick={onClose} aria-label="Close"><X /></button></div> : null}
        <div className="modal-body">{children}</div>
        {foot ? <div className="modal-foot">{foot}</div> : null}
      </div>
    </div>
  );
}

/* ---------- One place that shows the Hub's dialogs (payment date, payday, toasts) ---------- */

type Dialog =
  | { kind: "payment-date"; deal: Deal; status: DealStatus; resolve: (fields: Record<string, unknown> | null) => void }
  | { kind: "payday"; deal: Deal; payday: Payday }
  | null;

let show: (dialog: Dialog) => void = () => {};
let toast: (text: string) => void = () => {};

export const hubToast = (text: string) => toast(text);

/** Before moving to Delivered or Pending Payment without a payment date: ask for one. Null means cancelled. */
function askPaymentDate(deal: Deal, status: DealStatus) {
  if ((status !== "delivered" && status !== "pending_payment") || deal.payment_expected_at) return Promise.resolve({});
  return new Promise<Record<string, unknown> | null>((resolve) => show({ kind: "payment-date", deal, status, resolve }));
}

/** Move a deal to a stage, the way the website's board does: ask, move, celebrate, or put it back. */
export async function moveDeal(deal: Deal, status: DealStatus) {
  const fields = await askPaymentDate(deal, status);
  if (fields === null) return false;
  try {
    const result = await patchDeal(deal.id, { status, ...fields });
    if (result.payday && result.deal.paid_at) show({ kind: "payday", deal: result.deal, payday: result.payday });
    return true;
  } catch (error) {
    toast(`${deal.brand_name} wasn't moved to ${STATUS_LABELS[status]}: ${errorText(error)}. Returned to ${STATUS_LABELS[deal.status]}.`);
    return false;
  }
}

export function celebrate(deal: Deal, payday: Payday | null) {
  if (payday && deal.paid_at) show({ kind: "payday", deal, payday });
}

function PaymentDatePrompt({ deal, status, resolve, close }: { deal: Deal; status: DealStatus; resolve: (f: Record<string, unknown> | null) => void; close: () => void }) {
  const today = localToday();
  const [terms, setTerms] = useState<number | null>(deal.payment_terms_days ?? null);
  const [date, setDate] = useState(deal.payment_terms_days ? addDaysIso(today, deal.payment_terms_days) : "");
  const done = (value: Record<string, unknown> | null) => { resolve(value); close(); };
  return (
    <Modal title={`When will ${deal.brand_name} pay?`} onClose={() => done(null)} width={440}
      foot={<>
        <button className="btn" onClick={() => done({})}>Skip for now</button>
        <button className="btn honey" disabled={!date} onClick={() => done({ payment_expected_at: date, payment_terms_days: terms })}>Save date</button>
      </>}>
      <p className="muted">Moving to {STATUS_LABELS[status]}. Add when you expect the {money(deal.amount_usd)}, and it shows on your Home card.</p>
      <div className="chips" style={{ marginTop: 12 }}>
        {[7, 15, 30, 45, 60].map((n) => (
          <button key={n} className={`chip ${terms === n ? "on" : ""}`} onClick={() => { setTerms(n); setDate(addDaysIso(today, n)); }}>Net {n}</button>
        ))}
      </div>
      <label className="flabel" style={{ marginTop: 12 }}>Payment expected</label>
      <input className="field" type="date" value={date} min={addDaysIso(today, -365)} onChange={(e) => { setDate(e.target.value); setTerms(null); }} />
    </Modal>
  );
}

const CONFETTI = ["#FFCC04", "#34C759", "#F29E0C", "#FFFFFF", "#2F8F83"];

function PaydayDialog({ deal, payday, close }: { deal: Deal; payday: Payday; close: () => void }) {
  const [withAmount, setWithAmount] = useState(false);
  const monthName = payday.month_label.charAt(0) + payday.month_label.slice(1).toLowerCase();
  const before = Math.max(0, Math.min(100, payday.collected_after_usd ? (payday.collected_before_usd / payday.collected_after_usd) * payday.tier_progress_percent_after : 0));
  const pieces = Array.from({ length: 60 }, (_, i) => i);
  return (
    <div className="scrim center payday-scrim" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="confetti" aria-hidden>
        {pieces.map((i) => (
          <i key={i} style={{ left: `${(i * 37) % 100}%`, background: CONFETTI[i % CONFETTI.length], animationDelay: `${(i % 12) * 0.08}s`, transform: `rotate(${i * 29}deg)` }} />
        ))}
      </div>
      <div className="modal payday" role="dialog" aria-label="You got paid">
        <div className="pd-check">✓</div>
        <div className="pd-eyebrow">YOU GOT PAID</div>
        <div className="pd-amount">{money(deal.amount_usd)}</div>
        <div className="muted">{deal.brand_name} · deal completed 🎉</div>
        <div className="pd-month">
          <span><b>{deal.added_by && deal.updated_by && deal.added_by.id !== deal.updated_by.id ? `${deal.added_by.name.split(" ")[0]}'s ` : ""}{monthName} total</b></span>
          <span className="muted">{money(payday.collected_before_usd)} → <b>{money(payday.collected_after_usd)}</b></span>
        </div>
        <div className="pd-bar"><i className="before" style={{ width: `${before}%` }} /><i className="after" style={{ width: `${Math.max(0, payday.tier_progress_percent_after - before)}%` }} /></div>
        {payday.tiered_up ? <div className="pd-tier">🎉 Tier up! You just became a {payday.tier_name_after}</div> : null}
        <label className="toggle-row"><input type="checkbox" checked={withAmount} onChange={(e) => setWithAmount(e.target.checked)} />Include the amount in my post</label>
        <div className="pd-acts">
          <button className="btn honey lg" onClick={() => {
            const text = withAmount ? `Just got paid ${money(deal.amount_usd)} by ${deal.brand_name} 🎉` : `Just got paid by ${deal.brand_name} 🎉`;
            close();
            // Leave the Hub on its page, not on this deal, for when they come back.
            const here = nav.get().view;
            if (here.kind === "hub" && here.dealId) nav.open({ ...here, dealId: undefined });
            nav.open({ kind: "feed" }, "home", "ch");
            setTimeout(() => window.dispatchEvent(new CustomEvent("ch:new-post", { detail: { category: "win", text } })), 80);
          }}>🏆 Share to Wins</button>
          <button className="btn lg" onClick={close}>Done</button>
        </div>
        <div className="faint" style={{ fontSize: 12, textAlign: "center" }}>Opens a post in 🏆 Wins on Home for you to check before posting.</div>
      </div>
    </div>
  );
}

export function HubDialogs() {
  const [dialog, setDialog] = useState<Dialog>(null);
  const [message, setMessage] = useState<string | null>(null);
  useEffect(() => {
    show = setDialog;
    toast = setMessage;
    return () => { show = () => {}; toast = () => {}; };
  }, []);
  useEffect(() => {
    if (!message) return;
    const timer = setTimeout(() => setMessage(null), 6000);
    return () => clearTimeout(timer);
  }, [message]);
  return (
    <>
      {dialog?.kind === "payment-date" ? <PaymentDatePrompt deal={dialog.deal} status={dialog.status} resolve={dialog.resolve} close={() => setDialog(null)} /> : null}
      {dialog?.kind === "payday" ? <PaydayDialog deal={dialog.deal} payday={dialog.payday} close={() => setDialog(null)} /> : null}
      {message ? <div className="toast" role="status">{message}<button className="iconbtn" onClick={() => setMessage(null)}><X /></button></div> : null}
    </>
  );
}
