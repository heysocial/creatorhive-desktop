import { useRef, useState, type ChangeEvent, type DragEvent } from "react";
import { Check, ChevronLeft, Lock, MessageCircle, Upload } from "lucide-react";
import { ch, type SessionUser } from "../../lib/bridge";
import { useImprove } from "../../lib/learn";
import { editorChat, firstName, shortDay } from "../../lib/videoEdits";
import { EditorChatDock } from "./EditorParts";
import { nav } from "../../lib/nav";
import {
  cancelSlot,
  dismissSlotError,
  readVideoMeta,
  formatBytes,
  submitForEditing,
  uploadToSlot,
  useSlotUploads,
  useSubmission,
  type SubmissionVideo,
} from "../../lib/starter";
import { Thumb } from "./StarterImprove";
import "../../styles/starter.css";

/*
  UGC Starter: "Submit your 3 videos" (creatorhive-app docs/starter-track.md).
  Pick or drop each original file; it streams from disk straight to storage.
  Replace or remove any of them until they're submitted, then they're the editor's.
*/

function back() {
  nav.open({ kind: "learn", page: "improve" }, "learn", "ch");
}

function Slot({ slot, video, locked }: { slot: number; video: SubmissionVideo | undefined; locked: boolean }) {
  const uploads = useSlotUploads();
  const up = uploads[slot];
  const [over, setOver] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const input = useRef<HTMLInputElement>(null);

  // A File (chosen or dropped) gives both its path on disk, for the upload, and its length and size.
  async function take(file: File | undefined) {
    if (!file || locked) return;
    const info = await ch.files.videoInfo(file);
    if (!info) { setError("That file isn't a video. Pick a MOV or MP4."); return; }
    setError(null);
    const meta = await readVideoMeta(file);
    void uploadToSlot(slot, info, meta);
  }
  function choose() {
    setError(null);
    input.current?.click();
  }
  function picked(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    void take(file);
  }
  async function drop(event: DragEvent) {
    event.preventDefault();
    setOver(false);
    void take(event.dataTransfer.files[0]);
  }
  const fileInput = <input ref={input} type="file" accept="video/*,.mov,.mp4,.m4v,.webm,.hevc,.3gp,.mkv,.avi" hidden onChange={picked} />;

  const dropProps = locked ? {} : {
    onDragOver: (event: DragEvent) => { event.preventDefault(); setOver(true); },
    onDragLeave: () => setOver(false),
    onDrop: (event: DragEvent) => void drop(event),
  };

  if (up) {
    const pct = up.size ? Math.min(100, Math.round((up.sent / up.size) * 100)) : 0;
    return (
      <div className="card st-slot" {...dropProps}>
        <span className="st-empty" style={{ height: 300 }}><Upload /></span>
        <div className="st-slot-foot">
          <div><b>Video {slot}</b><span className="muted">{up.name} · {formatBytes(up.size)}</span></div>
          {up.status === "failed"
            ? <button className="btn" onClick={() => { dismissSlotError(slot); void uploadToSlot(slot, up.file, up.meta); }}>Try again</button>
            : <button className="btn" onClick={() => cancelSlot(slot)}>Cancel</button>}
        </div>
        {up.status === "failed" ? <span className="st-error">{up.error}</span> : (
          <>
            <span className="st-bar"><i style={{ width: `${pct}%` }} /></span>
            <span className="faint">{up.status === "finishing" ? "Checking the file…" : `Uploading · ${pct}%`}</span>
          </>
        )}
      </div>
    );
  }

  if (video) {
    return (
      <div className={`card st-slot ${over ? "over" : ""}`} {...dropProps}>
        <Thumb video={video} height={300} />
        <div className="st-slot-foot">
          <div><b>Video {slot}</b><span className="muted">{video.fileName} · {formatBytes(video.sizeBytes)}</span></div>
          {locked ? null : <button className="btn" onClick={choose}>Replace</button>}{fileInput}
        </div>
        <span className="st-ok"><Check />Uploaded</span>
        {error ? <span className="st-error">{error}</span> : null}
      </div>
    );
  }

  return (
    <div className={`st-drop ${over ? "over" : ""}`} {...dropProps}>
      <span className="st-drop-ico"><Upload /></span>
      <b>Drop video {slot} here</b>
      <span className="muted">MOV or MP4, up to 5 GB</span>
      <button className="btn" onClick={choose}>Choose a file</button>{fileInput}
      {error ? <span className="st-error">{error}</span> : null}
    </div>
  );
}

