import { useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import {
  ArrowLeft, ArrowUp, Check, ChevronDown, CircleCheck, Clock, Download, Eye, Maximize, MessageCircle, MessageSquarePlus, Pause, Play,
  RotateCcw, Trash2, Volume2, VolumeX,
} from "lucide-react";
import { ch, type SessionUser } from "../../lib/bridge";
import { ago } from "../../lib/format";
import { nav } from "../../lib/nav";
import { Avatar } from "../../lib/ui";
import {
  addStudentComment, deleteStudentComment, downloadFinal, editorChat, firstName, formatMoment, markWatched, reviewVideo, shortDay,
  useStudentEditing, versionsOf, type EditComment, type EditVersion, type ReviewState, type StudentEditState,
} from "../../lib/videoEdits";
import { useVideoSource, VideoStill } from "../edits/Player";
import { EditorChatDock } from "./EditorParts";
import "../../styles/video-edits.css";

/*
  "Review your edited videos" (creatorhive-app docs/video-editor.md): a tab per
  video, the vertical player with its versions, a timeline with a marker per
  note (click it to seek, click anywhere to note that moment), the notes, and
  Approve / Request changes; an approved video downloads at full quality.
*/

const REVIEW_LABEL: Record<ReviewState, string> = { pending: "Ready to review", approved: "Approved", changes_requested: "Changes requested" };

function ReviewPill({ state, hasVersion }: { state: ReviewState | undefined; hasVersion: boolean }) {
  if (!hasVersion) return <span className="ve-rpill r-none"><Clock />Being edited</span>;
  const s = state ?? "pending";
  const Icon = s === "approved" ? CircleCheck : s === "changes_requested" ? RotateCcw : Eye;
  return <span className={`ve-rpill r-${s}`}><Icon />{REVIEW_LABEL[s]}</span>;
}

export function VideoReview({ user, video }: { user: SessionUser; video?: number }) {
  const { editing, state, isLoading, isError, refetch } = useStudentEditing();
  const slot = video && video >= 1 && video <= 3 ? video : firstToReview(editing);
  const editor = editing?.editor;
  const first = editor ? firstName(editor.name) : "your editor";
  const back = () => nav.open({ kind: "learn", page: "improve" }, "learn", "ch");

  return (
    <div className="ve-with-dock">
      <div className="page">
        <div className="scroll page-body ve-review">
          <button className="ve-back" onClick={back}><ArrowLeft />Your first 3 videos</button>
          <div className="ve-review-head">
            <div>
              <h1>Review your edited videos</h1>
              <p className="muted">Watch each one. Click the timeline to leave a note at that exact moment, then approve or ask for changes.</p>
            </div>
            {editor ? <button className="btn ve-msg-btn" onClick={() => editorChat.open()}><MessageCircle />Message {first}</button> : null}
          </div>
          {isLoading ? <div className="empty-state">Loading…</div> : null}
          {isError ? <div className="empty-state"><div className="err-state">Couldn't load your videos.<button className="btn" onClick={() => void refetch()}>Try again</button></div></div> : null}
          {editing && !editing.edits.length ? (
            <div className="empty-state">{first} is still editing your videos. You'll get a notification when they're ready to review.</div>
          ) : null}
          {editing && editing.edits.length ? (
            <>
              <div className="ve-tabs" role="tablist">
                {[1, 2, 3].map((n) => {
                  const newest = versionsOf(editing.edits, n)[0];
                  const original = state?.videos.find((v) => v.slot === n);
                  const review = editing.reviews.find((r) => r.slot === n);
                  return (
                    <button key={n} role="tab" aria-selected={n === slot} className={`ve-tab ${n === slot ? "on" : ""}`}
                      onClick={() => nav.open({ kind: "video-review", video: n }, "learn", "ch")}>
                      <VideoStill thumbnailUrl={newest?.playback?.thumbnailUrl ?? original?.thumbnailUrl} fileUrl={newest?.viewUrl ?? original?.previewUrl} />
                      <span><b>Video {n}{original ? <span className="faint"> · {original.fileName}</span> : null}</b><ReviewPill state={review?.state} hasVersion={Boolean(newest)} /></span>
                    </button>
                  );
                })}
              </div>
              <SlotReview key={slot} slot={slot} editing={editing} user={user} />
            </>
          ) : null}
        </div>
      </div>
      <EditorChatDock editing={editing} user={user} />
    </div>
  );
}

function firstToReview(editing: StudentEditState | null) {
  if (!editing) return 1;
  const pending = [1, 2, 3].find((n) => versionsOf(editing.edits, n).length && (editing.reviews.find((r) => r.slot === n)?.state ?? "pending") === "pending");
  return pending ?? 1;
}

function SlotReview({ slot, editing, user }: { slot: number; editing: StudentEditState; user: SessionUser }) {
  const versions = versionsOf(editing.edits, slot);
  const review = editing.reviews.find((r) => r.slot === slot);
  const [versionId, setVersionId] = useState<string | null>(versions[0]?.id ?? null);
  const version = versions.find((v) => v.id === versionId) ?? versions[0] ?? null;
  const comments = useMemo(() => editing.comments.filter((c) => c.slot === slot).sort((a, b) => (a.atSeconds ?? 1e9) - (b.atSeconds ?? 1e9) || a.createdAt.localeCompare(b.createdAt)), [editing.comments, slot]);
  const element = useRef<HTMLVideoElement>(null);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(version?.durationSeconds ?? 0);
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(false);
  const [moment, setMoment] = useState<number | null>(null);
  const [lit, setLit] = useState<string | null>(null);
  useVideoSource(element, version);
  useEffect(() => { setDuration(version?.durationSeconds ?? 0); setTime(0); setMoment(null); }, [version?.id]);

  if (!version) {
    return <div className="empty-state">{firstName(editing.editor?.name ?? "Your editor")} is still editing Video {slot}.</div>;
  }

  const seek = (seconds: number) => {
    const el = element.current;
    if (!el) return;
    el.currentTime = Math.max(0, Math.min(seconds, (el.duration || duration || seconds)));
    setTime(el.currentTime);
  };
  const toggle = () => {
    const el = element.current;
    if (!el) return;
    if (el.paused) void el.play().catch(() => {});
    else el.pause();
  };
  async function versionMenu() {
    const choice = await ch.menu.popup(versions.map((v) => ({ id: v.id, label: `Edited · v${v.version}`, sublabel: [shortDay(v.sentAt ?? v.createdAt), v.note].filter(Boolean).join(" · "), checked: v.id === version!.id })));
    if (choice) setVersionId(choice);
  }
  const length = duration || version.durationSeconds || 0;
  const pick = (event: MouseEvent<HTMLDivElement>) => {
    if (!length) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const at = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)) * length;
    setMoment(at);
    seek(at);
    document.querySelector<HTMLInputElement>(".ve-composer input")?.focus();
  };
  const jump = (comment: EditComment) => {
    if (comment.atSeconds != null) seek(comment.atSeconds);
    setLit(comment.id);
  };

  return (
    <div className="ve-review-cols">
      <div className="ve-player-col">
        <div className="ve-player">
          <video ref={element} playsInline muted={muted} onClick={toggle}
            onPlay={() => { setPlaying(true); markWatched(slot, version.id); }} onPause={() => setPlaying(false)}
            onTimeUpdate={(event) => setTime(event.currentTarget.currentTime)}
            onLoadedMetadata={(event) => { if (Number.isFinite(event.currentTarget.duration)) setDuration(event.currentTarget.duration); }} />
          <button className="ve-version-btn" onClick={() => void versionMenu()} disabled={versions.length < 2} title={versions.length < 2 ? undefined : "Older versions"}>
            Edited · v{version.version}{versions.length > 1 ? <ChevronDown /> : null}
          </button>
          <div className="ve-controls">
            <button className="ve-pp" aria-label={playing ? "Pause" : "Play"} onClick={toggle}>{playing ? <Pause /> : <Play />}</button>
            <span className="ve-time">{formatMoment(time)} / {formatMoment(length)}</span>
            <button aria-label={muted ? "Sound on" : "Mute"} onClick={() => setMuted(!muted)}>{muted ? <VolumeX /> : <Volume2 />}</button>
            <button aria-label="Full screen" onClick={() => void element.current?.requestFullscreen().catch(() => {})}><Maximize /></button>
          </div>
        </div>
        <div className="ve-timeline" onClick={pick} role="slider" aria-label="Timeline: click to note a moment" aria-valuemin={0} aria-valuemax={Math.round(length)} aria-valuenow={Math.round(time)}>
          <span className="ve-tl-track"><i style={{ width: `${length ? Math.min(100, (time / length) * 100) : 0}%` }} /></span>
          <span className="ve-tl-head" style={{ left: `${length ? Math.min(100, (time / length) * 100) : 0}%` }} />
          {moment != null && length ? <span className="ve-tl-moment" style={{ left: `${(moment / length) * 100}%` }} /> : null}
          {length ? comments.filter((c) => c.atSeconds != null && c.atSeconds <= length + 0.5).map((c) => (
            <button key={c.id} className={`ve-marker ${c.author.isEditor ? "editor" : "me"} ${c.resolvedInVersion ? "fixed" : ""} ${lit === c.id ? "lit" : ""}`}
              style={{ left: `${Math.min(100, (c.atSeconds! / length) * 100)}%` }} title={`${c.author.name} at ${formatMoment(c.atSeconds!)}: ${c.body}`}
              onClick={(event) => { event.stopPropagation(); jump(c); }}>
              {c.author.name.slice(0, 1).toUpperCase()}
            </button>
          )) : null}
        </div>
        <p className="faint ve-tl-help"><MessageSquarePlus />Click anywhere on the timeline to comment at that moment.</p>
      </div>
      <div className="ve-side-col">
        <Comments slot={slot} version={version} comments={comments} user={user} lit={lit} onJump={jump}
          moment={moment ?? time} onClearMoment={() => setMoment(null)} />
        <Decision slot={slot} version={version} review={review?.state ?? "pending"} decidedVersion={review?.editId === version.id}
          openNotes={comments.filter((c) => c.author.id === user.id && c.editId === version.id && !c.resolvedInVersion).length} />
      </div>
    </div>
  );
}

