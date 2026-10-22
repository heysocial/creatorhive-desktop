import { useEffect, useMemo, useRef, useState } from "react";
import { Loader2, Search, X } from "lucide-react";
import { api, keys, queryClient, type Conversation, type Workspace } from "../lib/api";
import { useMembers, type Member } from "../lib/community";
import { nav } from "../lib/nav";
import { Avatar } from "../lib/ui";
import { Badge } from "../views/messages/MessageRow";

/** ⌘N: pick one person (or several, for a group) and open the conversation. */
export function NewMessage({ onClose, workspace }: { onClose: () => void; workspace: Workspace }) {
  const members = useMembers().data;
  const [q, setQ] = useState("");
  const [picked, setPicked] = useState<Member[]>([]);
  const [index, setIndex] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => input.current?.focus(), []);

  const results = useMemo(() => {
    const query = q.trim().toLowerCase();
    return (members ?? [])
      .filter((m) => !picked.some((p) => p.id === m.id))
      .filter((m) => !query || m.name.toLowerCase().includes(query))
      .slice(0, 30);
  }, [members, q, picked]);

  async function start(people: Member[]) {
    if (people.length === 0 || busy) return;
    setBusy(true);
    setError(null);
    try {
      const body = people.length === 1 ? { userId: people[0].id, workspace } : { userIds: people.map((p) => p.id), workspace };
      const { conversation } = await api<{ conversation: Conversation }>("/api/dms", { method: "POST", body });
      await queryClient.invalidateQueries({ queryKey: keys.conversations(workspace) });
      onClose();
      const section = nav.get().section === "dms" ? "dms" : "home";
      nav.open({ kind: "dm", id: conversation.id }, section, workspace === "heysocial" ? "hs" : "ch");
    } catch {
      setError("You can't message them right now.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="sheet" role="dialog" aria-label="New message" style={{ width: 520 }}>
        <div className="sheet-head">New message<button className="iconbtn" onClick={onClose} aria-label="Close"><X /></button></div>
        <div className="palette-input to-line">
          <span className="faint">To:</span>
          {picked.map((p) => (
            <span key={p.id} className="to-chip">{p.name}<button onClick={() => setPicked(picked.filter((x) => x.id !== p.id))} aria-label={`Remove ${p.name}`}><X /></button></span>
          ))}
          <input ref={input} value={q} placeholder={picked.length ? "" : "Name"} onChange={(e) => { setQ(e.target.value); setIndex(0); }}
            onKeyDown={(e) => {
              if (e.key === "Escape") onClose();
              if (e.key === "ArrowDown") { e.preventDefault(); setIndex((i) => Math.min(i + 1, results.length - 1)); }
              if (e.key === "ArrowUp") { e.preventDefault(); setIndex((i) => Math.max(i - 1, 0)); }
              if (e.key === "Backspace" && !q && picked.length) setPicked(picked.slice(0, -1));
              if (e.key === "Enter") {
                e.preventDefault();
                if (q && results[index]) { setPicked([...picked, results[index]]); setQ(""); }
                else void start(picked);
              }
            }} />
          <Search />
        </div>
        <div className="palette-list" style={{ maxHeight: 360 }}>
          {!members ? <div className="palette-empty">Loading…</div> : null}
          {results.map((m, i) => (
            <button key={m.id} className={`palette-row ${i === index ? "sel" : ""}`} onMouseEnter={() => setIndex(i)}
              onClick={() => { setPicked([...picked, m]); setQ(""); input.current?.focus(); }}>
              <Avatar name={m.name} src={m.avatarUrl} seed={m.id} size={28} radius="8px" presence={m.presence} />
              <span className="t">{m.name}</span><Badge badge={m.badge} role={m.role} />
              <span className="hint">{m.headline ?? ""}</span>
            </button>
          ))}
        </div>
        <div className="palette-foot" style={{ alignItems: "center" }}>
          <span>{picked.length > 1 ? "A group conversation" : "Return adds, Return again starts"}</span>
          {error ? <span style={{ color: "#C2334D" }}>{error}</span> : null}
          <button className="btn honey" style={{ marginLeft: "auto" }} disabled={!picked.length || busy} onClick={() => void start(picked)}>
            {busy ? <Loader2 className="spin" /> : null}{picked.length > 1 ? "Start group" : "Start conversation"}
          </button>
        </div>
      </div>
    </div>
  );
}
