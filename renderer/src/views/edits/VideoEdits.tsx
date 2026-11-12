import { useEffect, useMemo, useRef, useState, type ChangeEvent, type DragEvent } from "react";
import {
  CalendarDays, Check, ChevronDown, CircleCheck, Clapperboard, Clock, Download, Eye, MessageCircle, NotebookPen, Play, RotateCcw,
  Scissors, Send, Upload, X,
} from "lucide-react";
import { ch, type SessionUser } from "../../lib/bridge";
import { nav } from "../../lib/nav";
import { readVideoMeta, formatBytes, formatDuration } from "../../lib/starter";
import { Avatar } from "../../lib/ui";
import { clock, dayLabel } from "../../lib/format";
import {
  EDIT_STAGES, EDIT_STAGE_LABELS, STAGE_CLASS, cancelVersionUpload, daysUntil, dueIn, firstName, formatDueDate, formatMoment,
  clipsFor, dismissClipDownload, downloadClips, patchCard, planLabel, useClipDownloads, replyToStudent, shortDay, staffComment, uploadKey, uploadVersion, useVersionUploads, useVideoEditCard,
  useVideoEditsBoard, versionsOf, type BoardCard, type EditStage, type StaffCard, type StaffEditVersion, type StaffOriginal,
} from "../../lib/videoEdits";
import { useLayer } from "../hub/parts";
import { QuickPlayer, VideoStill, type PlayerSource } from "./Player";
import "../../styles/video-edits.css";

/*
  Staff: the video editing board (creatorhive-app docs/video-editor.md).
  Five columns, one card per student, drag a card to move it; a card opens
  its panel over the board: stage, due date, her notes, originals, edited
  versions (uploaded straight to storage) and the thread with her.
*/

export type BoardFilter = "all" | "due" | "unread";

const STAGE_ICON: Record<EditStage, typeof Upload> = {
  submitted: Upload,
  in_editing: Scissors,
  ready_to_review: Eye,
  revisions: RotateCcw,
  approved: CircleCheck,
};

export function StagePill({ stage, small = false }: { stage: EditStage; small?: boolean }) {
  const Icon = STAGE_ICON[stage];
  return <span className={`stage-pill ve-stage ${small ? "sm" : ""} ${STAGE_CLASS[stage]}`}><Icon />{EDIT_STAGE_LABELS[stage]}</span>;
}

export function PlanLabel({ plan }: { plan: string }) {
  return <span className="ve-plan"><Clapperboard />{planLabel(plan)}</span>;
}

const dueSoon = (card: BoardCard) => Boolean(card.dueOn) && card.stage !== "approved" && card.stage !== "ready_to_review" && daysUntil(card.dueOn!) <= 2;

export function filterCards(cards: BoardCard[], filter: BoardFilter) {
  if (filter === "due") return cards.filter(dueSoon);
  if (filter === "unread") return cards.filter((c) => c.unread > 0);
  return cards;
}

/** The due chip: "Due Nov 13", "Due today" (danger), "Sent Nov 8", "Approved Nov 4". */
function DueChip({ card }: { card: BoardCard }) {
  if (card.stage === "approved") return <span className="ve-chip ok"><CircleCheck />Approved {shortDay(card.approvedAt ?? card.stageChangedAt)}</span>;
  if (card.stage === "ready_to_review") return <span className="ve-chip"><Send />Sent {shortDay(card.sentAt ?? card.stageChangedAt)}</span>;
  if (!card.dueOn) return null;
  const days = daysUntil(card.dueOn);
  if (days === 0) return <span className="ve-chip danger"><CalendarDays />Due today</span>;
  if (days < 0) return <span className="ve-chip danger"><CalendarDays />Late · {formatDueDate(card.dueOn, false)}</span>;
  return <span className="ve-chip"><CalendarDays />Due {formatDueDate(card.dueOn, false)}</span>;
}

