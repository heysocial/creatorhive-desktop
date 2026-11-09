import { useState } from "react";
import { ArrowUpRight, Check, Lock, Plus, Sparkles, Upload } from "lucide-react";
import { ch } from "../../lib/bridge";
import type { ImproveResource } from "../../lib/learn";
import { nav } from "../../lib/nav";
import {
  formatDuration,
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
import { UpgradeDialog } from "./Courses";
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
      <video src={`${video.previewUrl}#t=0.1`} preload="metadata" muted playsInline />
      {duration ? <span className="st-dur">{duration}</span> : null}
    </span>
  );
}

function openVideos() {
  nav.open({ kind: "starter-videos" }, "learn", "ch");
}

function StuckBox({ text, upgradeUrl }: { text: string; upgradeUrl: string }) {
  return (
    <div className="st-stuck">
      <span className="st-stuck-why">{text}</span>
      <b>This is the exact thing we fix on coaching calls.</b>
      <button className="btn honey" onClick={() => ch.app.openExternal(upgradeUrl)}>Upgrade</button>
    </div>
  );
}

function VideosCard({ step, track }: { step: StarterStep; track: StarterTrack }) {
  const submission = useSubmission().data;
  const inFlight = useSlotUploads();
  const state = submission?.state ?? null;
  const bySlot = new Map((state?.videos ?? []).map((v) => [v.slot, v]));

  if (step.state === "done" || state?.status === "submitted") {
    return (
      <div className="card st-now">
        <div className="st-row-head"><div><b className="st-title">{step.title}</b><span className="muted">{step.detail}</span></div><GradePill grade={step.grade} /></div>
        <div className="st-sent">
          <span className="st-sent-tick"><Check /></span>
          <div><b>Submitted, our editor is on it</b><span>We'll message you here when your 3 edits are ready.</span></div>
        </div>
        <div className="st-slots">{[1, 2, 3].map((slot) => { const v = bySlot.get(slot); return v ? <Thumb key={slot} video={v} height={96} /> : <span key={slot} className="st-empty" style={{ height: 96 }} />; })}</div>
      </div>
    );
  }

  const ready = state?.videos.length ?? step.count?.value ?? 0;
  const next = [1, 2, 3].find((slot) => !bySlot.has(slot)) ?? 3;
  return (
    <div className="card st-now">
      <div className="st-row-head"><div><span className="st-eyebrow">Now</span><b className="st-title big">{step.title}</b></div><GradePill grade={step.grade} /></div>
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
      {step.stuck ? <StuckBox text={step.stuck} upgradeUrl={track.upgradeUrl} /> : null}
    </div>
  );
}

function CurrentCard({ step, track }: { step: StarterStep; track: StarterTrack }) {
  const [busy, setBusy] = useState(false);
  if (step.id === "three_videos") return <VideosCard step={step} track={track} />;
  const count = step.count;
  return (
    <div className="card st-now">
      <div className="st-row-head"><div><span className="st-eyebrow">Now</span><b className="st-title big">{step.title}</b></div><GradePill grade={step.grade} /></div>
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
      {step.stuck ? <StuckBox text={step.stuck} upgradeUrl={track.upgradeUrl} /> : null}
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
                : step.id === "three_videos" && step.state === "done" ? <VideosCard step={step} track={track} />
                : (
                  <div className="st-row-head">
                    <div><b className="st-title">{step.title}</b><span className="muted">{step.detail}</span></div>
                    <GradePill grade={step.grade} />
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
        <b>{track.allDone ? "All 5 milestones done" : `Milestone ${track.currentStep} of 5`} · overall {track.overallGrade}</b>
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
  const [upgrade, setUpgrade] = useState(false);
  const sw = track.scriptWriter;
  return (
    <>
      {upgrade ? <UpgradeDialog onClose={() => setUpgrade(false)} /> : null}
      <section className="st-track">
        <div className="st-track-head">
          <div><span className="st-eyebrow">{track.plan === "first3" ? "The Weekend Starter" : "UGC Starter"}</span><h2>Your path to your first paid deal</h2></div>
          <Summary track={track} />
        </div>
        <div className="st-cols">
          <Timeline track={track} />
          <aside className="st-side">
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
          </aside>
        </div>
      </section>
      <Resources resources={resources?.length ? resources : [...STARTER_RESOURCES]} onLocked={() => setUpgrade(true)} />
    </>
  );
}
