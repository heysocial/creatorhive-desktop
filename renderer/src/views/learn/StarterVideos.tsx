import { useEffect, useRef, useState, type ChangeEvent, type DragEvent } from "react";
import { Check, ChevronLeft, ChevronRight, FileText, Lock, MessageCircle, Plus, RotateCw, Send, WifiOff, X } from "lucide-react";
import { ch, type SessionUser } from "../../lib/bridge";
import { useImprove } from "../../lib/learn";
import { editorChat, firstName, listOf } from "../../lib/videoEdits";
import { StagePill } from "../edits/VideoEdits";
import { EditorChatDock } from "./EditorParts";
import { nav } from "../../lib/nav";
import {
  CLIPS_PER_VIDEO_MAX,
  SUBMISSION_MAX_BYTES,
  addClips,
  cancelClip,
  clipCount,
  clipsLabel,
  clipsOf,
  formatDuration,
  needsScript,
  readClip,
  removeClip,
  retryClip,
  scriptOf,
  sendVideo,
  slotStates,
  submitForEditing,
  useClipUploads,
  useSubmission,
  type ClipFile,
  type ClipUpload,
  type SubmissionVideo,
  type VideoSubmissionState,
} from "../../lib/starter";
import { ScriptChecklist, ScriptField, ScriptViewer } from "./VideoScript";
import "../../styles/starter.css";

/*
  "Submit your 3 videos" (creatorhive-app docs/multi-clip.md): each of Video
  1, 2 and 3 takes up to 20 clips. Choose files (several at once) or drop them
  on a video; each clip streams from disk straight to storage, in parts, and
  keeps going while she uses the rest of the app. Clips can be added or
  removed until the editor starts editing (`canEditClips`), then they lock.

  Each video is sent on its own (docs/per-video-send.md): "Send Video N to
  Valentin" on its page, with a note; the overview sends the rest together.
  Only the video he started editing locks.
*/

function back() {
  nav.open({ kind: "learn", page: "improve" }, "learn", "ch");
}

/* The video whose file dialog opens as soon as its screen shows (one time, not kept in history). */
let pickOnOpen: number | null = null;

/**
  Opens one video's screen (website: /library/videos?video=N). With `pick`, the
  file dialog opens straight away so she can choose all its clips at once.
*/
export function openVideo(slot: number, pick: boolean) {
  pickOnOpen = pick ? slot : null;
  nav.open({ kind: "starter-videos", video: slot }, "learn", "ch");
}