function Comments({ slot, version, comments, user, lit, onJump, moment, onClearMoment }: {
  slot: number; version: EditVersion; comments: EditComment[]; user: SessionUser; lit: string | null; onJump: (c: EditComment) => void;
  moment: number; onClearMoment: () => void;
}) {
  const [text, setText] = useState("");
  const [general, setGeneral] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function send() {
    const body = text.trim();
    if (!body || sending) return;
    setSending(true);
    const failed = await addStudentComment({ slot, editId: version.id, atSeconds: general ? null : moment, body });
    setSending(false);
    setError(failed);
    if (!failed) { setText(""); onClearMoment(); }
  }
  return (
    <section className="card ve-comments">
      <div className="ve-comments-head">
        <b>Comments on Video {slot}</b><span className="ve-count">{comments.length}</span>
        <span className="faint">Edited v{version.version} · {shortDay(version.sentAt ?? version.createdAt)}</span>
      </div>
      <div className="ve-comment-list">
        {comments.length === 0 ? <p className="faint ve-empty-note">No notes yet. Play the video and click the timeline where you'd like a change.</p> : null}
        {comments.map((c) => (
          <div key={c.id} className={`ve-comment ${lit === c.id ? "lit" : ""}`}>
            <Avatar name={c.author.name} src={c.author.avatarUrl} seed={c.author.id} size={28} />
            <div>
              <div className="ve-comment-meta">
                <b>{c.author.id === user.id ? firstName(c.author.name) : c.author.name}</b>
                {c.atSeconds != null ? <button className={`ve-ts ${c.author.isEditor ? "editor" : ""}`} onClick={() => onJump(c)}><Clock />{formatMoment(c.atSeconds)}</button> : <span className="ve-ts general">General</span>}
                {c.version && c.version !== version.version ? <span className="tag-s">v{c.version}</span> : null}
                <span className="faint">{ago(c.createdAt)}</span>
                {c.author.id === user.id && !c.resolvedInVersion ? (
                  <button className="ve-del" aria-label="Delete this note" title="Delete" onClick={() => void deleteStudentComment(c.id).then(setError)}><Trash2 /></button>
                ) : null}
              </div>
              <p>{c.body}</p>
              {c.resolvedInVersion ? <span className="ve-fixed"><Check />Fixed in v{c.resolvedInVersion}</span> : null}
            </div>
          </div>
        ))}
      </div>
      <div className="ve-composer">
        <button className={`ve-at ${general ? "off" : ""}`} onClick={() => setGeneral(!general)} title={general ? "Pin it to this moment" : "Make it a general note"}>
          <Clock />{general ? "General" : `at ${formatMoment(moment)}`}
        </button>
        <input value={text} maxLength={2000} placeholder={general ? "Add a note about this video…" : "Add a note at this moment…"}
          onChange={(event) => setText(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); void send(); } }} />
        <button className="ve-send" aria-label="Add note" disabled={!text.trim() || sending} onClick={() => void send()}><ArrowUp /></button>
      </div>
      {error ? <span className="ve-error">{error}</span> : null}
    </section>
  );
}

