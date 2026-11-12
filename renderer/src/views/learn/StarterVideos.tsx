import { useRef, useState, type ChangeEvent, type DragEvent } from "react";
import { Check, ChevronLeft, Lock, MessageCircle, Plus, RotateCw, WifiOff, X } from "lucide-react";
import { ch, type SessionUser } from "../../lib/bridge";
import { useImprove } from "../../lib/learn";
import { editorChat, firstName, shortDay } from "../../lib/videoEdits";
import { EditorChatDock } from "./EditorParts";
import { nav } from "../../lib/nav";
import {
  CLIPS_PER_VIDEO_MAX,
  SUBMISSION_MAX_BYTES,
  addClips,
  cancelClip,
  clipCount,
  canEditClipsNow,
  clipsLabel,
  clipsOf,
  formatDuration,
  readClip,
  removeClip,
  retryClip,
  submitForEditing,
  useClipUploads,
  useSubmission,
  type ClipFile,
  type ClipUpload,
  type SubmissionVideo,
  type VideoSubmissionState,
} from "../../lib/starter";
import "../../styles/starter.css";

/*
  "Submit your 3 videos" (creatorhive-app docs/multi-clip.md): each of Video
  1, 2 and 3 takes up to 20 clips. Choose files (several at once) or drop them
  on a video; each clip streams from disk straight to storage, in parts, and
  keeps going while she uses the rest of the app. Clips can be added or
  removed until the editor starts editing (`canEditClips`), then they lock.
*/

function back() {
  nav.open({ kind: "learn", page: "improve" }, "learn", "ch");
}

const ACCEPT = "video/*,.mov,.mp4,.m4v,.webm,.hevc,.3gp,.mkv,.avi";

/** Reads each file's length and still, a few at a time, keeping the order. */
async function readAll(items: Array<{ file: File; info: ClipFile["info"] }>): Promise<ClipFile[]> {
  const out: ClipFile[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      const { meta, still } = await readClip(items[i].file);
      out[i] = { info: items[i].info, meta, still };
    }
  };
  await Promise.all(Array.from({ length: Math.min(4, items.length) }, worker));
  return out;
}

function Still({ src, fileUrl }: { src: string | null | undefined; fileUrl?: string }) {
  if (src) return <img src={src} alt="" draggable={false} />;
  if (fileUrl) return <video src={`${fileUrl}#t=0.1`} preload="metadata" muted playsInline />;
  return null;
}

function ClipTile({ clip, editable, onError }: { clip: SubmissionVideo; editable: boolean; onError: (message: string | null) => void }) {
  const [busy, setBusy] = useState(false);
  const duration = formatDuration(clip.durationSeconds);
  async function remove() {
    setBusy(true);
    onError(null);
    const error = await removeClip(clip.id);
    setBusy(false);
    if (error) onError(error);
  }
  return (
    <div className={`mc-tile ${busy ? "busy" : ""}`} title={clip.fileName}>
      <Still src={clip.thumbnailUrl} fileUrl={clip.previewUrl} />
      {duration ? <span className="mc-dur">{duration}</span> : null}
      {editable ? <button className="mc-x" aria-label={`Remove ${clip.fileName}`} title="Remove" disabled={busy} onClick={() => void remove()}><X /></button> : null}
    </div>
  );
}

function UploadTile({ up }: { up: ClipUpload }) {
  const pct = up.size ? Math.min(100, Math.round((up.sent / up.size) * 100)) : 0;
  const failed = up.status === "failed";
  const duration = formatDuration(up.durationSeconds);
  return (
    <div className={`mc-tile up ${failed ? "failed" : ""}`} title={failed ? up.error ?? up.name : up.name}>
      <Still src={up.still} />
      {failed ? (
        <button className="mc-mid mc-retry" onClick={() => retryClip(up.key)}><RotateCw /><span>Tap to try again</span></button>
      ) : up.status === "offline" ? (
        <span className="mc-mid"><WifiOff /><span>Waiting for internet</span></span>
      ) : (
        <span className="mc-mid"><b>{pct}%</b></span>
      )}
      {duration && failed ? <span className="mc-dur">{duration}</span> : null}
      {failed ? null : <span className="mc-bar"><i style={{ width: `${pct}%` }} /></span>}
      <button className="mc-x" aria-label={`Cancel ${up.name}`} title="Cancel" onClick={() => cancelClip(up.key)}><X /></button>
    </div>
  );
}

