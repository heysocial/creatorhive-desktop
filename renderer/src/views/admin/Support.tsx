import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { ArrowUp, ImagePlus, Settings2, X } from "lucide-react";
import { ch } from "../../lib/bridge";
import { rateLimitMessage } from "../../lib/api";
import { nav } from "../../lib/nav";
import { money } from "../../lib/format";
import {
  PLATFORM_LABEL, STATUS_LABEL, SUPPORT_NAME,
  isSupportImage, markTicketRead, newMutationId, replyToTicket, saveSupportSettings, setTicketStatus, uploadSupportImage,
  useSupportSettings, useTicket, useTickets,
  type SupportAttachment, type SupportMessage, type TicketFilter, type TicketStatus,
} from "../../lib/support";
import { LbAvatar as Avatar } from "../people/LeaderboardParts";
import "../people/leaderboard-web.css";
import "../../styles/support.css";

/*
  Admin → Support, as the website has it (/admin/support): every student's
  ticket, newest first, one conversation answered as CreatorHive Support (the
  student never sees who), Mark waiting and Close, and who the student is.
  Owner and team; every route checks again. Hours and "Away now" decide what
  students see in the chat's header and automatic reply.
*/

const FILTERS: Array<{ key: TicketFilter; label: string }> = [
  { key: "open", label: "Open" },
  { key: "waiting", label: "Waiting on student" },
  { key: "closed", label: "Closed" },
  { key: "all", label: "All" },
];

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const ZONES = ["America/New_York", "America/Chicago", "America/Denver", "America/Los_Angeles", "America/Toronto", "Europe/London", "Europe/Paris"];

function ago(iso: string): string {
  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  if (minutes < 60 * 24) return `${Math.round(minutes / 60)} h ago`;
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}
const time = (iso: string) => new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
const memberSince = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

function Pill({ status }: { status: TicketStatus }) {
  return <span className={`su-pill ${status}`}>{STATUS_LABEL[status]}</span>;
}

function Message({ message, studentName }: { message: SupportMessage; studentName: string }) {
  if (message.sender === "auto") return <div className="su-auto">Automatic reply sent: “{message.body}”</div>;
  const fromSupport = message.sender === "support";
  return (
    <div className={`sp-row ${fromSupport ? "support" : "them"}`}>
      {message.body ? <div className={`sp-msg ${fromSupport ? "me" : "them"}`}>{message.body}</div> : null}
      {message.attachments.map((a) => (
        <button key={a.url} type="button" className="sp-pic" onClick={() => void ch.files.quickLook(a.url, a.name)} aria-label={`Open ${a.name}`}><img src={a.url} alt={a.name} /></button>
      ))}
      <div className={`sp-meta ${fromSupport ? "r" : ""}`}>
        {fromSupport ? `${message.authorName ?? "Support"} as ${SUPPORT_NAME}` : studentName} · {time(message.createdAt)}
      </div>
    </div>
  );
}

