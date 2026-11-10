import { useState } from "react";
import { CalendarDays, Check, Hourglass, Info, Loader2 } from "lucide-react";
import {
  cents, dayOf, daysBetween, endRetainer, errorText, isRetainer, localToday, logPayment, longDay, removePayment, usePaymentMethods, weekdayDay,
  type Deal, type Retainer,
} from "../../lib/hub";
import { money } from "../../lib/format";
import { Modal, celebratePayment, hubToast } from "./parts";

/*
  A retainer in the deal pop-up (the website's hand-off §11.2): the next
  payment with Log payment, the payments so far, and End retainer. Each
  payment counts in the month it's paid, everywhere money in is counted;
  the server does the counting.
*/

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const ordinal = (n: number) => `${n}${n % 10 === 1 && n !== 11 ? "st" : n % 10 === 2 && n !== 12 ? "nd" : n % 10 === 3 && n !== 13 ? "rd" : "th"}`;

/** "$250 every week" and its pills, where the pop-up shows a deal's amount. */
export function RetainerAmount({ deal }: { deal: Deal }) {
  if (!isRetainer(deal)) return null;
  return (
    <div className="dp-amount retainer">
      <b>{money(deal.amount_usd)}</b><span className="muted every">{deal.retainer.every_label}</span>
      <span className="retainer-pill">Retainer</span>
      <span className="retainer-paid">Paid so far {money(deal.retainer.paid_total_usd)}</span>
    </div>
  );
}

/** "Costs $180 · you kept $1,320": on any deal with expenses linked to it. */
export function ProfitLine({ deal }: { deal: Deal }) {
  if (!deal.costs_cents) return null;
  const retainer = isRetainer(deal) ? deal.retainer : null;
  const inCents = (retainer ? retainer.paid_total_usd : deal.amount_usd) * 100;
  const paid = retainer ? retainer.paid_count > 0 : deal.status === "completed" && Boolean(deal.paid_at);
  return <div className="dp-profit">Costs {cents(deal.costs_cents)} · {paid ? "you kept" : "you'll keep"} {cents(inCents - deal.costs_cents)}</div>;
}

export function RetainerSection({ deal, onEditSchedule }: { deal: Deal; onEditSchedule: () => void }) {
  const [logging, setLogging] = useState<string | null>(null);
  const [ending, setEnding] = useState(false);
  const [all, setAll] = useState(false);
  if (!isRetainer(deal)) return null;
  const r = deal.retainer;
  const today = localToday();
  const next = r.next_due_on;
  const inDays = next ? daysBetween(today, next) : null;
  const when = inDays === null ? "" : inDays === 0 ? "today" : inDays === 1 ? "tomorrow" : `in ${inDays} days`;
  const rhythm = r.interval === "month"
    ? `every month, on the ${ordinal(Number(r.anchor_on.slice(8, 10)))}`
    : `${r.every_label}, on ${new Date(`${r.anchor_on}T12:00:00`).toLocaleDateString("en-US", { weekday: "long" })}s`;
  const shown = all ? r.payments : r.payments.slice(0, 4);
  const stopped = !next && (deal.status === "completed" || Boolean(r.ended_on));

  async function remove(id: string, label: string) {
    if (!window.confirm(`Remove the ${label} payment?`)) return;
    try { await removePayment(deal.id, id); hubToast("Payment removed"); } catch (error) { hubToast(`The payment wasn't removed: ${errorText(error)}`); }
  }

  return (
    <section className="dp-sec retainer-sec">
      {next ? (
        <div className="retainer-next">
          <div className="rn-head"><span className="rn-icon"><CalendarDays /></span>
            <span><b>Next payment: {longDay(next)}</b><small className="muted">{money(deal.amount_usd)} · {rhythm} · {when}</small></span></div>
          <button className="btn honey lg" onClick={() => setLogging(next <= today ? next : today)}>Log payment</button>
          <button className="btn lg" onClick={onEditSchedule}>Edit schedule</button>
        </div>
      ) : null}
      {stopped ? <p className="faint dp-empty">This retainer ended{r.ended_on ? ` on ${weekdayDay(r.ended_on)}` : ""}. Its payments stay below.</p> : null}
      <div className="dp-sec-head"><span className="section-label">Payments</span><span className="faint">{r.paid_count} paid · {money(r.paid_total_usd)}</span></div>
      <ul className="retainer-payments">
        {next ? (
          <li className="upcoming"><span className="rp-status"><Hourglass /></span><span><b>{weekdayDay(next)}</b><small>Upcoming</small></span><b className="rp-amt">{money(deal.amount_usd)}</b>
            <button className="btn" onClick={() => setLogging(next <= today ? next : today)}>Mark paid</button></li>
        ) : null}
        {r.missed.map((day) => (
          <li key={`m-${day}`} className="missed"><span className="rp-status"><Hourglass /></span><span><b>{weekdayDay(day)}</b><small>Missed? Not logged yet</small></span><b className="rp-amt">{money(deal.amount_usd)}</b>
            <button className="btn" onClick={() => setLogging(day)}>Mark paid</button></li>
        ))}
        {shown.map((p) => (
          <li key={p.id}><span className="rp-status paid"><Check /></span>
            <span><b>{weekdayDay(p.paid_on)}</b><small className="paid-text">{p.landed ? "Paid" : "Lands then"}{p.payment_method_ref ? ` · ${p.payment_method_ref.label}` : ""}{p.note ? ` · ${p.note}` : ""}</small></span>
            <b className="rp-amt">{money(p.amount_usd)}</b>
            <button className="link" onClick={() => void remove(p.id, `${weekdayDay(p.paid_on)} ${money(p.amount_usd)}`)}>Remove</button></li>
        ))}
        {!r.payments.length && !next ? <li className="faint">No payments logged yet.</li> : null}
      </ul>
      {r.payments.length > 4 ? <button className="link" onClick={() => setAll(!all)}>{all ? "Show fewer" : `Show all ${r.payments.length} payments`}</button> : null}
      <p className="retainer-note faint"><Info />Each payment counts in the month it's paid: Cash, Paid this month, bee tier and leaderboard.</p>
      {!stopped ? <button className="link danger" onClick={() => setEnding(true)}>End retainer…</button> : null}
      {logging ? <LogPayment deal={deal} retainer={r} day={logging} onClose={() => setLogging(null)} /> : null}
      {ending ? <EndRetainer deal={deal} retainer={r} onClose={() => setEnding(false)} /> : null}
    </section>
  );
}

