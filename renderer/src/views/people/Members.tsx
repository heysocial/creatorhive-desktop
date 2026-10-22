import { useMemo, useState } from "react";
import { Search, Users } from "lucide-react";
import { useMembers } from "../../lib/community";
import { nav } from "../../lib/nav";
import { Avatar } from "../../lib/ui";
import { Badge } from "../messages/MessageRow";

const ROLE_ORDER: Record<string, number> = { owner: 0, team: 1 };

export function Members() {
  const { data, isLoading, isError } = useMembers();
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<"all" | "online" | "team">("all");
  const members = useMemo(() => {
    const query = q.trim().toLowerCase();
    return (data ?? [])
      .filter((m) => !query || m.name.toLowerCase().includes(query) || (m.headline ?? "").toLowerCase().includes(query) || (m.location ?? "").toLowerCase().includes(query))
      .filter((m) => filter === "all" || (filter === "online" ? m.presence === "online" : m.role === "owner" || m.role === "team"))
      .sort((a, b) => (ROLE_ORDER[a.role] ?? 2) - (ROLE_ORDER[b.role] ?? 2) || a.name.localeCompare(b.name));
  }, [data, q, filter]);
  const online = (data ?? []).filter((m) => m.presence === "online").length;

  return (
    <div className="page">
      <div className="mhead">
        <h1><Users />Members</h1>
        <span className="sub">{data ? `${data.length.toLocaleString()} members · ${online} online` : ""}</span>
        <div className="acts">
          <div className="seg">
            <button className={filter === "all" ? "on" : ""} onClick={() => setFilter("all")}>Everyone</button>
            <button className={filter === "online" ? "on" : ""} onClick={() => setFilter("online")}>Online</button>
            <button className={filter === "team" ? "on" : ""} onClick={() => setFilter("team")}>Coaches & team</button>
          </div>
          <label className="search-inline"><Search /><input placeholder="Find someone" value={q} onChange={(e) => setQ(e.target.value)} /></label>
        </div>
      </div>
      <div className="scroll page-body">
        {isLoading ? <div className="empty-state">Loading members…</div> : null}
        {isError ? <div className="empty-state">Couldn't load members.</div> : null}
        <div className="member-grid">
          {members.map((m) => (
            <button key={m.id} className="card member" onClick={() => nav.open({ kind: "profile", id: m.id })}>
              <Avatar name={m.name} src={m.avatarUrl} seed={m.id} size={48} online={m.presence === "online"} />
              <span className="mi">
                <span className="mn"><b>{m.name}</b><Badge badge={m.badge} role={m.role} /></span>
                {m.headline ? <span className="muted">{m.headline}</span> : null}
                {m.location ? <span className="faint">{m.location}</span> : null}
              </span>
            </button>
          ))}
        </div>
        {data && members.length === 0 ? <div className="empty-state">Nobody matches “{q}”.</div> : null}
      </div>
    </div>
  );
}