function Reply({ ticketId }: { ticketId: string }) {
  const [text, setText] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const picker = useRef<HTMLInputElement>(null);
  const send = async () => {
    const body = text.trim();
    if ((!body && files.length === 0) || busy) return;
    setBusy(true);
    setError(null);
    try {
      const attachments: SupportAttachment[] = [];
      for (const file of files) {
        const uploaded = await uploadSupportImage(file);
        if (!("url" in uploaded)) throw Object.assign(new Error("upload"), { reason: uploaded.failedReason ?? "That picture didn't upload. Try again." });
        attachments.push(uploaded);
      }
      await replyToTicket(ticketId, { body, attachments, clientMutationId: newMutationId() });
      setText("");
      setFiles([]);
    } catch (caught) {
      setError((caught as { reason?: string }).reason ?? rateLimitMessage(caught) ?? "Not sent. Try again.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      {error ? <div className="sp-error" role="alert">{error}</div> : null}
      {files.length ? (
        <div className="sp-staged">
          {files.map((file, i) => (
            <span key={`${file.name}-${i}`} className="sp-thumb">
              <img src={URL.createObjectURL(file)} alt={file.name} />
              <button type="button" aria-label={`Remove ${file.name}`} onClick={() => setFiles((f) => f.filter((_x, j) => j !== i))}><X size={11} /></button>
            </span>
          ))}
        </div>
      ) : null}
      <form className="sp-comp" onSubmit={(e) => { e.preventDefault(); void send(); }}
        onDragOver={(e) => { if (e.dataTransfer.types.includes("Files")) e.preventDefault(); }}
        onDrop={(e) => { e.preventDefault(); setFiles((f) => [...f, ...[...e.dataTransfer.files].filter(isSupportImage)].slice(0, 4)); }}>
        <button type="button" className="sp-attach" aria-label="Add a picture" onClick={() => picker.current?.click()}><ImagePlus size={18} /></button>
        <input ref={picker} type="file" accept="image/png,image/jpeg,image/webp,image/gif" multiple hidden onChange={(e) => { setFiles((f) => [...f, ...[...(e.target.files ?? [])].filter(isSupportImage)].slice(0, 4)); e.target.value = ""; }} />
        <textarea rows={1} value={text} placeholder={`Reply as ${SUPPORT_NAME}…`} aria-label="Reply"
          onChange={(e) => setText(e.target.value)}
          onPaste={(e) => { const pasted = [...e.clipboardData.files].filter(isSupportImage); if (pasted.length) { e.preventDefault(); setFiles((f) => [...f, ...pasted].slice(0, 4)); } }}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void send(); } }} />
        <button type="submit" className="sp-send" disabled={busy || (!text.trim() && files.length === 0)} aria-label="Send"><ArrowUp size={18} /></button>
      </form>
    </>
  );
}

function Conversation({ id }: { id: string }) {
  const ticket = useTicket(id);
  const list = useRef<HTMLDivElement>(null);
  const [busy, setBusy] = useState(false);
  const count = ticket.data?.messages.length ?? 0;
  useLayoutEffect(() => { list.current?.scrollTo({ top: list.current.scrollHeight }); }, [count]);
  useEffect(() => { if (count) void markTicketRead(id); }, [id, count]);
  if (ticket.isLoading) return <div className="su-conv"><div className="su-empty">Loading…</div></div>;
  if (!ticket.data) return <div className="su-conv"><div className="su-empty">This ticket isn't available.</div></div>;
  const { ticket: t, messages, student } = ticket.data;
  const change = async (status: TicketStatus) => {
    setBusy(true);
    try { await setTicketStatus(id, status); } finally { setBusy(false); }
  };
  return (
    <div className="su-conv">
      <div className="su-cvh">
        <Avatar name={student.name} id={student.id} src={student.avatarUrl} size={40} />
        <div>
          <b>{student.name}</b>
          <small>Ticket #{t.number} · {PLATFORM_LABEL[t.platform ?? ""] ?? "Website"} · {ago(t.createdAt)}</small>
        </div>
        <div className="su-acts">
          {t.status !== "waiting" && t.status !== "closed" ? <button className="btn" disabled={busy} onClick={() => void change("waiting")}>Mark waiting</button> : null}
          {t.status === "closed"
            ? <button className="btn" disabled={busy} onClick={() => void change("open")}>Reopen</button>
            : <button className="btn honey" disabled={busy} onClick={() => void change("closed")}>Close ticket</button>}
        </div>
      </div>
      <div className="su-msgs" ref={list}>
        {messages.map((m) => <Message key={m.id} message={m} studentName={student.name.split(" ")[0]} />)}
      </div>
      <Reply key={id} ticketId={id} />
    </div>
  );
}

function StudentPanel({ id }: { id: string }) {
  const ticket = useTicket(id);
  const s = ticket.data?.student;
  if (!s) return <aside className="su-info" />;
  return (
    <aside className="su-info">
      <b style={{ fontSize: 15 }}>{s.name}</b>
      <span>{s.email}</span>
      <span>{s.memberSince ? `Member since ${memberSince(s.memberSince)} · ` : ""}{s.tier}</span>
      <span>Hub: {s.hubDeals} {s.hubDeals === 1 ? "deal" : "deals"} · {money(s.hubPaidUsd)} paid</span>
      <span>Last seen on: {s.lastPlatform ?? "Unknown"}</span>
      <span style={{ marginTop: 8 }}><b>Past tickets</b></span>
      {s.pastTickets.length === 0 ? <span>None</span> : (
        <div className="past">
          {s.pastTickets.map((p) => (
            <button key={p.id} type="button" onClick={() => nav.open({ kind: "admin", page: "support", id: p.id }, "admin", "ch")}>
              #{p.number} · {STATUS_LABEL[p.status]} · {p.preview || "Picture"}
            </button>
          ))}
        </div>
      )}
    </aside>
  );
}

