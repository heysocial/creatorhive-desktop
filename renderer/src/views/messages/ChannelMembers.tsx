import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Check, Loader2, Search, UserMinus, UserPlus, X } from "lucide-react";
import { api, keys, queryClient, type Workspace } from "../../lib/api";
import { useChannelMembers, type Member } from "../../lib/community";
import { HS_KEY } from "../../lib/heysocial";
import { Avatar } from "../../lib/ui";
import { Badge } from "./MessageRow";
import "../../styles/admin-heysocial.css";

/*
  Who is in a channel, owner and team first, as the website's Members dialog
  lists them (ChannelMembersDialog). For owner and team (`canManage`, the
  server's answer) the same sheet adds people and removes them, with the
  confirm inline on the row, as the website does. The owner can't be removed,
  and you take yourself out by leaving, not from here. Adding notifies each
  person added; removing tells them nothing.
*/

function namesFor(people: Member[]) {
  const first = (person: Member) => person.name.split(" ")[0] || person.name;
  if (people.length === 1) return first(people[0]);
  if (people.length === 2) return `${first(people[0])} and ${first(people[1])}`;
  return `${first(people[0])} and ${people.length - 1} others`;
}

function refresh(channelId: string, workspace: Workspace) {
  void queryClient.invalidateQueries({ queryKey: ["channel-members", channelId] });
  void queryClient.invalidateQueries({ queryKey: keys.channels(workspace) });
  if (workspace === "heysocial") void queryClient.invalidateQueries({ queryKey: HS_KEY });
}

