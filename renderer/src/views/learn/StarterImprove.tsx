import { useState } from "react";
import { ArrowUpRight, Check, Lock, PlayCircle, Plus, Sparkles, Upload } from "lucide-react";
import { useCourses, type ImproveResource } from "../../lib/learn";
import { editorChat, firstName, shortDay } from "../../lib/videoEdits";
import { EditorCard, WhereTracker } from "./EditorParts";
import { nav } from "../../lib/nav";
import { openUpgrade } from "../../lib/access";
import {
  formatBytes,
  formatDuration,
  markCourseDone,
  markFirstVideo,
  resetsLabel,
  STARTER_GRADE_HELP,
  STARTER_RESOURCES,
  useSlotUploads,
  useSubmission,
  type StarterGrade,
  type StarterStep,
  type StarterTrack,
  type SubmissionVideo,
} from "../../lib/starter";
import "../../styles/starter.css";

/*
  UGC Starter's Improve (creatorhive-app docs/starter-track.md): the five-step
  track, the Script Writer's allowance, and the resources with the Academy's
  greyed out. No grade card and no M1–M6 milestones: the track's grade is the grade.
*/

const SCRIPT_WRITER = "ai-script-writer";

function GradePill({ grade }: { grade: StarterGrade }) {
  return <span className={`st-grade g-${grade === "–" ? "none" : grade}`}>{grade}</span>;
}

export function Thumb({ video, height }: { video: SubmissionVideo; height: number }) {
  const duration = formatDuration(video.durationSeconds);
  return (
    <span className="st-thumb" style={{ height }}>
      {video.thumbnailUrl ? <img src={video.thumbnailUrl} alt="" /> : <video src={`${video.previewUrl}#t=0.1`} preload="metadata" muted playsInline />}
      {duration ? <span className="st-dur">{duration}</span> : null}
    </span>
  );
}

function openVideos() {
  nav.open({ kind: "starter-videos" }, "learn", "ch");
}

function StuckBox({ text }: { text: string }) {
  return (
    <div className="st-stuck">
      <span className="st-stuck-why">{text}</span>
      <b>This is the exact thing we fix on coaching calls.</b>
      <button className="btn honey" onClick={openUpgrade}>Upgrade</button>
    </div>
  );
}