function VideoCard({ slot, state, editable, locked }: { slot: number; state: VideoSubmissionState; editable: boolean; locked: boolean }) {
  const clips = clipsOf(state, slot);
  const ups = useClipUploads().filter((u) => u.slot === slot);
  const max = state.maxClipsPerVideo ?? CLIPS_PER_VIDEO_MAX;
  const count = clips.length + ups.length;
  const [over, setOver] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  // One pick at a time, so a second pick counts the clips of the first one.
  const queue = useRef<Promise<void>>(Promise.resolve());

  function take(files: File[]) {
    queue.current = queue.current.then(() => takeNow(files)).catch(() => undefined);
  }

  // Files chosen or dropped: each gives its path on disk (for the upload), its length and a still.
  async function takeNow(files: File[]) {
    if (!editable || !files.length) return;
    setNote(null);
    const picked: Array<{ file: File; info: ClipFile["info"] }> = [];
    let notVideo = 0;
    const tooBig: string[] = [];
    for (const file of files) {
      const info = await ch.files.videoInfo(file);
      if (!info) notVideo += 1;
      else if (info.size > (state.maxBytes || SUBMISSION_MAX_BYTES)) tooBig.push(info.name);
      else picked.push({ file, info });
    }
    const room = Math.max(0, max - clipCount(slot));
    const taken = picked.slice(0, room);
    const left = picked.length - taken.length;
    const notes: string[] = [];
    if (left > 0) notes.push(`Video ${slot} can hold ${max} clips. ${left} ${left === 1 ? "wasn't" : "weren't"} added.`);
    if (tooBig.length) notes.push(`${tooBig.join(", ")} ${tooBig.length === 1 ? "is" : "are"} over 5 GB. Trim it or export it smaller, then try again.`);
    if (notVideo) notes.push(notVideo === 1 ? "One file isn't a video, so it wasn't added." : `${notVideo} files aren't videos, so they weren't added.`);
    setNote(notes.length ? notes.join(" ") : null);
    if (!taken.length) return;
    const read = await readAll(taken);
    // Another device may have added some meanwhile: keep to the limit.
    addClips(slot, read.slice(0, Math.max(0, max - clipCount(slot))));
  }
  function choose() {
    setNote(null);
    input.current?.click();
  }
  function picked(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    take(files);
  }
  const dropProps = editable ? {
    onDragOver: (event: DragEvent) => { event.preventDefault(); setOver(true); },
    onDragLeave: (event: DragEvent) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOver(false); },
    onDrop: (event: DragEvent) => { event.preventDefault(); setOver(false); take(Array.from(event.dataTransfer.files)); },
  } : {};
  const failed = ups.find((u) => u.status === "failed" && u.error);

  return (
    <div className={`card mc-card ${over ? "over" : ""}`} {...dropProps}>
      <div className="mc-head">
        <b>Video {slot}</b>
        {locked ? <span className="mc-sent"><Check />Sent · {clipsLabel(clips.length)}</span> : count ? <span className="muted">{clipsLabel(count)}</span> : null}
      </div>
      {count === 0 && editable ? (
        <div className="mc-empty">
          <button className="mc-drop" onClick={choose}>
            <span className="st-drop-ico"><Plus /></span>
            <b>Add the clips for this video</b>
            <span className="faint">or drag them here</span>
          </button>
          <button className="btn honey lg" onClick={choose}>Choose files</button>
        </div>
      ) : (
        <div className="mc-grid">
          {clips.map((clip) => <ClipTile key={clip.id} clip={clip} editable={editable} onError={setNote} />)}
          {ups.map((up) => <UploadTile key={up.key} up={up} />)}
          {editable && count < max ? (
            <button className="mc-tile mc-add" onClick={choose}><Plus /><span>Add clips</span></button>
          ) : null}
        </div>
      )}
      {note ? <span className="st-error">{note}</span> : failed ? <span className="st-error">{failed.error}</span> : null}
      <input ref={input} type="file" multiple accept={ACCEPT} hidden onChange={picked} />
    </div>
  );
}

