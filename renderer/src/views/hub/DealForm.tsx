import { useEffect, useMemo, useRef, useState } from "react";
import { Check, FileText, Link2, Loader2, Paperclip, Pencil, Plus, Trash2, X } from "lucide-react";
import { api, ApiError, queryClient } from "../../lib/api";
import { bytes } from "../../lib/format";
import {
  DEAL_STATUSES, DEAL_TYPES, STATUS_LABELS, createDeal, dayOf, createOption, deleteOption, errorText, isDeliveredOrLater, localToday, patchDeal, renameOption, useIndustries,
  usePaymentMethods, useSources, withTz, type Deal, type DealStatus, type DealType, type Option, type OptionKind,
} from "../../lib/hub";
import { Modal, celebrate, hubToast, useLayer } from "./parts";
import { addBriefLink, briefLink, uploadBrief } from "./DealPanel";
import { openDeal } from "./Deals";

export interface FormStart { deal?: Deal; status?: DealStatus; brand?: string; duplicateOf?: Deal }

let open: (start: FormStart | null) => void = () => {};
export const openDealForm = (start: FormStart) => open(start);

/* The words for each list's manager, as the website's DealSourcesManager / DealIndustriesManager / DealPaymentMethodsManager say them. */
const MANAGE: Record<OptionKind, { one: string; title: string; description: string; deleteEffect: (count: number) => string; emptyHint: string }> = {
  sources: {
    one: "source", title: "Deal sources",
    description: "Where deals come from. Sources you create are shared with your Hub. Renaming one updates every deal that uses it.",
    deleteEffect: (count) => `It comes off ${count} deal${count === 1 ? "" : "s"}. Their amounts and other sources stay.`,
    emptyHint: "None yet. Use + New source on a deal to create one.",
  },
  industries: {
    one: "industry", title: "Industries",
    description: "What brands sell. Industries you create are shared with your Hub. Renaming one updates every deal that uses it.",
    deleteEffect: (count) => `${count} deal${count === 1 ? " is" : "s are"} left with no industry. Their amounts and sources stay.`,
    emptyHint: "None yet. Use + New industry on a deal to create one.",
  },
  "payment-methods": {
    one: "payment method", title: "Payment methods",
    description: "How brands pay you. Methods you create are shared with your Hub. Renaming one updates every deal that uses it.",
    deleteEffect: (count) => `${count} deal${count === 1 ? " is" : "s are"} left with no payment method. Their amounts and dates stay.`,
    emptyHint: "None yet. Use + New method on a deal to create one.",
  },
};

/** Rename and delete the Hub's own sources, industries or payment methods; the defaults are listed below, fixed. */
function ManageOptions({ kind, options, onClose, onDeleted }: { kind: OptionKind; options: Option[]; onClose: () => void; onDeleted: (id: string) => void }) {
  const words = MANAGE[kind];
  const [editing, setEditing] = useState<{ id: string; name: string } | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const custom = options.filter((o) => o.custom).sort((a, b) => a.label.localeCompare(b.label));
  const defaults = options.filter((o) => !o.custom);
  const used = (o: Option) => (o.dealCount ? `${o.dealCount} deal${o.dealCount === 1 ? "" : "s"}` : "Not used yet");

  async function rename() {
    if (!editing || !editing.name.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      await renameOption(kind, editing.id, editing.name.trim());
      setEditing(null);
    } catch (e) {
      const code = e instanceof ApiError ? e.code : "";
      const match = e instanceof ApiError && typeof e.data?.default_id === "string" ? defaults.find((d) => d.id === e.data!.default_id) : undefined;
      setError(code === "exists" ? `You already have a${/^[aeiou]/.test(words.one) ? "n" : ""} ${words.one} with that name.` : match ? `“${match.label}” is already one of the defaults.` : errorText(e));
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await deleteOption(kind, id);
      onDeleted(id);
      setConfirming(null);
    } catch {
      setError(`Couldn't delete that ${words.one}.`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={words.title} onClose={onClose} width={520} foot={<button className="btn" onClick={onClose}>Done</button>}>
      <p className="muted" style={{ marginTop: 0 }}>{words.description}</p>
      <div className="section-label" style={{ marginTop: 10 }}>Yours · {custom.length}</div>
      {custom.length === 0 ? <p className="faint">{words.emptyHint}</p> : null}
      <div className="manage-list">
        {custom.map((o) => editing?.id === o.id ? (
          <div key={o.id} className="manage-row">
            <EscapeLayer onEscape={() => setEditing(null)} />
            <input className="field" autoFocus value={editing.name} maxLength={40} aria-label={`Rename ${o.label}`}
              onChange={(e) => { setEditing({ ...editing, name: e.target.value }); setError(null); }}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void rename(); } }} />
            <button className="btn honey" disabled={busy || !editing.name.trim()} onClick={() => void rename()}>{busy ? <Loader2 className="spin" /> : null}Save</button>
            <button className="btn" onClick={() => setEditing(null)}>Cancel</button>
          </div>
        ) : confirming === o.id ? (
          <div key={o.id} className="manage-row confirm">
            <span><b>Delete “{o.label}”?</b>{o.dealCount ? <small className="muted">{words.deleteEffect(o.dealCount)}</small> : null}</span>
            <button className="btn danger" disabled={busy} onClick={() => void remove(o.id)}>{busy ? <Loader2 className="spin" /> : null}Delete {words.one}</button>
            <button className="btn" onClick={() => setConfirming(null)}>Keep it</button>
          </div>
        ) : (
          <div key={o.id} className="manage-row">
            <span><b>{o.label}</b><small className="faint">{used(o)}</small></span>
            <button className="btn" onClick={() => { setError(null); setConfirming(null); setEditing({ id: o.id, name: o.label }); }}><Pencil />Rename</button>
            <button className="btn" onClick={() => { setError(null); setEditing(null); setConfirming(o.id); }}><Trash2 />Delete</button>
          </div>
        ))}
      </div>
      {error ? <p className="form-error" role="alert">{error}</p> : null}
      <div className="section-label" style={{ marginTop: 14 }}>CreatorHive defaults · everyone has these</div>
      <div className="chips">{defaults.map((d) => <span key={d.id} className="chip static">{d.label}</span>)}</div>
    </Modal>
  );
}

