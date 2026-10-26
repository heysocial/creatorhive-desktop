import { useRef, useState } from "react";
import { Check, Loader2, Upload, X } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { ch } from "../../lib/bridge";
import { api, ApiError, queryClient } from "../../lib/api";

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
}
type Form = Omit<InvoiceProfile, "logoUrl" | "bankAccountLast4" | "isSetUp" | "nextNumber"> & { nextNumber: string };

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

function formFrom(p: InvoiceProfile): Form {
  const { logoUrl: _l, bankAccountLast4: _b, isSetUp: _s, nextNumber, ...rest } = p;
  return { ...rest, nextNumber: String(nextNumber) };
}

export function InvoiceDetailsForm({ profile, onSaved, compact }: { profile: InvoiceProfile; onSaved?: (p: InvoiceProfile) => void; compact?: boolean }) {
  const [form, setForm] = useState<Form>(() => formFrom(profile));
  const [logoUrl, setLogoUrl] = useState(profile.logoUrl);
  const [bankDirty, setBankDirty] = useState({ routing: false, account: false });
  const [accountFocused, setAccountFocused] = useState(false);
  const [saving, setSaving] = useState(false);
  const [logoBusy, setLogoBusy] = useState(false);
  const [status, setStatus] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const picker = useRef<HTMLInputElement>(null);
  const set = <K extends keyof Form>(key: K, value: Form[K]) => { setForm((f) => ({ ...f, [key]: value })); setStatus(null); };

  async function put(body: Record<string, unknown>) {
    try {
      const { profile: saved } = await api<{ profile: InvoiceProfile }>("/api/invoice-profile", { method: "PUT", body });
      queryClient.setQueryData(["invoice-profile"], saved);
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
    if (!Number.isInteger(nextNumber) || nextNumber < 1 || nextNumber > 99_999_999) { setStatus({ kind: "error", text: "Next number must be a whole number." }); return; }
    if (!form.businessName.trim()) { setStatus({ kind: "error", text: "Add your business name. It's the top of every invoice." }); return; }
    if (!form.email.trim()) { setStatus({ kind: "error", text: "Add a billing email. Brands reply there." }); return; }
    setSaving(true); setStatus(null);
    const { bankRouting, bankAccount, ...rest } = form;
    const saved = await put({ ...rest, nextNumber, ...(bankDirty.routing ? { bankRouting } : {}), ...(bankDirty.account ? { bankAccount } : {}) });
    setSaving(false);
    if (!saved) return;
    setForm(formFrom(saved));
    setBankDirty({ routing: false, account: false });
    setStatus({ kind: "ok", text: "Saved. New invoices start with these details." });
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
        <h3>Defaults</h3>
        <p className="faint">Used when a deal doesn't say otherwise.</p>
        <div className="idf-grid three">
          <label>Payment terms
            <select className="field" value={form.defaultTermsDays} onChange={(e) => set("defaultTermsDays", Number(e.target.value))}>
              {[...new Set([...TERMS, form.defaultTermsDays])].sort((a, b) => a - b).map((d) => <option key={d} value={d}>{termsLabel(d)}</option>)}
            </select>
          </label>
          {text("numberPrefix", "Number prefix", 12)}
          <label>Next number<input className="field" value={form.nextNumber} inputMode="numeric" maxLength={8} onChange={(e) => set("nextNumber", e.target.value.replace(/\D/g, ""))} /></label>
        </div>
        <label>Note at the bottom · optional<textarea className="field area" value={form.note} maxLength={500} onChange={(e) => set("note", e.target.value)} /></label>
      </section>
      <div className="idf-foot">
        {status ? <span className={status.kind === "error" ? "late-text" : "muted"}>{status.text}</span> : null}
        <button className="btn honey" disabled={saving} onClick={() => void save()}>{saving ? <Loader2 className="spin" /> : null}Save details</button>
      </div>
    </div>
  );
}
