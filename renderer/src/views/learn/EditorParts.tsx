import { useEffect, useState } from "react";
import { Check, Clapperboard, Eye, MessageCircle, X } from "lucide-react";
import type { SessionUser } from "../../lib/bridge";
import { useConversations } from "../../lib/api";
import { nav } from "../../lib/nav";
import { Avatar } from "../../lib/ui";
import {
  EDIT_STAGES, EDIT_STAGE_LABELS, STAGE_CLASS, editorChat, editorConversation, firstName, formatDueDate, reviewable, shortDay, stageIndex,
  useEditorChatOpen, type EditStage, type EditTimeline, type StudentEditState, type VideoEditor,
} from "../../lib/videoEdits";
import { openVideo } from "./StarterVideos";
import { Conversation } from "../messages/Conversation";
import { StagePill } from "../edits/VideoEdits";
import "../../styles/video-edits.css";

/*
  The personal video editor on the student's side (creatorhive-app
  docs/video-editor.md): the editor's card with the button that docks his
  chat beside the page, and "Where your videos are".
*/

/** "About your 3 videos · In editing · ready by Thu, Nov 13". */
export function contextLine(editing: StudentEditState | null) {
  const parts = ["About your 3 videos"];
  if (editing?.stage) parts.push(EDIT_STAGE_LABELS[editing.stage]);
  if (editing?.dueOn && editing.stage !== "approved") parts.push(`ready by ${formatDueDate(editing.dueOn)}`);
  return parts.join(" · ");
}

export function EditorCard({ editor }: { editor: VideoEditor }) {
  const first = firstName(editor.name);
  return (
    <section className="ve-editor-card">
      <span className="ve-editor-photo">
        <Avatar name={editor.name} src={editor.avatarUrl} seed={editor.id} size={60} />
        <i className="ve-online" />
      </span>
      <div className="ve-editor-text">
        <span className="st-eyebrow">Your personal video editor</span>
        <b>{first} · {editor.title || "Video editor"}</b>
        <p>Questions, a change, a different song? Ask him here. He usually replies within a few hours.</p>
        <button className="btn honey lg ve-editor-btn" onClick={() => editorChat.open()}><MessageCircle />Message your personal video editor, {first}</button>
      </div>
    </section>
  );
}

/** The five steps of one video (or of all 3 together, from an older server). */
function Steps({ stage, timeline: t, dueOn }: { stage: EditStage; timeline: EditTimeline; dueOn: string | null }) {
  const current = stageIndex(stage);
  const hint: Record<EditStage, string> = {
    submitted: shortDay(t.submittedAt),
    in_editing: t.inEditingAt ? `Since ${shortDay(t.inEditingAt)}` : "Next",
    ready_to_review: t.readyAt ? `Sent ${shortDay(t.readyAt)}` : dueOn ? `By ${formatDueDate(dueOn, false)}` : "Soon",
    revisions: t.revisionsAt ? `Since ${shortDay(t.revisionsAt)}` : "If you ask",
    approved: t.approvedAt ? shortDay(t.approvedAt) : "Download",
  };
  // Revisions is a side trip: skipped when she approved first time.
  const done = (step: EditStage) => {
    if (stage === "approved") return step !== "revisions" || Boolean(t.revisionsAt);
    return stageIndex(step) < current && !(step === "revisions" && !t.revisionsAt);
  };
  return (
    <ol className="ve-track">
      {EDIT_STAGES.map((step) => {
        const state = done(step) ? "done" : step === stage ? "now" : "next";
        return (
          <li key={step} className={`ve-tstep ${state} ${state === "now" ? STAGE_CLASS[step] : ""}`}>
            <span className="ve-tdot">{state === "done" ? <Check /> : state === "now" ? <i /> : null}</span>
            <b>{EDIT_STAGE_LABELS[step]}</b>
            <small>{hint[step]}</small>
          </li>
        );
      })}
    </ol>
  );
}