export function StarterVideos({ user }: { user: SessionUser }) {
  const { data, isLoading, isError } = useSubmission();
  const uploads = useClipUploads();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [brief, setBrief] = useState("");
  const state = data?.state ?? null;
  const editing = state?.editing ?? null;
  const editorName = editing?.editor ? firstName(editing.editor.name) : null;
  const submitted = state?.status === "submitted";
  const editable = canEditClipsNow(state);
  const locked = submitted && !editable;
  const filled = [1, 2, 3].filter((slot) => clipsOf(state, slot).length > 0).length;
  const busy = uploads.length > 0;
  const stuck = uploads.some((u) => u.status === "failed");
  const ready = filled === 3 && !busy;
  // The Weekend Starter: step 2 waits for the course.
  const courseFirst = useImprove().data?.starter?.steps.find((s) => s.id === "three_videos")?.locked ?? null;
  const editor = editorName ?? "our editor";

  async function submit() {
    setSubmitting(true);
    setError(await submitForEditing(brief));
    setSubmitting(false);
  }

  return (
    <div className="ve-with-dock">
    <div className="page">
      <div className="mhead">
        <button className="btn ghost st-back" onClick={back}><ChevronLeft />Improve</button>
        <h1>Submit your 3 videos</h1>
        {editing?.editor ? <div className="acts"><button className="btn" onClick={() => editorChat.open()}><MessageCircle />Message {editorName}</button></div> : null}
      </div>
      <div className="scroll page-body st-videos">
        <p className="st-lede">Add all the clips you filmed for each video. {editorName ? `${editorName}, your editor,` : "Our editor"} puts them together for you. We keep your files at full quality.</p>
        {isLoading ? <div className="empty-state">Loading…</div> : null}
        {isError ? <div className="empty-state">Couldn't load your videos.</div> : null}
        {data?.unavailable ? <div className="empty-state">{data.unavailable}</div> : null}
        {courseFirst && !submitted ? (
          <div className="card ve-locked-big"><Lock /><b>{courseFirst}</b><span className="muted">Go through the video course on Improve first, then your 3 videos open here.</span></div>
        ) : null}
        {state && submitted ? (
          <div className="st-sent big">
            <span className="st-sent-tick"><Check /></span>
            <div>
              <b>Submitted{state.submittedAt ? ` ${shortDay(state.submittedAt)}` : ""}, {editor} is on it</b>
              <span>{editable ? `Sent. You can still add or remove clips until ${editorName ?? "your editor"} starts editing.`
                : `Your clips are with ${editorName ?? "our editor"}, at full quality. To change a clip now, message him.`}</span>
            </div>
          </div>
        ) : null}
        {state && !(courseFirst && !submitted) ? (
          <div className="st-slot-grid mc-cards">
            {[1, 2, 3].map((slot) => <VideoCard key={slot} slot={slot} state={state} editable={editable} locked={locked} />)}
          </div>
        ) : null}
        {state && !submitted && !courseFirst ? (
          <div className="card st-submit ve-submit">
            <label className="ve-brief-field">
              <b>Notes for {editorName ?? "your editor"} <span className="faint">(optional)</span></b>
              <textarea className="field area" maxLength={2000} rows={3} value={brief} onChange={(event) => setBrief(event.target.value)}
                placeholder="What are they for? Music you like, captions, a part to cut…" />
            </label>
            <div className="mc-foot">
              <button className="btn honey lg" disabled={!ready || submitting} onClick={() => void submit()}>{submitting ? "Submitting…" : "Submit for editing"}</button>
              <span className="muted">{filled < 3 ? "Add clips to all 3 videos to submit"
                : stuck ? "A clip didn't upload. Tap it to try again, or remove it."
                : busy ? "Your clips are uploading. You can leave this screen."
                : "All 3 videos have clips. Check they are the right ones."}</span>
              {error ? <span className="st-error">{error}</span> : null}
            </div>
          </div>
        ) : null}
        {state && submitted && editable && busy ? <span className="muted mc-note">Your clips are uploading. You can leave this screen.</span> : null}
      </div>
    </div>
    <EditorChatDock editing={editing} user={user} />
    </div>
  );
}