function BoardCardView({ card, selected, ghost, onPointerDown }: { card: BoardCard; selected: boolean; ghost?: boolean; onPointerDown?: (event: React.PointerEvent) => void }) {
  return (
    <div className={`ve-card ${selected ? "on" : ""} ${ghost ? "ghost" : ""}`} role="button" tabIndex={0} data-card={card.id}
      onPointerDown={onPointerDown}
      onClick={() => nav.open({ kind: "video-edits", cardId: card.id, filter: currentFilter() }, "edits", "ch")}
      onKeyDown={(event) => { if (event.key === "Enter") nav.open({ kind: "video-edits", cardId: card.id, filter: currentFilter() }, "edits", "ch"); }}>
      <div className="ve-card-who">
        <Avatar name={card.member.name} src={card.member.avatarUrl} seed={card.member.id} size={32} />
        <span><b>{card.member.name}</b><small>Submitted {shortDay(card.submittedAt)}</small></span>
      </div>
      <div className="ve-card-thumbs">
        {[1, 2, 3].map((slot) => {
          const thumb = card.thumbnails.find((t) => t.slot === slot);
          return <VideoStill key={slot} thumbnailUrl={thumb?.url} label={thumb?.url ? undefined : String(slot)} />;
        })}
      </div>
      {card.clipCounts ? <span className="ve-clip-counts">{[1, 2, 3].map((slot) => card.clipCounts?.[slot] ?? 0).join(" · ")} clips</span> : null}
      <div className="ve-card-chips">
        <DueChip card={card} />
        {card.member.plan !== "first3" ? <span className="ve-chip quiet">{planLabel(card.member.plan)}</span> : null}
        {card.unread ? <span className="ve-unread" title={`${card.unread} unread`}><MessageCircle />{card.unread}</span> : null}
      </div>
      <span className="ve-progress">{card.progress}</span>
    </div>
  );
}

function currentFilter(): BoardFilter | undefined {
  const view = nav.get().view;
  return view.kind === "video-edits" ? view.filter : undefined;
}

interface Drag { card: BoardCard; x: number; y: number; startX: number; startY: number; moved: boolean; over: EditStage | null; width: number }

