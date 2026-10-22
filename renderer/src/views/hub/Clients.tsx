import { useMemo, useState } from "react";
import { ArrowUpDown, Copy, Download, Link2, Mail, Pencil, Plus, Search, Unlink } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { ch } from "../../lib/bridge";
import { api, ApiError, queryClient } from "../../lib/api";
import { monDay, type DealStatus } from "../../lib/hub";
import { money } from "../../lib/format";
import { Modal, Monogram, StagePill } from "./parts";
import { openDeal } from "./Deals";
import { openDealForm } from "./DealForm";
import { openExport } from "./Export";

interface ClientDeal { id: string; brand_name: string; deal_type: string; status: DealStatus; amount_usd: number; paid_at: string | null; created_at: string }
interface Client {
  key: string; id: string | null; brand_name: string; contact_name: string | null; email: string | null; phone: string | null; notes: string | null;
  other_emails: string[]; brands: { key: string; name: string; deal_count: number; earned_usd: number; via: "self" | "look_alike" | "linked" }[];
  deals: ClientDeal[]; deal_count: number; earned_usd: number; in_play_usd: number; last_paid_at: string | null; first_deal_at: string | null;
}
interface Notice { contact_key: string; brand: { key: string; name: string; deal_count: number; earned_usd: number }; into: { key: string; name: string } }
interface Contacts { contacts: Client[]; notices: Notice[] }

const KEY = ["hub", "contacts"];
const setContacts = (data: Partial<Contacts>) => queryClient.setQueryData<Contacts>(KEY, (old) => old && ({ ...old, ...data }));

function lastDeal(c: Client) {
  const d = c.deals[0];
  if (!d) return null;
  return { deal: d, when: d.status === "completed" && d.paid_at ? `Paid ${monDay(d.paid_at)}` : `Started ${monDay(d.created_at)}` };
}

function ContactDialog({ client, onClose, onSaved }: { client: Client | null; onClose: () => void; onSaved: (key: string) => void }) {
  const [v, setV] = useState({ brand_name: client?.brand_name ?? "", contact_name: client?.contact_name ?? "", email: client?.email ?? "", phone: client?.phone ?? "", notes: client?.notes ?? "" });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function save() {
    setBusy(true);
    setError(null);
    try {
      const result = await api<Contacts & { contact: Client }>("/api/hub/contacts", { method: "POST", body: { ...(client ? { key: client.key } : {}), ...v } });
      setContacts(result);
      onSaved(result.contact.key);
      onClose();
    } catch (e) {
      if (e instanceof ApiError && e.code === "exists" && e.data?.contact) { onSaved((e.data.contact as Client).key); onClose(); return; }
      setError(e instanceof ApiError && e.code && !e.code.startsWith("HTTP") ? e.code : "Couldn't save.");
    } finally {
      setBusy(false);
    }
  }
  const field = (key: keyof typeof v, label: string, max: number, type = "text") => (
    <><label className="flabel">{label}</label><input className="field" type={type} value={v[key]} maxLength={max} onChange={(e) => setV({ ...v, [key]: e.target.value })} /></>
  );
  return (
    <Modal title={client ? `Edit ${client.brand_name}` : "Add contact"} onClose={onClose} width={480}
      foot={<>{error ? <span className="form-error">{error}</span> : null}<button className="btn" onClick={onClose}>Cancel</button><button className="btn honey" disabled={!v.brand_name.trim() || busy} onClick={() => void save()}>Save</button></>}>
      {field("brand_name", "Brand", 120)}
      {field("contact_name", "Name", 120)}
      {field("email", "Email", 254, "email")}
      {field("phone", "Phone", 40)}
      <label className="flabel">Notes</label><textarea className="field area" value={v.notes} maxLength={4000} onChange={(e) => setV({ ...v, notes: e.target.value })} />
    </Modal>
  );
}

