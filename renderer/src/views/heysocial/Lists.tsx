import { useEffect, useState } from "react";
import { AlarmClock, Archive, Bookmark, Check, Hash, Loader2, RotateCcw, Trash2, X } from "lucide-react";
import { ch } from "../../lib/bridge";
import { api, queryClient } from "../../lib/api";
import { shortTime } from "../../lib/format";
import { messageView, placeView, refreshHs, useHsActivity, useHsSaved, useHsSidebar, useHsThreads, type SavedItem } from "../../lib/heysocial";
import { nav } from "../../lib/nav";
import { Avatar, channelName } from "../../lib/ui";

/* Hey Social Inc.'s Threads, Mentions & reactions and Saved for later, as on the website. */

export function HsThreads() {
  const { data, isLoading } = useHsThreads();
  return (
    <div className="page">
      <div className="mhead"><h1>Threads</h1><span className="sub">Threads you started or replied in, newest reply first</span></div>
      <div className="scroll hs-list">
        {isLoading ? <div className="empty-state">Loading…</div> : null}
        {data?.length === 0 ? <div className="empty-state">No threads yet. Reply to a message in a channel to start one.</div> : null}
        {data?.map((t) => (
          <button key={t.parentId} className={`hs-card ${t.unread ? "unread" : ""}`} onClick={() => {
            void api("/api/hey-social/threads", { method: "POST", body: { parentId: t.parentId } }).then(() => refreshHs()).catch(() => null);
            nav.open(placeView(t.place, t.parentId), "home", "hs");
          }}>
            <div className="hs-card-head"><b>{t.place.label}</b>{t.unread ? <i className="act-dot" /> : null}</div>
            <div className="hs-card-msg"><Avatar name={t.author.name} src={t.author.avatarUrl} seed={t.author.id} size={30} radius="7px" /><span><b>{t.author.name}</b> <span className="faint">{shortTime(t.createdAt)}</span><br />{t.preview}</span></div>
            {t.lastReplyAuthor ? (
              <div className="hs-card-reply"><Avatar name={t.lastReplyAuthor.name} src={t.lastReplyAuthor.avatarUrl} seed={t.lastReplyAuthor.id} size={22} radius="6px" /><span><b>{t.lastReplyAuthor.name}</b> {t.lastReplyPreview}</span></div>
            ) : null}
            <div className="faint hs-card-foot">{t.replyCount === 1 ? "1 reply" : `${t.replyCount} replies`}{t.lastReplyAt ? ` · last ${shortTime(t.lastReplyAt)}` : ""}</div>
          </button>
        ))}
      </div>
    </div>
  );
}

export function HsMentions() {
  const { data, isLoading } = useHsActivity();
  // Seen once the list is open; the badge clears, the rows stay marked for this visit.
  useEffect(() => {
    if (!data) return;
    void api("/api/hey-social/activity", { method: "POST" }).then(() => refreshHs()).catch(() => null);
  }, [Boolean(data)]);
  return (
    <div className="page">
      <div className="mhead"><h1>Mentions & reactions</h1></div>
      <div className="scroll activity-list">
        {isLoading ? <div className="empty-state">Loading…</div> : null}
        {data?.length === 0 ? <div className="empty-state">Nothing yet. When someone @mentions you or reacts to your message, it shows up here.</div> : null}
        {data?.map((a) => (
          <button key={a.id} className={`act-row ${a.unread ? "unread" : ""}`} onClick={() => nav.open(messageView(a.place, a.messageId), "home", "hs")}>
            <Avatar name={a.actor.name} src={a.actor.avatarUrl} seed={a.actor.id} size={40} radius="10px" />
            <span className="act-text">
              <span><b>{a.actor.name}</b> <span className="muted">{a.kind === "mention" ? "mentioned you" : <>reacted {a.emoji} to your message</>}</span> <span className="tag-s">{a.place.label}</span></span>
              <span className="act-quote">{a.preview}</span>
            </span>
            <span className="act-when faint">{shortTime(a.at)}</span>
            <i className={`act-dot ${a.unread ? "" : "off"}`} />
          </button>
        ))}
      </div>
    </div>
  );
}

