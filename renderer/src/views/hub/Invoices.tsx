import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Download, FileText, Loader2, Pencil, Send } from "lucide-react";
import { InvoiceEditor } from "./InvoiceEditor";
import { InvoiceDetailsForm, useInvoiceProfile } from "./InvoiceDetails";
import { useQuery } from "@tanstack/react-query";
import { ch } from "../../lib/bridge";
import { api, ApiError, queryClient } from "../../lib/api";
import { allDeals, isClosedOutStatus, isCollected, localToday, monDay, useDeals, withTz, type Deal } from "../../lib/hub";
import { money } from "../../lib/format";
import { Modal, Monogram } from "./parts";
import { openDeal } from "./Deals";

/*
  Invoices are made one per deal (/api/hub/deals/<id>/invoice). This lists
  them all in one place. Draft and Sent come from the invoice; Paid comes from
  the deal (Completed with a paid date), as the plan promised.
*/

interface Line { description: string; quantity: number; rateCents: number }
interface Payment { method: string; label: string; value?: string; bankName?: string; accountLast4?: string }
export interface Invoice {
  id: string; dealId: string; number: string; issuedOn: string; dueOn: string | null; termsDays: number | null;
  sender: { businessName: string; ownerName: string; street: string; city: string; region: string; postalCode: string; email: string; logoUrl: string | null };
  billTo: { company: string; contactName: string; email: string; phone: string };
  projectTitle: string; projectDetails: string; lines: Line[]; subtotalCents: number; taxCents: number; totalCents: number;
  note: string; payment: Payment[]; status: "draft" | "sent"; sentAt: string | null; sentTo: string | null; sendCount: number; shareUrl: string;
  /** Which invoice profile it's from: "main" or the extra one's id. Older servers leave it out. */
  profileId?: string;
}
export interface InvoiceProfileChoice { id: string; name: string; businessName: string; isMain: boolean; isSetUp: boolean }
interface InvoiceResponse { invoicesEnabled: boolean; canEdit: boolean; invoice: Invoice | null; profileSetUp: boolean; profiles?: InvoiceProfileChoice[] }

/* One row of Hub → Invoices (GET /api/hub/invoices). The server decides its state. */
type ListState = "draft" | "sent" | "overdue" | "paid";
interface InvoiceListItem {
  id: string; dealId: string; brandName: string; number: string; totalCents: number; issuedOn: string; dueOn: string | null;
  status: "draft" | "sent"; sentAt: string | null; state: ListState; daysOverdue: number; paidAt: string | null;
  fromName: string; profileId: string; mine: boolean; updatedAt: string;
}

const cents = (n: number) => (n / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });

export function useInvoice(dealId: string, enabled = true) {
  return useQuery({
    queryKey: ["hub", "invoice", dealId],
    enabled,
    retry: false,
    queryFn: async () => {
      try {
        return await api<InvoiceResponse>(`/api/hub/deals/${dealId}/invoice`);
      } catch (error) {
        if (error instanceof ApiError && error.status === 404) return null; // invoices are off for this member
        throw error;
      }
    },
  });
}