export function Clients() {
  const { data, isLoading, isError } = useQuery({ queryKey: KEY, queryFn: () => api<Contacts>("/api/hub/contacts") });
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<"all" | "paid" | "unpaid">("all");
  const [sort, setSort] = useState<"earned" | "last" | "az">("earned");
  const [selected, setSelected] = useState<string | null>(null);
  const [editing, setEditing] = useState<Client | null | "new">(null);
  const [undo, setUndo] = useState<Notice | null>(null);

  const clients = data?.contacts ?? [];
  const list = useMemo(() => {
    const query = q.trim().toLowerCase();
    const filtered = clients
      .filter((c) => filter === "all" || (filter === "paid" ? c.earned_usd > 0 : c.earned_usd === 0))
      .filter((c) => !query || [c.brand_name, c.contact_name, c.email, c.phone, c.notes, ...c.other_emails, ...c.brands.map((b) => b.name)].some((x) => x?.toLowerCase().includes(query)));
    if (sort === "az") return [...filtered].sort((a, b) => a.brand_name.localeCompare(b.brand_name));
    const when = (c: Client) => new Date(c.deals[0]?.paid_at ?? c.deals[0]?.created_at ?? 0).getTime();
    if (sort === "last") return [...filtered].sort((a, b) => when(b) - when(a));
    return filtered;
  }, [clients, q, filter, sort]);
  const earned = clients.reduce((t, c) => t + c.earned_usd, 0);
  const current = clients.find((c) => c.key === selected) ?? null;
  const notice = data?.notices[0];

  async function link(action: "keep" | "split" | "link", brand: string, into?: string) {
    const result = await api<Contacts>("/api/hub/contacts/links", { method: "POST", body: { action, brand, into } }).catch(() => null);
    if (result) setContacts(result);
  }

  async function sortMenu() {
    const choice = await ch.menu.popup([{ id: "earned", label: "Total earned", checked: sort === "earned" }, { id: "last", label: "Last deal", checked: sort === "last" }, { id: "az", label: "Brand A–Z", checked: sort === "az" }]);
    if (choice) setSort(choice as typeof sort);
  }

  return (
    <div className="page">
      <div className="mhead">
        <h1>Past clients</h1><span className="sub">{clients.length} brands · {money(earned)} earned</span>
        <div className="acts">
          <button className="btn" onClick={() => openExport()}><Download />Export</button>
          <button className="btn honey" onClick={() => setEditing("new")}><Plus />Add contact</button>
        </div>
      </div>
      <div className="clients-bar">
        <label className="search-inline wide"><Search /><input placeholder="Search names, brands, emails, phone or notes" value={q} onChange={(e) => setQ(e.target.value)} /></label>
        <div className="seg">
          <button className={filter === "all" ? "on" : ""} onClick={() => setFilter("all")}>All {clients.length}</button>
          <button className={filter === "paid" ? "on" : ""} onClick={() => setFilter("paid")}>Paid you {clients.filter((c) => c.earned_usd > 0).length}</button>
          <button className={filter === "unpaid" ? "on" : ""} onClick={() => setFilter("unpaid")}>Not paid yet {clients.filter((c) => c.earned_usd === 0).length}</button>
        </div>
        <button className="btn" style={{ marginLeft: "auto" }} onClick={() => void sortMenu()}><ArrowUpDown />{sort === "earned" ? "Total earned" : sort === "last" ? "Last deal" : "Brand A–Z"}</button>
      </div>
      {notice ? (
        <div className="notice"><Link2 /><span><b>Linked automatically.</b> “{notice.brand.name}” ({notice.brand.deal_count} {notice.brand.deal_count === 1 ? "deal" : "deals"}, {money(notice.brand.earned_usd)} paid) looks like <b>{notice.into.name}</b>, so they're one client.</span>
          <button className="btn" onClick={() => { void link("split", notice.brand.key, notice.into.key); setUndo(notice); }}>Change</button>
          <button className="btn honey" onClick={() => void link("keep", notice.brand.key, notice.into.key)}>Got it</button>
        </div>
      ) : null}
      {undo ? <div className="notice quiet"><span>“{undo.brand.name}” is its own client now.</span><button className="btn" onClick={() => { void link("link", undo.brand.key, undo.into.key); setUndo(null); }}>Undo</button><button className="iconbtn" onClick={() => setUndo(null)}>✕</button></div> : null}
      <div className={`clients-body ${current ? "with-side" : ""}`}>
        <div className="clients-table scroll">
          <div className="ct-row head"><span>Brand</span><span>Name</span><span>Email</span><span>Phone</span><span>Notes</span><span>Last deal</span><span className="r">Total earned</span></div>
          {isLoading ? <div className="empty-state">Loading…</div> : null}
          {isError ? <div className="empty-state">Couldn't load your clients.</div> : null}
          {data && clients.length === 0 ? <div className="empty-state"><div><b>No past clients yet</b><p className="muted">Brands show up here once a deal is secured and has a contact, or when you add one.</p></div></div> : null}
          {list.map((c) => {
            const last = lastDeal(c);
            return (
              <div key={c.key} className={`ct-row ${selected === c.key ? "on" : ""}`} onClick={() => setSelected(c.key)} role="button">
                <span className="ct-brand"><Monogram name={c.brand_name} size={24} /><span><b>{c.brand_name}</b>{c.brands.length > 1 ? <small className="faint">also {c.brands.filter((b) => b.via !== "self").map((b) => b.name).join(", ")}</small> : null}</span></span>
                <span>{c.contact_name ?? "—"}</span>
                <span className="ct-email">{c.email ? <>{c.email}<button className="iconbtn sm" title="Copy" onClick={(e) => { e.stopPropagation(); void navigator.clipboard.writeText(c.email!); }}><Copy /></button></> : "—"}</span>
                <span>{c.phone ?? "—"}</span>
                <span className="ct-notes">{c.notes ?? ""}</span>
                <span>{last ? <>{money(last.deal.amount_usd)} <StagePill status={last.deal.status} small /><small className="faint">{last.when}</small></> : "—"}</span>
                <span className="r"><b>{money(c.earned_usd)}</b>{c.in_play_usd ? <small className="faint">{money(c.in_play_usd)} in play</small> : null}</span>
              </div>
            );
          })}
          {data && list.length ? <p className="faint table-foot">Showing {list.length} of {clients.length} · filled in from the contact details on your deals and the contacts you save</p> : null}
        </div>
        {current ? (
          <aside className="client-side scroll">
            <div className="cs-head"><Monogram name={current.brand_name} size={44} /><span><b>{current.brand_name}</b>{current.first_deal_at ? <small className="faint">Client since {new Date(current.first_deal_at).toLocaleDateString("en-US", { month: "short", year: "numeric" })}</small> : null}</span></div>
            <div className="cs-money"><div><small className="muted">Earned</small><b>{money(current.earned_usd)}</b></div><div><small className="muted">In play</small><b>{money(current.in_play_usd)}</b></div></div>
            {current.contact_name ? <div className="cs-field"><small>Name</small><span>{current.contact_name}</span></div> : null}
            {current.email ? <div className="cs-field"><small>Email</small><span>{current.email}<button className="iconbtn sm" onClick={() => ch.app.openExternal(`mailto:${current.email}`)}><Mail /></button></span></div> : null}
            {current.phone ? <div className="cs-field"><small>Phone</small><span>{current.phone}</span></div> : null}
            {current.notes ? <div className="cs-field"><small>Notes</small><span style={{ whiteSpace: "pre-wrap" }}>{current.notes}</span></div> : null}
            <div className="section-label" style={{ marginTop: 10 }}>Past deals</div>
            {current.deals.map((d) => (
              <button key={d.id} className="cs-deal" onClick={() => openDeal(d.id)}>
                <span>{d.deal_type === "retainer" ? "Retainer" : d.deal_type === "tiktok_shop" ? "TikTok Shop" : d.deal_type === "ugc" ? "UGC" : "Other"} · {new Date(d.paid_at ?? d.created_at).toLocaleDateString("en-US", { month: "short" })}</span>
                <StagePill status={d.status} small /><b>{money(d.amount_usd)}</b>
              </button>
            ))}
            <button className="link add" onClick={() => openDealForm({ brand: current.brand_name })}>+ New deal for {current.brand_name}</button>
            {current.brands.filter((b) => b.via !== "self").length ? (
              <>
                <div className="section-label" style={{ marginTop: 10 }}>Linked brands</div>
                {current.brands.filter((b) => b.via !== "self").map((b) => (
                  <div key={b.key} className="cs-link"><span>{b.name}</span><span className="faint">{b.deal_count} · {money(b.earned_usd)}</span>
                    <button className="btn" onClick={() => void link("split", b.key, current.key)}><Unlink />Unlink</button></div>
                ))}
              </>
            ) : null}
            <div className="cs-foot">
              <button className="btn" onClick={() => setEditing(current)}><Pencil />Edit</button>
              <button className="btn" onClick={async () => {
                if (!window.confirm(`Remove ${current.brand_name} from Past clients? Its deals stay.`)) return;
                const result = await api<Contacts>(`/api/hub/contacts?key=${encodeURIComponent(current.key)}`, { method: "DELETE" }).catch(() => null);
                if (result) { setContacts(result); setSelected(null); }
              }}>Remove</button>
            </div>
          </aside>
        ) : null}
      </div>
      {editing ? <ContactDialog client={editing === "new" ? null : editing} onClose={() => setEditing(null)} onSaved={setSelected} /> : null}
    </div>
  );
}