function ChipPicker({ options, selected, onToggle, kind, onCreate, multi, onManage }: {
  options: Option[]; selected: string[]; onToggle: (id: string) => void; kind: string; onCreate: (name: string) => Promise<void>; multi: boolean; onManage: () => void;
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
          <EscapeLayer onEscape={() => setAdding(false)} />
          <input autoFocus value={name} maxLength={40} placeholder={`New ${kind}`} onChange={(e) => setName(e.target.value)}
            onKeyDown={async (e) => {
              if (e.key === "Enter" && name.trim()) {
                e.preventDefault();
                setBusy(true);
                try { await onCreate(name.trim()); setName(""); setAdding(false); } finally { setBusy(false); }
              }
            }} />
          {busy ? <Loader2 className="spin" /> : null}
        </span>
      ) : <button type="button" className="chip add" onClick={() => setAdding(true)}><Plus />New {kind}</button>}
      {options.some((o) => o.custom) ? <button type="button" className="chip add" onClick={onManage}><Pencil />Edit {kind === "industry" ? "industries" : `${kind}s`}</button> : null}
    </div>
  );
}

/** While a little inline field is open, Esc closes the field, not the whole dialog. */
function EscapeLayer({ onEscape }: { onEscape: () => void }) {
  useLayer(onEscape);
  return null;
}

/* ---------- Brief on a new deal: held until the deal exists, then attached (the website's NewDealBriefs) ---------- */

type DraftBrief = { key: string; kind: "file"; file: File } | { key: string; kind: "link"; url: string; name: string };
const BRIEF_TYPES = /^(application\/pdf|application\/msword|application\/vnd\.openxmlformats-officedocument\.wordprocessingml\.document|image\/(jpeg|png|heic|webp))$/;
const BRIEF_EXTENSIONS = /\.(pdf|docx?|jpe?g|png|heic|webp)$/i;