/** The overview with all 3 videos, notes and Submit (website: /library/videos). */
export function openAllVideos() {
  pickOnOpen = null;
  nav.open({ kind: "starter-videos" }, "learn", "ch");
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

function VideoCard({ slot, state, editable, sent }: { slot: number; state: VideoSubmissionState; editable: boolean; sent: boolean }) {
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
  // Opened from an empty Video N slot or "Next: Video N": the dialog opens at once.
  useEffect(() => {
    if (pickOnOpen !== slot) return;
    pickOnOpen = null;
    if (editable) choose();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
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
  // The Weekend Starter (creatorhive-app docs/video-scripts.md): "Your script" above "Your video".
  const withScript = state.scriptRequired === true;
  const script = scriptOf(state, slot);
  const [viewing, setViewing] = useState(false);

  return (
    <div className={`card mc-card ${over ? "over" : ""}`} {...dropProps}>
      <div className="mc-head">
        <b>Video {slot}</b>
        {sent ? <span className="mc-sent">{editable ? <Send /> : <Check />}Sent · {clipsLabel(editable ? count : clips.length)}</span> : count ? <span className="muted">{clipsLabel(count)}</span> : null}
        {withScript ? <ScriptChecklist script={Boolean(script)} video={clips.length > 0 && ups.length === 0} /> : null}
      </div>
      {withScript && !sent ? <ScriptField slot={slot} script={script} required /> : null}
      {withScript && sent && script ? (
        <div className="vs-sent-row">
          <button type="button" className="btn" onClick={() => setViewing(true)}><FileText />View script</button>
          <span className="faint">Locked after sending</span>
        </div>
      ) : null}
      {viewing && script ? <ScriptViewer script={script} onClose={() => setViewing(false)} /> : null}
      {withScript && !sent ? <span className="vs-label">Your video</span> : null}
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

export function StarterVideos({ user, video }: { user: SessionUser; video?: number }) {
  const { data, isLoading, isError } = useSubmission();
  const uploads = useClipUploads();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [brief, setBrief] = useState("");
  const [notes, setNotes] = useState<Record<number, string>>({});
  const state = data?.state ?? null;
  const editing = state?.editing ?? null;
  const editorName = editing?.editor ? firstName(editing.editor.name) : null;
  const editor = editorName ?? "Valentin";
  // Each video on its own (docs/per-video-send.md); older servers: the whole card on every video.
  const slots = slotStates(state);
  const slotOf = (slot: number) => slots[slot - 1];
  const unsent = [1, 2, 3].filter((slot) => slotOf(slot).stage === null);
  const sentSlots = [1, 2, 3].filter((slot) => slotOf(slot).stage !== null);
  const allSent = Boolean(state) && unsent.length === 0;
  const anySent = sentSlots.length > 0;
  const anyLocked = slots.some((s) => !s.canEditClips);
  const clipsIn = (slot: number) => clipsOf(state, slot).length;
  const uploadsIn = (slot: number) => uploads.filter((u) => u.slot === slot).length;
  const hasClips = (slot: number) => clipsIn(slot) + uploadsIn(slot) > 0;
  const busy = uploads.length > 0;
  const stuck = uploads.some((u) => u.status === "failed");
  // The Weekend Starter: no video goes without its script (creatorhive-app docs/video-scripts.md).
  const noScript = unsent.filter((slot) => needsScript(state, slot));
  const unsentReady = unsent.length > 0 && unsent.every((slot) => clipsIn(slot) > 0) && !busy && noScript.length === 0;
  const sendAllLabel = unsent.length === 3 ? `Send all 3 to ${editor}` : `Send ${listOf(unsent)} to ${editor}`;
  // The Weekend Starter: step 2 waits for the course.
  const courseFirst = useImprove().data?.starter?.steps.find((s) => s.id === "three_videos")?.locked ?? null;
  const gated = Boolean(courseFirst) && !anySent;
  const one = video && video >= 1 && video <= 3 ? video : null;
  const current = one ? slotOf(one) : null;
  // The next video not sent yet: an empty one first, in order after this one.
  const after = one ? [1, 2, 3].map((n) => ((one + n - 1) % 3) + 1).filter((slot) => slot !== one && slotOf(slot).stage === null) : [];
  const nextUnsent = after.find((slot) => !hasClips(slot)) ?? after[0] ?? null;
  const oneUploading = one ? uploadsIn(one) > 0 : false;
  const showSendOne = Boolean(one && current && current.stage === null && clipsIn(one!) > 0);
  const oneNoScript = one ? needsScript(state, one) : false;
  const canSendOne = showSendOne && !oneUploading && !oneNoScript;

  async function submit() {
    setSubmitting(true);
    setError(await submitForEditing(brief));
    setSubmitting(false);
  }
  async function sendOne(slot: number) {
    setSubmitting(true);
    setError(await sendVideo(slot, notes[slot] ?? ""));
    setSubmitting(false);
  }
  const goNext = (slot: number) => openVideo(slot, !hasClips(slot) && slotOf(slot).canEditClips);

  const footLine = stuck ? "A clip didn't upload. Tap it to try again, or remove it."
    : busy ? "Your clips are uploading. You can leave this screen."
    : noScript.length ? `Add the script for ${listOf(noScript)} to send ${noScript.length === 1 ? "it" : "them"}.`
    : unsentReady ? (unsent.length === 3 ? "All 3 videos have clips. Check they are the right ones." : `${listOf(unsent)} ${unsent.length === 1 ? "has" : "have"} clips. Check they are the right ones.`)
    : unsent.length === 3 ? "Add clips to all 3 videos to send them together, or send each one from its own page"
    : `Add clips to ${listOf(unsent.filter((slot) => clipsIn(slot) === 0))} to send the rest`;

  return (
    <div className="ve-with-dock">
    <div className="page">
      <div className="mhead">
        <button className="btn ghost st-back" onClick={back}><ChevronLeft />{one ? "Back to Improve" : "Improve"}</button>
        <h1>{one ? `Video ${one}` : "Submit your 3 videos"}</h1>
        {editing?.editor ? <div className="acts"><button className="btn" onClick={() => editorChat.open()}><MessageCircle />Message {editorName}</button></div> : null}
      </div>
      <div className="scroll page-body st-videos">
        {one ? (
          <>
            <div className="seg mc-switch" role="tablist" aria-label="Your 3 videos">
              {[1, 2, 3].map((slot) => {
                const n = clipsIn(slot) + uploadsIn(slot);
                const sent = slotOf(slot).stage !== null;
                return (
                  <button key={slot} role="tab" aria-selected={slot === one} className={slot === one ? "on" : ""}
                    onClick={() => slot !== one && openVideo(slot, false)}>
                    Video {slot}
                    {sent ? <span className="mc-switch-sent"><Send />Sent</span>
                      : n ? <span className="mc-switch-n">{uploadsIn(slot) ? null : <Check />}{n}</span> : null}
                  </button>
                );
              })}
            </div>
            {current?.stage ? null : <p className="st-lede">Add all the clips you filmed for this video. {editorName ?? "Our editor"} puts them together for you.</p>}
          </>
        ) : (
          <p className="st-lede">Add all the clips you filmed for each video. Send each one to {editor} when it's ready, or all 3 together. We keep your files at full quality.</p>
        )}
        {isLoading ? <div className="empty-state">Loading…</div> : null}
        {isError ? <div className="empty-state">Couldn't load your videos.</div> : null}
        {data?.unavailable ? <div className="empty-state">{data.unavailable}</div> : null}
        {gated ? (
          <div className="card ve-locked-big"><Lock /><b>{courseFirst}</b><span className="muted">Go through the video course on Improve first, then your 3 videos open here.</span></div>
        ) : null}
        {error ? <span className="st-error mc-error" role="alert">{error}</span> : null}
        {state && !one && allSent ? (
          <div className="st-sent big">
            <span className="st-sent-tick"><Check /></span>
            <div>
              <b>All 3 sent, {editor} is on it</b>
              <span>{editing?.nextLine ?? "We'll tell you when your edited videos are ready to review."}</span>
            </div>
          </div>
        ) : null}
        {state && one && current?.stage ? (
          <div className="st-sent big mc-sent-banner" role="status">
            <span className="st-sent-tick"><Send /></span>
            <div>
              <b>Video {one} is with {editor}</b>
              <span>{current.line || "Sent."}</span>
            </div>
            <StagePill stage={current.stage} small />
          </div>
        ) : null}
        {state && one && !gated ? (
          <div className="mc-one">
            <VideoCard key={one} slot={one} state={state} editable={slotOf(one).canEditClips} sent={slotOf(one).stage !== null} />
          </div>
        ) : null}
        {state && showSendOne && !gated ? (
          <div className="card st-submit ve-submit mc-send-one">
            <label className="ve-brief-field">
              <b>A note for {editor} about Video {one} <span className="faint">(optional)</span></b>
              <span className="muted">The brand you're aiming at, the music you like, captions or not, your favourite take…</span>
              <textarea className="field area" maxLength={2000} rows={3} value={notes[one!] ?? ""}
                onChange={(event) => setNotes((n) => ({ ...n, [one!]: event.target.value }))}
                placeholder="Upbeat music but not too loud, white captions." />
            </label>
            <div className="mc-foot">
              <button className="btn honey lg" disabled={!canSendOne || submitting} onClick={() => void sendOne(one!)}><Send />{submitting ? "Sending…" : `Send Video ${one} to ${editor}`}</button>
              <span className="muted">{oneUploading ? "Wait for the clips to finish uploading, then send it." : oneNoScript ? "Add the script to send." : `${editor} starts on it once you send it. You can still change its clips until he starts editing.`}</span>
            </div>
          </div>
        ) : null}
        {state && one && !gated && nextUnsent ? (
          <div className="mc-next-row">
            <button className={`btn lg mc-next ${showSendOne ? "" : "honey"}`} onClick={() => goNext(nextUnsent)}>Next: Video {nextUnsent}<ChevronRight /></button>
            {current?.stage === null && clipsIn(one) === 0 ? (
              <span className="muted">{busy ? "Your clips are uploading. You can leave this screen." : "Add clips to this video, then send it, or move on to the next one."}</span>
            ) : null}
          </div>
        ) : null}
        {state && one && !nextUnsent && allSent ? (
          <div className="mc-next-row">
            <span className="muted">All 3 videos are with {editor}.</span>
            <button className="btn honey lg mc-next" onClick={back}>Back to Improve</button>
          </div>
        ) : null}
        {state && !one && !gated ? (
          <div className="st-slot-grid mc-cards">
            {[1, 2, 3].map((slot) => <VideoCard key={slot} slot={slot} state={state} editable={slotOf(slot).canEditClips} sent={slotOf(slot).stage !== null} />)}
          </div>
        ) : null}
        {state && !one && !allSent && !gated ? (
          <div className="card st-submit ve-submit">
            <label className="ve-brief-field">
              <b>Notes for {editor} <span className="faint">(optional)</span></b>
              <textarea className="field area" maxLength={2000} rows={3} value={brief} onChange={(event) => setBrief(event.target.value)}
                placeholder="What are they for? Music you like, captions, a part to cut…" />
            </label>
            <div className="mc-foot">
              <button className="btn honey lg" disabled={!unsentReady || submitting} onClick={() => void submit()}><Send />{submitting ? "Sending…" : sendAllLabel}</button>
              <span className="muted">{footLine}</span>
              {sentSlots.length ? <span className="muted">{listOf(sentSlots)} {sentSlots.length === 1 ? "is" : "are"} already with {editor}.</span> : null}
            </div>
          </div>
        ) : null}
        {state && !one && allSent ? (
          <span className="muted mc-note">{busy ? "Your clips are uploading. You can leave this screen."
            : anyLocked ? `Your clips are with ${editor}, at full quality. To change a clip in a video he's editing, message him.`
            : `Sent. You can still add or remove clips until ${editor} starts editing.`}</span>
        ) : null}
      </div>
    </div>
    <EditorChatDock editing={editing} user={user} />
    </div>
  );
}
