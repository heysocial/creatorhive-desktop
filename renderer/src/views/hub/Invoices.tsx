import { useEffect, useMemo, useState } from "react";
import { Download, ExternalLink, FileText, Loader2, Send } from "lucide-react";
import { useQueries, useQuery } from "@tanstack/react-query";
import { ch } from "../../lib/bridge";
import { api, ApiError, queryClient } from "../../lib/api";
import { allDeals, localToday, monDay, useDeals, type Deal } from "../../lib/hub";
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
}
interface InvoiceResponse { invoicesEnabled: boolean; canEdit: boolean; invoice: Invoice | null; profileSetUp: boolean }

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
  if (deal?.status === "completed" && deal.paid_at) return "paid";
  if (invoice.status === "sent" && invoice.sentAt) return invoice.dueOn && invoice.dueOn < localToday() ? "overdue" : "sent";
  return "draft";
}
function stateLine(invoice: Invoice, deal: Deal | undefined) {
  const s = stateOf(invoice, deal);
  if (s === "paid") return `${invoice.number} · Paid ${monDay(deal!.paid_at!)}`;
  if (s === "overdue") {
    const days = Math.round((Date.now() - new Date(`${invoice.dueOn}T12:00:00`).getTime()) / 86_400_000);
    return `${invoice.number} · Sent ${monDay(invoice.sentAt!)} · ${days} ${days === 1 ? "day" : "days"} overdue`;
  }
  if (s === "sent") return `${invoice.number} · Sent ${monDay(invoice.sentAt!)}${invoice.dueOn ? ` · due ${monDay(invoice.dueOn)}` : ""}`;
  return `${invoice.number} · Draft${deal?.status === "delivered" ? " · deal delivered" : ""}`;
}

export async function createInvoice(deal: Deal) {
  try {
    await api(`/api/hub/deals/${deal.id}/invoice`, { method: "POST" });
  } catch (error) {
    if (error instanceof ApiError && error.code === "PROFILE_NOT_SET_UP") {
      if (window.confirm("Add your invoice details first (business name and email). Open them on the website?")) ch.app.openSite(`/settings/invoice?returnTo=/hub/deals/${deal.id}`);
      return;
    }
    if (!(error instanceof ApiError && error.code === "ALREADY_EXISTS")) { window.alert("Couldn't create the invoice."); return; }
  }
  await queryClient.invalidateQueries({ queryKey: ["hub", "invoice", deal.id] });
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
  return (
    <>
      <button className="btn" onClick={() => void ch.files.save(`/api/hub/deals/${invoice.dealId}/invoice/pdf?download=1`, `Invoice-${invoice.number}.pdf`)}><Download />Download PDF</button>
      <button className="btn" onClick={() => ch.app.openSite(`/hub/deals/${invoice.dealId}?invoice=1`)}><ExternalLink />Edit on the website</button>
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
      return data.canEdit ? <section className="dp-sec"><span className="section-label">Invoice</span><button className="link add" onClick={() => void createInvoice(deal)}>+ Create invoice</button></section> : null;
    }
    return (
      <section className="dp-sec invoice-offer">
        <b>{deal.brand_name} is delivered — send the invoice</b>
        <div className="row"><button className="btn honey" onClick={() => void createInvoice(deal)}><FileText />Create invoice</button>
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

/** Hub → Invoices: every deal's invoice in one list. */
export function Invoices() {
  const deals = allDeals(useDeals().data);
  const [filter, setFilter] = useState<"all" | "draft" | "sent" | "paid">("all");
  const [selected, setSelected] = useState<string | null>(null);
  const results = useQueries({ queries: deals.map((d) => ({
    queryKey: ["hub", "invoice", d.id],
    retry: false,
    staleTime: 60_000,
    queryFn: async () => {
      try { return await api<InvoiceResponse>(`/api/hub/deals/${d.id}/invoice`); } catch (error) {
        if (error instanceof ApiError && error.status === 404) return null;
        throw error;
      }
    },
  })) });
  const loading = results.some((r) => r.isLoading);
  const disabled = results.length > 0 && results.every((r) => r.isSuccess && r.data === null);
  const invoices = useMemo(() => results.flatMap((r, i) => (r.data?.invoice ? [{ invoice: r.data.invoice, deal: deals[i] }] : []))
    .sort((a, b) => (b.invoice.issuedOn + b.invoice.number).localeCompare(a.invoice.issuedOn + a.invoice.number)), [results, deals]);
  const shown = invoices.filter(({ invoice, deal }) => {
    const s = stateOf(invoice, deal);
    return filter === "all" || (filter === "sent" ? s === "sent" || s === "overdue" : s === filter);
  });
  useEffect(() => { if (!selected && shown[0]) setSelected(shown[0].invoice.id); }, [shown.length]);
  const current = invoices.find((x) => x.invoice.id === selected) ?? shown[0];
  const count = (f: typeof filter) => invoices.filter(({ invoice, deal }) => { const s = stateOf(invoice, deal); return f === "all" || (f === "sent" ? s === "sent" || s === "overdue" : s === f); }).length;

  return (
    <div className="page">
      <div className="mhead">
        <h1>Invoices</h1><span className="sub">One per deal, all in one list</span>
        <div className="acts"><div className="seg">
          {(["all", "draft", "sent", "paid"] as const).map((f) => <button key={f} className={filter === f ? "on" : ""} onClick={() => setFilter(f)}>{f[0].toUpperCase() + f.slice(1)}{invoices.length ? ` ${count(f)}` : ""}</button>)}
        </div></div>
      </div>
      {disabled ? <div className="empty-state">Invoices aren't switched on for your account yet.</div> : (
        <div className="inv-body">
          <div className="inv-list scroll">
            {loading && invoices.length === 0 ? <div className="empty-state">Loading invoices…</div> : null}
            {!loading && invoices.length === 0 ? <div className="empty-state">No invoices yet. Open a delivered deal and choose Create invoice.</div> : null}
            {shown.map(({ invoice, deal }) => {
              const s = stateOf(invoice, deal);
              return (
                <button key={invoice.id} className={`inv-row ${current?.invoice.id === invoice.id ? "on" : ""}`} onClick={() => setSelected(invoice.id)} onDoubleClick={() => openDeal(deal.id)}>
                  <Monogram name={deal.brand_name} size={34} />
                  <span><b>{deal.brand_name}</b><small className={s === "overdue" ? "late-text" : "muted"}>{stateLine(invoice, deal)}</small></span>
                  <b className="amt">{money(invoice.totalCents / 100)}</b>
                </button>
              );
            })}
          </div>
          <div className="inv-preview scroll">
            {current ? (
              <>
                <div className="inv-bar">
                  <span className={`inv-badge ${stateOf(current.invoice, current.deal)}`}>{stateOf(current.invoice, current.deal)}</span>
                  <button className="link" onClick={() => openDeal(current.deal.id)}>Open the deal</button>
                  <span className="acts"><InvoiceActions invoice={current.invoice} deal={current.deal} /></span>
                </div>
                <InvoicePaper invoice={current.invoice} />
              </>
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
}