function Hours({ onClose }: { onClose: () => void }) {
  const settings = useSupportSettings();
  const [error, setError] = useState<string | null>(null);
  const s = settings.data;
  if (!s) return <div className="su-settings">Loading…</div>;
  const save = async (patch: Parameters<typeof saveSupportSettings>[0]) => {
    setError(null);
    try { await saveSupportSettings(patch); } catch { setError("That didn't save. Try again."); }
  };
  return (
    <div className="su-settings">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <b>Support hours</b>
        <button type="button" className="sp-x" style={{ marginLeft: 0 }} onClick={onClose} aria-label="Close settings"><X size={16} /></button>
      </div>
      <div className="days" role="group" aria-label="Days">
        {DAYS.map((label, i) => {
          const day = i + 1;
          const on = s.days.includes(day);
          return <button key={label} type="button" className={on ? "on" : ""} aria-pressed={on}
            onClick={() => void save({ days: on ? s.days.filter((d) => d !== day) : [...s.days, day].sort() })}>{label}</button>;
        })}
      </div>
      <label>From <input type="time" value={s.start} onChange={(e) => void save({ start: e.target.value })} /> to <input type="time" value={s.end} onChange={(e) => void save({ end: e.target.value })} /></label>
      <label>Time zone
        <select value={s.timezone} onChange={(e) => void save({ timezone: e.target.value })}>
          {[...new Set([s.timezone, ...ZONES])].map((z) => <option key={z} value={z}>{z.replace("_", " ")}</option>)}
        </select>
      </label>
      <label><input type="checkbox" checked={s.awayNow} onChange={(e) => void save({ awayNow: e.target.checked })} /> Away now (overrides the hours)</label>
      <span className="muted">Students see: {s.online ? "Online" : `Away · back ${s.hoursLabel}`}</span>
      {error ? <span className="sp-failed">{error}</span> : null}
    </div>
  );
}

export function AdminSupport({ id }: { id?: string }) {
  const [filter, setFilter] = useState<TicketFilter>("open");
  const [showHours, setShowHours] = useState(false);
  const tickets = useTickets(filter);
  const counts = tickets.data?.counts;
  const rows = tickets.data?.tickets ?? [];
  const open = (ticketId: string) => nav.open({ kind: "admin", page: "support", id: ticketId }, "admin", "ch");
  return (
    <div className="su lb-web">
      <section className="su-list">
        <div className="su-lh">
          <h2>Support <button type="button" className="sp-x" style={{ marginLeft: 0 }} onClick={() => setShowHours((v) => !v)} aria-label="Support hours" title="Support hours"><Settings2 size={17} /></button></h2>
          <div className="su-filters">
            {FILTERS.map((f) => {
              const n = f.key === "all" ? null : counts?.[f.key];
              return <button key={f.key} type="button" className={filter === f.key ? "on" : ""} onClick={() => setFilter(f.key)}>{f.label}{n ? ` · ${n}` : ""}</button>;
            })}
          </div>
        </div>
        <div className="su-rows">
          {tickets.isLoading ? <div className="su-empty">Loading…</div> : rows.length === 0 ? <div className="su-empty">No tickets here.</div> : rows.map((t) => (
            <button key={t.id} type="button" className={`su-row ${t.id === id ? "on" : ""}`} onClick={() => open(t.id)}>
              <Avatar name={t.student.name} id={t.student.id} src={t.student.avatarUrl} size={40} />
              <div className="t">
                <div className="top"><b className={t.unread ? "unread" : ""}>{t.student.name}</b><Pill status={t.status} /></div>
                <p>{t.lastMessageFrom === "support" ? "You: " : ""}{t.preview || "Picture"}</p>
              </div>
            </button>
          ))}
        </div>
        {showHours ? <Hours onClose={() => setShowHours(false)} /> : null}
      </section>
      {id ? <Conversation key={id} id={id} /> : <div className="su-conv"><div className="su-empty">Pick a ticket.</div></div>}
      {id ? <StudentPanel id={id} /> : <aside className="su-info" />}
    </div>
  );
}