function useDragCards(onDrop: (card: BoardCard, stage: EditStage) => void) {
  const [drag, setDrag] = useState<Drag | null>(null);
  const ref = useRef<Drag | null>(null);
  ref.current = drag;
  function start(event: React.PointerEvent, card: BoardCard) {
    if (event.button !== 0) return;
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    setDrag({ card, x: event.clientX, y: event.clientY, startX: event.clientX, startY: event.clientY, moved: false, over: null, width: rect.width });
    const move = (e: PointerEvent) => {
      const current = ref.current;
      if (!current) return;
      const moved = current.moved || Math.hypot(e.clientX - current.startX, e.clientY - current.startY) > 6;
      const target = document.elementFromPoint(e.clientX, e.clientY)?.closest<HTMLElement>("[data-drop-stage]");
      setDrag({ ...current, x: e.clientX, y: e.clientY, moved, over: (target?.dataset.dropStage as EditStage) ?? null });
      const scroller = document.querySelector<HTMLElement>(".ve-board");
      if (moved && scroller) {
        const r = scroller.getBoundingClientRect();
        if (e.clientX > r.right - 48) scroller.scrollLeft += 14;
        if (e.clientX < r.left + 48) scroller.scrollLeft -= 14;
      }
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      const current = ref.current;
      setDrag(null);
      if (current?.moved) {
        window.addEventListener("click", (e) => { e.stopPropagation(); e.preventDefault(); }, { capture: true, once: true });
        if (current.over && current.over !== current.card.stage) onDrop(current.card, current.over);
      }
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }
  return { drag: drag?.moved ? drag : null, start };
}

export function VideoEditsBoard({ cardId, filter = "all", user }: { cardId?: string; filter?: BoardFilter; user: SessionUser }) {
  const { data, isLoading, isError, refetch } = useVideoEditsBoard();
  const [error, setError] = useState<string | null>(null);
  const { drag, start } = useDragCards((card, stage) => {
    setError(null);
    void patchCard(card.id, { stage }).then((message) => { if (message) setError(`${card.member.name}: ${message}`); });
  });
  useEffect(() => {
    if (!error) return;
    const timer = setTimeout(() => setError(null), 6000);
    return () => clearTimeout(timer);
  }, [error]);
  const cards = useMemo(() => filterCards(data?.cards ?? [], filter), [data, filter]);
  const all = data?.cards ?? [];
  const setFilter = (next: BoardFilter) => nav.open({ kind: "video-edits", filter: next === "all" ? undefined : next }, "edits", "ch");

  if (data === null) return <div className="empty-state">The video editing board is for the owner and the video editors.</div>;
  return (
    <div className="page ve-page">
      <div className="ve-board-head">
        <div>
          <span className="st-eyebrow">The Weekend Starter · Edits</span>
          <h1>Video editing</h1>
          <p className="muted">Every student's 3 videos, from upload to approval. Drag a card to move it; the student is told.</p>
        </div>
        <div className="ve-filters" role="tablist">
          <button role="tab" aria-selected={filter === "all"} className={filter === "all" ? "on" : ""} onClick={() => setFilter("all")}>All {all.length}</button>
          <button role="tab" aria-selected={filter === "due"} className={filter === "due" ? "on" : ""} onClick={() => setFilter("due")}>Due in 2 days · {all.filter(dueSoon).length}</button>
          <button role="tab" aria-selected={filter === "unread"} className={filter === "unread" ? "on" : ""} onClick={() => setFilter("unread")}>Unread messages · {all.filter((c) => c.unread > 0).length}</button>
        </div>
      </div>
      {error ? <div className="ve-toast" role="alert">{error}</div> : null}
      {isLoading ? <div className="empty-state">Loading…</div> : null}
      {isError ? <div className="empty-state"><div className="err-state">Couldn't load the board.<button className="btn" onClick={() => void refetch()}>Try again</button></div></div> : null}
      {data ? (
        <div className="ve-board">
          {EDIT_STAGES.map((stage) => {
            const list = cards.filter((c) => c.stage === stage);
            const over = drag?.over === stage && drag.card.stage !== stage;
            return (
              <section key={stage} className={`ve-lane ${over ? "over" : ""}`} data-drop-stage={stage} aria-label={EDIT_STAGE_LABELS[stage]}>
                <div className="ve-lane-head"><StagePill stage={stage} /><span className="ve-count">{data.counts[stage] ?? list.length}</span></div>
                <div className="ve-lane-body">
                  {list.map((card) => (
                    <BoardCardView key={card.id} card={card} selected={card.id === cardId} ghost={drag?.card.id === card.id} onPointerDown={(event) => start(event, card)} />
                  ))}
                  {list.length === 0 ? <div className="lane-empty">{filter === "all" ? "Nobody here" : "None"}</div> : null}
                </div>
              </section>
            );
          })}
        </div>
      ) : null}
      {drag ? <div className="drag-card" style={{ left: drag.x - 40, top: drag.y - 20, width: drag.width }}><div className="ve-card lifted"><div className="ve-card-who"><Avatar name={drag.card.member.name} src={drag.card.member.avatarUrl} seed={drag.card.member.id} size={32} /><span><b>{drag.card.member.name}</b><small>{EDIT_STAGE_LABELS[drag.over ?? drag.card.stage]}</small></span></div></div></div> : null}
      {cardId ? <CardPanel key={cardId} id={cardId} user={user} onClose={() => nav.open({ kind: "video-edits", filter: filter === "all" ? undefined : filter }, "edits", "ch")} /> : null}
    </div>
  );
}

/* ------------------------------------------------------------------ the card panel */

const metaLine = (v: { durationSeconds: number | null; sizeBytes: number; width: number | null; height: number | null }) =>
  [formatDuration(v.durationSeconds), formatBytes(v.sizeBytes), v.width && v.height ? `${v.width}×${v.height}` : null].filter(Boolean).join(" · ");

function CardPanel({ id, user, onClose }: { id: string; user: SessionUser; onClose: () => void }) {
  const { data: card, isError, refetch } = useVideoEditCard(id);
  const box = useRef<HTMLElement>(null);
  const [playing, setPlaying] = useState<{ source: PlayerSource; title: string } | null>(null);
  useLayer(() => (playing ? setPlaying(null) : onClose()), box);
  return (
    <div className="scrim side ve-scrim" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <aside ref={box} className="ve-panel" tabIndex={-1} aria-label="Student card">
        {!card ? (
          <div className="empty-state">{isError ? <div className="err-state">Couldn't load this card.<button className="btn" onClick={() => void refetch()}>Try again</button></div> : "Loading…"}</div>
        ) : <CardBody card={card} user={user} onClose={onClose} onPlay={setPlaying} />}
      </aside>
      {playing ? <QuickPlayer source={playing.source} title={playing.title} onClose={() => setPlaying(null)} /> : null}
    </div>
  );
}

function CardBody({ card, user, onClose, onPlay }: { card: StaffCard; user: SessionUser; onClose: () => void; onPlay: (p: { source: PlayerSource; title: string }) => void }) {
  const first = firstName(card.member.name);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const download = useClipDownloads()[card.id];
  const newest = Math.max(0, ...card.edits.filter((e) => e.status === "ready").map((e) => e.version));
  const primary = card.stage === "revisions" ? `Send v${Math.max(2, newest)} for review` : card.stage === "submitted" || card.stage === "in_editing" ? "Move to Ready to review" : null;

  async function move(stage: EditStage) {
    setBusy(true);
    setError(await patchCard(card.id, { stage }));
    setBusy(false);
  }
  async function stageMenu() {
    const choice = await ch.menu.popup(EDIT_STAGES.map((stage) => ({ id: stage, label: EDIT_STAGE_LABELS[stage], checked: stage === card.stage })));
    if (choice && choice !== card.stage) void move(choice as EditStage);
  }
  function message() {
    if (!card.conversationId) return;
    onClose();
    nav.open({ kind: "dm", id: card.conversationId }, "dms", "ch");
  }

  return (
    <>
      <header className="ve-panel-head">
        <Avatar name={card.member.name} src={card.member.avatarUrl} seed={card.member.id} size={56} />
        <div className="ve-panel-title">
          <span className="st-eyebrow">Video editing · {planLabel(card.member.plan)}</span>
          <h2>{card.member.name}</h2>
          <span className="muted">
            Submitted {shortDay(card.submittedAt, true)}{card.dueOn ? ` · Due ${formatDueDate(card.dueOn)} (${dueIn(card.dueOn)})` : ""}
          </span>
        </div>
        <div className="ve-panel-acts">
          {card.conversationId ? <button className="btn" onClick={message}><MessageCircle />Message</button> : null}
          <button className="iconbtn" aria-label="Close" title="Close (Esc)" onClick={onClose}><X /></button>
        </div>
      </header>
      <div className="ve-panel-body scroll">
        <div className="ve-stage-row">
          <span className="ve-label">Stage</span>
          <button className={`stage-btn ${STAGE_CLASS[card.stage]}`} onClick={() => void stageMenu()} disabled={busy}>{EDIT_STAGE_LABELS[card.stage]}<ChevronDown /></button>
          <span className="faint ve-hint">{primary ? `${first} is told by notification + email` : card.stage === "ready_to_review" ? `Waiting for ${first}'s review` : `${first} approved all 3`}</span>
          {primary ? <button className="btn honey" disabled={busy} onClick={() => void move("ready_to_review")}><Send />{busy ? "Moving…" : primary}</button> : null}
        </div>
        <DueRow card={card} onError={setError} />
        {error ? <div className="ve-error" role="alert">{error}</div> : null}
        {card.brief ? (
          <div className="ve-brief">
            <b><NotebookPen />{first}'s notes · from the upload form</b>
            <p>{card.brief}</p>
          </div>
        ) : null}
        <div className="ve-sec-head">
          <h3>Her videos</h3>
          {card.originals.length ? (
            <button className="btn" disabled={Boolean(download && !download.error)} onClick={() => { dismissClipDownload(card.id); void downloadClips(card); }}>
              <Download />{download && !download.error ? `Downloading ${download.done + 1} of ${download.total}` : `Download all · ${card.originals.length} ${card.originals.length === 1 ? "clip" : "clips"} · ${formatBytes(card.totalBytes)}`}
            </button>
          ) : null}
        </div>
        {download?.error ? <div className="ve-error" role="alert">{download.error}</div> : null}
        {[1, 2, 3].map((slot) => (
          <SlotRow key={slot} card={card} slot={slot} clips={clipsFor(card, slot)} versions={versionsOf(card.edits, slot)} onPlay={onPlay} />
        ))}
        <Thread card={card} user={user} />
      </div>
    </>
  );
}

function DueRow({ card, onError }: { card: StaffCard; onError: (message: string | null) => void }) {
  const [value, setValue] = useState(card.dueOn ?? "");
  useEffect(() => setValue(card.dueOn ?? ""), [card.dueOn]);
  return (
    <label className="ve-due-row">
      <span className="ve-label">Ready by</span>
      <input type="date" className="field" value={value} onChange={(event) => setValue(event.target.value)}
        onBlur={() => { if (value && value !== card.dueOn) void patchCard(card.id, { dueOn: value }).then(onError); }} />
      <span className="faint">{card.dueOn ? `${formatDueDate(card.dueOn)} · ${dueIn(card.dueOn)}. ${firstName(card.member.name)} sees "ready by" this day.` : "No due date"}</span>
    </label>
  );
}

function SlotRow({ card, slot, clips, versions, onPlay }: { card: StaffCard; slot: number; clips: StaffOriginal[]; versions: StaffEditVersion[]; onPlay: (p: { source: PlayerSource; title: string }) => void }) {
  const uploads = useVersionUploads();
  const up = uploads[uploadKey(card.id, slot)];
  const input = useRef<HTMLInputElement>(null);
  const [picked, setPicked] = useState<{ file: File } | null>(null);
  const [note, setNote] = useState("");
  const [over, setOver] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const nextVersion = (versions[0]?.version ?? 0) + 1;
  const review = card.reviews.find((r) => r.slot === slot);
  const download = useClipDownloads()[card.id];

  async function take(file: File | undefined) {
    if (!file) return;
    const info = await ch.files.videoInfo(file);
    if (!info) { setError("That file isn't a video. Pick an MP4 or MOV."); return; }
    setError(null);
    setPicked({ file });
  }
  async function send() {
    if (!picked) return;
    const info = await ch.files.videoInfo(picked.file);
    if (!info) return;
    const meta = await readVideoMeta(picked.file);
    void uploadVersion(card.id, slot, info, note, meta);
    setPicked(null);
    setNote("");
  }
  const drop = {
    onDragOver: (event: DragEvent) => { event.preventDefault(); setOver(true); },
    onDragLeave: () => setOver(false),
    onDrop: (event: DragEvent) => { event.preventDefault(); setOver(false); void take(event.dataTransfer.files[0]); },
  };
  const fileInput = <input ref={input} type="file" hidden accept="video/mp4,video/quicktime,.mp4,.mov,.m4v" onChange={(event: ChangeEvent<HTMLInputElement>) => { const f = event.target.files?.[0]; event.target.value = ""; void take(f); }} />;

  return (
    <div className={`ve-slot ve-slot-multi ${over ? "over" : ""}`} {...drop}>
      <div className="ve-slot-original">
        <div className="ve-clip-head">
          <span className="ve-kicker">Video {slot}{clips.length ? ` · ${clips.length} ${clips.length === 1 ? "clip" : "clips"} · ${formatBytes(clips.reduce((sum, c) => sum + c.sizeBytes, 0))}` : ""}</span>
          {clips.length ? (
            <button className="btn ve-clip-dl" disabled={Boolean(download && !download.error)} onClick={() => { dismissClipDownload(card.id); void downloadClips(card, slot); }}>
              <Download />{download && !download.error && download.slot === slot ? `Downloading ${download.done + 1} of ${download.total}` : `Download Video ${slot}`}
            </button>
          ) : null}
        </div>
        {clips.length ? (
          <ol className="ve-clips">
            {clips.map((original, index) => (
              <li key={original.id} className="ve-clip">
                <button className="ve-clip-thumb" onClick={() => onPlay({ source: original, title: `${card.member.name} · Video ${slot} · clip ${index + 1}` })} aria-label={`Play ${original.fileName}`}>
                  <VideoStill thumbnailUrl={original.playback?.thumbnailUrl} fileUrl={original.viewUrl} />
                  <span className="ve-play"><Play /></span>
                </button>
                <span className="ve-clip-name">
                  <b className="ve-file" title={original.fileName}>{String(index + 1).padStart(2, "0")} · {original.fileName}</b>
                  <span className="faint">{metaLine(original)}</span>
                </span>
                <button className="iconbtn" title="Download" aria-label={`Download ${original.fileName}`} onClick={() => void ch.files.save(original.downloadUrl, `${String(index + 1).padStart(2, "0")} - ${original.fileName}`)}><Download /></button>
              </li>
            ))}
          </ol>
        ) : <span className="faint">Not uploaded</span>}
      </div>
      <div className="ve-slot-edits">
        <span className="ve-kicker">Edited versions{review && review.state !== "pending" ? <em className={`ve-review r-${review.state}`}>{review.state === "approved" ? "Approved" : "Changes requested"}</em> : null}</span>
        {versions.map((v, index) => (
          <button key={v.id} className={`ve-version ${index === 0 ? "current" : ""}`} onClick={() => onPlay({ source: v, title: `${card.member.name} · Video ${slot} · v${v.version}` })}
            title={v.status === "uploading" ? "Still uploading" : "Play"}>
            <span className="ve-v">v{v.version}</span>
            <span>{shortDay(v.createdAt)}{v.note ? ` · ${v.note}` : ""}{v.status === "uploading" ? " · uploading" : v.sentAt ? "" : " · not sent yet"}</span>
          </button>
        ))}
        {up ? (
          <div className="ve-uploading">
            <span className="st-bar"><i style={{ width: `${up.size ? Math.min(100, Math.round((up.sent / up.size) * 100)) : 0}%` }} /></span>
            <span className="faint">{up.status === "failed" ? up.error : up.status === "finishing" ? "Checking the file…" : `Uploading v${up.version ?? nextVersion} · ${up.size ? Math.round((up.sent / up.size) * 100) : 0}%`}</span>
            <button className="btn" onClick={() => cancelVersionUpload(up.key)}>{up.status === "failed" ? "Dismiss" : "Cancel"}</button>
          </div>
        ) : picked ? (
          <div className="ve-note-form">
            <span className="faint">v{nextVersion} · {picked.file.name}</span>
            <input className="field" autoFocus maxLength={200} placeholder="One line for her (optional): Captions added, cap moment cut" value={note}
              onChange={(event) => setNote(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void send(); }} />
            <div className="ve-note-acts"><button className="btn" onClick={() => setPicked(null)}>Cancel</button><button className="btn honey" onClick={() => void send()}><Upload />Upload v{nextVersion}</button></div>
          </div>
        ) : versions.length ? (
          <button className="btn ve-upload-btn" onClick={() => input.current?.click()}><Upload />Upload v{nextVersion}</button>
        ) : (
          <button className="ve-dropzone" onClick={() => input.current?.click()}>
            <Upload /><b>Upload edited version</b><span>Drop the file here · MP4 or MOV</span>
          </button>
        )}
        {error ? <span className="ve-error">{error}</span> : null}
        {fileInput}
      </div>
    </div>
  );
}

function Thread({ card, user }: { card: StaffCard; user: SessionUser }) {
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const list = useRef<HTMLDivElement>(null);
  const first = firstName(card.member.name);
  // Newest at the bottom, inside the thread's own scroll (the panel stays where it is).
  useEffect(() => { if (list.current) list.current.scrollTop = list.current.scrollHeight; }, [card.thread.length]);

  async function send() {
    const body = text.trim();
    if (!body || !card.conversationId || sending) return;
    setSending(true);
    const failed = await replyToStudent(card.id, card.conversationId, body);
    setSending(false);
    setError(failed);
    if (!failed) setText("");
  }
  async function markFixed(commentId: string, slot: number) {
    const newest = versionsOf(card.edits, slot).find((v) => v.status === "ready");
    setError(await staffComment(card.id, { resolveCommentId: commentId, resolvedInEditId: newest?.id ?? null }));
  }

  return (
    <section className="ve-thread-sec">
      <div className="ve-sec-head"><h3>Comments & messages</h3><span className="faint">Also in your Messages</span></div>
      <div className="ve-thread" ref={list}>
        {card.thread.length === 0 ? <p className="faint">Nothing yet. Her notes on a moment and your messages with her show here.</p> : null}
        {card.thread.map((item, index) => {
          const comment = item.kind === "comment" ? card.comments.find((c) => c.id === item.id) : undefined;
          const newDay = index === 0 || new Date(card.thread[index - 1].at).toDateString() !== new Date(item.at).toDateString();
          return (
            <div key={`${item.kind}:${item.id}`}>
              {newDay ? <div className="ve-day">{dayLabel(item.at)}</div> : null}
              <div className="ve-thread-item">
                <Avatar name={item.author.name} src={item.author.avatarUrl} seed={item.author.id} size={28} />
                <div>
                  <div className="ve-thread-meta">
                    <b>{item.author.id === user.id ? "You" : item.author.name}</b>
                    {item.kind === "comment" ? (
                      <span className="ve-tchip"><Clock />Video {item.slot}{item.atSeconds != null ? ` at ${formatMoment(item.atSeconds)}` : ""}{item.version ? ` · v${item.version}` : ""}</span>
                    ) : <span className="ve-tchip"><MessageCircle />Message</span>}
                    <span className="faint">{clock(item.at)}</span>
                  </div>
                  <p>{item.body}</p>
                  {comment?.resolvedInVersion ? <span className="ve-fixed"><Check />Fixed in v{comment.resolvedInVersion}</span>
                    : comment && !comment.author.isEditor && item.slot ? <button className="ve-link" onClick={() => void markFixed(comment.id, item.slot!)}>Mark as fixed</button> : null}
                </div>
              </div>
            </div>
          );
        })}
      </div>
      <div className="ve-reply">
        <input className="field" placeholder={card.conversationId ? `Reply to ${first}…` : "No conversation with her yet"} disabled={!card.conversationId}
          value={text} onChange={(event) => setText(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void send(); } }} />
        <button className="ve-send" aria-label="Send" disabled={!text.trim() || sending} onClick={() => void send()}><Send /></button>
      </div>
      {error ? <span className="ve-error">{error}</span> : null}
    </section>
  );
}
