import { useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, X } from "lucide-react";
import { api, ApiError } from "../../lib/api";
import { Avatar } from "../../lib/ui";
import { useLayer } from "../hub/parts";
import "../../styles/admin-roadmap-courses.css";

/*
  Admin → Roadmap: the website's /admin/roadmap (components/roadmap/
  RoadmapWorkspace.tsx), the owner's own list of bugs, features and requests.
  A board of four columns you drag cards between, or a list; a quick-add bar
  that drops into Idea; a side panel to write the rest. Same API, same fields,
  same words. The owner alone, here (Admin.tsx) and on the server, which
  answers everyone else 404.
*/

const TYPES = ["bug", "feature", "request"] as const;
const STATUSES = ["idea", "next", "building", "done"] as const;
const PRIORITIES = ["high", "medium", "low"] as const;
const PLATFORMS = ["iphone", "web", "both"] as const;
const TITLE_MAX = 160;

type RoadmapType = (typeof TYPES)[number];
type RoadmapStatus = (typeof STATUSES)[number];
type RoadmapPriority = (typeof PRIORITIES)[number];
type RoadmapPlatform = (typeof PLATFORMS)[number];

interface RoadmapItem {
  id: string;
  title: string;
  description: string | null;
  type: RoadmapType;
  status: RoadmapStatus;
  priority: RoadmapPriority;
  platform: RoadmapPlatform;
  /** A member (with their current name and photo) or a typed name. */
  requestedBy: { userId: string | null; name: string; avatarUrl: string | null } | null;
  createdAt: string;
  updatedAt: string;
}

interface MemberOption { id: string; name: string; avatarUrl: string | null; badge?: { label: string } | null }

type Draft = {
  id: string | null;
  title: string;
  description: string;
  type: RoadmapType;
  status: RoadmapStatus;
  priority: RoadmapPriority;
  platform: RoadmapPlatform;
  requestedBy: { userId: string | null; name: string } | null;
  createdAt: string;
};

const LABEL: Record<string, string> = {
  idea: "Idea", next: "Next", building: "Building", done: "Done",
  bug: "Bug", feature: "Feature", request: "Request",
  high: "High", medium: "Medium", low: "Low",
  iphone: "iPhone", web: "Web", both: "Both",
};
const PRIORITY_RANK: Record<RoadmapPriority, number> = { high: 0, medium: 1, low: 2 };
const KEY = ["admin", "roadmap"] as const;

/** The server's sentence when it sent one (its roadmap errors are written to be shown), else ours. */
const said = (error: unknown, fallback: string) =>
  error instanceof ApiError && error.code && /\s/.test(error.code) ? error.code : fallback;

const shortDate = (iso: string) => new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });

function Pill({ value }: { value: string }) {
  return <span className="rm-pill" data-kind={value}>{LABEL[value]}</span>;
}

function Priority({ value }: { value: RoadmapPriority }) {
  return (
    <span className="rm-priority" data-priority={value} title={`${LABEL[value]} priority`} aria-label={`${LABEL[value]} priority`}>
      <i /><i /><i />
    </span>
  );
}

function Requester({ item }: { item: RoadmapItem }) {
  if (!item.requestedBy) return <span className="faint">—</span>;
  return (
    <span className="rm-requester">
      <Avatar name={item.requestedBy.name} seed={item.requestedBy.userId ?? item.requestedBy.name} src={item.requestedBy.avatarUrl} size={20} />
      <span>{item.requestedBy.name}</span>
    </span>
  );
}

