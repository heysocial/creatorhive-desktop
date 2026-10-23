import { useState } from "react";
import { Check } from "lucide-react";
import { api, queryClient } from "../../lib/api";
import { HS_KEY, THEMES, refreshHs, useHsSidebar, type HsSidebar } from "../../lib/heysocial";
import { Modal } from "../hub/parts";

/*
  Hey Social Inc. → Preferences (the website's /hey-social/settings): your
  theme and the built-in sections' titles. PATCH /api/hey-social/settings.
*/

const SECTIONS: { key: "starred" | "channels" | "dms"; name: string }[] = [
  { key: "starred", name: "Starred" },
  { key: "channels", name: "Channels" },
  { key: "dms", name: "Direct messages" },
];

export function HsPreferences({ onClose }: { onClose: () => void }) {
  const data = useHsSidebar().data;
  const [error, setError] = useState<string | null>(null);

  async function save(body: { theme?: string; builtinLabels?: Partial<Record<"starred" | "channels" | "dms", string>> }) {
    setError(null);
    // Shown at once; the server's answer settles it.
    queryClient.setQueryData<HsSidebar>(HS_KEY, (old) => (old ? { ...old, ...(body.theme ? { theme: body.theme } : {}), ...(body.builtinLabels ? { builtinLabels: { ...old.builtinLabels, ...body.builtinLabels } } : {}) } : old));
    try { await api("/api/hey-social/settings", { method: "PATCH", body }); }
    catch { setError("Couldn't save. Try again."); }
    void refreshHs();
  }

  return (
    <Modal title="Preferences" width={560} onClose={onClose}>
      <p className="muted" style={{ marginTop: 0 }}>Only you see these. They follow you to any computer you sign in on.</p>
      <div className="section-label">Theme</div>
      <p className="faint" style={{ margin: "2px 0 10px", fontSize: 12.5 }}>Colours the sidebar, top bar and rail in Hey Social Inc. Light and dark follow your app setting.</p>
      <div className="hs-themes">
        {Object.entries(THEMES).map(([id, theme]) => (
          <button key={id} className={`hs-theme ${data?.theme === id ? "on" : ""}`} onClick={() => void save({ theme: id })} aria-pressed={data?.theme === id}>
            <span className="sw" style={theme.side ? { background: theme.side, color: theme.text } : undefined}>
              <i /><i /><i />
              {data?.theme === id ? <Check className="tick" /> : null}
            </span>
            {theme.name}
          </button>
        ))}
      </div>
      <div className="section-label" style={{ marginTop: 18 }}>Section titles</div>
      <p className="faint" style={{ margin: "2px 0 10px", fontSize: 12.5 }}>Rename the built-in sections, emoji welcome. Your own sections are renamed from their ⋯ menu in the sidebar.</p>
      <div className="hs-labels">
        {SECTIONS.map((s) => (
          <label key={s.key}>
            <span className="muted">{s.name}</span>
            <input className="field" maxLength={40} placeholder={s.name} defaultValue={data?.builtinLabels[s.key] ?? ""}
              onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
              onBlur={(e) => { const value = e.target.value.trim(); if (value !== (data?.builtinLabels[s.key] ?? "")) void save({ builtinLabels: { [s.key]: value } }); }} />
          </label>
        ))}
      </div>
      {error ? <p className="late-text">{error}</p> : null}
    </Modal>
  );
}
