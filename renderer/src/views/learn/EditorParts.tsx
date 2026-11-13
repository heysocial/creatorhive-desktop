import { useEffect, useState } from "react";
import { Check, Clapperboard, Eye, MessageCircle, X } from "lucide-react";
import type { SessionUser } from "../../lib/bridge";
import { useConversations } from "../../lib/api";
import { nav } from "../../lib/nav";
import { Avatar } from "../../lib/ui";
import {
  EDIT_STAGES, EDIT_STAGE_LABELS, STAGE_CLASS, editorChat, editorConversation, firstName, formatDueDate, shortDay, stageIndex,
  useEditorChatOpen, type EditStage, type StudentEditState, type VideoEditor,
} from "../../lib/videoEdits";
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

const TRACK_HINT: Record<EditStage, (e: StudentEditState) => string> = {
  submitted: (e) => shortDay(e.timeline.submittedAt),
  in_editing: (e) => (e.timeline.inEditingAt ? `Since ${shortDay(e.timeline.inEditingAt)}` : ""),
  ready_to_review: (e) => (e.dueOn ? `By ${formatDueDate(e.dueOn, false)}` : ""),
  revisions: () => "If you ask",
  approved: () => "Download",
};
const TRACK_DONE: Record<EditStage, (e: StudentEditState) => string | null> = {
  submitted: (e) => e.timeline.submittedAt,
  in_editing: (e) => e.timeline.inEditingAt,
  ready_to_review: (e) => e.timeline.readyAt,
  revisions: (e) => e.timeline.revisionsAt,
  approved: (e) => e.timeline.approvedAt,
};

export function WhereTracker({ editing }: { editing: StudentEditState }) {
  if (!editing.stage) return null;
  const current = stageIndex(editing.stage);
  const canReview = current >= stageIndex("ready_to_review");
  return (
    <section className="card ve-where">
      <div className="ve-where-head">
        <div>
          <h3>Where your videos are</h3>
          {editing.nextLine ? <p className="muted">{editing.nextLine}</p> : null}
        </div>
        <StagePill stage={editing.stage} />
      </div>
      <ol className="ve-track">
        {EDIT_STAGES.map((stage, index) => {
          const state = editing.stage === "approved" || index < current ? "done" : index === current ? "now" : "next";
          const doneAt = TRACK_DONE[stage](editing);
          const hint = state === "done" && doneAt && stage !== "approved" ? shortDay(doneAt) : state === "now" && stage === "approved" ? shortDay(doneAt) || "Download" : TRACK_HINT[stage](editing);
          return (
            <li key={stage} className={`ve-tstep ${state} ${state === "now" ? STAGE_CLASS[stage] : ""}`}>
              <span className="ve-tdot">{state === "done" ? <Check /> : state === "now" ? <i /> : null}</span>
              <b>{EDIT_STAGE_LABELS[stage]}</b>
              <small>{hint}</small>
            </li>
          );
        })}
      </ol>
      {canReview ? (
        <button className="btn honey ve-where-btn" onClick={() => nav.open({ kind: "video-review" }, "learn", "ch")}>
          <Eye />{editing.stage === "approved" ? "See and download your videos" : "Review your edited videos"}
        </button>
      ) : null}
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