export function StarterVideos({ user }: { user: SessionUser }) {
  const { data, isLoading, isError } = useSubmission();
  const uploads = useSlotUploads();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [brief, setBrief] = useState("");
  const state = data?.state ?? null;
  const editing = state?.editing ?? null;
  const editorName = editing?.editor ? firstName(editing.editor.name) : null;
  const bySlot = new Map((state?.videos ?? []).map((v) => [v.slot, v]));
  const submitted = state?.status === "submitted";
  // After Submit, Replace stays open until the editor starts (`canReplace`).
  const locked = submitted && !editing?.canReplace;
  const allIn = bySlot.size === 3 && Object.keys(uploads).length === 0;
  // The Weekend Starter: step 2 waits for the course.
  const courseFirst = useImprove().data?.starter?.steps.find((s) => s.id === "three_videos")?.locked ?? null;

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
        <h1>{submitted ? "Your 3 videos" : "Upload your 3 videos"}</h1>
        {editing?.editor ? <div className="acts"><button className="btn" onClick={() => editorChat.open()}><MessageCircle />Message {editorName}</button></div> : null}
      </div>
      <div className="scroll page-body st-videos">
        <p className="st-lede">Upload the 3 videos you filmed. {editorName ? `${editorName}, your video editor,` : "Our editor"} cuts all 3 for you. We keep your original files at full quality.</p>
        {isLoading ? <div className="empty-state">Loading…</div> : null}
        {isError ? <div className="empty-state">Couldn't load your videos.</div> : null}
        {data?.unavailable ? <div className="empty-state">{data.unavailable}</div> : null}
        {courseFirst && !submitted ? (
          <div className="card ve-locked-big"><Lock /><b>{courseFirst}</b><span className="muted">Go through the video course on Improve first, then your 3 uploads open here.</span></div>
        ) : null}
        {state && submitted ? (
          <div className="st-sent big">
            <span className="st-sent-tick"><Check /></span>
            <div>
              <b>Submitted{state.submittedAt ? ` ${shortDay(state.submittedAt)}` : ""}, {editorName ?? "our editor"} is on it</b>
              <span>{editing?.canReplace ? `You can still replace a video until ${editorName ?? "your editor"} starts editing.`
                : editing ? `Your originals are with ${editorName ?? "your editor"}, at full quality. To swap a video now, message him.`
                : "We'll message you here when your 3 edited videos are ready. Need to change one? Message us in DMs."}</span>
            </div>
          </div>
        ) : null}
        {state && !(courseFirst && !submitted) ? (
          <div className="st-slot-grid">
            {[1, 2, 3].map((slot) => <Slot key={slot} slot={slot} video={bySlot.get(slot)} locked={locked} />)}
          </div>
        ) : null}
        {state && !submitted && !courseFirst ? (
          <div className="card st-submit ve-submit">
            <label className="ve-brief-field">
              <b>Notes for {editorName ?? "your editor"} <span className="faint">(optional)</span></b>
              <textarea className="field area" maxLength={2000} rows={3} value={brief} onChange={(event) => setBrief(event.target.value)}
                placeholder="What are they for? Music you like, captions, a part to cut…" />
            </label>
            <div className="ve-submit-row">
              <div>
                <b>{allIn ? "All 3 videos are in" : "Upload all 3 videos to submit"}</b>
                <span className="muted">{allIn ? `Check they're the right takes. After you submit, they go straight to ${editorName ?? "our editor"}.` : `${bySlot.size} of 3 uploaded`}</span>
                {error ? <span className="st-error">{error}</span> : null}
              </div>
              <button className="btn honey lg" disabled={!allIn || submitting} onClick={() => void submit()}>{submitting ? "Submitting…" : allIn ? "Submit for editing" : `Submit for editing · add video ${[1, 2, 3].find((n) => !bySlot.has(n)) ?? 3} first`}</button>
            </div>
          </div>
        ) : null}
      </div>
    </div>
    <EditorChatDock editing={editing} user={user} />
    </div>
  );
}