function Decision({ slot, version, review, decidedVersion, openNotes }: { slot: number; version: EditVersion; review: ReviewState; decidedVersion: boolean; openNotes: number }) {
  const [busy, setBusy] = useState<null | "approve" | "changes" | "download">(null);
  const [error, setError] = useState<string | null>(null);
  async function decide(decision: "approve" | "changes") {
    setBusy(decision);
    setError(await reviewVideo(slot, decision));
    setBusy(null);
  }
  async function download() {
    setBusy("download");
    setError(await downloadFinal(slot));
    setBusy(null);
  }
  const size = version.width && version.height ? ` · ${version.width}×${version.height}` : "";
  if (review === "approved" && decidedVersion) {
    return (
      <section className="card ve-decision">
        <div className="ve-approved">
          <span><CircleCheck />Video {slot} is approved.</span>
          <button className="btn" disabled={busy === "download"} onClick={() => void download()}><Download />{busy === "download" ? "Downloading…" : `Download final${size} MP4`}</button>
        </div>
        {error ? <span className="ve-error">{error}</span> : null}
      </section>
    );
  }
  return (
    <section className="card ve-decision">
      {review === "changes_requested" && decidedVersion ? (
        <>
          <b>You asked for changes on Video {slot}</b>
          <p className="muted">Your notes went to your editor all at once. You'll get a notification when the new version is ready. Changed your mind?</p>
          <div className="ve-decision-acts">
            <button className="btn honey lg" disabled={Boolean(busy)} onClick={() => void decide("approve")}><Check />{busy === "approve" ? "Approving…" : `Approve Video ${slot}`}</button>
          </div>
        </>
      ) : (
        <>
          <b>Happy with Video {slot}?</b>
          <p className="muted">Approve it and the final file is yours to download. Or send it back with your notes: your editor gets them all at once.</p>
          <div className="ve-decision-acts">
            <button className="btn honey lg" disabled={Boolean(busy)} onClick={() => void decide("approve")}><Check />{busy === "approve" ? "Approving…" : `Approve Video ${slot}`}</button>
            <button className="btn lg" disabled={Boolean(busy)} title={openNotes === 0 ? "Tip: click the timeline to add a note at the moment you'd like changed" : undefined} onClick={() => void decide("changes")}>
              <RotateCcw />{busy === "changes" ? "Sending…" : openNotes ? `Request changes (${openNotes} ${openNotes === 1 ? "note" : "notes"})` : "Request changes"}
            </button>
          </div>
        </>
      )}
      {error ? <span className="ve-error">{error}</span> : null}
    </section>
  );
}