function dueLabel(iso: string) {
  const d = new Date(iso);
  const now = new Date();
  const tomorrow = new Date(now);
  tomorrow.setDate(now.getDate() + 1);
  const time = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  if (d.toDateString() === now.toDateString()) return `Today, ${time}`;
  if (d.toDateString() === tomorrow.toDateString()) return `Tomorrow, ${time}`;
  return `${d.toLocaleDateString([], { weekday: "long", month: "short", day: "numeric" })}, ${time}`;
}

function reminderTimes() {
  const now = new Date();
  const at = (days: number, hour: number) => { const d = new Date(now); d.setDate(d.getDate() + days); d.setHours(hour, 0, 0, 0); return d; };
  const nextMonday = (() => { const d = at(1, 9); while (d.getDay() !== 1) d.setDate(d.getDate() + 1); return d; })();
  return [
    { id: "hour", label: "In 1 hour", at: new Date(now.getTime() + 3600_000) },
    ...(now.getHours() < 17 ? [{ id: "evening", label: "This evening", at: at(0, 18) }] : []),
    { id: "tomorrow", label: "Tomorrow morning", at: at(1, 9) },
    { id: "monday", label: "Next Monday", at: nextMonday },
  ];
}

async function patchSaved(messageId: string, body: Record<string, unknown>) {
  await api("/api/hey-social/saved", { method: "PATCH", body: { messageId, ...body } }).catch(() => null);
  void queryClient.invalidateQueries({ queryKey: ["hey-social"] });
}