export function ChannelMembers({ channelId, title, isPrivate, workspace, meId, onClose, onProfile }: {
  channelId: string;
  /** "#name". */
  title: string;
  isPrivate: boolean;
  workspace: Workspace;
  meId: string;
  onClose: () => void;
  onProfile: (id: string) => void;
}) {
  const { data, isLoading, isError } = useChannelMembers(channelId);
  const [mode, setMode] = useState<"list" | "add">("list");
  const [q, setQ] = useState("");
  const [confirming, setConfirming] = useState<string | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const key = (event: KeyboardEvent) => event.key === "Escape" && onClose();
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [onClose]);

  const canManage = Boolean(data?.canManage);
  const query = q.trim().toLowerCase();
  const shown = (data?.members ?? []).filter((m) => !query || m.name.toLowerCase().includes(query));
  const isStaff = (m: { role: string }) => m.role === "owner" || m.role === "team";
  const staff = shown.filter(isStaff);
  const others = shown.filter((m) => !isStaff(m));
  const existing = useMemo(() => new Set((data?.members ?? []).map((m) => m.id)), [data]);

  async function remove(member: Member) {
    setRemoving(member.id);
    try {
      await api(`/api/channels/${channelId}/members?userId=${encodeURIComponent(member.id)}`, { method: "DELETE" });
      queryClient.setQueryData<{ members: Member[] }>(["channel-members", channelId], (current) => current ? { ...current, members: current.members.filter((m) => m.id !== member.id) } : current);
      refresh(channelId, workspace);
      setNotice(`Removed ${member.name} from ${title}.`);
      setError(null);
    } catch (e) {
      setError((e as Error).message && !(e as Error).message.startsWith("HTTP") ? (e as Error).message : `Couldn't remove ${member.name}. Try again.`);
    } finally {
      setRemoving(null);
      setConfirming(null);
    }
  }

  const row = (m: Member, removable: boolean) => confirming === m.id ? (
    <div key={m.id} className="cm-confirm" role="group" aria-label={`Remove ${m.name}?`}>
      <span className="cm-confirm-copy">
        <b>Remove {m.name}?</b>
        <small>{isPrivate ? "They'll no longer see this private channel or its messages." : "It leaves their channel list. They can still find it, since it's public."}</small>
      </span>
      <span className="cm-confirm-acts">
        <button className="btn" disabled={removing === m.id} onClick={() => setConfirming(null)}>Cancel</button>
        <button className="btn danger" disabled={removing === m.id} onClick={() => void remove(m)}>{removing === m.id ? <Loader2 className="spin" /> : null}Remove</button>
      </span>
    </div>
  ) : (
    <div key={m.id} className="cm-row">
      <button className="palette-row" onClick={() => onProfile(m.id)}>
        <Avatar name={m.name} src={m.avatarUrl} seed={m.id} size={28} radius="8px" presence={m.presence} />
        <span className="t">{m.name}</span><Badge badge={m.badge} role={m.role} />
        {m.id === meId ? <span className="hint">You</span> : null}
      </button>
      {removable ? <button className="iconbtn cm-remove" title="Remove from channel" aria-label={`Remove ${m.name} from the channel`} onClick={() => { setNotice(null); setConfirming(m.id); }}><UserMinus /></button> : null}
    </div>
  );

  return (
    <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="sheet members-sheet cm-sheet" role="dialog" aria-label={mode === "list" ? "Members" : "Add people"}>
        <div className="sheet-head">
          <span className="cm-title">{mode === "list" ? "Members" : "Add people"}</span>
          <span className="faint">{mode === "list" ? `${isPrivate ? "Private · " : ""}${title}` : `Add people to ${title}. They'll get a notification.`}</span>
          <button className="iconbtn" onClick={onClose} aria-label="Close"><X /></button>
        </div>
        {mode === "add" ? (
          <AddPeople channelId={channelId} title={title} workspace={workspace} existing={existing} onBack={() => setMode("list")}
            onAdded={(names) => { setNotice(`Added ${names} to ${title}.`); setError(null); setMode("list"); refresh(channelId, workspace); }} />
        ) : (
          <>
            <div className="palette-input"><Search /><input autoFocus value={q} placeholder="Search members" aria-label="Search members" onChange={(e) => setQ(e.target.value)} /></div>
            {notice ? <div className="cm-notice" role="status">{notice}</div> : null}
            {error ? <div className="cm-error" role="alert">{error}</div> : null}
            <div className="palette-list">
              {canManage && !query ? (
                <button className="palette-row cm-add" onClick={() => { setNotice(null); setMode("add"); }}><span className="glyph"><UserPlus /></span><span className="t">Add people</span></button>
              ) : null}
              {isLoading ? <div className="palette-empty">Loading…</div> : null}
              {isError ? <div className="palette-empty">Couldn't load who's in this channel. Try again.</div> : null}
              {data && shown.length === 0 ? <div className="palette-empty">{query ? `No one called “${q.trim()}” here.` : "No one is in this channel yet."}</div> : null}
              {staff.length ? <div className="palette-group">Owner &amp; team</div> : null}
              {staff.map((m) => row(m, canManage && m.role !== "owner" && m.id !== meId))}
              {others.length ? <div className="palette-group">Members · {others.length}</div> : null}
              {others.map((m) => row(m, canManage && m.id !== meId))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function AddPeople({ channelId, title, workspace, existing, onBack, onAdded }: {
  channelId: string; title: string; workspace: Workspace; existing: Set<string>; onBack: () => void; onAdded: (names: string) => void;
}) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Member[]>([]);
  const [selected, setSelected] = useState<Member[]>([]);
  const [searching, setSearching] = useState(false);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const request = useRef(0);

  useEffect(() => {
    const id = ++request.current;
    const timer = window.setTimeout(() => {
      setSearching(true);
      const params = new URLSearchParams({ view: "picker", limit: "40" });
      // Hey Social Inc. adds only its own people (the server refuses anyone else too).
      if (workspace === "heysocial") params.set("workspace", "heysocial");
      if (q.trim()) params.set("q", q.trim());
      api<{ members: Member[] }>(`/api/members?${params.toString()}`)
        .then((data) => { if (request.current === id) { setResults(data.members ?? []); setError(null); } })
        .catch(() => { if (request.current === id) setError("Couldn't search members. Try again."); })
        .finally(() => { if (request.current === id) setSearching(false); });
    }, 250);
    return () => window.clearTimeout(timer);
  }, [q, workspace]);

  const picked = new Set(selected.map((m) => m.id));
  function toggle(member: Member) {
    if (existing.has(member.id)) return;
    setError(null);
    setSelected((current) => current.some((m) => m.id === member.id) ? current.filter((m) => m.id !== member.id) : [...current, member]);
  }

  async function add() {
    if (adding || selected.length === 0) return;
    setAdding(true);
    setError(null);
    try {
      await api(`/api/channels/${channelId}/members`, { method: "POST", body: { userIds: selected.map((m) => m.id) } });
      onAdded(namesFor(selected));
    } catch (e) {
      setError((e as Error).message && !(e as Error).message.startsWith("HTTP") ? (e as Error).message : `Couldn't add them to ${title}. Try again.`);
      setAdding(false);
    }
  }

  return (
    <>
      <button className="cm-back" onClick={onBack}><ArrowLeft />Members</button>
      {selected.length ? (
        <div className="cm-chips" aria-label="People to add">
          {selected.map((m) => (
            <button key={m.id} className="cm-chip" onClick={() => toggle(m)} aria-label={`Remove ${m.name}`}>
              <Avatar name={m.name} src={m.avatarUrl} seed={m.id} size={20} radius="50%" /><span>{m.name}</span><X />
            </button>
          ))}
        </div>
      ) : null}
      <div className="palette-input"><Search /><input autoFocus value={q} placeholder="Search everyone" aria-label="Search everyone" onChange={(e) => setQ(e.target.value)} />{searching ? <Loader2 className="spin" /> : null}</div>
      {error ? <div className="cm-error" role="alert">{error}</div> : null}
      <div className="palette-list" aria-live="polite">
        {results.map((m) => {
          const inChannel = existing.has(m.id);
          const checked = picked.has(m.id);
          return (
            <button key={m.id} className="palette-row cm-pick" aria-pressed={checked} disabled={inChannel} onClick={() => toggle(m)}>
              <Avatar name={m.name} src={m.avatarUrl} seed={m.id} size={28} radius="8px" />
              <span className="t">{m.name}</span><Badge badge={m.badge} role={m.role} />
              {inChannel ? <span className="hint">In channel</span> : <span className={`cm-check ${checked ? "on" : ""}`} aria-hidden>{checked ? <Check /> : null}</span>}
            </button>
          );
        })}
        {!searching && results.length === 0 ? <div className="palette-empty">{q.trim() ? `No one matches “${q.trim()}”.` : "No one to add."}</div> : null}
      </div>
      <div className="cm-foot">
        <button className="btn honey cm-submit" disabled={selected.length === 0 || adding} onClick={() => void add()}>
          {adding ? <Loader2 className="spin" /> : null}{selected.length ? `Add ${selected.length} to ${title}` : "Add people"}
        </button>
      </div>
    </>
  );
}
