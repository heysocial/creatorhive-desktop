import { useRef, useState, type ChangeEvent, type DragEvent } from "react";
import { Check, ChevronLeft, Upload } from "lucide-react";
import { ch } from "../../lib/bridge";
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

export function StarterVideos() {
  const { data, isLoading, isError } = useSubmission();
  const uploads = useSlotUploads();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const state = data?.state ?? null;
  const bySlot = new Map((state?.videos ?? []).map((v) => [v.slot, v]));
  const submitted = state?.status === "submitted";
  const allIn = bySlot.size === 3 && Object.keys(uploads).length === 0;

  async function submit() {
    setSubmitting(true);
    setError(await submitForEditing());
    setSubmitting(false);
  }

  return (
    <div className="page">
      <div className="mhead">
        <button className="btn ghost st-back" onClick={back}><ChevronLeft />Improve</button>
        <h1>Submit your 3 videos</h1>
      </div>
      <div className="scroll page-body st-videos">
        <p className="st-lede">Upload the 3 videos you filmed. Our editor cuts all 3 for you. We keep your original files at full quality.</p>
        {isLoading ? <div className="empty-state">Loading…</div> : null}
        {isError ? <div className="empty-state">Couldn't load your videos.</div> : null}
        {data?.unavailable ? <div className="empty-state">{data.unavailable}</div> : null}
        {state && submitted ? (
          <div className="st-sent big">
            <span className="st-sent-tick"><Check /></span>
            <div><b>Submitted, our editor is on it</b><span>We'll message you here when your 3 edited videos are ready. Need to change one? Message us in DMs.</span></div>
          </div>
        ) : null}
        {state ? (
          <div className="st-slot-grid">
            {[1, 2, 3].map((slot) => <Slot key={slot} slot={slot} video={bySlot.get(slot)} locked={submitted} />)}
          </div>
        ) : null}
        {state && !submitted ? (
          <div className="card st-submit">
            <div>
              <b>{allIn ? "All 3 videos are in" : "Upload all 3 videos to submit"}</b>
              <span className="muted">{allIn ? "Check they're the right takes. After you submit, they go straight to our editor." : `${bySlot.size} of 3 uploaded`}</span>
              {error ? <span className="st-error">{error}</span> : null}
            </div>
            <button className="btn honey lg" disabled={!allIn || submitting} onClick={() => void submit()}>{submitting ? "Submitting…" : "Submit for editing"}</button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