function VideosCard({ step, track }: { step: StarterStep; track: StarterTrack }) {
  const submission = useSubmission().data;
  const inFlight = useSlotUploads();
  const state = submission?.state ?? null;
  const bySlot = new Map((state?.videos ?? []).map((v) => [v.slot, v]));

  if (step.state === "done" || state?.status === "submitted") {
    const editing = state?.editing;
    const editorName = editing?.editor ? firstName(editing.editor.name) : "our editor";
    return (
      <div className="card st-now">
        <div className="st-row-head">
          <div>
            <b className="st-title">{track.plan === "first3" ? `Step ${step.number} · ` : ""}{step.title}{state?.submittedAt ? <span className="ve-done-pill"><Check />Submitted {shortDay(state.submittedAt)}</span> : null}</b>
            <span className="muted">
              {editing?.canReplace ? `You can still replace a video until ${editorName} starts editing.`
                : editing ? <>Your originals are with {editorName}, at full quality. To swap a video now, <button className="ve-inline-link" onClick={() => editorChat.open()}>message him</button>.</>
                : step.detail}
            </span>
          </div>
          {track.plan === "first3" ? null : <GradePill grade={step.grade} />}
        </div>
        {editing ? null : (
          <div className="st-sent">
            <span className="st-sent-tick"><Check /></span>
            <div><b>Submitted, our editor is on it</b><span>We'll message you here when your 3 edits are ready.</span></div>
          </div>
        )}
        <div className="st-slots">{[1, 2, 3].map((slot) => {
          const v = bySlot.get(slot);
          if (!v) return <span key={slot} className="st-empty" style={{ height: 96 }} />;
          return (
            <div key={slot} className="ve-sub-slot">
              <Thumb video={v} height={editing ? 150 : 96} />
              {editing ? <span className="ve-sub-name"><b>{v.fileName}</b><small className="faint">{[formatDuration(v.durationSeconds), formatBytes(v.sizeBytes)].filter(Boolean).join(" · ")}</small></span> : null}
              {editing?.canReplace ? <button className="btn" onClick={openVideos}>Replace</button> : null}
            </div>
          );
        })}</div>
      </div>
    );
  }

  const ready = state?.videos.length ?? step.count?.value ?? 0;
  const next = [1, 2, 3].find((slot) => !bySlot.has(slot)) ?? 3;
  return (
    <div className="card st-now">
      <div className="st-row-head"><div><span className="st-eyebrow">Now</span><b className="st-title big">{step.title}</b></div>{track.plan === "first3" ? null : <GradePill grade={step.grade} />}</div>
      <p className="st-lede">Film 3 videos and upload them here. <b>Our editor cuts all 3 for you</b>, so you start pitching with a finished portfolio.</p>
      <div className="st-slots">
        {[1, 2, 3].map((slot) => {
          const v = bySlot.get(slot);
          if (v) return <Thumb key={slot} video={v} height={120} />;
          const up = inFlight[slot];
          return (
            <button key={slot} className="st-empty" style={{ height: 120 }} onClick={openVideos}>
              {up ? <><span className="st-mini-bar"><i style={{ width: `${up.size ? Math.round((up.sent / up.size) * 100) : 0}%` }} /></span><small>{up.status === "failed" ? "Upload stopped" : `Uploading ${up.size ? Math.round((up.sent / up.size) * 100) : 0}%`}</small></>
                : <><Plus /><small>Video {slot}</small></>}
            </button>
          );
        })}
      </div>
      <div className="st-progress"><span className="st-bar"><i style={{ width: `${(ready / 3) * 100}%` }} /></span><b>{ready} of 3 uploaded</b></div>
      {submission?.unavailable ? <p className="faint">{submission.unavailable}</p> : null}
      <button className="btn honey lg" onClick={openVideos}>
        <Upload />{ready === 3 ? "Review and submit" : ready === 0 ? "Upload your videos" : `Upload video ${next}`}
      </button>
      {step.stuck ? <StuckBox text={step.stuck} /> : null}
    </div>
  );
}

/** The Weekend Starter's step 1: its course, with progress, Open the course and Mark as done. */
function CourseCard({ step }: { step: StarterStep }) {
  const [busy, setBusy] = useState(false);
  const courses = useCourses().data;
  const course = step.course;
  const done = step.state === "done";
  const summary = course ? courses?.find((c) => c.slug === course.slug) : undefined;
  const lessons = course?.lessons || summary?.lessonCount || 0;
  const completed = course?.completed ?? summary?.completedCount ?? 0;
  const pct = done ? 100 : lessons ? Math.round((completed / lessons) * 100) : 0;
  const line = course ? [course.title, lessons ? `${lessons} ${lessons === 1 ? "lesson" : "lessons"}` : null, course.minutes ? `${course.minutes} min` : null].filter(Boolean).join(" · ") : step.detail;
  const toggle = (value: boolean) => { setBusy(true); void markCourseDone(value).finally(() => setBusy(false)); };
  return (
    <div className={`card st-now ${done ? "ve-done" : ""}`}>
      <div className="st-row-head">
        <div>
          {done ? null : <span className="st-eyebrow">Now</span>}
          <b className={`st-title ${done ? "" : "big"}`}>Step {step.number} · {step.title}{done && step.completedAt ? <span className="ve-done-pill"><Check />Done {shortDay(step.completedAt)}</span> : null}</b>
          <span className="muted">{line}. Watch it before you film: it shows what brands want to see.</span>
        </div>
      </div>
      <div className="st-progress"><span className="st-bar ve-green"><i style={{ width: `${pct}%` }} /></span>{lessons ? <b>{done && course?.markedDone && completed < lessons ? "Marked as done" : `${completed} of ${lessons} lessons`}</b> : null}</div>
      <div className="ve-course-acts">
        <button className={`btn ${done ? "" : "honey"}`} disabled={!summary} onClick={() => summary && nav.open({ kind: "course", id: summary.id }, "learn", "ch")}><PlayCircle />Open the course</button>
        {done ? (course?.markedDone ? <button className="st-link" disabled={busy} onClick={() => toggle(false)}>Not done yet? Undo</button> : null)
          : <button className="btn" disabled={busy} onClick={() => toggle(true)}><Check />Mark as done</button>}
      </div>
    </div>
  );
}

