import { useCallback, useEffect, useRef, useState } from "react";
import { Check, Loader2, Plus, Trash2, X } from "lucide-react";
import { api, ApiError, queryClient } from "../../lib/api";
import type { Invoice } from "./Invoices";

/*
  Editing an invoice, as the website's editor does: every change saves itself
  (PATCH /api/hub/deals/<id>/invoice, 0.7 s after you stop typing) and the
  server recomputes the totals. Bank numbers stay on the website's settings.
*/

type Line = { description: string; quantity: number; rateCents: number };
type Doc = Pick<Invoice, "number" | "issuedOn" | "dueOn" | "termsDays" | "billTo" | "projectTitle" | "projectDetails" | "note" | "taxCents"> & { lines: Line[] };

const TERMS = [0, 7, 14, 15, 30, 45, 60, 90];
const cents = (n: number) => (n / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });
const lineTotal = (l: Line) => Math.round((Math.round(l.quantity * 100) * l.rateCents) / 100);
function addDays(iso: string, days: number) {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}
const ERRORS: Record<string, string> = {
  NUMBER_TAKEN: "That invoice number is already used.",
  INVALID_DATE: "Check the dates.",
  INVALID_QUANTITY: "Quantities are more than 0, with up to 2 decimals.",
  INVALID_RATE: "Check the rates.",
  TOO_MANY_LINES: "An invoice has up to 50 lines.",
  TOO_LONG: "Some text is too long.",
};