function LogPayment({ deal, retainer, day, onClose }: { deal: Deal; retainer: Retainer; day: string; onClose: () => void }) {
  const methods = usePaymentMethods().data ?? [];
  const [amount, setAmount] = useState(String(retainer.amount_usd));
  const [paidOn, setPaidOn] = useState(day);
  const [method, setMethod] = useState<string | null>(deal.payment_method_ref?.id ?? null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const month = MONTHS[Number(paidOn.slice(5, 7)) - 1] ?? "";

  async function save() {
    const usd = Number(amount.replace(/[$,\s]/g, ""));
    if (!Number.isInteger(usd) || usd < 1) { setError("Type the amount in whole dollars, like 250."); return; }
    setBusy(true);
    try {
      const result = await logPayment(deal.id, { amount_usd: usd, paid_on: paidOn, ...(method ? { payment_method_ref: method } : {}), note: note.trim() || null });
      onClose();
      hubToast(`Payment logged · ${money(usd)} · counts toward ${month}`);
      celebratePayment(result.deal ?? deal, result.payday);
    } catch (e) {
      setError(errorText(e));
      setBusy(false);
    }
  }

  return (
    <Modal title={`Log a payment · ${deal.brand_name}`} onClose={onClose} width={460}
      foot={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn honey" disabled={busy} onClick={() => void save()}>{busy ? <Loader2 className="spin" /> : null}Save payment</button></>}>
      <div className="form-col money-form">
        <label><span>Amount</span><span className="big-amount"><i>$</i><input autoFocus inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value)} /></span></label>
        <label><span>Date paid</span><input className="field" type="date" value={paidOn} onChange={(e) => setPaidOn(e.target.value)} /><small className="faint">It counts toward {month}.</small></label>
        <div><span>Paid with</span><div className="chip-row">
          {methods.map((m) => <button key={m.id} type="button" className={`chip ${method === m.id ? "on" : ""}`} onClick={() => setMethod(m.id)}>{m.label}</button>)}
        </div></div>
        <label><span>Note (optional)</span><input className="field" value={note} maxLength={500} placeholder="Bonus, partial payment…" onChange={(e) => setNote(e.target.value)} /></label>
        {error ? <p className="form-error">{error}</p> : null}
      </div>
    </Modal>
  );
}

function EndRetainer({ deal, retainer, onClose }: { deal: Deal; retainer: Retainer; onClose: () => void }) {
  const [lastOn, setLastOn] = useState(retainer.payments[0] ? dayOf(retainer.payments[0].paid_on) : localToday());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function end() {
    setBusy(true);
    try { await endRetainer(deal.id, lastOn); onClose(); hubToast(`The ${deal.brand_name} retainer ended`); } catch (e) { setError(errorText(e)); setBusy(false); }
  }
  return (
    <Modal title={`End the ${deal.brand_name} retainer?`} onClose={onClose} width={440}
      foot={<><button className="btn" onClick={onClose}>Keep it going</button><button className="btn danger" disabled={busy} onClick={() => void end()}>{busy ? <Loader2 className="spin" /> : null}End retainer</button></>}>
      <div className="form-col money-form">
        <ul className="end-list">
          <li>The {retainer.payments.length} payment{retainer.payments.length === 1 ? "" : "s"} you logged stay, with their dates.</li>
          <li>No more upcoming payments.</li>
          <li>The deal moves to Completed.</li>
        </ul>
        <label><span>Last payment date</span><input className="field" type="date" value={lastOn} onChange={(e) => setLastOn(e.target.value)} /></label>
        {error ? <p className="form-error">{error}</p> : null}
      </div>
    </Modal>
  );
}