/** The Weekend Starter's upload step, until the course is done. */
function LockedCard({ step }: { step: StarterStep }) {
  return (
    <div className="card st-now ve-locked">
      <div className="st-row-head">
        <div><b className="st-title">Step {step.number} · {step.title}</b><span className="muted">Upload 3 videos and your editor cuts them for you.</span></div>
        <span className="ve-lock-pill"><Lock />{step.locked}</span>
      </div>
    </div>
  );
}

function CurrentCard({ step, track }: { step: StarterStep; track: StarterTrack }) {
  const [busy, setBusy] = useState(false);
  if (step.id === "course") return <CourseCard step={step} />;
  if (step.locked) return <LockedCard step={step} />;
  if (step.id === "three_videos") return <VideosCard step={step} track={track} />;
  const count = step.count;
  return (
    <div className="card st-now">
      <div className="st-row-head"><div><span className="st-eyebrow">Now</span><b className="st-title big">{step.title}</b></div>{track.plan === "first3" ? null : <GradePill grade={step.grade} />}</div>
      {count && step.id === "applications" ? (
        <>
          <div className="st-count"><b>{count.value}</b><span>of {count.target} sent</span></div>
          <span className="st-bar"><i style={{ width: `${(count.value / count.target) * 100}%` }} /></span>
        </>
      ) : null}
      <span className="muted">{step.detail}</span>
      {step.id === "first_video" ? (
        <button className="btn honey" disabled={busy} onClick={() => { setBusy(true); void markFirstVideo(true).finally(() => setBusy(false)); }}><Check />I filmed it</button>
      ) : step.id === "applications" ? (
        <button className="st-link" onClick={() => nav.open({ kind: "hub", page: "deals", board: "outreach" }, "hub", "ch")}>Add an application in the Hub →</button>
      ) : (
        <button className="st-link" onClick={() => nav.open({ kind: "hub", page: "deals" }, "hub", "ch")}>Open your Hub →</button>
      )}
      {step.stuck ? <StuckBox text={step.stuck} /> : null}
    </div>
  );
}

function Timeline({ track }: { track: StarterTrack }) {
  return (
    <section className="st-timeline" aria-label="Milestones">
      {track.steps.map((step, index) => {
        const last = index === track.steps.length - 1;
        const nextState = track.steps[index + 1]?.state;
        const line = step.state === "done" ? (nextState === "done" ? "done" : nextState === "current" ? "now" : "") : "";
        return (
          <div key={step.id} className={`st-step ${step.state}`}>
            <div className="st-rail">
              <span className="st-dot">{step.state === "done" ? <Check /> : null}</span>
              {!last ? <span className={`st-line ${line}`} /> : null}
            </div>
            <div className="st-body">
              {step.state === "current" ? <CurrentCard step={step} track={track} />
                : step.id === "course" ? <CourseCard step={step} />
                : step.locked ? <LockedCard step={step} />
                : step.id === "three_videos" && step.state === "done" ? <VideosCard step={step} track={track} />
                : (
                  <div className="st-row-head">
                    <div><b className="st-title">{step.title}</b><span className="muted">{step.detail}</span></div>
                    {track.plan === "first3" ? null : <GradePill grade={step.grade} />}
                  </div>
                )}
            </div>
          </div>
        );
      })}
    </section>
  );
}

