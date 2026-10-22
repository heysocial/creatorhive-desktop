import { useEffect, useState } from "react";
import { Download, Loader2 } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { ch } from "../../lib/bridge";
import { api } from "../../lib/api";
import { localToday, withTz } from "../../lib/hub";
import { money, plural } from "../../lib/format";
import { Modal } from "./parts";

interface Summary {
  years: number[];
  all: { count: number; totalUsd: number };
  year: { year: number; count: number; totalUsd: number };
  dates: { from: string; to: string; count: number; totalUsd: number } | null;
  period: { range: string; label: string; count: number; totalUsd: number } | null;
}
type Scope = "all" | "year" | "dates" | "period";

let open: (opts: { range?: string } | null) => void = () => {};
/** ⇧⌘E, the Export… buttons and the Hub sidebar all open this. */
export const openExport = (opts: { range?: string } = {}) => open(opts);

function ExportDialog({ range, onClose }: { range?: string; onClose: () => void }) {
  const thisYear = new Date().getFullYear();
  const [scope, setScope] = useState<Scope>(range ? "period" : "all");
  const [year, setYear] = useState(thisYear);
  const [from, setFrom] = useState(`${thisYear}-01-01`);
  const [to, setTo] = useState(localToday());
  const [format, setFormat] = useState<"xlsx" | "csv">("xlsx");
  const [saving, setSaving] = useState(false);
  const params = new URLSearchParams({ year: String(year), from, to, ...(range ? { range } : {}) });
  const { data } = useQuery({
    queryKey: ["hub", "export-summary", params.toString()],
    queryFn: () => api<Summary>(withTz(`/api/hub/export?summary=1&${params}`)),
  });
  const picked = scope === "all" ? data?.all : scope === "year" ? data?.year : scope === "dates" ? data?.dates : data?.period;
  const count = picked?.count ?? 0;

  async function save() {
    setSaving(true);
    const q = new URLSearchParams({ scope, format });
    if (scope === "year") q.set("year", String(year));
    if (scope === "dates") { q.set("from", from); q.set("to", to); }
    if (scope === "period" && range) q.set("range", range);
    const name = `CreatorHive deals – ${scope === "year" ? year : scope === "dates" ? `${from} to ${to}` : scope === "period" ? data?.period?.label ?? "period" : "all"} – ${localToday()}.${format}`;
    await ch.files.save(withTz(`/api/hub/export?${q}`), name);
    setSaving(false);
    onClose();
  }

  const option = (id: Scope, label: string, right: React.ReactNode) => (
    <label className={`radio-row ${scope === id ? "on" : ""}`}>
      <input type="radio" name="scope" checked={scope === id} onChange={() => setScope(id)} />
      <span>{label}</span><span className="faint">{right}</span>
    </label>
  );

  return (
    <Modal title="Export deals" onClose={onClose} width={500}
      foot={<><button className="btn" onClick={onClose}>Cancel</button>
        <button className="btn honey" disabled={!count || saving} onClick={() => void save()}>{saving ? <Loader2 className="spin" /> : <Download />}{count ? `Save ${plural(count, "deal")}…` : "No deals to export"}</button></>}>
      <div className="section-label">Which deals</div>
      {range && data?.period ? option("period", `This period: ${data.period.label}`, `${plural(data.period.count, "deal")} · ${money(data.period.totalUsd)}`) : null}
      {option("all", "All deals", data ? `${plural(data.all.count, "deal")} · ${money(data.all.totalUsd)}` : "…")}
      {option("year", "Paid in a tax year", (
        <span className="inline-pick">
          <select value={year} onChange={(e) => { setYear(Number(e.target.value)); setScope("year"); }}>{(data?.years ?? [thisYear]).map((y) => <option key={y} value={y}>{y}</option>)}</select>
          {data ? ` · ${plural(data.year.count, "deal")}` : ""}
        </span>
      ))}
      {option("dates", "Choose dates", (
        <span className="inline-pick">
          <input type="date" value={from} max={to} onChange={(e) => { setFrom(e.target.value); setScope("dates"); }} /> – <input type="date" value={to} min={from} onChange={(e) => { setTo(e.target.value); setScope("dates"); }} />
          {data?.dates ? ` · ${plural(data.dates.count, "deal")}` : ""}
        </span>
      ))}
      <div className="section-label" style={{ marginTop: 14 }}>File type</div>
      <div className="seg"><button className={format === "xlsx" ? "on" : ""} onClick={() => setFormat("xlsx")}>Excel (.xlsx)</button><button className={format === "csv" ? "on" : ""} onClick={() => setFormat("csv")}>CSV</button></div>
      <p className="hint">{format === "xlsx" ? "Sheets: Deals (with \"Added by\" in a Shared Hub), Summary and Contacts." : "Your deals, one row each."}</p>
    </Modal>
  );
}

export function ExportHost() {
  const [opts, setOpts] = useState<{ range?: string } | null>(null);
  useEffect(() => { open = setOpts; return () => { open = () => {}; }; }, []);
  return opts ? <ExportDialog range={opts.range} onClose={() => setOpts(null)} /> : null;
}