/**
  "Where your videos are": each video on its own line (docs/per-video-send.md),
  its stage and five-step tracker; a video not sent yet says so.
*/
export function WhereTracker({ editing }: { editing: StudentEditState }) {
  if (!editing.stage) return null;
  const videos = editing.videos?.length ? editing.videos : null;
  const allApproved = videos ? videos.every((v) => v.stage === "approved") : editing.stage === "approved";
  return (
    <section className="card ve-where">
      <div className="ve-where-head">
        <div>
          <h3>Where your videos are</h3>
          {editing.nextLine ? <p className="muted">{editing.nextLine}</p> : null}
        </div>
        {videos ? null : <StagePill stage={editing.stage} />}
      </div>
      {videos ? (
        <div className="ve-video-tracks">
          {videos.map((video) => (
            <div key={video.slot} className="ve-video-track">
              <div className="ve-video-track-head">
                <b>Video {video.slot}</b>
                {video.stage ? <StagePill stage={video.stage} small /> : <span className="ve-not-sent">Not sent yet</span>}
              </div>
              {video.line ? <p className="muted ve-video-track-line">{video.line}</p> : null}
              {video.stage ? <Steps stage={video.stage} timeline={video.timeline} dueOn={video.dueOn} /> : null}
              {reviewable(video.stage) ? (
                <button className="ve-text-link" onClick={() => nav.open({ kind: "video-review", video: video.slot }, "learn", "ch")}>
                  {video.stage === "approved" ? `Watch and download Video ${video.slot}` : `Review Video ${video.slot}`} →
                </button>
              ) : !video.stage ? (
                <button className="ve-text-link" onClick={() => openVideo(video.slot, false)}>Open Video {video.slot} →</button>
              ) : null}
            </div>
          ))}
        </div>
      ) : (
        <>
          <Steps stage={editing.stage} timeline={editing.timeline} dueOn={editing.dueOn} />
          {reviewable(editing.stage) ? (
            <button className="btn honey ve-where-btn" onClick={() => nav.open({ kind: "video-review" }, "learn", "ch")}>
              <Eye />{allApproved ? "See and download your videos" : "Review your edited videos"}
            </button>
          ) : null}
        </>
      )}
    </section>
  );
}

/** The editor's DM, docked on the right of the page (420 wide); the page stays usable beside it. */
export function EditorChatDock({ editing, user }: { editing: StudentEditState | null; user: SessionUser }) {
  const open = useEditorChatOpen();
  const editor = editing?.editor ?? null;
  const [conversationId, setConversationId] = useState<string | null>(editor?.conversationId ?? null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const conversations = useConversations("creatorhive", open).data;
  const presence = conversations?.find((c) => c.id === conversationId)?.other?.presence;

  useEffect(() => {
    if (!open || !editor || conversationId) return;
    let cancelled = false;
    setError(null);
    editorConversation(editor).then((id) => { if (!cancelled) setConversationId(id); }).catch(() => { if (!cancelled) setError("Couldn't open the conversation. Try again."); });
    return () => { cancelled = true; };
  }, [open, editor, conversationId, attempt]);
  useEffect(() => { if (editor?.conversationId) setConversationId(editor.conversationId); }, [editor?.conversationId]);

  if (!open || !editor) return null;
  const first = firstName(editor.name);
  const head = (
    <>
      <div className="ve-dock-head">
        <span className="ve-editor-photo sm">
          <Avatar name={editor.name} src={editor.avatarUrl} seed={editor.id} size={38} presence={presence ?? undefined} />
        </span>
        <div><b>{first}</b><span className="muted">Your video editor{presence === "online" ? " · Online" : ""}</span></div>
        <button className="iconbtn" aria-label="Close the chat" title="Close" onClick={() => editorChat.close()}><X /></button>
      </div>
      <div className="ve-dock-strip"><Clapperboard />{contextLine(editing)}</div>
    </>
  );
  return (
    <aside className="ve-dock" aria-label={`Chat with ${first}`}>
      {conversationId ? (
        <Conversation key={conversationId} where={{ kind: "dm", id: conversationId }} user={user} workspace="creatorhive" dock={{ head, placeholder: `Message ${first}` }} />
      ) : (
        <>
          {head}
          <div className="empty-state">{error ? <div className="err-state">{error}<button className="btn" onClick={() => setAttempt((n) => n + 1)}>Try again</button></div> : "Opening…"}</div>
        </>
      )}
    </aside>
  );
}