function Summary({ track }: { track: StarterTrack }) {
  return (
    <div className="card st-summary">
      <span className="st-ring">{track.overallGrade}</span>
      <div>
        <b>{track.allDone ? `All ${track.steps.length} milestones done` : `Milestone ${Math.min(track.currentStep, track.steps.length)} of ${track.steps.length}`} · overall {track.overallGrade}</b>
        <span className="st-bars">{track.steps.map((s) => <i key={s.id} className={s.state} />)}</span>
      </div>
    </div>
  );
}

function Resources({ resources, onLocked }: { resources: ImproveResource[]; onLocked: () => void }) {
  return (
    <section>
      <div className="sec-head"><h2>Resources</h2><span className="muted">Tools, scripts, and manuals to move faster.</span></div>
      <div className="res-grid">
        {resources.map((r) => {
          const open = r.slug === SCRIPT_WRITER;
          return (
            <button key={r.id} className={`card res-tile ${open ? "" : "st-locked"}`} aria-label={open ? undefined : `${r.title}, part of the UGC Academy`}
              onClick={() => (open ? nav.open({ kind: "script-writer" }, "learn", "ch") : onLocked())}>
              {open ? null : <span className="st-lock"><Lock /></span>}
              <span className="res-top"><span className="t-ico honey"><Sparkles /></span>{r.flagship ? <span className="tag-s honey">Flagship</span> : null}{open ? <ArrowUpRight className="arrow" /> : null}</span>
              <b>{r.title}</b><span className="muted">{r.description}</span><small className="faint">{r.type}</small>
            </button>
          );
        })}
      </div>
    </section>
  );
}

export function StarterImprove({ track, resources }: { track: StarterTrack; resources: ImproveResource[] | null | undefined }) {
  const sw = track.scriptWriter;
  const editing = useSubmission().data?.state?.editing ?? null;
  const weekend = track.plan === "first3";
  return (
    <>
      <section className="st-track">
        <div className="st-track-head">
          <div>
            <span className="st-eyebrow">{weekend ? "The Weekend Starter" : "UGC Starter"}</span><h2>{track.title ?? "Your path to your first paid deal"}</h2>
            {weekend ? <p className="muted ve-track-sub">Watch the course, upload 3 videos, and {editing?.editor ? firstName(editing.editor.name) : "your editor"} edits them for you.</p> : null}
          </div>
          {/* The Weekend Starter has no grades (as on the website): no summary, no side column. */}
          {weekend ? null : <Summary track={track} />}
        </div>
        <div className={`st-cols ${weekend ? "ve-solo" : ""}`}>
          <div className="ve-main-col">
            <Timeline track={track} />
            {editing?.editor ? <EditorCard editor={editing.editor} /> : null}
            {editing?.stage ? <WhereTracker editing={editing} /> : null}
          </div>
          {weekend ? null : <aside className="st-side">
            <div className="card st-side-card">
              <span className="section-label">AI Script Writer</span>
              <div className="st-count"><b>{sw.remaining}</b><span>of {sw.limit} scripts left this month</span></div>
              <span className="st-bar ink"><i style={{ width: `${(sw.remaining / sw.limit) * 100}%` }} /></span>
              <span className="muted">Resets {resetsLabel(sw.resetsAt)}</span>
              <button className="btn" onClick={() => nav.open({ kind: "script-writer" }, "learn", "ch")}>Write a script</button>
            </div>
            <div className="card st-side-card">
              <span className="section-label">How grades work</span>
              <p className="muted">{STARTER_GRADE_HELP}</p>
            </div>
          </aside>}
        </div>
      </section>
      <Resources resources={resources?.length ? resources : [...STARTER_RESOURCES]} onLocked={openUpgrade} />
    </>
  );
}