function NewDealBriefs({ value, onChange }: { value: DraftBrief[]; onChange: (next: DraftBrief[]) => void }) {
  const [link, setLink] = useState<{ url: string; name: string; error: string | null } | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const picker = useRef<HTMLInputElement>(null);
  const full = value.length >= 5;

  function addFiles(files: File[]) {
    setMessage(null);
    const next = [...value];
    for (const file of files) {
      if (!BRIEF_TYPES.test(file.type) && !BRIEF_EXTENSIONS.test(file.name)) { setMessage("Briefs can be a PDF, a Word document or a photo."); continue; }
      if (file.size > 20 * 1024 * 1024) { setMessage(`${file.name} is over 20 MB.`); continue; }
      if (next.length >= 5) { setMessage("A deal can have up to 5 briefs."); break; }
      next.push({ key: crypto.randomUUID(), kind: "file", file });
    }
    onChange(next);
  }

  function addLink() {
    if (!link) return;
    const url = briefLink(link.url);
    if (!url) { setLink({ ...link, error: "Links need to start with https:// or http://" }); return; }
    onChange([...value, { key: crypto.randomUUID(), kind: "link", url, name: link.name.trim() }]);
    setLink(null);
  }

  // A group of fields, not a <form>: Enter here adds the link instead of saving the deal.
  const onLinkKey = (e: React.KeyboardEvent) => { if (e.key === "Enter") { e.preventDefault(); e.stopPropagation(); addLink(); } };
  return (
    <div className="new-briefs" onDragOver={(e) => e.dataTransfer.types.includes("Files") && e.preventDefault()} onDrop={(e) => { e.preventDefault(); addFiles([...e.dataTransfer.files]); }}>
      {value.map((b) => (
        <div key={b.key} className="brief">
          <span className={`ficon ${b.kind === "link" ? "link" : /pdf$/i.test(b.file.name) ? "pdf" : "word"}`}>{b.kind === "link" ? <Link2 /> : /pdf$/i.test(b.file.name) ? "PDF" : <FileText />}</span>
          <span className="fmeta"><b>{b.kind === "file" ? b.file.name : b.name || new URL(b.url).hostname.replace(/^www\./, "")}</b><span>{b.kind === "file" ? bytes(b.file.size) : new URL(b.url).hostname.replace(/^www\./, "")}</span></span>
          <button type="button" className="iconbtn" aria-label="Remove" onClick={() => onChange(value.filter((x) => x.key !== b.key))}><X /></button>
        </div>
      ))}
      {link ? (
        <div className="brief-link-form" role="group" aria-label="Add a link">
          <EscapeLayer onEscape={() => setLink(null)} />
          <input className="field" autoFocus type="url" placeholder="https://docs.google.com/…" value={link.url} aria-invalid={Boolean(link.error) || undefined} maxLength={2048}
            onChange={(e) => setLink({ ...link, url: e.target.value, error: null })} onKeyDown={onLinkKey} aria-label="Link" />
          <input className="field" placeholder="Name · optional" value={link.name} maxLength={200} onChange={(e) => setLink({ ...link, name: e.target.value })} onKeyDown={onLinkKey} aria-label="Name" />
          <button type="button" className="btn honey" disabled={!link.url.trim()} onClick={addLink}>Add link</button>
          <button type="button" className="btn" onClick={() => setLink(null)}>Cancel</button>
          {link.error ? <span className="form-error">{link.error}</span> : null}
        </div>
      ) : !full ? (
        <div className="row">
          <button type="button" className="btn" onClick={() => picker.current?.click()}><Paperclip />Add file</button>
          <button type="button" className="btn" onClick={() => { setMessage(null); setLink({ url: "", name: "", error: null }); }}><Link2 />Add link</button>
          <span className="faint">{value.length ? `${value.length} of 5` : "The brand's brief, mood board or contract"}</span>
        </div>
      ) : null}
      {message ? <span className="form-error">{message}</span> : null}
      <input ref={picker} type="file" multiple hidden accept=".pdf,.doc,.docx,.jpg,.jpeg,.png,.heic,.webp" onChange={(e) => { const files = [...(e.target.files ?? [])]; e.target.value = ""; addFiles(files); }} />
    </div>
  );
}

/** Attach the briefs picked on New deal to the deal just created; says which ones didn't make it. */
async function attachBriefs(dealId: string, drafts: DraftBrief[]) {
  const failed: string[] = [];
  for (const d of drafts) {
    const ok = d.kind === "file" ? await uploadBrief(dealId, d.file) : await addBriefLink(dealId, d.url, d.name);
    if (!ok) failed.push(d.kind === "file" ? d.file.name : d.name || d.url);
  }
  void queryClient.invalidateQueries({ queryKey: ["hub", "briefs", dealId] });
  if (failed.length) hubToast(`The deal was saved, but ${failed.join(", ")} couldn't be added to its brief.`);
}

