import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, Search, UserMinus, UserPlus, X } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { api, ApiError, keys, queryClient, type Workspace } from "../../lib/api";
import { useChannelMembers, type Member } from "../../lib/community";
import { Avatar } from "../../lib/ui";
import { Badge } from "./MessageRow";
import "../../styles/admin-events-misc.css";

/*
  Who is in a channel, owner and team first, as the website's Members dialog
  (components/channels/ChannelMembersDialog.tsx) lists them. For owner and
  team (the server's `canManage`) it also adds people and removes them, with
  the website's questions; the route checks the role again.
*/

const errorText = (error: unknown) => (error instanceof ApiError && error.code && !/^HTTP \d+$/.test(error.code) ? error.code : null);

/** "Chloé", "Chloé and Chris", "Chloé and 3 others". */
function namesFor(people: { name: string }[]) {
  const first = (person: { name: string }) => person.name.split(" ")[0] || person.name;
  if (people.length === 1) return first(people[0]);
  if (people.length === 2) return `${first(people[0])} and ${first(people[1])}`;
  return `${first(people[0])} and ${people.length - 1} others`;
}

export function ChannelMembersSheet({ channelId, title, isPrivate, meId, workspace, onClose, onProfile }: {
  channelId: string;
  title: string;
  isPrivate: boolean;
  meId: string;
  workspace: Workspace;
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

  const canManage = data?.canManage === true;
  const query = q.trim().toLowerCase();
  const shown = (data?.members ?? []).filter((m) => !query || m.name.toLowerCase().includes(query));
  const isStaff = (m: { role: string }) => m.role === "owner" || m.role === "team";
  const staff = shown.filter(isStaff);
  const others = shown.filter((m) => !isStaff(m));

  // The count on the channel header comes from the channel list.
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["channel-members", channelId] });
    void queryClient.invalidateQueries({ queryKey: keys.channels(workspace) });
  };

  async function remove(member: Member) {
    setRemoving(member.id);
    try {
      await api(`/api/channels/${channelId}/members?userId=${encodeURIComponent(member.id)}`, { method: "DELETE" });
      setNotice(`Removed ${member.name} from ${title}.`);
      setError(null);
      refresh();
    } catch (failure) {
      setError(errorText(failure) ?? `Couldn't remove ${member.name}. Try again.`);
    } finally {
      setRemoving(null);
      setConfirming(null);
    }
  }

  const row = (m: Member, removable: boolean) => confirming === m.id ? (
    <div key={m.id} className="chx-confirm" role="group" aria-label={`Remove ${m.name}?`}>
      <span><b>Remove {m.name}?</b><small>{isPrivate ? "They'll no longer see this private channel or its messages." : "It leaves their channel list. They can still find it, since it's public."}</small></span>
      <button className="btn" disabled={removing === m.id} onClick={() => setConfirming(null)}>Cancel</button>
      <button className="btn evx-danger" disabled={removing === m.id} onClick={() => void remove(m)}>{removing === m.id ? "Removing…" : "Remove"}</button>
    </div>
  ) : (
    <div key={m.id} className="chx-member">
      <button className="palette-row" onClick={() => onProfile(m.id)}>
        <Avatar name={m.name} src={m.avatarUrl} seed={m.id} size={28} radius="8px" presence={m.presence} />
        <span className="t">{m.name}</span><Badge badge={m.badge} role={m.role} />
        {m.id === meId ? <span className="hint">You</span> : null}
      </button>
      {removable ? <button className="iconbtn chx-remove" title="Remove from channel" aria-label={`Remove ${m.name} from the channel`} onClick={() => { setNotice(null); setConfirming(m.id); }}><UserMinus /></button> : null}
    </div>
  );

  return (
    <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="sheet members-sheet" role="dialog" aria-label={mode === "list" ? "Members" : "Add people"}>
        <div className="sheet-head">{mode === "list" ? "Members" : "Add people"}<span className="faint">{mode === "list" ? `${isPrivate ? "Private · " : ""}${title}` : `Add people to ${title}. They'll get a notification.`}</span><button className="iconbtn" onClick={onClose} aria-label="Close"><X /></button></div>
        {mode === "add" ? (
          <AddPeople channelId={channelId} title={title} workspace={workspace} existingIds={new Set((data?.members ?? []).map((m) => m.id))}
            onBack={() => setMode("list")}
            onAdded={(names) => { setNotice(`Added ${names} to ${title}.`); setMode("list"); refresh(); }} />
        ) : (
          <>
            <div className="palette-input"><Search /><input autoFocus value={q} placeholder="Search members" aria-label="Search members" onChange={(e) => setQ(e.target.value)} /></div>
            {notice ? <div className="chx-note" role="status">{notice}</div> : null}
            {error ? <div className="chx-note chx-err" role="alert">{error}</div> : null}
            <div className="palette-list">
              {canManage && !query ? <button className="palette-row" onClick={() => { setNotice(null); setMode("add"); }}><span className="glyph"><UserPlus /></span><span className="t">Add people</span></button> : null}
              {isLoading ? <div className="palette-empty">Loading…</div> : null}
              {isError ? <div className="palette-empty">Couldn't load the members.</div> : null}
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

interface Candidate { id: string; name: string; avatarUrl: string | null; role?: string; badge?: Member["badge"] }

function AddPeople({ channelId, title, workspace, existingIds, onBack, onAdded }: {
  channelId: string; title: string; workspace: Workspace; existingIds: Set<string>; onBack: () => void; onAdded: (names: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [selected, setSelected] = useState<Candidate[]>([]);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(query.trim()), 250);
    return () => clearTimeout(timer);
  }, [query]);
  const results = useQuery({
    queryKey: ["channel-add-people", workspace, debounced],
    queryFn: async () => {
      const params = new URLSearchParams({ view: "picker", limit: "40" });
      // Hey Social Inc. adds only its own people (the server refuses anyone else too).
      if (workspace === "heysocial") params.set("workspace", "heysocial");
      if (debounced) params.set("q", debounced);
      return (await api<{ members: Candidate[] }>(`/api/members?${params.toString()}`)).members ?? [];
    },
  });
  const selectedIds = useMemo(() => new Set(selected.map((m) => m.id)), [selected]);

  function toggle(member: Candidate) {
    if (existingIds.has(member.id)) return;
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
    } catch (failure) {
      setError(errorText(failure) ?? `Couldn't add them to ${title}. Try again.`);
      setAdding(false);
    }
  }

  return (
    <>
      <button className="btn chx-add" onClick={onBack}><ArrowLeft />Members</button>
      {selected.length ? (
        <div className="chips chx-chips" aria-label="People to add">
          {selected.map((m) => <button key={m.id} className="chip" onClick={() => toggle(m)} aria-label={`Remove ${m.name}`}><Avatar name={m.name} src={m.avatarUrl} seed={m.id} size={18} />{m.name}<X /></button>)}
        </div>
      ) : null}
      <div className="palette-input"><Search /><input autoFocus value={query} placeholder="Search everyone" aria-label="Search everyone" onChange={(e) => setQuery(e.target.value)} /></div>
      {error ? <div className="chx-note chx-err" role="alert">{error}</div> : null}
      <div className="palette-list" aria-live="polite">
        {(results.data ?? []).map((m) => {
          const inChannel = existingIds.has(m.id);
          const checked = selectedIds.has(m.id);
          return (
            <button key={m.id} className="palette-row chx-pick" aria-pressed={checked} disabled={inChannel} onClick={() => toggle(m)}>
              <Avatar name={m.name} src={m.avatarUrl} seed={m.id} size={28} radius="8px" />
              <span className="t">{m.name}</span><Badge badge={m.badge} role={m.role} />
              {inChannel ? <span className="hint">In channel</span> : <input type="checkbox" readOnly tabIndex={-1} checked={checked} className="chx-check" />}
            </button>
          );
        })}
        {results.isError ? <div className="palette-empty">Couldn't search members. Try again.</div> : null}
        {results.data && results.data.length === 0 ? <div className="palette-empty">{debounced ? `No one matches “${debounced}”.` : "No one to add."}</div> : null}
      </div>
      <div className="chx-foot">
        <button className="btn honey" disabled={selected.length === 0 || adding} onClick={() => void add()}>{adding ? "Adding…" : selected.length ? `Add ${selected.length} to ${title}` : "Add people"}</button>
      </div>
    </>
  );
}
