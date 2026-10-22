import { useEffect, useMemo, useRef, useState } from "react";
import { Check, Loader2, Plus } from "lucide-react";
import { api } from "../../lib/api";
import {
  DEAL_STATUSES, DEAL_TYPES, STATUS_LABELS, createDeal, dayOf, createOption, errorText, localToday, patchDeal, useIndustries, usePaymentMethods,
  useSources, withTz, type Deal, type DealStatus, type DealType, type Option,
} from "../../lib/hub";
import { Modal, celebrate } from "./parts";
import { openDeal } from "./Deals";

export interface FormStart { deal?: Deal; status?: DealStatus; brand?: string; duplicateOf?: Deal }

let open: (start: FormStart | null) => void = () => {};
export const openDealForm = (start: FormStart) => open(start);

function ChipPicker({ options, selected, onToggle, kind, onCreate, multi }: {
  options: Option[]; selected: string[]; onToggle: (id: string) => void; kind: string; onCreate: (name: string) => Promise<void>; multi: boolean;
}) {
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <div className="chips">
      {options.map((o) => (
        <button key={o.id} type="button" className={`chip ${selected.includes(o.id) ? "on" : ""}`} onClick={() => onToggle(o.id)} aria-pressed={selected.includes(o.id)}>
          {selected.includes(o.id) && multi ? <Check /> : null}{o.label}{o.custom ? <span className="custom">CUSTOM</span> : null}
        </button>
      ))}
      {adding ? (
        <span className="chip-add">
          <input autoFocus value={name} maxLength={40} placeholder={`New ${kind}`} onChange={(e) => setName(e.target.value)}
            onKeyDown={async (e) => {
              if (e.key === "Escape") { e.stopPropagation(); setAdding(false); }
              if (e.key === "Enter" && name.trim()) {
                e.preventDefault();
                setBusy(true);
                try { await onCreate(name.trim()); setName(""); setAdding(false); } finally { setBusy(false); }
              }
            }} />
          {busy ? <Loader2 className="spin" /> : null}
        </span>
      ) : <button type="button" className="chip add" onClick={() => setAdding(true)}><Plus />New {kind}</button>}
    </div>
  );
}

interface Values {
  amount: string; brand: string; email: string; name: string; phone: string; sources: string[]; industry: string | null;
  type: DealType; status: DealStatus; paidOn: string; paidTouched: boolean; method: string | null; deliverables: string; notes: string;
  draftDue: string; paymentExpected: string; terms: string; count: string;
}

function initial(start: FormStart): Values {
  const d = start.deal ?? start.duplicateOf;
  const dup = Boolean(start.duplicateOf);
  return {
    amount: d ? String(d.amount_usd) : "750",
    brand: dup ? `${d!.brand_name} (copy)` : d?.brand_name ?? start.brand ?? "",
    email: d?.contact_email ?? "",
    name: d?.contact_name ?? "",
    phone: d?.contact_phone ?? "",
    sources: d?.deal_sources.map((s) => s.id) ?? [],
    industry: d?.industry_ref?.id ?? null,
    type: d?.deal_type ?? "ugc",
    status: dup ? "pitching" : d?.status ?? start.status ?? "pitching",
    paidOn: d?.paid_at && !dup ? dayOf(d.paid_at) : "",
    paidTouched: false,
    method: d?.payment_method_ref?.id ?? null,
    deliverables: d?.deliverables ?? "",
    notes: d?.notes ?? "",
    draftDue: dup ? "" : d?.draft_due_at ?? "",
    paymentExpected: dup ? "" : d?.payment_expected_at ?? "",
    terms: d?.payment_terms_days != null ? String(d.payment_terms_days) : "",
    count: d?.deliverables_count != null ? String(d.deliverables_count) : "",
  };
}

/** What changed about the brand's industry and sources, for "Apply to all". */
function brandChange(before: Deal, after: Values) {
  const industry = after.industry && after.industry !== (before.industry_ref?.id ?? null) ? after.industry : null;
  const had = before.deal_sources.map((s) => s.id);
  const add = after.sources.filter((s) => !had.includes(s));
  const remove = had.filter((s) => !after.sources.includes(s));
  return { industry, add, remove, any: Boolean(industry || add.length || remove.length) };
}

