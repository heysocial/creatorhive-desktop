import { useRef, useState } from "react";
import { Check, Loader2, Plus, Trash2, Upload, X } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { ch } from "../../lib/bridge";
import { api, ApiError, queryClient } from "../../lib/api";
import { Monogram } from "./parts";

/*
  Your invoice details (the website's /settings/invoice): business, logo, how
  brands pay you and the defaults every invoice starts with. Saved with
  PUT /api/invoice-profile; the logo goes to the private store through the
  website's own upload route, then the server turns it into a 512px PNG.
  Used in Settings → Hub & invoices, and before a first invoice.
*/

export interface InvoiceProfile {
  businessName: string; ownerName: string; street: string; city: string; region: string; postalCode: string; email: string;
  logoUrl: string | null;
  paypal: string; paypalOn: boolean; zelle: string; zelleOn: boolean; cashapp: string; cashappOn: boolean;
  bankName: string; bankRouting: string; bankAccount: string; bankAccountLast4: string; bankOn: boolean;
  defaultTermsDays: number; numberPrefix: string; nextNumber: number; note: string; isSetUp: boolean;
  /* Several profiles since Nov 2026 (Kinzi): "main" or the extra one's id, its raw label, the name shown and which is main. */
  id?: string; label?: string; name?: string; isMain?: boolean;
}
type Form = Omit<InvoiceProfile, "logoUrl" | "bankAccountLast4" | "isSetUp" | "nextNumber" | "id" | "label" | "name" | "isMain"> & { nextNumber: string; label: string };

const TERMS = [0, 7, 14, 15, 30, 45, 60, 90];
const termsLabel = (days: number) => (days === 0 ? "Due on receipt" : `Net ${days}`);
const LOGO_TYPES = ["image/png", "image/jpeg", "image/webp"];

export function useInvoiceProfile() {
  return useQuery({
    queryKey: ["invoice-profile"],
    retry: false,
    queryFn: async () => {
      try { return (await api<{ profile: InvoiceProfile }>("/api/invoice-profile")).profile; }
      catch (e) { if (e instanceof ApiError && e.status === 404) return null; throw e; } // invoices are off for this member
    },
  });
}

/** Every invoice profile, main first (GET /api/invoice-profiles). null when invoices are off. */
export function useInvoiceProfiles() {
  return useQuery({
    queryKey: ["invoice-profiles"],
    retry: false,
    queryFn: async () => {
      try { return await api<{ max: number; profiles: InvoiceProfile[] }>("/api/invoice-profiles"); }
      catch (e) { if (e instanceof ApiError && e.status === 404) return null; throw e; }
    },
  });
}

const profileKey = (p: InvoiceProfile) => p.id ?? "main";
const LABEL_MAX = 40;

function formFrom(p: InvoiceProfile): Form {
  const { logoUrl: _l, bankAccountLast4: _b, isSetUp: _s, id: _i, name: _n, isMain: _m, nextNumber, label, ...rest } = p;
  return { ...rest, label: label ?? "", nextNumber: String(nextNumber) };
}

