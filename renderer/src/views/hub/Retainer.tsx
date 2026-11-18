import { useState } from "react";
import { CalendarDays, Check, Hourglass, Info, Loader2 } from "lucide-react";
import {
  TOO_MANY_DECIMALS, cents, dayOf, daysBetween, endRetainer, errorText, feeText, isRetainer, localToday, logPayment, longDay, parseUsd, receivedUsd, removePayment, updatePayment, usd2, usdInputValue,
  usePaymentMethods, weekdayDay, type Deal, type Retainer, type RetainerPayment,
} from "../../lib/hub";
import { money } from "../../lib/format";
import { Modal, celebratePayment, hubToast } from "./parts";
import { PlatformFeeFields, feeBody, feeDraft } from "./PlatformFee";

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
  // What she received: a retainer's payments, or the deal less its platform fee.
  const inCents = Math.round((retainer ? retainer.paid_total_usd : deal.received_usd ?? deal.amount_usd) * 100);
  const paid = retainer ? retainer.paid_count > 0 : deal.status === "completed" && Boolean(deal.paid_at);
  return <div className="dp-profit">Costs {cents(deal.costs_cents)} · {paid ? "you kept" : "you'll keep"} {cents(inCents - deal.costs_cents)}</div>;
}

export function RetainerSection({ deal, onEditSchedule }: { deal: Deal; onEditSchedule: () => void }) {
  const [logging, setLogging] = useState<string | null>(null);
  const [editing, setEditing] = useState<RetainerPayment | null>(null);
  const [ending, setEnding] = useState(false);
  const [all, setAll] = useState(false);
  if (!isRetainer(deal)) return null;
  const r = deal.retainer;
  const today = localToday();
  const next = r.next_due_on;
  const inDays = next ? daysBetween(today, next) : null;
  // A date a few days past is still due, not late (the server keeps it as the next payment for 3 days).
  const when = inDays === null ? "" : inDays === 0 ? "today" : inDays === 1 ? "tomorrow" : inDays === -1 ? "yesterday, still due" : inDays < 0 ? `${-inDays} days ago, still due` : `in ${inDays} days`;
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
            <span><b>{weekdayDay(p.paid_on)}</b><small className="paid-text">{p.landed ? "Paid" : "Lands then"}{p.payment_method_ref ? ` · ${p.payment_method_ref.label}` : ""}{p.note ? ` · ${p.note}` : ""}</small>
              {/* The platform kept part of it: the payment, the fee and what reached her. */}
              {p.platform_fee_usd ? <small className="fee-line">{usd2(p.amount_usd)} · {feeText(p.platform_fee_usd, p.platform_fee_name)} · You received {usd2(p.received_usd ?? receivedUsd(p.amount_usd, p.platform_fee_usd))}</small> : null}</span>
            <b className="rp-amt">{money(p.amount_usd)}</b>
            <span className="rp-acts">
              <button className="link" onClick={() => setEditing(p)}>Edit</button>
              <button className="link" onClick={() => void remove(p.id, `${weekdayDay(p.paid_on)} ${money(p.amount_usd)}`)}>Remove</button>
            </span></li>
        ))}
        {!r.payments.length && !next ? <li className="faint">No payments logged yet.</li> : null}
      </ul>
      {r.payments.length > 4 ? <button className="link" onClick={() => setAll(!all)}>{all ? "Show fewer" : `Show all ${r.payments.length} payments`}</button> : null}
      <p className="retainer-note faint"><Info />Each payment counts in the month it's paid: Cash, Paid this month, bee tier and leaderboard.</p>
      {!stopped ? <button className="link danger" onClick={() => setEnding(true)}>End retainer…</button> : null}
      {logging ? <LogPayment deal={deal} retainer={r} day={logging} onClose={() => setLogging(null)} /> : null}
      {editing ? <LogPayment deal={deal} retainer={r} day={editing.paid_on} payment={editing} onClose={() => setEditing(null)} /> : null}
      {ending ? <EndRetainer deal={deal} retainer={r} onClose={() => setEnding(false)} /> : null}
    </section>
  );
}

/** Log a payment, or (with `payment`) correct one already logged: amount, platform fee, day, method and note. */
function LogPayment({ deal, retainer, day, payment, onClose }: { deal: Deal; retainer: Retainer; day: string; payment?: RetainerPayment; onClose: () => void }) {
  const methods = usePaymentMethods().data ?? [];
  const [amount, setAmount] = useState(usdInputValue(payment?.amount_usd ?? retainer.amount_usd));
  const [fee, setFee] = useState(() => feeDraft(payment?.platform_fee_usd, payment?.platform_fee_name));
  const [paidOn, setPaidOn] = useState(dayOf(day));
  const [method, setMethod] = useState<string | null>(payment ? payment.payment_method_ref?.id ?? null : deal.payment_method_ref?.id ?? null);
  const [note, setNote] = useState(payment?.note ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const month = MONTHS[Number(paidOn.slice(5, 7)) - 1] ?? "";
  const parsed = parseUsd(amount);
  const usd = typeof parsed === "number" && parsed > 0 ? parsed : null;

  async function save() {
    if (parsed === "decimals") { setError(TOO_MANY_DECIMALS); return; }
    if (usd === null) { setError("Type the amount, like 250 or 487.50."); return; }
    const feeResult = feeBody(fee, usd);
    if (!feeResult.ok) { setError(feeResult.error); return; }
    setBusy(true);
    try {
      if (payment) {
        await updatePayment(deal.id, payment.id, {
          amount_usd: usd, paid_on: paidOn, payment_method_ref: method, note: note.trim() || null,
          // An edit always says the fee: what's typed, or none.
          platform_fee_usd: null, platform_fee_name: null, ...feeResult.body,
        });
        onClose();
        hubToast(`Payment updated · ${money(usd)}`);
        return;
      }
      const result = await logPayment(deal.id, { amount_usd: usd, paid_on: paidOn, ...(method ? { payment_method_ref: method } : {}), note: note.trim() || null, ...feeResult.body });
      onClose();
      hubToast(`Payment logged · ${money(usd)} · counts toward ${month}`);
      celebratePayment(result.deal ?? deal, result.payday);
    } catch (e) {
      setError(errorText(e));
      setBusy(false);
    }
  }

  return (
    <Modal title={`${payment ? "Edit payment" : "Log a payment"} · ${deal.brand_name}`} onClose={onClose} width={460}
      foot={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn honey" disabled={busy} onClick={() => void save()}>{busy ? <Loader2 className="spin" /> : null}Save payment</button></>}>
      <div className="form-col money-form">
        <label><span>Amount</span><span className="big-amount"><i>$</i><input autoFocus inputMode="decimal" value={amount} onChange={(e) => { setAmount(e.target.value); setError(""); }} /></span></label>
        <PlatformFeeFields amount={usd} value={fee} onChange={(next) => { setFee(next); setError(""); }} />
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