export function InvoiceEditor({ invoice, onClose }: { invoice: Invoice; onClose: () => void }) {
  const [doc, setDoc] = useState<Doc>(() => ({
    number: invoice.number, issuedOn: invoice.issuedOn, dueOn: invoice.dueOn, termsDays: invoice.termsDays, billTo: invoice.billTo,
    projectTitle: invoice.projectTitle, projectDetails: invoice.projectDetails, note: invoice.note, taxCents: invoice.taxCents, lines: invoice.lines,
  }));
  const [taxText, setTaxText] = useState((invoice.taxCents / 100).toFixed(2));
  const [save, setSave] = useState<{ kind: "idle" | "saving" | "saved" | "error"; message?: string }>({ kind: "idle" });
  const pending = useRef<Record<string, unknown>>({});
  const timer = useRef<number | null>(null);

  const flush = useCallback(async () => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    const body = pending.current;
    if (!Object.keys(body).length) return;
    pending.current = {};
    setSave({ kind: "saving" });
    try {
      const { invoice: saved } = await api<{ invoice: Invoice }>(`/api/hub/deals/${invoice.dealId}/invoice`, { method: "PATCH", body });
      queryClient.setQueryData(["hub", "invoice", invoice.dealId], (old: { invoice: Invoice } | undefined) => (old ? { ...old, invoice: saved } : old));
      setSave({ kind: "saved" });
    } catch (e) {
      setSave({ kind: "error", message: (e instanceof ApiError && ERRORS[e.code ?? ""]) || "Couldn't save. Check the invoice and try again." });
    }
  }, [invoice.dealId]);

  const change = (patch: Partial<Doc>, now = false) => {
    setDoc((d) => ({ ...d, ...patch }));
    pending.current = { ...pending.current, ...patch };
    setSave({ kind: "saving" });
    if (timer.current) clearTimeout(timer.current);
    if (now) void flush();
    else timer.current = window.setTimeout(() => void flush(), 700);
  };

  // Close (Esc, ✕) saves anything still waiting.
  const close = useCallback(async () => { await flush(); void queryClient.invalidateQueries({ queryKey: ["hub", "invoice", invoice.dealId] }); onClose(); }, [flush, onClose, invoice.dealId]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); void close(); } };
    window.addEventListener("keydown", key, true);
    return () => window.removeEventListener("keydown", key, true);
  }, [close]);

  // Stable keys so a removed line doesn't hand its typed rate to the next one.
  const [keys, setKeys] = useState(() => invoice.lines.map(() => crypto.randomUUID()));
  const setLine = (i: number, patch: Partial<Line>) => change({ lines: doc.lines.map((l, j) => (j === i ? { ...l, ...patch } : l)) });
  const subtotal = doc.lines.reduce((t, l) => t + lineTotal(l), 0);

  return (
    <div className="scrim center" onMouseDown={(e) => e.target === e.currentTarget && void close()}>
      <div className="modal invoice-editor" role="dialog" aria-label={`Edit invoice ${doc.number}`}>
        <div className="modal-head">
          Edit invoice
          <span className={`save-state ${save.kind}`}>{save.kind === "saving" ? <><Loader2 className="spin" />Saving…</> : save.kind === "saved" ? <><Check />Saved</> : save.kind === "error" ? save.message : ""}</span>
          <button className="iconbtn" onClick={() => void close()} aria-label="Close"><X /></button>
        </div>
        <div className="modal-body ie-body">
          <div className="ie-grid">
            <label>Invoice number<input className="field" value={doc.number} maxLength={40} onChange={(e) => change({ number: e.target.value })} /></label>
            <label>Issued<input className="field" type="date" value={doc.issuedOn} onChange={(e) => change({ issuedOn: e.target.value, ...(doc.termsDays != null ? { dueOn: addDays(e.target.value, doc.termsDays) } : {}) })} /></label>
            <label>Terms
              <select className="field" value={doc.termsDays ?? ""} onChange={(e) => { const d = Number(e.target.value); change({ termsDays: d, dueOn: addDays(doc.issuedOn, d) }); }}>
                {doc.termsDays != null && !TERMS.includes(doc.termsDays) ? <option value={doc.termsDays}>Net {doc.termsDays}</option> : null}
                {TERMS.map((d) => <option key={d} value={d}>{d === 0 ? "Due on receipt" : `Net ${d}`}</option>)}
              </select>
            </label>
            <label>Due<input className="field" type="date" value={doc.dueOn ?? ""} onChange={(e) => change({ dueOn: e.target.value || null, termsDays: null })} /></label>
          </div>
          <div className="section-label">Bill to</div>
          <div className="ie-grid">
            <label>Company<input className="field" value={doc.billTo.company} maxLength={120} onChange={(e) => change({ billTo: { ...doc.billTo, company: e.target.value } })} /></label>
            <label>Contact<input className="field" value={doc.billTo.contactName} maxLength={120} onChange={(e) => change({ billTo: { ...doc.billTo, contactName: e.target.value } })} /></label>
            <label>Email<input className="field" type="email" value={doc.billTo.email} maxLength={254} onChange={(e) => change({ billTo: { ...doc.billTo, email: e.target.value } })} /></label>
            <label>Phone<input className="field" value={doc.billTo.phone} maxLength={40} onChange={(e) => change({ billTo: { ...doc.billTo, phone: e.target.value } })} /></label>
          </div>
          <div className="section-label">Project</div>
          <input className="field" placeholder="Project title" value={doc.projectTitle} maxLength={200} onChange={(e) => change({ projectTitle: e.target.value })} />
          <textarea className="field area" placeholder="Details (optional)" value={doc.projectDetails} maxLength={2000} onChange={(e) => change({ projectDetails: e.target.value })} />
          <div className="section-label">Items</div>
          <div className="ie-lines">
            <div className="ie-line head"><span>Description</span><span>Qty</span><span>Rate</span><span className="r">Amount</span><span /></div>
            {doc.lines.map((line, i) => (
              <div key={keys[i] ?? i} className="ie-line">
                <input className="field" value={line.description} maxLength={500} onChange={(e) => setLine(i, { description: e.target.value })} />
                <input className="field" type="number" min={0.01} step={0.01} value={line.quantity} onChange={(e) => setLine(i, { quantity: Number(e.target.value) })} />
                <input className="field" inputMode="decimal" defaultValue={(line.rateCents / 100).toFixed(2)}
                  onChange={(e) => { const v = Number(e.target.value.replace(/[$,\s]/g, "") || 0); if (Number.isFinite(v) && v >= 0) setLine(i, { rateCents: Math.round(v * 100) }); }}
                  onBlur={(e) => { e.target.value = (Number(e.target.value.replace(/[$,\s]/g, "") || 0)).toFixed(2); }} />
                <span className="r">{cents(lineTotal(line))}</span>
                <button className="iconbtn sm" title="Remove line" disabled={doc.lines.length <= 1} onClick={() => { setKeys((k) => k.filter((_, j) => j !== i)); change({ lines: doc.lines.filter((_, j) => j !== i) }, true); }}><Trash2 /></button>
              </div>
            ))}
            <button className="link add" disabled={doc.lines.length >= 50} onClick={() => { setKeys((k) => [...k, crypto.randomUUID()]); change({ lines: [...doc.lines, { description: "New item", quantity: 1, rateCents: 0 }] }, true); }}><Plus />Add a line</button>
          </div>
          <div className="ie-totals">
            <span>Subtotal</span><b>{cents(subtotal)}</b>
            <span>Tax</span><input className="field" value={taxText} onChange={(e) => {
              setTaxText(e.target.value);
              const value = Number(e.target.value.replace(/[$,\s]/g, "") || "0");
              if (Number.isFinite(value) && value >= 0) change({ taxCents: Math.round(value * 100) });
            }} />
            <span className="t">Total due</span><b className="t">{cents(subtotal + doc.taxCents)}</b>
          </div>
          <div className="section-label">Note</div>
          <textarea className="field area" placeholder="Thanks for working with me!" value={doc.note} maxLength={2000} onChange={(e) => change({ note: e.target.value })} />
          <p className="hint">Your business details, logo and how you get paid come from Settings → Hub & invoices.</p>
        </div>
      </div>
    </div>
  );
}