/*
  Settings → Hub & invoices with profiles: a tab per profile, "Add another
  profile", and the form for the one picked. Extra profiles share the main
  one's invoice numbers and payment terms.
*/
export function InvoiceProfiles() {
  const query = useInvoiceProfiles();
  const [activeId, setActiveId] = useState("main");
  const [adding, setAdding] = useState<string | null>(null);
  const [addBusy, setAddBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const dirty = useRef(false);
  if (query.isLoading) return <p className="muted">Loading…</p>;
  if (query.isError) return <p className="muted">Couldn't load your invoice details.</p>;
  if (!query.data) return <p className="muted">Invoices aren't switched on for your account yet.</p>;
  const { profiles, max } = query.data;
  const profile = profiles.find((p) => profileKey(p) === activeId) ?? profiles[0];
  const many = profiles.length > 1;

  const switchTo = (id: string) => {
    if (id === profileKey(profile)) return;
    if (dirty.current && !window.confirm("Leave without saving?\n\nYour changes to this profile aren't saved yet.")) return;
    dirty.current = false;
    setMessage(null);
    setActiveId(id);
  };
  async function add() {
    const label = (adding ?? "").trim();
    if (!label) { setMessage({ kind: "error", text: "Give the new profile a name, e.g. Noah." }); return; }
    setAddBusy(true); setMessage(null);
    try {
      const { profile: created } = await api<{ profile: InvoiceProfile }>("/api/invoice-profiles", { method: "POST", body: { label } });
      queryClient.setQueryData(["invoice-profiles"], (old: typeof query.data) => (old ? { ...old, profiles: [...old.profiles, created] } : old));
      setAdding(null);
      dirty.current = false;
      setActiveId(profileKey(created));
      setMessage({ kind: "ok", text: `"${created.name}" added. Fill it in and save.` });
    } catch (e) {
      setMessage({ kind: "error", text: e instanceof ApiError && e.code === "TOO_MANY_PROFILES" ? `You can have up to ${max} profiles.` : (e instanceof ApiError && typeof e.data?.message === "string" ? e.data.message : "Couldn't add the profile. Try again.") });
    } finally {
      setAddBusy(false);
    }
  }
  async function remove() {
    if (profile.isMain || profileKey(profile) === "main") return;
    if (!window.confirm(`Remove "${profile.name}"?\n\nInvoices you already made with it keep its details.`)) return;
    try {
      await api(`/api/invoice-profiles/${encodeURIComponent(profileKey(profile))}`, { method: "DELETE" });
      queryClient.setQueryData(["invoice-profiles"], (old: typeof query.data) => (old ? { ...old, profiles: old.profiles.filter((p) => profileKey(p) !== profileKey(profile)) } : old));
      dirty.current = false;
      setActiveId("main");
      setMessage({ kind: "ok", text: "Profile removed." });
    } catch {
      setMessage({ kind: "error", text: "Couldn't remove it. Try again." });
    }
  }

  return (
    <>
      <div className="idf-tabs" role="tablist" aria-label="Invoice profiles">
        {profiles.map((p) => (
          <button key={profileKey(p)} role="tab" aria-selected={p === profile} className={`idf-tab ${p === profile ? "on" : ""}`} onClick={() => switchTo(profileKey(p))}>
            {p.logoUrl ? <img src={p.logoUrl} alt="" /> : <Monogram name={p.name || "?"} size={20} />}
            <span>{p.name}</span>
            {p.isMain && many ? <small>Main</small> : null}
          </button>
        ))}
        {adding === null
          ? profiles.length < max ? <button className="idf-add" onClick={() => { setAdding(""); setMessage(null); }}><Plus />Add another profile</button> : null
          : <form className="idf-add-form" onSubmit={(e) => { e.preventDefault(); void add(); }}>
            <input className="field" autoFocus value={adding} maxLength={LABEL_MAX} placeholder="Name it, e.g. Noah" aria-label="New profile name" onChange={(e) => setAdding(e.target.value)} />
            <button className="btn honey" type="submit" disabled={addBusy}>{addBusy ? <Loader2 className="spin" /> : null}Add</button>
            <button className="btn" type="button" onClick={() => setAdding(null)}>Cancel</button>
          </form>}
      </div>
      {many ? <p className="faint idf-tabs-hint">Pick which profile to use under From on each invoice. New invoices start with your main profile.</p> : null}
      {message ? <p className={`idf-tabs-hint ${message.kind === "error" ? "late-text" : "muted"}`}>{message.text}</p> : null}
      <div className="set-card idf-card">
        <InvoiceDetailsForm key={profileKey(profile)} profile={profile} profileId={profileKey(profile)} showLabel={many || profileKey(profile) !== "main"}
          onDirty={() => { dirty.current = true; }} onSaved={() => { dirty.current = false; }} onRemove={profileKey(profile) !== "main" ? () => void remove() : undefined} />
      </div>
    </>
  );
}

export function InvoiceDetailsForm({ profile, onSaved, compact, profileId, showLabel, onDirty, onRemove }: {
  profile: InvoiceProfile; onSaved?: (p: InvoiceProfile) => void; compact?: boolean;
  /** Saves through /api/invoice-profiles/<id>; without it, the main profile through /api/invoice-profile. */
  profileId?: string; showLabel?: boolean; onDirty?: () => void; onRemove?: () => void;
}) {
  const isMain = !profileId || profileId === "main";
  const [form, setForm] = useState<Form>(() => formFrom(profile));
  const [logoUrl, setLogoUrl] = useState(profile.logoUrl);
  const [bankDirty, setBankDirty] = useState({ routing: false, account: false });
  const [accountFocused, setAccountFocused] = useState(false);
  const [saving, setSaving] = useState(false);
  const [logoBusy, setLogoBusy] = useState(false);
  const [status, setStatus] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const picker = useRef<HTMLInputElement>(null);
  const set = <K extends keyof Form>(key: K, value: Form[K]) => { setForm((f) => ({ ...f, [key]: value })); setStatus(null); onDirty?.(); };

  async function put(body: Record<string, unknown>) {
    try {
      const path = profileId ? `/api/invoice-profiles/${encodeURIComponent(profileId)}` : "/api/invoice-profile";
      const { profile: saved } = await api<{ profile: InvoiceProfile }>(path, { method: "PUT", body });
      if (isMain) queryClient.setQueryData(["invoice-profile"], (old: InvoiceProfile | null | undefined) => ({ ...old, ...saved }));
      queryClient.setQueryData(["invoice-profiles"], (old: { profiles: InvoiceProfile[] } | null | undefined) => (old ? { ...old, profiles: old.profiles.map((p) => ((p.id ?? "main") === (saved.id ?? profileId ?? "main") ? saved : p)) } : old));
      // A deal's invoice lists the profiles for its From picker.
      void queryClient.invalidateQueries({ queryKey: ["hub", "invoice"] });
      setLogoUrl(saved.logoUrl);
      return saved;
    } catch (e) {
      setStatus({ kind: "error", text: (e instanceof ApiError && typeof e.data?.message === "string" ? e.data.message : null) ?? "Couldn't save. Try again." });
      return null;
    }
  }

  async function chooseLogo(file: File | undefined) {
    if (!file) return;
    if (!LOGO_TYPES.includes(file.type)) { setStatus({ kind: "error", text: "Your logo can be a PNG, JPG or WebP image." }); return; }
    if (file.size > 5 * 1024 * 1024) { setStatus({ kind: "error", text: "That image is over 5 MB." }); return; }
    setLogoBusy(true); setStatus(null);
    const userId = (await ch.auth.session()).user?.id;
    const up = await ch.files.upload({ route: "/api/invoice-profile/logo/upload", name: `invoice-logos/${userId}/${file.name.replace(/[^\w.-]+/g, "-")}`, type: file.type, bytes: await file.arrayBuffer(), access: "private" });
    if (up.ok) await put({ logoBlobPathname: up.pathname });
    else setStatus({ kind: "error", text: (up.error === "rate_limited" && up.message) || "That image didn't upload. Try again." });
    setLogoBusy(false);
  }

  async function save() {
    if (saving) return;
    const nextNumber = Number(form.nextNumber);
    if (isMain && (!Number.isInteger(nextNumber) || nextNumber < 1 || nextNumber > 99_999_999)) { setStatus({ kind: "error", text: "Next number must be a whole number." }); return; }
    if (!isMain && !form.label.trim()) { setStatus({ kind: "error", text: "Give this profile a name, e.g. Noah." }); return; }
    if (!form.businessName.trim()) { setStatus({ kind: "error", text: "Add your business name. It's the top of every invoice." }); return; }
    if (!form.email.trim()) { setStatus({ kind: "error", text: "Add a billing email. Brands reply there." }); return; }
    setSaving(true); setStatus(null);
    const { bankRouting, bankAccount, defaultTermsDays, numberPrefix, nextNumber: _next, label, ...rest } = form;
    const saved = await put({
      ...rest,
      // Shared by every profile: only the main one sets them. The old route has no label.
      ...(isMain ? { defaultTermsDays, numberPrefix, nextNumber } : {}),
      ...(profileId ? { label: label.trim() } : {}),
      ...(bankDirty.routing ? { bankRouting } : {}), ...(bankDirty.account ? { bankAccount } : {}),
    });
    setSaving(false);
    if (!saved) return;
    setForm(formFrom(saved));
    setBankDirty({ routing: false, account: false });
    setStatus({ kind: "ok", text: isMain ? "Saved. New invoices start with these details." : `Saved. Pick "${saved.name}" under From on any invoice.` });
    onSaved?.(saved);
  }

  const maskedAccount = accountFocused || bankDirty.account || !form.bankAccount ? form.bankAccount : `•••• ${form.bankAccount.slice(-4)}`;
  const text = (key: keyof Form, label: string, max: number, extra: Partial<React.InputHTMLAttributes<HTMLInputElement>> = {}) => (
    <label>{label}<input className="field" value={String(form[key])} maxLength={max} onChange={(e) => set(key, e.target.value as never)} {...extra} /></label>
  );
  const method = (key: "paypal" | "zelle" | "cashapp", label: string, placeholder: string, max: number) => (
    <div className="idf-method">
      <button type="button" role="checkbox" aria-checked={form[`${key}On`]} aria-label={`Show ${label} on invoices`} className={`idf-check ${form[`${key}On`] ? "on" : ""}`} onClick={() => set(`${key}On`, !form[`${key}On`])}>{form[`${key}On`] ? <Check /> : null}</button>
      <b>{label}</b>
      <input className="field" value={form[key]} maxLength={max} placeholder={placeholder} onChange={(e) => { set(key, e.target.value); if (e.target.value && !form[`${key}On`]) set(`${key}On`, true); }} />
    </div>
  );

  return (
    <div className={`idf ${compact ? "compact" : ""}`}>
      <section>
        <h3>Your business</h3>
        <p className="faint">Shown at the top of every invoice.</p>
        {showLabel ? <label>Profile name{isMain ? " · optional" : ""}<input className="field" value={form.label} maxLength={LABEL_MAX} placeholder={isMain ? "e.g. Kinzi" : "e.g. Noah"} onChange={(e) => set("label", e.target.value)} /><small className="faint">Only you see this, on the tabs and the From picker.</small></label> : null}
        <div className="idf-logo">
          {logoUrl ? <img src={logoUrl} alt="" /> : <span className="idf-logo-empty"><Upload /></span>}
          <div><b>Logo</b><small className="faint">PNG, JPG or WebP · square works best</small></div>
          <span className="row" style={{ gap: 6, marginLeft: "auto" }}>
            <button type="button" className="btn" disabled={logoBusy} onClick={() => picker.current?.click()}>{logoBusy ? <Loader2 className="spin" /> : null}{logoUrl ? "Change" : "Upload"}</button>
            {logoUrl ? <button type="button" className="btn" disabled={logoBusy} onClick={async () => { setLogoBusy(true); await put({ logoBlobPathname: null }); setLogoBusy(false); }}><X />Remove</button> : null}
          </span>
          <input ref={picker} type="file" accept={LOGO_TYPES.join(",")} hidden onChange={(e) => { void chooseLogo(e.target.files?.[0]); e.target.value = ""; }} />
        </div>
        <div className="idf-grid two">{text("businessName", "Business name", 120)}{text("ownerName", "Your name", 120)}</div>
        {text("street", "Street address", 200)}
        <div className="idf-grid three">{text("city", "City", 100)}{text("region", "State", 60)}{text("postalCode", "ZIP", 20)}</div>
        <label>Billing email<input className="field" type="email" value={form.email} maxLength={254} onChange={(e) => set("email", e.target.value)} /><small className="faint">Brands reply here when you email an invoice.</small></label>
      </section>
      <section>
        <h3>How brands pay you</h3>
        <p className="faint">Pick what to show. You can hide one on any invoice.</p>
        <div className="idf-method bank">
          <button type="button" role="checkbox" aria-checked={form.bankOn} aria-label="Show bank transfer on invoices" className={`idf-check ${form.bankOn ? "on" : ""}`} onClick={() => set("bankOn", !form.bankOn)}>{form.bankOn ? <Check /> : null}</button>
          <b>Bank transfer</b>
          <div className="idf-grid three">
            {text("bankName", "Bank", 120)}
            <label>Routing number<input className="field" value={form.bankRouting} maxLength={40} inputMode="numeric" autoComplete="off" onChange={(e) => { set("bankRouting", e.target.value); setBankDirty((d) => ({ ...d, routing: true })); }} /></label>
            <label>Account number<input className="field" value={maskedAccount} maxLength={40} inputMode="numeric" autoComplete="off" onFocus={() => setAccountFocused(true)} onBlur={() => setAccountFocused(false)} onChange={(e) => { set("bankAccount", e.target.value); setBankDirty((d) => ({ ...d, account: true })); }} /></label>
          </div>
        </div>
        {method("paypal", "PayPal", "PayPal email", 254)}
        {method("zelle", "Zelle", "Email or phone", 254)}
        {method("cashapp", "Cash App", "$cashtag", 60)}
      </section>
      <section>
        <h3>{isMain ? "Defaults" : "Note"}</h3>
        <p className="faint">{isMain ? "Used when a deal doesn't say otherwise." : "Invoice numbers and payment terms are shared by all your profiles; change them on your main profile."}</p>
        {isMain ? <div className="idf-grid three">
          <label>Payment terms
            <select className="field" value={form.defaultTermsDays} onChange={(e) => set("defaultTermsDays", Number(e.target.value))}>
              {[...new Set([...TERMS, form.defaultTermsDays])].sort((a, b) => a - b).map((d) => <option key={d} value={d}>{termsLabel(d)}</option>)}
            </select>
          </label>
          {text("numberPrefix", "Number prefix", 12)}
          <label>Next number<input className="field" value={form.nextNumber} inputMode="numeric" maxLength={8} onChange={(e) => set("nextNumber", e.target.value.replace(/\D/g, ""))} /></label>
        </div> : null}
        <label>Note at the bottom · optional<textarea className="field area" value={form.note} maxLength={500} onChange={(e) => set("note", e.target.value)} /></label>
      </section>
      <div className="idf-foot">
        {onRemove ? <button className="btn idf-remove" onClick={onRemove}><Trash2 />Remove this profile</button> : null}
        {status ? <span className={status.kind === "error" ? "late-text" : "muted"}>{status.text}</span> : null}
        <button className="btn honey" disabled={saving} onClick={() => void save()}>{saving ? <Loader2 className="spin" /> : null}{isMain ? "Save details" : `Save ${form.label.trim() || "profile"}`}</button>
      </div>
    </div>
  );
}