export function AdminRoadmap(_props: { id?: string }) {
  const client = useQueryClient();
  const query = useQuery({ queryKey: KEY, queryFn: async () => (await api<{ items: RoadmapItem[] }>("/api/roadmap")).items });
  const items = query.data ?? null;
  const [view, setView] = useState<"board" | "list">("board");
  const [statusFilter, setStatusFilter] = useState<Set<RoadmapStatus>>(new Set());
  const [typeFilter, setTypeFilter] = useState<Set<RoadmapType>>(new Set());
  const [quickTitle, setQuickTitle] = useState("");
  const [quickType, setQuickType] = useState<RoadmapType>("feature");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [panelError, setPanelError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState<RoadmapStatus | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // For "Requested by". Loaded the first time the panel opens.
  const members = useQuery({
    queryKey: ["admin", "roadmap", "members"],
    enabled: Boolean(draft),
    staleTime: 5 * 60_000,
    queryFn: async () => (await api<{ members: MemberOption[] }>("/api/members")).members ?? [],
  }).data ?? [];

  const say = (message: string) => {
    setToast(message);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 1800);
  };
  useEffect(() => () => { if (toastTimer.current) clearTimeout(toastTimer.current); }, []);

  const setItems = (update: (current: RoadmapItem[]) => RoadmapItem[]) =>
    client.setQueryData<RoadmapItem[]>(KEY, (current) => update(current ?? []));
  const replace = (item: RoadmapItem) => setItems((current) => current.map((existing) => existing.id === item.id ? item : existing));

  const visible = useMemo(() => (items ?? []).filter((item) =>
    (!statusFilter.size || statusFilter.has(item.status)) && (!typeFilter.size || typeFilter.has(item.type))), [items, statusFilter, typeFilter]);

  const counts = useMemo(() => {
    const all = items ?? [];
    const open = all.filter((item) => item.status !== "done");
    return {
      open: open.length,
      bugs: open.filter((item) => item.type === "bug").length,
      building: all.filter((item) => item.status === "building").length,
      done: all.filter((item) => item.status === "done").length,
    };
  }, [items]);

  const sortedList = useMemo(() => visible.slice().sort((a, b) =>
    STATUSES.indexOf(a.status) - STATUSES.indexOf(b.status)
    || PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority]
    || b.createdAt.localeCompare(a.createdAt)), [visible]);

  async function quickAdd(event: React.FormEvent) {
    event.preventDefault();
    const title = quickTitle.trim();
    if (!title) return;
    setQuickTitle("");
    try {
      const { item } = await api<{ item: RoadmapItem }>("/api/roadmap", { method: "POST", body: { title, type: quickType } });
      setItems((current) => [item, ...current]);
      say("Added to Idea");
    } catch (error) {
      setQuickTitle(title);
      say(said(error, "That didn't save."));
    }
  }

  async function move(id: string, status: RoadmapStatus) {
    const before = items?.find((item) => item.id === id);
    if (!before || before.status === status) return;
    replace({ ...before, status });
    try {
      replace((await api<{ item: RoadmapItem }>(`/api/roadmap/${id}`, { method: "PATCH", body: { status } })).item);
      say(`Moved to ${LABEL[status]}`);
    } catch {
      replace(before);
      say("That move didn't save. Try again.");
    }
  }

  function openItem(item: RoadmapItem | null, status: RoadmapStatus = "idea") {
    setPanelError(null);
    setDraft(item
      ? {
          id: item.id, title: item.title, description: item.description ?? "", type: item.type, status: item.status,
          priority: item.priority, platform: item.platform,
          requestedBy: item.requestedBy ? { userId: item.requestedBy.userId, name: item.requestedBy.name } : null,
          createdAt: item.createdAt,
        }
      : {
          id: null, title: "", description: "", type: "feature", status, priority: "medium", platform: "both",
          requestedBy: null, createdAt: new Date().toISOString(),
        });
  }

  async function saveDraft() {
    if (!draft || saving) return;
    if (!draft.title.trim()) { setPanelError("Give the item a title."); return; }
    setSaving(true);
    setPanelError(null);
    const body = {
      title: draft.title, description: draft.description, type: draft.type, status: draft.status,
      priority: draft.priority, platform: draft.platform,
      requestedBy: draft.requestedBy && (draft.requestedBy.userId || draft.requestedBy.name.trim())
        ? draft.requestedBy.userId ? { userId: draft.requestedBy.userId } : { name: draft.requestedBy.name }
        : null,
    };
    try {
      if (draft.id) {
        replace((await api<{ item: RoadmapItem }>(`/api/roadmap/${draft.id}`, { method: "PATCH", body })).item);
      } else {
        const { item } = await api<{ item: RoadmapItem }>("/api/roadmap", { method: "POST", body });
        setItems((current) => [item, ...current]);
      }
      setDraft(null);
      say("Saved");
    } catch (error) {
      setPanelError(said(error, "That didn't save."));
    } finally {
      setSaving(false);
    }
  }

  async function deleteDraft() {
    if (!draft?.id) return;
    if (!window.confirm(`Delete “${draft.title}”?\n\nIt is removed from the roadmap for good.`)) return;
    try {
      await api(`/api/roadmap/${draft.id}`, { method: "DELETE" });
      const gone = draft.id;
      setItems((current) => current.filter((item) => item.id !== gone));
      setDraft(null);
      say("Deleted");
    } catch (error) {
      setPanelError(said(error, "That didn't delete."));
    }
  }

  function toggle<T>(set: Set<T>, value: T, apply: (next: Set<T>) => void) {
    const next = new Set(set);
    if (next.has(value)) next.delete(value); else next.add(value);
    apply(next);
  }

  return (
    <div className="page rm">
      <div className="mhead">
        <h1>Roadmap</h1><span className="sub">Feedback, bugs and feature requests. Only you can see this page.</span>
        <div className="acts rm-counts" aria-label="Roadmap totals">
          <span><b>{counts.open}</b> open</span>
          <span><b>{counts.bugs}</b> {counts.bugs === 1 ? "bug" : "bugs"}</span>
          <span><b>{counts.building}</b> building</span>
          <span><b>{counts.done}</b> done</span>
        </div>
      </div>
      <div className="rm-scroll">
        <form className="rm-quick" onSubmit={(event) => void quickAdd(event)}>
          <input
            value={quickTitle}
            onChange={(event) => setQuickTitle(event.target.value)}
            maxLength={TITLE_MAX}
            placeholder="+ Add a bug, feature or request…"
            aria-label="New item title"
          />
          <select value={quickType} onChange={(event) => setQuickType(event.target.value as RoadmapType)} aria-label="Type">
            {TYPES.map((type) => <option key={type} value={type}>{LABEL[type]}</option>)}
          </select>
          <span className="rm-hint">Enter to add · goes to Idea</span>
          <button type="submit" className="btn honey" disabled={!quickTitle.trim()}>Add</button>
        </form>

        <div className="rm-toolbar">
          <div className="seg" role="group" aria-label="View">
            <button className={view === "board" ? "on" : ""} aria-pressed={view === "board"} onClick={() => setView("board")}>Board</button>
            <button className={view === "list" ? "on" : ""} aria-pressed={view === "list"} onClick={() => setView("list")}>List</button>
          </div>
          <div className="rm-chips" role="group" aria-label="Filter by status">
            <span className="rm-chip-label">Status</span>
            {STATUSES.map((status) => (
              <button key={status} className={`chip ${statusFilter.has(status) ? "on" : ""}`} aria-pressed={statusFilter.has(status)}
                onClick={() => toggle(statusFilter, status, setStatusFilter)}>
                {LABEL[status]} <span>{(items ?? []).filter((item) => item.status === status).length}</span>
              </button>
            ))}
          </div>
          <div className="rm-chips" role="group" aria-label="Filter by type">
            <span className="rm-chip-label">Type</span>
            {TYPES.map((type) => (
              <button key={type} className={`chip ${typeFilter.has(type) ? "on" : ""}`} aria-pressed={typeFilter.has(type)}
                onClick={() => toggle(typeFilter, type, setTypeFilter)}>
                {LABEL[type]} <span>{(items ?? []).filter((item) => item.type === type).length}</span>
              </button>
            ))}
          </div>
        </div>

        {query.isError && !items ? (
          <p className="rm-error" role="alert">
            {said(query.error, "The roadmap could not be loaded.")} <button className="rm-link" onClick={() => void query.refetch()}>Try again</button>
          </p>
        ) : !items ? (
          <div className="rm-board" aria-busy="true" aria-label="Loading the roadmap">
            {STATUSES.map((status) => <div key={status} className="rm-skeleton" />)}
          </div>
        ) : view === "board" ? (
          <div className="rm-board">
            {STATUSES.filter((status) => !statusFilter.size || statusFilter.has(status)).map((status) => {
              const cards = visible.filter((item) => item.status === status)
                .sort((a, b) => PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] || b.createdAt.localeCompare(a.createdAt));
              return (
                <section
                  key={status}
                  className="rm-column"
                  data-kind={status}
                  data-over={dragOver === status || undefined}
                  aria-label={LABEL[status]}
                  onDragOver={(event) => { event.preventDefault(); setDragOver(status); }}
                  onDragLeave={() => setDragOver((current) => current === status ? null : current)}
                  onDrop={(event) => {
                    event.preventDefault();
                    setDragOver(null);
                    const id = event.dataTransfer.getData("text/roadmap-item");
                    if (id) void move(id, status);
                  }}
                >
                  <h2>
                    <Pill value={status} />
                    <span className="rm-n">{cards.length}</span>
                    <button className="rm-column-add" aria-label={`Add to ${LABEL[status]}`} title={`Add to ${LABEL[status]}`} onClick={() => openItem(null, status)}>
                      <Plus aria-hidden />
                    </button>
                  </h2>
                  {cards.map((item) => (
                    <article
                      key={item.id}
                      className="rm-card"
                      draggable
                      tabIndex={0}
                      aria-label={item.title}
                      onDragStart={(event) => { event.dataTransfer.setData("text/roadmap-item", item.id); event.dataTransfer.effectAllowed = "move"; }}
                      onClick={() => openItem(item)}
                      onKeyDown={(event) => { if (event.key === "Enter") openItem(item); }}
                    >
                      <div className="rm-card-title">{item.title}</div>
                      <div className="rm-card-meta"><Pill value={item.type} /><span className="rm-platform">{LABEL[item.platform]}</span></div>
                      <div className="rm-card-foot">
                        <Priority value={item.priority} />
                        <Requester item={item} />
                        <span className="rm-date">{shortDate(item.createdAt)}</span>
                      </div>
                    </article>
                  ))}
                  {cards.length === 0 && <div className="rm-empty">Drop a card here</div>}
                </section>
              );
            })}
          </div>
        ) : (
          <div className="rm-table-wrap">
            <table className="rm-table">
              <thead>
                <tr><th>Item</th><th>Type</th><th>Status</th><th>Priority</th><th>Platform</th><th>Requested by</th><th>Added</th></tr>
              </thead>
              <tbody>
                {sortedList.map((item) => (
                  <tr key={item.id} tabIndex={0} onClick={() => openItem(item)} onKeyDown={(event) => { if (event.key === "Enter") openItem(item); }}>
                    <td className="rm-title-cell">
                      <strong>{item.title}</strong>
                      {item.description && <small>{item.description}</small>}
                    </td>
                    <td><Pill value={item.type} /></td>
                    <td><Pill value={item.status} /></td>
                    <td><span className="rm-priority-cell"><Priority value={item.priority} />{LABEL[item.priority]}</span></td>
                    <td><span className="rm-platform">{LABEL[item.platform]}</span></td>
                    <td><Requester item={item} /></td>
                    <td className="rm-date">{shortDate(item.createdAt)}</td>
                  </tr>
                ))}
                {sortedList.length === 0 && (
                  <tr><td colSpan={7}><div className="rm-empty">{items.length ? "Nothing matches these filters." : "Nothing on the roadmap yet. Add the first item above."}</div></td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {draft && (
        <ItemPanel
          draft={draft}
          members={members}
          saving={saving}
          error={panelError}
          onChange={(patch) => setDraft((current) => current ? { ...current, ...patch } : current)}
          onClose={() => { if (!saving) setDraft(null); }}
          onSave={() => void saveDraft()}
          onDelete={() => void deleteDraft()}
        />
      )}
      {toast && <div className="rm-toast" role="status">{toast}</div>}
    </div>
  );
}

function Segmented<T extends string>({ values, value, onChange, label }: { values: readonly T[]; value: T; onChange: (value: T) => void; label: string }) {
  return (
    <div className="seg rm-seg-full" role="group" aria-label={label}>
      {values.map((option) => (
        <button key={option} type="button" className={option === value ? "on" : ""} aria-pressed={option === value} onClick={() => onChange(option)}>{LABEL[option]}</button>
      ))}
    </div>
  );
}

/* The side panel: everything about one item. Esc or the scrim closes it, ⌘↩ (or Enter in the title) saves. */
function ItemPanel({
  draft, members, saving, error, onChange, onClose, onSave, onDelete,
}: {
  draft: Draft;
  members: MemberOption[];
  saving: boolean;
  error: string | null;
  onChange: (patch: Partial<Draft>) => void;
  onClose: () => void;
  onSave: () => void;
  onDelete: () => void;
}) {
  const fieldId = useId();
  const box = useRef<HTMLElement>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const query = draft.requestedBy?.name.trim().toLowerCase() ?? "";
  const matches = members.filter((member) => member.name.toLowerCase().includes(query)).slice(0, 8);
  const exact = members.some((member) => member.name.toLowerCase() === query);
  useLayer(onClose, box);

  return createPortal(
    <div className="rm rm-overlay">
      <div className="rm-scrim" onMouseDown={onClose} aria-hidden />
      <aside ref={box} className="rm-panel" role="dialog" aria-modal="true" aria-label={draft.id ? "Roadmap item" : "New roadmap item"} tabIndex={-1}
        onKeyDown={(event) => { if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) { event.preventDefault(); onSave(); } }}>
        <header>
          <h3>{draft.id ? "Item" : "New item"}</h3>
          <button className="iconbtn" onClick={onClose} aria-label="Close"><X /></button>
        </header>
        <form className="rm-panel-body" onSubmit={(event) => { event.preventDefault(); onSave(); }}>
          <label className="rm-field">
            <span>Title</span>
            <input autoFocus value={draft.title} maxLength={TITLE_MAX} onChange={(event) => onChange({ title: event.target.value })} />
          </label>
          <label className="rm-field">
            <span>Description</span>
            <textarea rows={5} value={draft.description} placeholder="What happened, steps, who it affects…" onChange={(event) => onChange({ description: event.target.value })} />
          </label>
          <div className="rm-field"><span>Type</span><Segmented label="Type" values={TYPES} value={draft.type} onChange={(type) => onChange({ type })} /></div>
          <div className="rm-field"><span>Status</span><Segmented label="Status" values={STATUSES} value={draft.status} onChange={(status) => onChange({ status })} /></div>
          <div className="rm-grid2">
            <div className="rm-field"><span>Priority</span><Segmented label="Priority" values={PRIORITIES} value={draft.priority} onChange={(priority) => onChange({ priority })} /></div>
            <div className="rm-field"><span>Platform</span><Segmented label="Platform" values={PLATFORMS} value={draft.platform} onChange={(platform) => onChange({ platform })} /></div>
          </div>
          <div className="rm-field rm-picker">
            <label htmlFor={`${fieldId}-who`}>Requested by</label>
            <input
              id={`${fieldId}-who`}
              value={draft.requestedBy?.name ?? ""}
              placeholder="Pick a member or type a name"
              autoComplete="off"
              onFocus={() => setPickerOpen(true)}
              onBlur={() => setTimeout(() => setPickerOpen(false), 120)}
              onChange={(event) => { onChange({ requestedBy: { userId: null, name: event.target.value } }); setPickerOpen(true); }}
            />
            {pickerOpen && (matches.length > 0 || (query && !exact)) && (
              <ul role="listbox">
                {matches.map((member) => (
                  <li key={member.id} role="option" aria-selected={draft.requestedBy?.userId === member.id}
                    onMouseDown={(event) => { event.preventDefault(); onChange({ requestedBy: { userId: member.id, name: member.name } }); setPickerOpen(false); }}>
                    <Avatar name={member.name} seed={member.id} src={member.avatarUrl} size={22} />
                    {member.name}
                    {member.badge?.label && <small>{member.badge.label}</small>}
                  </li>
                ))}
                {query && !exact && (
                  <li role="option" aria-selected={false}
                    onMouseDown={(event) => { event.preventDefault(); setPickerOpen(false); }}>
                    <span className="rm-typed-avatar">{draft.requestedBy?.name.trim().slice(0, 1).toUpperCase()}</span>
                    Use “{draft.requestedBy?.name.trim()}”<small>not a member</small>
                  </li>
                )}
              </ul>
            )}
          </div>
          <p className="rm-added">
            Added {new Date(draft.createdAt).toLocaleDateString(undefined, { weekday: "short", month: "long", day: "numeric", year: "numeric" })}
          </p>
          {error && <p className="rm-error" role="alert">{error}</p>}
          <button type="submit" hidden aria-hidden tabIndex={-1} />
        </form>
        <footer>
          {draft.id && <button className="btn rm-delete" onClick={onDelete} disabled={saving}>Delete</button>}
          <button className="btn" onClick={onClose} disabled={saving}>Cancel</button>
          <button className="btn honey" onClick={onSave} disabled={saving}>{saving ? "Saving…" : "Save"}</button>
        </footer>
      </aside>
    </div>,
    document.body,
  );
}