interface Values {
  amount: string; brand: string; email: string; name: string; phone: string; sources: string[]; industry: string | null;
  type: DealType; status: DealStatus; paidOn: string; paidTouched: boolean; deliveredOn: string; deliveredTouched: boolean; method: string | null; deliverables: string; notes: string;
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
    deliveredOn: d?.delivered_at && !dup ? dayOf(d.delivered_at) : "",
    deliveredTouched: false,
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
  const [managing, setManaging] = useState<OptionKind | null>(null);
  const [briefs, setBriefs] = useState<DraftBrief[]>([]);
  const sources = useSources().data ?? [];
  const industries = useIndustries().data ?? [];
  const methods = usePaymentMethods().data ?? [];
  const brandInput = useRef<HTMLInputElement>(null);
  const emailInput = useRef<HTMLInputElement>(null);
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
      // Only when the member set it (or cleared it): otherwise the server stamps today on the move to Delivered.
      ...(isDeliveredOrLater(v.status) && (editing ? v.deliveredTouched : v.deliveredOn) ? { delivered_on: v.deliveredOn || null } : {}),
    };
  }

  async function save() {
    if (!v.brand.trim() || saving) return;
    // The server's own check (lib/hub/validation.ts), said in words before it says "invalid contact_email".
    if (v.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.email.trim())) {
      setError("That contact email doesn't look right.");
      emailInput.current?.focus();
      return;
    }
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
        if (briefs.length) await attachBriefs(result.deal.id, briefs);
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
          <div><label className="flabel">Contact email</label><input ref={emailInput} className="field" type="email" value={v.email} aria-invalid={error?.includes("email") || undefined} onChange={(e) => { set("email", e.target.value); if (error?.includes("email")) setError(null); }} /></div>
          <div><label className="flabel">Contact name</label><input className="field" value={v.name} maxLength={120} onChange={(e) => set("name", e.target.value)} /></div>
          <div><label className="flabel">Phone</label><input className="field" value={v.phone} maxLength={40} onChange={(e) => set("phone", e.target.value)} /></div>
        </div>
        <label className="flabel">Where the deal came from · optional</label>
        <ChipPicker multi kind="source" options={sources} selected={v.sources}
          onToggle={(id) => set("sources", v.sources.includes(id) ? v.sources.filter((s) => s !== id) : [...v.sources, id].slice(0, 10))}
          onCreate={async (name) => { const o = await createOption("sources", name); setV((c) => ({ ...c, sources: c.sources.includes(o.id) ? c.sources : [...c.sources, o.id] })); }}
          onManage={() => setManaging("sources")} />
        <p className="hint">The app, agency or person that brought it: Backstage, Instagram, a referral.</p>
        <label className="flabel">Brand's industry · optional</label>
        <ChipPicker multi={false} kind="industry" options={industries} selected={v.industry ? [v.industry] : []}
          onToggle={(id) => set("industry", v.industry === id ? null : id)}
          onCreate={async (name) => { const o = await createOption("industries", name); set("industry", o.id); }}
          onManage={() => setManaging("industries")} />
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
        {isDeliveredOrLater(v.status) ? (
          <>
            <label className="flabel">Delivered on · optional</label>
            <div className="row">
              <input className="field narrow" type="date" max={today} value={v.deliveredOn} aria-label="Delivered on" onChange={(e) => setV((c) => ({ ...c, deliveredOn: e.target.value, deliveredTouched: true }))} />
              {v.deliveredOn ? <button type="button" className="btn" onClick={() => setV((c) => ({ ...c, deliveredOn: "", deliveredTouched: true }))}>Clear</button> : null}
            </div>
            <p className="hint">{v.deliveredOn ? "Unpaid 14 days after this day, it shows as overdue." : start.deal && isDeliveredOrLater(start.deal.status) ? "Add the day you delivered the content." : "Today when the deal moves to Delivered, unless you pick another day."}</p>
          </>
        ) : null}
        {editing || start.duplicateOf ? (
          <>
            <label className="flabel">Payment via</label>
            <ChipPicker multi={false} kind="method" options={methods} selected={v.method ? [v.method] : []}
              onToggle={(id) => set("method", v.method === id ? null : id)}
              onCreate={async (name) => { const o = await createOption("payment-methods", name); set("method", o.id); }}
              onManage={() => setManaging("payment-methods")} />
          </>
        ) : null}
        <label className="flabel">Deliverables</label>
        <textarea className="field area" maxLength={1000} value={v.deliverables} placeholder="3 UGC videos + 5 product photos" onChange={(e) => set("deliverables", e.target.value)} />
        <label className="flabel">Notes</label>
        <textarea className="field area" maxLength={4000} value={v.notes} onChange={(e) => set("notes", e.target.value)} />
        {/* A saved deal keeps its briefs in its pop-up, so only a new one asks here. */}
        {!editing ? <><label className="flabel">Brief · optional</label><NewDealBriefs value={briefs} onChange={setBriefs} /></> : null}
        <div className="grid4">
          <div><label className="flabel">Draft due</label><input className="field" type="date" value={v.draftDue} onChange={(e) => set("draftDue", e.target.value)} /></div>
          <div><label className="flabel">Payment expected</label><input className="field" type="date" value={v.paymentExpected} onChange={(e) => set("paymentExpected", e.target.value)} /></div>
          <div><label className="flabel">Payment terms (days)</label><input className="field" type="number" min={0} max={365} value={v.terms} onChange={(e) => set("terms", e.target.value)} /></div>
          <div><label className="flabel">Deliverables count</label><input className="field" type="number" min={0} max={1000} value={v.count} onChange={(e) => set("count", e.target.value)} /></div>
        </div>
      </form>
      {managing ? (
        <ManageOptions kind={managing} options={managing === "sources" ? sources : managing === "industries" ? industries : methods} onClose={() => setManaging(null)}
          onDeleted={(id) => setV((c) => ({ ...c, sources: c.sources.filter((s) => s !== id), industry: c.industry === id ? null : c.industry, method: c.method === id ? null : c.method }))} />
      ) : null}
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