function DealFormDialog({ start, onClose }: { start: FormStart; onClose: () => void }) {
  const editing = Boolean(start.deal);
  const [v, setV] = useState<Values>(() => initial(start));
  const [moreStages, setMoreStages] = useState(() => Boolean(start.deal && !["pitching", "deal_secured"].includes(start.deal.status)));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [apply, setApply] = useState<{ count: number; saved: Deal; change: ReturnType<typeof brandChange> } | null>(null);
  const sources = useSources().data ?? [];
  const industries = useIndustries().data ?? [];
  const methods = usePaymentMethods().data ?? [];
  const brandInput = useRef<HTMLInputElement>(null);
  const set = <K extends keyof Values>(key: K, value: Values[K]) => setV((current) => ({ ...current, [key]: value }));

  useEffect(() => { if (!editing) brandInput.current?.focus(); }, [editing]);

  const labelOf = useMemo(() => {
    const map = new Map([...sources, ...industries].map((o) => [o.id, o.label]));
    return (id: string) => map.get(id) ?? id;
  }, [sources, industries]);

  function body() {
    const completed = v.status === "completed";
    return {
      brand_name: v.brand.trim(),
      amount_usd: Number(v.amount.replace(/\D/g, "") || 0),
      contact_email: v.email.trim(),
      contact_name: v.name.trim(),
      contact_phone: v.phone.trim(),
      deal_sources: v.sources,
      industry_ref: v.industry,
      deal_type: v.type,
      status: v.status,
      ...(editing ? { payment_method_ref: v.method } : start.duplicateOf ? { payment_method_ref: v.method } : {}),
      deliverables: v.deliverables.trim(),
      notes: v.notes.trim(),
      draft_due_at: v.draftDue,
      payment_expected_at: v.paymentExpected,
      payment_terms_days: v.terms,
      deliverables_count: v.count,
      ...(completed && (v.paidTouched || !editing) ? { paid_on: v.paidOn || null } : {}),
    };
  }

  async function save() {
    if (!v.brand.trim() || saving) return;
    setSaving(true);
    setError(null);
    try {
      if (editing) {
        const result = await patchDeal(start.deal!.id, body());
        celebrate(result.deal, result.payday);
        const change = brandChange(start.deal!, v);
        if (change.any) {
          const siblings = await api<{ count: number; industries: { label: string | null; count: number }[] }>(
            `/api/hub/deals/siblings?brand=${encodeURIComponent(v.brand.trim())}&exclude=${start.deal!.id}`).catch(() => null);
          const sameIndustryAlready = siblings && !change.add.length && !change.remove.length && siblings.industries.length === 1 && siblings.industries[0].label === labelOf(change.industry ?? "");
          if (siblings && siblings.count > 0 && !sameIndustryAlready) {
            setApply({ count: siblings.count, saved: result.deal, change });
            setSaving(false);
            return;
          }
        }
        onClose();
      } else {
        const result = await createDeal(body());
        celebrate(result.deal, result.payday);
        onClose();
        openDeal(result.deal.id);
      }
    } catch (e) {
      setError(errorText(e));
    } finally {
      setSaving(false);
    }
  }

  async function applyToAll() {
    if (!apply) return;
    try {
      await api(withTz(`/api/hub/deals/${apply.saved.id}/apply-to-brand`), {
        method: "POST",
        body: { ...(apply.change.industry ? { industry_ref: apply.change.industry } : {}), add_sources: apply.change.add, remove_sources: apply.change.remove },
      });
    } catch {
      window.alert("Couldn't update the other deals.");
    }
    onClose();
  }

  const stages = moreStages ? DEAL_STATUSES : (["pitching", "deal_secured"] as DealStatus[]);
  const today = localToday();

  if (apply) {
    const before = start.deal!;
    return (
      <Modal title={`Apply to all ${apply.count + 1} deals with ${v.brand.trim()}?`} onClose={onClose} width={480}
        foot={<><button className="btn" onClick={onClose}>Just this one</button><button className="btn honey" onClick={() => void applyToAll()}>Yes, all {apply.count + 1}</button></>}>
        <div className="apply-box">
          {apply.change.industry ? (
            <div className="apply-row"><span className="muted">Industry</span><s className="faint">{before.industry_ref?.label ?? "Not set"}</s><span>→</span><b>{labelOf(apply.change.industry)}</b></div>
          ) : null}
          {apply.change.add.length || apply.change.remove.length ? (
            <div className="apply-row"><span className="muted">Sources</span><span className="faint">{before.deal_sources.map((s) => s.label).join(", ") || "None"}</span><span>→</span><b>{v.sources.map(labelOf).join(", ") || "None"}</b></div>
          ) : null}
        </div>
      </Modal>
    );
  }

  return (
    <Modal title={<span>{editing ? "Edit deal" : start.duplicateOf ? "Duplicate deal" : "New deal"} <span className="muted" style={{ fontWeight: 500 }}>{start.deal?.brand_name ?? ""}</span></span>} onClose={onClose} width={760}
      foot={<>
        {error ? <span className="form-error">{error}</span> : null}
        <button className="btn" onClick={onClose}>Cancel</button>
        <button className="btn honey" disabled={!v.brand.trim() || saving} onClick={() => void save()}>{saving ? <Loader2 className="spin" /> : null}{editing ? "Save changes" : "Track this deal"}</button>
      </>}>
      <form className="deal-form" onSubmit={(e) => { e.preventDefault(); void save(); }}
        onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void save(); } }}>
        <div className="amount-row">
          <span className="dollar">$</span>
          <input className="amount" inputMode="numeric" value={Number(v.amount || 0).toLocaleString("en-US")} aria-label="Amount"
            style={{ width: `${Math.max(2, Number(v.amount || 0).toLocaleString("en-US").length) * 0.62 + 0.4}em` }}
            onChange={(e) => set("amount", e.target.value.replace(/\D/g, "").slice(0, 8))} />
          <span className="muted">what's this deal worth?</span>
        </div>
        <label className="flabel">Brand</label>
        <input ref={brandInput} className="field" value={v.brand} maxLength={120} required onChange={(e) => set("brand", e.target.value)} />
        <div className="grid3">
          <div><label className="flabel">Contact email</label><input className="field" type="email" value={v.email} onChange={(e) => set("email", e.target.value)} /></div>
          <div><label className="flabel">Contact name</label><input className="field" value={v.name} maxLength={120} onChange={(e) => set("name", e.target.value)} /></div>
          <div><label className="flabel">Phone</label><input className="field" value={v.phone} maxLength={40} onChange={(e) => set("phone", e.target.value)} /></div>
        </div>
        <label className="flabel">Where the deal came from · optional</label>
        <ChipPicker multi kind="source" options={sources} selected={v.sources}
          onToggle={(id) => set("sources", v.sources.includes(id) ? v.sources.filter((s) => s !== id) : [...v.sources, id].slice(0, 10))}
          onCreate={async (name) => { const o = await createOption("sources", name); setV((c) => ({ ...c, sources: c.sources.includes(o.id) ? c.sources : [...c.sources, o.id] })); }} />
        <p className="hint">The app, agency or person that brought it: Backstage, Instagram, a referral.</p>
        <label className="flabel">Brand's industry · optional</label>
        <ChipPicker multi={false} kind="industry" options={industries} selected={v.industry ? [v.industry] : []}
          onToggle={(id) => set("industry", v.industry === id ? null : id)}
          onCreate={async (name) => { const o = await createOption("industries", name); set("industry", o.id); }} />
        <label className="flabel">Deal type</label>
        <div className="chips">{DEAL_TYPES.map((t) => <button type="button" key={t.id} className={`chip ${v.type === t.id ? "on" : ""}`} onClick={() => set("type", t.id)}>{t.label}</button>)}</div>
        <label className="flabel">Sales stage</label>
        <div className="chips">
          {stages.map((s) => (
            <button type="button" key={s} className={`chip ${v.status === s ? "on" : ""}`} onClick={() => setV((c) => ({ ...c, status: s, paidOn: s === "completed" && !c.paidOn ? today : c.paidOn }))}>{STATUS_LABELS[s]}</button>
          ))}
          {!moreStages ? <button type="button" className="chip add" onClick={() => setMoreStages(true)}>More…</button> : null}
        </div>
        {v.status === "completed" ? (
          <>
            <label className="flabel">Paid on</label>
            <input className="field narrow" type="date" max={today} value={v.paidOn} onChange={(e) => setV((c) => ({ ...c, paidOn: e.target.value, paidTouched: true }))} />
            <p className="hint">{!v.paidOn ? "Not counted in any month until you add the day it was paid." : v.paidOn === today ? "Today, unless you pick another day." : "Counts toward that month in Cash."}</p>
          </>
        ) : null}
        {editing || start.duplicateOf ? (
          <>
            <label className="flabel">Payment via</label>
            <ChipPicker multi={false} kind="method" options={methods} selected={v.method ? [v.method] : []}
              onToggle={(id) => set("method", v.method === id ? null : id)}
              onCreate={async (name) => { const o = await createOption("payment-methods", name); set("method", o.id); }} />
          </>
        ) : null}
        <label className="flabel">Deliverables</label>
        <textarea className="field area" maxLength={1000} value={v.deliverables} placeholder="3 UGC videos + 5 product photos" onChange={(e) => set("deliverables", e.target.value)} />
        <label className="flabel">Notes</label>
        <textarea className="field area" maxLength={4000} value={v.notes} onChange={(e) => set("notes", e.target.value)} />
        <div className="grid4">
          <div><label className="flabel">Draft due</label><input className="field" type="date" value={v.draftDue} onChange={(e) => set("draftDue", e.target.value)} /></div>
          <div><label className="flabel">Payment expected</label><input className="field" type="date" value={v.paymentExpected} onChange={(e) => set("paymentExpected", e.target.value)} /></div>
          <div><label className="flabel">Payment terms (days)</label><input className="field" type="number" min={0} max={365} value={v.terms} onChange={(e) => set("terms", e.target.value)} /></div>
          <div><label className="flabel">Deliverables count</label><input className="field" type="number" min={0} max={1000} value={v.count} onChange={(e) => set("count", e.target.value)} /></div>
        </div>
      </form>
    </Modal>
  );
}

/** Mounted once; New deal, Edit and Duplicate all open through it. */
export function DealFormHost() {
  const [start, setStart] = useState<FormStart | null>(null);
  useEffect(() => {
    open = setStart;
    return () => { open = () => {}; };
  }, []);
  return start ? <DealFormDialog key={start.deal?.id ?? "new"} start={start} onClose={() => setStart(null)} /> : null;
}