export function HsSaved() {
  const [status, setStatus] = useState<SavedItem["status"]>("in_progress");
  const { data, isLoading } = useHsSaved(status);
  const counts = data?.counts;

  async function remind(item: SavedItem) {
    const times = reminderTimes();
    const choice = await ch.menu.popup([
      ...times.map((t) => ({ id: t.id, label: t.label })),
      ...(item.remindAt ? [{ type: "separator" as const }, { id: "remove", label: "Remove reminder" }] : []),
    ]);
    if (choice === "remove") return patchSaved(item.messageId, { remindAt: null });
    const pick = times.find((t) => t.id === choice);
    if (pick) await patchSaved(item.messageId, { remindAt: pick.at.toISOString() });
  }

  return (
    <div className="page">
      <div className="mhead">
        <h1>Saved for later</h1>
        <div className="acts"><div className="seg">
          {(["in_progress", "archived", "completed"] as const).map((s) => (
            <button key={s} className={status === s ? "on" : ""} onClick={() => setStatus(s)}>{s === "in_progress" ? "In progress" : s[0].toUpperCase() + s.slice(1)}{counts ? ` · ${counts[s]}` : ""}</button>
          ))}
        </div></div>
      </div>
      <div className="scroll hs-list">
        {isLoading ? <div className="empty-state"><Loader2 className="spin" /></div> : null}
        {data?.items.length === 0 ? <div className="empty-state"><div><Bookmark /><p>{status === "in_progress" ? "Save messages to come back to them. Hover a message and choose Save." : "Nothing here."}</p></div></div> : null}
        {data?.items.map((item) => (
          <div key={item.messageId} className="hs-card saved">
            <button className="hs-card-main" onClick={() => nav.open(messageView(item.place, item.messageId), "home", "hs")}>
              <div className="hs-card-head"><b>{item.place.label}</b>{item.remindAt ? <span className={`due ${new Date(item.remindAt).getTime() - Date.now() < 3 * 3600_000 ? "soon" : ""}`}><AlarmClock />{item.remindedAt ? `Reminded ${shortTime(item.remindedAt)}` : dueLabel(item.remindAt)}</span> : null}</div>
              <div className="hs-card-msg"><Avatar name={item.author.name} src={item.author.avatarUrl} seed={item.author.id} size={30} radius="7px" /><span><b>{item.author.name}</b> <span className="faint">{shortTime(item.createdAt)}</span><br />{item.preview}</span></div>
            </button>
            <div className="hs-card-acts">
              {status === "in_progress" ? (
                <>
                  <button className="iconbtn" title="Remind me" onClick={() => void remind(item)}><AlarmClock /></button>
                  <button className="iconbtn" title="Completed" onClick={() => void patchSaved(item.messageId, { status: "completed" })}><Check /></button>
                  <button className="iconbtn" title="Archive" onClick={() => void patchSaved(item.messageId, { status: "archived" })}><Archive /></button>
                </>
              ) : <button className="iconbtn" title="Back to in progress" onClick={() => void patchSaved(item.messageId, { status: "in_progress" })}><RotateCcw /></button>}
              <button className="iconbtn" title="Remove" onClick={async () => { await api(`/api/hey-social/saved?messageId=${item.messageId}`, { method: "DELETE" }).catch(() => null); void queryClient.invalidateQueries({ queryKey: ["hey-social"] }); }}><Trash2 /></button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ---------- Create a channel / Browse channels ---------- */

export function CreateChannel({ onClose }: { onClose: () => void }) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [open, setOpen] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function create() {
    setBusy(true);
    setError(null);
    try {
      const { channel } = await api<{ channel: { id: string } }>("/api/channels", { method: "POST", body: { name: name.trim(), description: description.trim() || undefined, isPrivate: !open, workspace: "heysocial" } });
      await queryClient.invalidateQueries({ queryKey: ["channels", "heysocial"] });
      void refreshHs();
      onClose();
      nav.open({ kind: "channel", id: channel.id }, "home", "hs");
    } catch (e) {
      const code = (e as { code?: string }).code;
      setError(code === "NAME_TAKEN" ? "That name is taken." : "Couldn't create the channel.");
    } finally { setBusy(false); }
  }
  return (
    <div className="scrim center" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ width: 460 }}>
        <div className="modal-head">Create a channel<button className="iconbtn" onClick={onClose}><X /></button></div>
        <div className="modal-body">
          <label className="flabel">Name</label>
          <input className="field" autoFocus maxLength={50} placeholder="e.g. 📣 marketing" value={name} onChange={(e) => setName(e.target.value)} />
          <label className="flabel">Description · optional</label>
          <input className="field" maxLength={200} value={description} onChange={(e) => setDescription(e.target.value)} />
          <label className="flabel">Who can join</label>
          <label className="radio-row"><input type="radio" checked={open} onChange={() => setOpen(true)} /><span>Open</span><span className="faint">Any Hey Social Inc. member can find and join it</span></label>
          <label className="radio-row"><input type="radio" checked={!open} onChange={() => setOpen(false)} /><span>Private</span><span className="faint">Only people you add</span></label>
        </div>
        <div className="modal-foot">{error ? <span className="form-error">{error}</span> : null}<button className="btn" onClick={onClose}>Cancel</button><button className="btn honey" disabled={!name.trim() || busy} onClick={() => void create()}>Create</button></div>
      </div>
    </div>
  );
}

export function BrowseChannels({ onClose }: { onClose: () => void }) {
  const sidebar = useHsSidebar().data;
  const list = (sidebar?.channels ?? []).filter((c) => !c.joined && c.workspaceOpen);
  return (
    <div className="scrim center" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ width: 520 }}>
        <div className="modal-head">Browse channels<button className="iconbtn" onClick={onClose}><X /></button></div>
        <div className="modal-body">
          {list.length === 0 ? <p className="muted">You're in every open channel.</p> : null}
          {list.map((c) => (
            <div key={c.id} className="browse-row">
              <Hash /><span><b>{channelName(c.name)}</b><small className="faint">{c.description ?? ""} · {c.memberCount} members</small></span>
              <button className="btn" onClick={async () => {
                await api(`/api/channels/${c.id}/members`, { method: "POST" }).catch(() => null);
                await queryClient.invalidateQueries({ queryKey: ["channels", "heysocial"] });
                void refreshHs();
                onClose();
                nav.open({ kind: "channel", id: c.id }, "home", "hs");
              }}>Join</button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