type State = "draft" | "sent" | "overdue" | "paid";
function stateOf(invoice: Invoice, deal: Deal | undefined): State {
  // Not paid while the money is still to land.
  if (deal && isCollected(deal)) return "paid";
  // The closed-out stages are never overdue: she's stopped chasing it.
  if (invoice.status === "sent" && invoice.sentAt) return invoice.dueOn && invoice.dueOn < localToday() && !(deal && isClosedOutStatus(deal.status)) ? "overdue" : "sent";
  return "draft";
}
/* A day ("2026-12-03") as itself; a moment in her own time zone. */
const listDay = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value)
  ? new Date(`${value}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })
  : new Date(value).toLocaleDateString("en-US", { month: "short", day: "numeric" });
function listLine(invoice: InvoiceListItem) {
  const parts = [invoice.number];
  if (invoice.state === "paid" && invoice.paidAt) parts.push(`Paid ${listDay(invoice.paidAt)}`);
  else if (invoice.state === "draft") parts.push(`Draft · made ${listDay(invoice.issuedOn)}`);
  else {
    if (invoice.sentAt) parts.push(`Sent ${listDay(invoice.sentAt)}`);
    if (invoice.state === "overdue") parts.push(`${invoice.daysOverdue} ${invoice.daysOverdue === 1 ? "day" : "days"} overdue`);
    else if (invoice.dueOn) parts.push(`Due ${listDay(invoice.dueOn)}`);
  }
  return parts.join(" · ");
}
const STATE_LABELS: Record<ListState, string> = { draft: "Draft", sent: "Sent", overdue: "Overdue", paid: "Paid" };
const FILTERS: [Filter, string][] = [["all", "All"], ["draft", "Drafts"], ["sent", "Sent"], ["overdue", "Overdue"], ["paid", "Paid"]];
type Filter = "all" | ListState;

/** Makes the deal's invoice; false when your invoice details aren't set up yet. */
async function createInvoice(deal: Deal): Promise<boolean> {
  try {
    await api(`/api/hub/deals/${deal.id}/invoice`, { method: "POST" });
  } catch (error) {
    if (error instanceof ApiError && error.code === "PROFILE_NOT_SET_UP") return false;
    if (!(error instanceof ApiError && error.code === "ALREADY_EXISTS")) { window.alert("Couldn't create the invoice."); return true; }
  }
  await queryClient.invalidateQueries({ queryKey: ["hub", "invoice", deal.id] });
  void queryClient.invalidateQueries({ queryKey: ["hub", "invoices"] });
  return true;
}

/** Create invoice: asks for your invoice details first if they're missing, then makes it. */
function CreateInvoice({ deal, children }: { deal: Deal; children: (start: () => void, busy: boolean) => ReactNode }) {
  const [busy, setBusy] = useState(false);
  const [needsDetails, setNeedsDetails] = useState(false);
  const profile = useInvoiceProfile();
  const start = async () => {
    setBusy(true);
    if (!(await createInvoice(deal))) setNeedsDetails(true);
    setBusy(false);
  };
  return (
    <>
      {children(() => void start(), busy)}
      {needsDetails ? (
        <Modal title="Your invoice details" width={640} onClose={() => setNeedsDetails(false)}>
          <p className="muted" style={{ marginTop: 0 }}>Set this up once. Every invoice you create starts with these details, and you can still change anything on a single invoice.</p>
          {profile.data ? <InvoiceDetailsForm compact profile={profile.data} onSaved={(saved) => { if (saved.isSetUp) { setNeedsDetails(false); void start(); } }} /> : <p className="muted">{profile.isError ? "Couldn't load your details." : "Loading…"}</p>}
        </Modal>
      ) : null}
    </>
  );
}

export function InvoicePaper({ invoice }: { invoice: Invoice }) {
  const s = invoice.sender;
  return (
    <div className="invoice-paper selectable">
      <div className="ip-top">
        <div>{s.logoUrl ? <img className="ip-logo" src={s.logoUrl} alt="" /> : null}<h2>Invoice</h2><div className="muted">{invoice.number}</div></div>
        <div className="ip-dates">
          <span>Issued</span><b>{new Date(`${invoice.issuedOn}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</b>
          {invoice.dueOn ? <><span>Due</span><b>{new Date(`${invoice.dueOn}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</b></> : null}
          {invoice.termsDays != null ? <><span>Terms</span><b>{invoice.termsDays === 0 ? "Due on receipt" : `Net ${invoice.termsDays}`}</b></> : null}
        </div>
      </div>
      <div className="ip-parties">
        <div><small>From</small><b>{s.businessName}</b><span>{[s.ownerName, s.email].filter(Boolean).join(" · ")}</span>{s.street || s.city ? <span>{[s.street, s.city, s.region, s.postalCode].filter(Boolean).join(", ")}</span> : null}</div>
        <div><small>Bill to</small><b>{invoice.billTo.company}</b><span>{[invoice.billTo.contactName, invoice.billTo.email].filter(Boolean).join(" · ")}</span></div>
      </div>
      {invoice.projectTitle ? <div className="ip-project"><small>Project</small><b>{invoice.projectTitle}</b>{invoice.projectDetails ? <span>{invoice.projectDetails}</span> : null}</div> : null}
      <div className="ip-lines">
        <div className="ip-line head"><span>Description</span><span className="r">Qty</span><span className="r">Rate</span><span className="r">Amount</span></div>
        {invoice.lines.map((line, i) => (
          <div key={i} className="ip-line"><span>{line.description}</span><span className="r">{line.quantity}</span><span className="r">{cents(line.rateCents)}</span><span className="r">{cents(Math.round(Math.round(line.quantity * 100) * line.rateCents / 100))}</span></div>
        ))}
      </div>
      <div className="ip-totals">
        <span>Subtotal</span><span className="r">{cents(invoice.subtotalCents)}</span>
        <span>Tax</span><span className="r">{cents(invoice.taxCents)}</span>
        <b>Total due</b><b className="r">{cents(invoice.totalCents)}</b>
      </div>
      <div className="ip-foot">
        {invoice.payment.length ? <div><small>How to pay</small>{invoice.payment.map((p, i) => <span key={i}>{p.label}: {p.value ?? `${p.bankName ?? "Bank"} ••${p.accountLast4 ?? ""}`}</span>)}</div> : null}
        {invoice.note ? <div><small>Note</small><span>{invoice.note}</span></div> : null}
      </div>
    </div>
  );
}

function SendDialog({ invoice, deal, onClose }: { invoice: Invoice; deal: Deal | undefined; onClose: () => void }) {
  const [to, setTo] = useState(invoice.sentTo || invoice.billTo.email || deal?.contact_email || "");
  const [subject, setSubject] = useState(`Invoice ${invoice.number} from ${invoice.sender.businessName}`);
  const [message, setMessage] = useState(`Hi${invoice.billTo.contactName ? ` ${invoice.billTo.contactName.split(" ")[0]}` : ""},\n\nHere's invoice ${invoice.number} for ${cents(invoice.totalCents)}${invoice.dueOn ? `, due ${new Date(`${invoice.dueOn}T12:00:00`).toLocaleDateString("en-US", { month: "long", day: "numeric" })}` : ""}.\n\nThank you!\n${invoice.sender.ownerName || invoice.sender.businessName}`);
  const [copy, setCopy] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function send() {
    setBusy(true);
    setError(null);
    try {
      await api(`/api/hub/deals/${invoice.dealId}/invoice/send`, { method: "POST", body: { to: to.trim(), subject, message, sendMeACopy: copy } });
      await queryClient.invalidateQueries({ queryKey: ["hub", "invoice", invoice.dealId] });
      void queryClient.invalidateQueries({ queryKey: ["hub", "invoices"] });
      onClose();
    } catch (e) {
      const code = e instanceof ApiError ? e.code : "";
      setError(code === "RATE_LIMITED" ? "You've sent this invoice a lot today. Try again tomorrow." : code === "INVALID_TO" ? "That email address doesn't look right." : code === "NO_REPLY_TO" ? "Add your email to your invoice details first." : "Couldn't send. Try again.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title={invoice.sendCount ? "Resend invoice" : "Send invoice"} onClose={onClose} width={520}
      foot={<>{error ? <span className="form-error">{error}</span> : null}<button className="btn" onClick={onClose}>Cancel</button><button className="btn honey" disabled={busy || !to.trim()} onClick={() => void send()}>{busy ? <Loader2 className="spin" /> : <Send />}Send</button></>}>
      <label className="flabel">To</label><input className="field" type="email" value={to} onChange={(e) => setTo(e.target.value)} />
      <label className="flabel">Subject</label><input className="field" value={subject} maxLength={200} onChange={(e) => setSubject(e.target.value)} />
      <label className="flabel">Message</label><textarea className="field area tall" value={message} maxLength={5000} onChange={(e) => setMessage(e.target.value)} />
      <div className="attached"><FileText />Invoice-{invoice.number}.pdf is attached</div>
      <label className="toggle-row"><input type="checkbox" checked={copy} onChange={(e) => setCopy(e.target.checked)} />Send me a copy</label>
    </Modal>
  );
}

function InvoiceActions({ invoice, deal }: { invoice: Invoice; deal: Deal | undefined }) {
  const [sending, setSending] = useState(false);
  const [editing, setEditing] = useState(false);
  return (
    <>
      <button className="btn" onClick={() => void ch.files.save(`/api/hub/deals/${invoice.dealId}/invoice/pdf?download=1`, `Invoice-${invoice.number}.pdf`)}><Download />Download PDF</button>
      <button className="btn" onClick={() => setEditing(true)}><Pencil />Edit</button>
      {editing ? <InvoiceEditor invoice={invoice} onClose={() => setEditing(false)} /> : null}
      <button className="btn honey" onClick={() => setSending(true)}><Send />{invoice.sendCount ? "Resend" : "Send invoice"}</button>
      {sending ? <SendDialog invoice={invoice} deal={deal} onClose={() => setSending(false)} /> : null}
    </>
  );
}

/** The Invoice group in a deal's panel. */
export function InvoiceSection({ deal }: { deal: Deal }) {
  const { data } = useInvoice(deal.id);
  const [dismissed, setDismissed] = useState(() => { try { return localStorage.getItem(`hub.invoice.offer.${deal.id}`) === "no"; } catch { return false; } });
  if (!data) return null;
  const inv = data.invoice;
  if (!inv) {
    if (!(deal.status === "delivered" || deal.status === "completed") || dismissed) {
      return data.canEdit ? <section className="dp-sec"><span className="section-label">Invoice</span><CreateInvoice deal={deal}>{(start, busy) => <button className="link add" disabled={busy} onClick={start}>+ Create invoice</button>}</CreateInvoice></section> : null;
    }
    return (
      <section className="dp-sec invoice-offer">
        <b>{deal.brand_name} is delivered — send the invoice</b>
        <div className="row"><CreateInvoice deal={deal}>{(start, busy) => <button className="btn honey" disabled={busy} onClick={start}>{busy ? <Loader2 className="spin" /> : <FileText />}Create invoice</button>}</CreateInvoice>
          <button className="btn" onClick={() => { setDismissed(true); try { localStorage.setItem(`hub.invoice.offer.${deal.id}`, "no"); } catch { /* fine */ } }}>Not now</button></div>
      </section>
    );
  }
  const s = stateOf(inv, deal);
  return (
    <section className="dp-sec">
      <div className="dp-sec-head"><span className="section-label">Invoice</span><span className={`inv-badge ${s}`}>{s === "overdue" ? "Overdue" : s[0].toUpperCase() + s.slice(1)}</span></div>
      <div className="inv-mini"><span className="ficon inv">INV</span><span><b>Invoice {inv.number} · {cents(inv.totalCents)}</b><small className="muted">{inv.sentAt ? `Sent ${monDay(inv.sentAt)}` : "Draft"}{inv.dueOn ? ` · Due ${monDay(inv.dueOn)}` : ""}</small></span></div>
      <div className="row wrap"><InvoiceActions invoice={inv} deal={deal} /></div>
    </section>
  );
}

/** Hub → Invoices: every invoice in one list, from one call (GET /api/hub/invoices); the preview reads only the picked deal's. */
export function Invoices() {
  const deals = allDeals(useDeals().data);
  const [filter, setFilter] = useState<Filter>("all");
  const [selected, setSelected] = useState<string | null>(null);
  const list = useQuery({
    queryKey: ["hub", "invoices"],
    retry: false,
    queryFn: async () => {
      try { return (await api<{ invoices: InvoiceListItem[] }>(withTz("/api/hub/invoices"))).invoices; } catch (error) {
        if (error instanceof ApiError && error.status === 404) return null; // invoices are off for this member
        throw error;
      }
    },
  });
  const invoices = list.data ?? [];
  const counts = useMemo(() => {
    const out: Record<Filter, number> = { all: invoices.length, draft: 0, sent: 0, overdue: 0, paid: 0 };
    for (const invoice of invoices) out[invoice.state] += 1;
    return out;
  }, [invoices]);
  const shown = filter === "all" ? invoices : invoices.filter((invoice) => invoice.state === filter);
  const showFrom = new Set(invoices.map((invoice) => invoice.fromName)).size > 1;
  const waiting = invoices.filter((invoice) => invoice.state === "sent" || invoice.state === "overdue").reduce((sum, invoice) => sum + invoice.totalCents, 0);
  useEffect(() => { if (!selected && shown[0]) setSelected(shown[0].id); }, [shown.length]);
  const current = invoices.find((x) => x.id === selected) ?? shown[0];
  const detail = useInvoice(current?.dealId ?? "", Boolean(current));
  const full = detail.data?.invoice && detail.data.invoice.id === current?.id ? detail.data.invoice : null;
  const currentDeal = current ? deals.find((d) => d.id === current.dealId) : undefined;

  return (
    <div className="page inv-page">
      <div className="mhead">
        <h1>Invoices</h1><span className="sub">One per deal, all in one list</span>
        <div className="acts"><div className="seg">
          {FILTERS.map(([f, label]) => <button key={f} className={filter === f ? "on" : ""} onClick={() => setFilter(f)}>{label}{invoices.length ? ` ${counts[f]}` : ""}</button>)}
        </div></div>
      </div>
      {list.data === null ? <div className="empty-state">Invoices aren't switched on for your account yet.</div> : (
        <div className="inv-body">
          <div className="inv-list scroll">
            {invoices.length ? (
              <div className="inv-summary">
                <span><b>{invoices.length}</b> {invoices.length === 1 ? "invoice" : "invoices"}</span>
                {waiting > 0 ? <span><b>{money(waiting / 100)}</b> waiting to be paid</span> : null}
                {counts.overdue > 0 ? <span className="late-text"><b>{counts.overdue}</b> overdue</span> : null}
              </div>
            ) : null}
            {list.isLoading ? <div className="empty-state">Loading invoices…</div> : null}
            {list.isError ? <div className="empty-state">Couldn't load your invoices. <button className="link" onClick={() => void list.refetch()}>Try again</button></div> : null}
            {list.isSuccess && invoices.length === 0 ? <div className="empty-state">No invoices yet. Open a delivered deal and choose Create invoice.</div> : null}
            {invoices.length > 0 && shown.length === 0 ? <div className="empty-state">No {FILTERS.find(([f]) => f === filter)?.[1].toLowerCase()} invoices.</div> : null}
            {shown.map((invoice) => (
              <button key={invoice.id} className={`inv-row ${current?.id === invoice.id ? "on" : ""}`} onClick={() => setSelected(invoice.id)} onDoubleClick={() => openDeal(invoice.dealId)}>
                <Monogram name={invoice.brandName} size={34} />
                <span>
                  <b>{invoice.brandName}</b>
                  <small className={invoice.state === "overdue" ? "late-text" : "muted"}>{listLine(invoice)}</small>
                  {showFrom ? <small className="faint">From {invoice.fromName}{invoice.mine ? "" : " · your partner's"}</small> : null}
                </span>
                <span className="inv-end"><b className="amt">{money(invoice.totalCents / 100)}</b><span className={`inv-badge ${invoice.state}`}>{STATE_LABELS[invoice.state]}</span></span>
              </button>
            ))}
          </div>
          <div className="inv-preview scroll">
            {current ? (
              <>
                <div className="inv-bar">
                  <span className={`inv-badge ${current.state}`}>{STATE_LABELS[current.state]}</span>
                  <button className="link" onClick={() => openDeal(current.dealId)}>Open the deal</button>
                  {full ? <span className="acts"><InvoiceActions invoice={full} deal={currentDeal} /></span> : null}
                </div>
                {full ? <InvoicePaper invoice={full} /> : detail.isError ? <div className="empty-state">Couldn't load this invoice.</div> : <div className="empty-state">Loading…</div>}
              </>
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
}
