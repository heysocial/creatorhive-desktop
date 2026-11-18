import { useEffect, useMemo, useRef, useState, type DragEvent, type ReactNode } from "react";
import {
  AlertTriangle, ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Check, ChevronDown, Clapperboard, Copy, Download, Film, Image as ImageIcon, Loader2, Lock,
  MapPin, MessageSquarePlus, Music, Paperclip, RotateCcw, SendHorizontal, Sparkles, Upload, X,
} from "lucide-react";
import { ch } from "../../lib/bridge";
import { queryClient } from "../../lib/api";
import { nav } from "../../lib/nav";
import { openUpgrade, useAreaLocked } from "../../lib/access";
import {
  ACCEPT_ATTR, VE_KEY, addVeFiles, dismissVeRefusals, fmtLength, fmtTime, isLocked, moveVeFile, readDismissed, releaseVeFiles, removeVeFile,
  resetVeDraft, retryVeFile, sentenceOf, setProject, useVeChat, useVeDraft, useVeFiles, useVeHome, useVeProject, veApi, writeDismissed,
  type VeFile, type VeMusicChoice, type VeQuestion,
} from "../../lib/videoEditor";
import {
  VE_AUDIENCES, VE_CAPTION_LOOKS, VE_CHANGE_PRESETS, VE_LENGTHS, VE_LIMITS, VE_STAGES,
  type VeAllowance, type VeBrief, type VeCaptionLook, type VeChatMessage, type VeEditPlan, type VeLength, type VeProject, type VeStatus, type VeUploadKind,
} from "../../lib/videoEditorShared";
import { VE_LIBRARY } from "../../lib/videoEditorLibrary";
import "../../styles/video-editor.css";

/*
  The AI Video Editor (Learn → Improve): the Mac's copy of the website's studio
  (creatorhive-app /library/video-editor, components/video-editor/*), same
  flow and words, which is Sebastian's editor (creator-hive-editing-bot
  app/Studio.tsx + app/Chat.tsx): the chat with the questions card on the
  left; on the right the drop areas, "We're on it", the preview or the
  finished videos, the options column and the clip strip.
  Contract: creatorhive-app docs/ai-video-editor.md.
*/

const SLOW_AFTER_MS = 5 * 60_000;

const STATUS_LABEL: Record<VeStatus, string> = {
  queued: "In line", working: "Editing", preview_ready: "Preview", done: "Ready", error: "Didn't work", cancelled: "Stopped",
};

/** With no song of their own: the library when it has tracks, else no music. */
const NO_SONG: VeMusicChoice = VE_LIBRARY.tracks.length ? "auto" : "none";


const active = (p: VeProject | null) => !!p && (p.status === "queued" || p.status === "working" || p.finalizing);

export function VideoEditor() {
  const locked = useAreaLocked("videoEditor");
  const home = useVeHome(!locked);
  // An earlier video picked from "Your videos" (a Mac extra), or the one in progress / made last.
  const [openId, setOpenId] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState<string | null>(() => readDismissed());
  const [draft, setDraft] = useVeDraft();
  const { files } = useVeFiles();
  const [outbox, setOutbox] = useState<string | null>(null);
  const current = home.data?.current ?? null;
  const baseId = openId ?? (current && current.id !== dismissed && current.status !== "cancelled" ? current.id : null);
  const project = useVeProject(baseId);
  const fetched = project.data ?? (current?.id === baseId ? current : null);
  const shown = fetched && fetched.status !== "cancelled" && fetched.id !== dismissed ? fetched : null;
  const allowance = home.data?.allowance ?? null;

  // A video that finished: the allowance and the thread may have moved.
  const wasActive = useRef(false);
  const nowActive = active(shown);
  useEffect(() => {
    if (wasActive.current && !nowActive) {
      void queryClient.invalidateQueries({ queryKey: [...VE_KEY, "home"] });
      void queryClient.invalidateQueries({ queryKey: [...VE_KEY, "chat"] });
    }
    wasActive.current = nowActive;
  }, [nowActive]);

  if (locked || isLocked(home.error) || home.data?.allowed === false) return <VeLocked />;

  function again() {
    if (shown) { setDismissed(shown.id); writeDismissed(shown.id); }
    setOpenId(null);
    resetVeDraft();
  }
  const openPast = async () => {
    const recent = home.data?.recent ?? [];
    const picked = await ch.menu.popup([
      { id: "new", label: "Make another video", enabled: Boolean(shown) },
      ...(recent.length ? [{ type: "separator" as const }] : []),
      ...recent.slice(0, 15).map((p) => ({ id: p.id, label: p.title || "Your video", sublabel: `${STATUS_LABEL[p.status]}${p.durationSeconds ? ` · ${fmtLength(p.durationSeconds)}` : ""}`, checked: p.id === shown?.id })),
    ]);
    if (!picked) return;
    if (picked === "new") again();
    else { setDismissed(null); setOpenId(picked); }
  };

  // Options: before a video they set the brief; on a preview they ask the chat (it's a change).
  const musicUpload = files.find((f) => f.kind === "music" && f.phase !== "failed") ?? null;
  const musicChoice: VeMusicChoice = draft.music === null || (draft.music === "own" && !musicUpload) ? (musicUpload ? "own" : NO_SONG) : draft.music;
  const shownMusic: VeMusicChoice = shown ? (shown.files.some((f) => f.kind === "music") ? "own" : NO_SONG) : musicChoice;
  const optionsDisabled = (!!shown && shown.status !== "preview_ready") || outbox !== null;

  return (
    <div className="page aive">
      <div className="mhead">
        <ToolTabs />
        <div className="acts">
          {allowance ? <AllowancePill allowance={allowance} /> : null}
          <button className="btn" title="Your videos" onClick={() => void openPast()}><Film />Your videos<ChevronDown /></button>
        </div>
      </div>
      {home.data && !home.data.editorOnline && (!shown || active(shown)) ? <div className="aive-calm" role="status">The editor is starting up. Your video will start as soon as it's back.</div> : null}
      {home.isLoading ? <div className="empty-state"><Loader2 className="spin" /></div> : null}
      {home.isError && !isLocked(home.error) ? (
        <div className="empty-state"><div className="aive-state"><p>{sentenceOf(home.error)}</p>
          <button className="btn" onClick={() => void home.refetch()}><RotateCcw />Try again</button></div></div>
      ) : null}
      {home.data ? (
        <div className="aive-body">
          {/* Option A: the questions until the preview is ready; then the chat is the editor you ask. */}
          {shown && (shown.status === "preview_ready" || shown.status === "done" || shown.finalizing)
            ? <ChatPanel project={shown} outbox={outbox} onOutboxSent={() => setOutbox(null)} />
            : (
              <aside className="aive-chat aive-left card">
                <div className="aive-msgs scroll">
                  {!shown ? <BriefCard allowance={allowance} music={musicChoice} onStarted={(p) => { setDismissed(null); setOpenId(p.id); }} /> : <YourAnswers project={shown} />}
                </div>
              </aside>
            )}
          <Stage key={shown?.id ?? "new"} project={shown} allowance={allowance} onAgain={again}>
            <Options
              captionLook={shown ? shown.brief.captionLook : draft.brief.captionLook}
              length={shown ? shown.brief.length : draft.brief.length}
              music={shownMusic}
              hasOwnMusic={shown ? shown.files.some((f) => f.kind === "music") : !!musicUpload}
              disabled={optionsDisabled}
              onCaptionLook={(look) => {
                if (!shown) return setDraft((d) => ({ brief: { ...d.brief, captionLook: look } }));
                setOutbox(`Change the captions to “${VE_CAPTION_LOOKS.find((l) => l.id === look)?.name ?? look}”.`);
              }}
              onLength={(next) => {
                if (!shown) return setDraft((d) => ({ brief: { ...d.brief, length: next } }));
                const label = VE_LENGTHS.find((l) => l.id === next)?.label ?? next;
                setOutbox(next === "auto" ? "Use the best length for this video." : `Make it ${label}.`);
              }}
              onMusic={(next) => {
                if (!shown) return setDraft({ music: next });
                setOutbox(next === "none" ? "No music, please." : next === "auto" ? "Pick the music for me." : "Use my own song.");
              }}
            />
          </Stage>
        </div>
      ) : null}
    </div>
  );
}

function ToolTabs({ locked = false }: { locked?: boolean }) {
  return (
    <div className="aive-tabs" aria-label="AI Video Editor">
      <span className="on"><span className="aive-tab-ico vee"><Clapperboard /></span>Video Editor{locked ? <Lock className="aive-tab-lock" /> : null}</span>
    </div>
  );
}

function AllowancePill({ allowance }: { allowance: VeAllowance }) {
  const used = Math.max(0, allowance.videosLimit - allowance.videosLeft);
  return (
    <span className="aive-allow" title={`${allowance.changesLeft} of ${allowance.changesLimit} changes left today`}>
      <span className="dots">{Array.from({ length: allowance.videosLimit }, (_, i) => <i key={i} className={i < used ? "" : "on"} />)}</span>
      {allowance.videosLeft} of {allowance.videosLimit} videos left today
    </span>
  );
}

/* ---------- Locked (not in the Academy) ---------- */

function VeLocked() {
  return (
    <div className="page aive">
      <div className="mhead"><ToolTabs locked /></div>
      <div className="aive-locked">
        <div className="aive-locked-ghost" aria-hidden>
          <div className="g-chat"><i style={{ width: "70%" }} /><i style={{ width: "54%", marginLeft: "auto" }} /><i style={{ width: "62%" }} /></div>
          <div className="g-panel"><b /><span><i /><i /><i /><i /></span></div>
        </div>
        <div className="aive-locked-card card">
          <div className="soon-icon" aria-hidden><Lock /></div>
          <p>Drop in your raw footage and photos. Get a brand-ready edit in under 60 seconds. The AI Video Editor is part of the UGC Academy.</p>
          <button className="btn honey lg" onClick={openUpgrade}>See the UGC Academy</button>
        </div>
      </div>
    </div>
  );
}

/** Learn → Improve's entry ("Edit it."). Everyone sees it; the studio shows the lock outside the Academy. */
export function VideoEditorTile() {
  const locked = useAreaLocked("videoEditor");
  return (
    <button className={`card aive-entry ${locked ? "locked" : ""}`} onClick={() => nav.open({ kind: "video-editor" }, "learn", "ch")}>
      <span className="aive-entry-mark"><Clapperboard /></span>
      <span className="aive-entry-text">
        <small>AI Video Editor</small>
        <b>Edit it.</b>
        <span className="muted">Drop in your raw footage and photos. Get a brand-ready edit in under 60 seconds.</span>
      </span>
      <span className="aive-entry-cta">{locked ? <><Lock />UGC Academy</> : <>Open<ArrowRight /></>}</span>
    </button>
  );
}

/* ---------- Chat (left) ---------- */

function planToText(p: VeEditPlan): string {
  const out: string[] = [];
  if (p.summary) out.push(p.summary, "");
  if (p.hook) out.push(`Hook: ${p.hook}`, "");
  if (p.cuts?.length) { out.push("Cuts:"); p.cuts.forEach((c) => out.push(`- ${c.from} to ${c.to}: ${c.reason}`)); out.push(""); }
  if (p.steps?.length) { out.push("Steps:"); p.steps.forEach((s, i) => out.push(`${i + 1}. ${s.title}: ${s.detail}${s.why ? ` (${s.why})` : ""}`)); out.push(""); }
  if (p.broll?.length) { out.push("B-roll:"); p.broll.forEach((b) => out.push(`- ${b.at}: ${b.idea}`)); out.push(""); }
  if (p.captions) out.push(`Captions: ${p.captions}`);
  if (p.music) out.push(`Music: ${p.music}`);
  if (p.export) out.push(`Export: ${p.export}`);
  if (p.assumptions?.length) out.push("", "Assumptions:", ...p.assumptions.map((a) => `- ${a}`));
  if (p.qc_after_render?.length) out.push("", "Check after rendering:", ...p.qc_after_render.map((q) => `- ${q}`));
  return out.join("\n").trim();
}

function PlanCard({ plan }: { plan: VeEditPlan }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="aive-plan selectable">
      <div className="aive-plan-head">
        <b>Edit plan{plan.mode === "personal_brand" ? " · personal brand" : plan.mode === "ugc_ad" ? " · UGC ad" : ""}</b>
        <button className="btn" onClick={() => { void navigator.clipboard.writeText(planToText(plan)).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }); }}>
          {copied ? <Check /> : <Copy />}{copied ? "Copied" : "Copy plan"}
        </button>
      </div>
      {plan.summary ? <p>{plan.summary}</p> : null}
      {plan.hook ? <section><h4>Hook</h4><p>{plan.hook}</p></section> : null}
      {plan.cuts?.length ? <section><h4>Cuts</h4><ul>{plan.cuts.map((c, i) => <li key={i}><code>{c.from} to {c.to}</code> {c.reason}</li>)}</ul></section> : null}
      {plan.steps?.length ? <section><h4>Steps</h4><ol>{plan.steps.map((s, i) => <li key={i}><b>{s.title}.</b> {s.detail}{s.why ? <div className="faint">{s.why}</div> : null}</li>)}</ol></section> : null}
      {plan.broll?.length ? <section><h4>B-roll</h4><ul>{plan.broll.map((b, i) => <li key={i}>{b.at ? <em>{b.at}: </em> : null}{b.idea}</li>)}</ul></section> : null}
      {plan.captions ? <section><h4>Captions</h4><p>{plan.captions}</p></section> : null}
      {plan.music ? <section><h4>Music</h4><p>{plan.music}</p></section> : null}
      {plan.export ? <section><h4>Export</h4><p>{plan.export}</p></section> : null}
      {plan.assumptions?.length ? <section><h4>Assumptions</h4><ul>{plan.assumptions.map((a, i) => <li key={i}>{a}</li>)}</ul></section> : null}
      {plan.qc_after_render?.length ? <section><h4>Check after rendering</h4><ul>{plan.qc_after_render.map((q, i) => <li key={i}>{q}</li>)}</ul></section> : null}
    </div>
  );
}

const MAX_ATTACH_CHARS = 50_000;
const EDIT_MYSELF = "I'd rather edit it myself. Give me the written plan.";

/** While the video is being made (or didn't work): what they answered, compact. */
function YourAnswers({ project }: { project: VeProject }) {
  const b = project.brief;
  const music = project.files.find((f) => f.kind === "music")?.fileName;
  const rows: [string, string][] = [
    ["Making", b.type === "ad" ? "An ad for a brand" : "A video for my own page"],
    ...(b.type === "ad" && b.brand.trim() ? [["Brand", b.brand.trim()] as [string, string]] : []),
    ...(b.product.trim() ? [["About", b.product.trim()] as [string, string]] : []),
    ["Who watches", VE_AUDIENCES.find((a) => a.v === b.audience)?.label ?? b.audience],
    ["Captions", VE_CAPTION_LOOKS.find((l) => l.id === b.captionLook)?.name ?? b.captionLook],
    ["Length", VE_LENGTHS.find((l) => l.id === b.length)?.label ?? b.length],
    ["Music", music ?? (VE_LIBRARY.tracks.length ? "We pick" : "No music")],
    ...(b.notes.trim() ? [["Script or notes", "Added"] as [string, string]] : []),
    ...(b.cta.trim() ? [["At the end", b.cta.trim()] as [string, string]] : []),
  ];
  return (
    <section className="aive-brief aive-answers-card" aria-label="Your answers">
      <header className="aive-brief-head">
        <span className="aive-brief-mark"><Check /></span>
        <div><b>Your answers</b><small>{project.status === "error" ? "Make another video to try again with new answers." : "The chat opens here when your preview is ready."}</small></div>
      </header>
      <dl className="aive-answer-rows">{rows.map(([k, v]) => <div key={k}><dt>{k}</dt><dd className="selectable">{v}</dd></div>)}</dl>
    </section>
  );
}

/** "Ask the editor": the chat about this video, once its preview is ready. */
function ChatPanel({ project, outbox, onOutboxSent }: {
  project: VeProject;
  outbox: string | null;
  onOutboxSent: () => void;
}) {
  const projectId = project.id;
  const chat = useVeChat(projectId);
  const [text, setText] = useState("");
  const [attachment, setAttachment] = useState<{ name: string; text: string } | null>(null);
  const [pending, setPending] = useState<{ content: string; attached: string | null } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const messages = chat.data?.messages ?? [];
  const allowance = chat.data?.allowance ?? null;
  const busy = pending !== null;
  const outOfMessages = allowance !== null && allowance.messagesLeft <= 0;

  useEffect(() => { scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: "smooth" }); }, [messages.length, busy]);

  async function send(raw: string) {
    const typed = raw.trim();
    if ((!typed && !attachment) || busy) return false;
    setError(null);
    const lead = typed || "Here is my transcript.";
    const content = attachment ? `${lead}\n\n[Transcript attached: ${attachment.name}]\n${attachment.text}` : lead;
    setPending({ content: lead, attached: attachment?.name ?? null });
    setText("");
    const kept = attachment;
    setAttachment(null);
    try {
      const r = await veApi.chat(projectId, content);
      if (r.project) setProject(r.project);
      else if (r.reply.action && projectId) void queryClient.invalidateQueries({ queryKey: [...VE_KEY, "project", projectId] });
      await queryClient.invalidateQueries({ queryKey: [...VE_KEY, "chat", projectId ?? "general"] });
      void queryClient.invalidateQueries({ queryKey: [...VE_KEY, "home"] });
      return true;
    } catch (e) {
      setError(sentenceOf(e, "The editor couldn't answer. Try again."));
      setText(typed);
      setAttachment(kept);
      return false;
    } finally {
      setPending(null);
    }
  }

  // The options column asks here, so the chat answers it like anything typed.
  const sendRef = useRef(send);
  sendRef.current = send;
  useEffect(() => {
    if (!outbox) return;
    void sendRef.current(outbox).finally(onOutboxSent);
  }, [outbox, onOutboxSent]);

  async function onFile(file: File | undefined) {
    if (!file) return;
    const body = await file.text();
    if (body.length > MAX_ATTACH_CHARS) { setError("That transcript is too long. The limit is about 50,000 characters, so try a shorter section."); return; }
    setError(null);
    setAttachment({ name: file.name, text: body });
  }

  return (
    <aside className="aive-chat card">
      <header className="aive-chat-head">
        <b>Ask the editor</b>
        <button className="aive-link" disabled={busy || outOfMessages} onClick={() => void send(EDIT_MYSELF)}>Edit it myself</button>
      </header>
      <div className="aive-msgs scroll" ref={scroller}>
        {chat.isLoading ? <div className="aive-chat-empty"><Loader2 className="spin" /></div> : null}
        {!chat.isLoading && !messages.length && !pending ? <p className="aive-chat-hint">Ask for a change, or ask why we made a choice. Prefer to edit it yourself? Press Edit it myself for the written plan.</p> : null}
        {messages.map((m) => <Message key={m.id} message={m} />)}
        {pending ? (
          <>
            <div className="aive-msg user"><div className="bubble selectable">{pending.content}{pending.attached ? <div className="aive-attached">Attached: {pending.attached}</div> : null}</div></div>
            <div className="aive-msg assistant"><div className="bubble faint"><Loader2 className="spin" /> Thinking…</div></div>
          </>
        ) : null}
      </div>
      {error ? <div className="aive-chat-error">{error}</div> : null}
      {attachment ? <div className="aive-attach-chip">{attachment.name}<button aria-label="Remove attachment" onClick={() => setAttachment(null)}><X /></button></div> : null}
      <div className="aive-composer">
        <input ref={fileRef} type="file" hidden accept=".txt,.srt,.vtt,.md,text/plain" onChange={(e) => { void onFile(e.target.files?.[0]); e.target.value = ""; }} />
        <button className="attach" title="Attach transcript" disabled={busy} onClick={() => fileRef.current?.click()}><Paperclip /></button>
        <textarea rows={1} value={text} placeholder={outOfMessages ? "No messages left today" : "Ask for a change or a question"} maxLength={2000} disabled={busy || outOfMessages}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void send(text); } }} />
        <button className={`send ${text.trim() || attachment ? "on" : ""}`} title="Send" disabled={busy || outOfMessages || (!text.trim() && !attachment)} onClick={() => void send(text)}><SendHorizontal /></button>
      </div>
      {allowance && allowance.messagesLeft <= 5 ? <div className="aive-chat-meta faint">{allowance.messagesLeft} {allowance.messagesLeft === 1 ? "message" : "messages"} left today</div> : <div className="aive-chat-gap" />}
    </aside>
  );
}

function Message({ message }: { message: VeChatMessage }) {
  if (message.role === "user") {
    const [shown, rest] = message.content.split("\n\n[Transcript attached: ");
    const attached = rest ? rest.split("]")[0] : null;
    return <div className="aive-msg user"><div className="bubble selectable">{shown}{attached ? <div className="aive-attached">Attached: {attached}</div> : null}</div></div>;
  }
  return (
    <div className="aive-msg assistant">
      <div className="bubble selectable">
        {message.content}
        {message.plan ? <PlanCard plan={message.plan} /> : null}
      </div>
    </div>
  );
}

/* ---------- The questions card (in the chat column, before a video) ---------- */

function BriefCard({ allowance, music, onStarted }: { allowance: VeAllowance | null; music: VeMusicChoice; onStarted: (p: VeProject) => void }) {
  const [draft, setDraft] = useVeDraft();
  const { files } = useVeFiles();
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const brief = draft.brief;
  const onChange = (patch: Partial<VeBrief>) => setDraft((d) => ({ brief: { ...d.brief, ...patch } }));
  const questions: VeQuestion[] = brief.type === "ad"
    ? ["type", "brand", "about", "audience", "captions", "notes", "cta"]
    : ["type", "about", "audience", "captions", "notes", "cta"];
  const current = questions.includes(draft.question) ? draft.question : "type";
  const index = Math.max(0, questions.indexOf(current));
  const last = index === questions.length - 1;
  const brandMissing = brief.type === "ad" && !brief.brand.trim();
  const go = (q: VeQuestion) => setDraft({ question: q });
  const next = () => go(questions[Math.min(questions.length - 1, index + 1)]);
  const back = () => go(questions[Math.max(0, index - 1)]);

  const kept = (kind: VeUploadKind) => files.filter((f) => f.kind === kind && f.phase !== "failed");
  const mains = kept("main");
  const stillUploading = files.some((f) => f.phase !== "done" && f.phase !== "failed");
  const outOfVideos = allowance !== null && allowance.videosLeft <= 0;
  const waitingFor = !mains.length ? "Add your main video on the right first."
    : stillUploading ? "Uploading… you can press Make my video when it's done."
    : outOfVideos ? "You've made every video for today. Come back tomorrow." : null;

  const answered: { q: VeQuestion; text: string }[] = [];
  for (const q of questions.slice(0, index)) {
    const text = q === "type" ? (brief.type === "ad" ? "An ad for a brand" : "A video for my own page")
      : q === "brand" ? brief.brand.trim()
      : q === "about" ? brief.product.trim()
      : q === "audience" ? VE_AUDIENCES.find((a) => a.v === brief.audience)?.label ?? ""
      : q === "captions" ? VE_CAPTION_LOOKS.find((l) => l.id === brief.captionLook)?.name ?? ""
      : q === "notes" ? (brief.notes.trim() ? "Script or notes added" : "")
      : brief.cta.trim();
    if (text) answered.push({ q, text });
  }

  async function start() {
    setStarting(true);
    setError(null);
    const ids = (kind: VeUploadKind) => kept(kind).map((f) => f.uploadId).filter((id): id is string => Boolean(id));
    try {
      // Music is the upload sent (or not): the brief has no music field.
      const { project } = await veApi.create({ brief, mains: ids("main"), clips: ids("clip"), music: music === "own" ? ids("music")[0] ?? null : null, reference: ids("reference")[0] ?? null });
      releaseVeFiles();
      resetVeDraft();
      setProject(project);
      onStarted(project);
    } catch (e) {
      setError(sentenceOf(e));
    } finally {
      setStarting(false);
    }
  }

  return (
    <section className="aive-brief" aria-label="A few quick questions">
      <header className="aive-brief-head">
        <span className="aive-brief-mark"><Sparkles /></span>
        <div>
          <b>{current === "type" ? "What are we making today?" : "A few quick questions"}</b>
          <small>{current === "type" ? "Pick one. We'll take care of the editing." : "This helps us make the right choices for you. Not sure about an answer? Leave it blank."}</small>
        </div>
        <span className="aive-brief-count">{index + 1} of {questions.length}</span>
      </header>
      {answered.length ? (
        <div className="aive-answers">{answered.map((a) => <button key={a.q} className="aive-answer" title="Change this answer" onClick={() => go(a.q)}>{a.text}</button>)}</div>
      ) : null}
      <div className="aive-brief-body">
        {current === "type" ? (
          <div className="aive-choices">
            <button className={`aive-choice ${brief.type === "ad" ? "on" : ""}`} aria-pressed={brief.type === "ad"} onClick={() => onChange({ type: "ad" })}>
              <b>An ad for a brand</b><span>Fast and eye-catching, made to get attention in the first seconds.</span>
            </button>
            <button className={`aive-choice ${brief.type === "personal" ? "on" : ""}`} aria-pressed={brief.type === "personal"} onClick={() => onChange({ type: "personal" })}>
              <b>A video for my own page</b><span>Calmer and more personal, so it sounds and feels like you.</span>
            </button>
          </div>
        ) : null}
        {current === "brand" ? (
          <Field label="Which brand or product is this for?" htmlFor="aive-brand">
            <input id="aive-brand" className="field" autoFocus maxLength={80} value={brief.brand} placeholder="For example: Unbound Merino socks"
              onChange={(e) => onChange({ brand: e.target.value })} onKeyDown={(e) => { if (e.key === "Enter" && brief.brand.trim()) next(); }} />
          </Field>
        ) : null}
        {current === "about" ? (
          <Field label="What's the video about? (optional)" htmlFor="aive-product"
            hint={`In one sentence: what you're selling or promoting, or the main idea of the video.${brief.type === "ad" ? " You don't need to repeat the brand name." : ""}`}>
            <input id="aive-product" className="field" autoFocus maxLength={120} value={brief.product} placeholder="For example: a merino wool travel shirt that never smells"
              onChange={(e) => onChange({ product: e.target.value })} onKeyDown={(e) => { if (e.key === "Enter") next(); }} />
          </Field>
        ) : null}
        {current === "audience" ? (
          <Field label="Who will watch it?" hint="Their age sets how fast we cut.">
            <div className="aive-chips">{VE_AUDIENCES.map((a) => <button key={a.v} className={`chip ${brief.audience === a.v ? "on" : ""}`} aria-pressed={brief.audience === a.v} onClick={() => onChange({ audience: a.v })}>{a.label}</button>)}</div>
          </Field>
        ) : null}
        {current === "captions" ? (
          <Field label="Caption style" hint="How the words on screen look. You can change it later by asking.">
            <div className="aive-looks">
              {VE_CAPTION_LOOKS.map((l) => (
                <button key={l.id} className={`aive-look ${brief.captionLook === l.id ? "on" : ""}`} aria-pressed={brief.captionLook === l.id} onClick={() => onChange({ captionLook: l.id })}>
                  <span className="aive-look-sample"><CaptionSample look={l.id} /></span>
                  <span className="aive-look-name">{l.name}</span>
                </button>
              ))}
            </div>
          </Field>
        ) : null}
        {current === "notes" ? (
          <Field label="Script or notes (optional)" htmlFor="aive-script" hint="Got a script, or things we must keep or avoid? Paste it here. We'll use it to pick the best take of each line.">
            <textarea id="aive-script" className="field area" autoFocus rows={4} maxLength={3000} value={brief.notes} placeholder="Paste your script or write any notes" onChange={(e) => onChange({ notes: e.target.value })} />
          </Field>
        ) : null}
        {current === "cta" ? (
          <Field label="What should people do at the end? (optional)" htmlFor="aive-cta">
            <input id="aive-cta" className="field" autoFocus maxLength={120} value={brief.cta} placeholder="For example: Shop now, follow me, book a call" onChange={(e) => onChange({ cta: e.target.value })} />
          </Field>
        ) : null}
      </div>
      {error ? <div className="aive-error">{error}</div> : null}
      {last && waitingFor ? <p className="aive-small">{waitingFor}</p> : null}
      <footer className="aive-brief-actions">
        {index > 0 ? <button className="btn" onClick={back}><ArrowLeft />Back</button> : <span />}
        {last ? (
          <button className="btn honey" disabled={!!waitingFor || starting || brandMissing} onClick={() => void start()}>{starting ? "Starting…" : "Make my video"}</button>
        ) : (
          <button className="btn honey" disabled={current === "brand" && brandMissing} onClick={next}>{current === "type" ? "Continue" : "Next"}<ArrowRight /></button>
        )}
      </footer>
    </section>
  );
}

function Field({ label, hint, htmlFor, children }: { label: string; hint?: string; htmlFor?: string; children: ReactNode }) {
  return (
    <div className="aive-field">
      <label htmlFor={htmlFor}>{label}</label>
      {hint ? <p className="aive-small">{hint}</p> : null}
      {children}
    </div>
  );
}

function CaptionSample({ look, short = false }: { look: VeCaptionLook; short?: boolean }) {
  if (short) return <span className={`sample sample-${look}`}>{look === "highlight" ? <>A<b>a</b></> : "Aa"}</span>;
  return <span className={`sample sample-${look}`}>{look === "highlight" ? <>your <b>words</b> here</> : "your words here"}</span>;
}

/* ---------- Stage (right) ---------- */

function Stage({ project, allowance, onAgain, children }: { project: VeProject | null; allowance: VeAllowance | null; onAgain: () => void; children: ReactNode }) {
  const [stopping, setStopping] = useState(false);
  const title = project ? `${project.title || "Your video"}${project.durationSeconds ? ` · ${Math.round(project.durationSeconds)}s` : ""}` : "New video";
  const done = project?.status === "done" && project.downloads.length > 0;

  async function startOver() {
    if (!project) return;
    setStopping(true);
    try {
      setProject((await veApi.cancel(project.id)).project);
    } catch {
      // Already stopped or gone: start over anyway.
    } finally {
      setStopping(false);
      onAgain();
    }
  }

  async function downloadMenu() {
    if (!project?.downloads.length) return;
    const picked = await ch.menu.popup([
      ...project.downloads.map((d, i) => ({ id: String(i), label: d.label, sublabel: d.name })),
      { type: "separator" as const },
      { id: "all", label: "Both, into a folder…" },
    ]);
    if (picked === "all") void ch.files.saveMany(project.downloads.map((d) => ({ url: d.url, name: d.name })), "Choose where to save your videos");
    else if (picked != null) { const d = project.downloads[Number(picked)]; if (d) void ch.files.save(d.url, d.name); }
  }

  return (
    <section className="aive-stage" aria-label="Your video">
      <header className="aive-stage-head">
        <h2>{title}</h2>
        {project ? <span className={`aive-badge ${project.finalizing ? "working" : project.status}`}>{project.finalizing ? "Making finals" : STATUS_LABEL[project.status]}</span> : null}
        <button className="btn honey aive-download" disabled={!done} title={done ? undefined : "Ready once you approve your preview"} onClick={() => void downloadMenu()}><Download />Download</button>
      </header>
      <div className="aive-stage-main">
        <div className="aive-center">
          {!project ? <DropAreas />
            : active(project) ? <Progress project={project} stopping={stopping} onStartOver={() => void startOver()} />
            : project.status === "preview_ready" ? <Preview project={project} allowance={allowance} />
            : project.status === "done" ? <Done project={project} onAgain={onAgain} />
            : <Failed project={project} onAgain={onAgain} />}
        </div>
        {children}
      </div>
      <ClipStrip project={project} />
    </section>
  );
}

/* ---------- Options (captions, music, length) ---------- */

function Options({ captionLook, length, music, hasOwnMusic, disabled, onCaptionLook, onLength, onMusic }: {
  captionLook: VeCaptionLook; length: VeLength; music: VeMusicChoice; hasOwnMusic: boolean; disabled: boolean;
  onCaptionLook: (l: VeCaptionLook) => void; onLength: (l: VeLength) => void; onMusic: (m: VeMusicChoice) => void;
}) {
  const musicOptions: { id: VeMusicChoice; label: string }[] = [
    ...(hasOwnMusic ? [{ id: "own" as const, label: "Your music" }] : []),
    ...(VE_LIBRARY.tracks.length ? [{ id: "auto" as const, label: "We pick" }] : []),
    { id: "none", label: "No music" },
  ];
  const opt = (on: boolean, onClick: () => void, children: ReactNode, key: string) => (
    <button key={key} role="radio" aria-checked={on} disabled={disabled} className={`aive-opt ${on ? "on" : ""}`} onClick={() => { if (!on) onClick(); }}>
      {children}{on ? <Check className="aive-opt-check" /> : null}
    </button>
  );
  return (
    <aside className={`aive-options scroll ${disabled ? "off" : ""}`} aria-label="Options">
      <div role="radiogroup" aria-label="Captions">
        <span className="aive-label">Captions</span>
        {VE_CAPTION_LOOKS.map((l) => opt(captionLook === l.id, () => onCaptionLook(l.id), <><span className="aive-sample"><CaptionSample look={l.id} short /></span><span className="aive-opt-label">{l.name}</span></>, l.id))}
      </div>
      <div role="radiogroup" aria-label="Music">
        <span className="aive-label">Music</span>
        {musicOptions.map((m) => opt(music === m.id, () => onMusic(m.id), <span className="aive-opt-label">{m.label}</span>, m.id))}
      </div>
      <div role="radiogroup" aria-label="Length">
        <span className="aive-label">Length</span>
        {VE_LENGTHS.map((l) => opt(length === l.id, () => onLength(l.id), <span className="aive-opt-label">{l.label}</span>, l.id))}
      </div>
    </aside>
  );
}

/* ---------- Add your videos ---------- */

const AREAS: { kind: VeUploadKind; title: string; hint: string; pick: string; pickMore: string; multiple: boolean; icon: ReactNode }[] = [
  { kind: "main", title: "Your main video (you talking to the camera)", hint: "Up to 3 minutes in total. Recorded it in several takes or lines? Add them all and we'll join them in the order shown here.", pick: "Choose your video or videos", pickMore: "Add another video", multiple: true, icon: <Film /> },
  { kind: "clip", title: "Extra footage (optional)", hint: "Videos or pictures we can show while you talk, like your product or things you mention. Up to 12 files. Pictures: JPG, PNG or WEBP.", pick: "Add videos or pictures", pickMore: "Add more", multiple: true, icon: <ImageIcon /> },
  { kind: "reference", title: "A video you like (optional)", hint: "A video whose style you'd like yours to follow: the pace, the captions, the feel. Up to 2 minutes.", pick: "Choose a video", pickMore: "Replace it", multiple: false, icon: <Sparkles /> },
  {
    kind: "music", title: "Music (optional, otherwise we pick)",
    hint: VE_LIBRARY.tracks.length
      ? "Your own song. Skip it and we pick one, or choose No music on the right if you'll add a trending sound inside TikTok or Instagram."
      : "Optional. Skip it if you plan to add a trending sound inside TikTok or Instagram. Without a song, your video has no music.",
    pick: "Choose a song", pickMore: "Replace it", multiple: false, icon: <Music />,
  },
];
const maxOf = (kind: VeUploadKind) => (kind === "main" ? VE_LIMITS.maxMainTakes : kind === "clip" ? VE_LIMITS.maxClips : 1);

function DropAreas() {
  return (
    <div className="aive-drops scroll">
      <div className="aive-drops-intro"><h3>Add your videos</h3><p className="muted">Just drop them in. You don't need to do anything else to them.</p></div>
      <div className="aive-drops-grid">{AREAS.map((a) => <DropArea key={a.kind} area={a} />)}</div>
    </div>
  );
}

function DropArea({ area }: { area: (typeof AREAS)[number] }) {
  const { files: all, refusals } = useVeFiles();
  const files = all.filter((f) => f.kind === area.kind);
  const notes = refusals.filter((r) => r.kind === area.kind);
  const kept = files.filter((f) => f.phase !== "failed");
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const full = kept.length >= maxOf(area.kind);
  const replaceable = area.kind === "music" || area.kind === "reference";
  const mains = area.kind === "main" ? kept : [];
  const take = (list: File[]) => { if (list.length) void addVeFiles(area.kind, list); };
  return (
    <div className={`aive-drop ${area.kind === "main" ? "main" : ""} ${over ? "over" : ""} ${files.length ? "filled" : ""}`}
      onDragOver={(e: DragEvent) => { e.preventDefault(); setOver(true); }}
      onDragLeave={(e: DragEvent) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver(false); }}
      onDrop={(e: DragEvent) => { e.preventDefault(); setOver(false); take(Array.from(e.dataTransfer.files)); }}>
      <div className="aive-drop-head">
        <span className="aive-drop-ico">{area.icon}</span>
        <div><b>{area.title}</b><small>{area.hint}</small></div>
      </div>
      {files.map((f) => {
        const i = mains.indexOf(f);
        return <FileRow key={f.localId} file={f} index={mains.length > 1 && i >= 0 ? i : null} last={i === mains.length - 1} />;
      })}
      {!full || replaceable ? (
        <button className="aive-drop-btn" onClick={() => input.current?.click()}>
          <Upload />{kept.length ? area.pickMore : area.pick}
          {!kept.length ? <span className="faint">or drop {area.multiple ? "them" : "it"} here</span> : null}
        </button>
      ) : null}
      <input ref={input} type="file" hidden multiple={area.multiple} accept={ACCEPT_ATTR[area.kind]} onChange={(e) => { take(Array.from(e.target.files ?? [])); e.target.value = ""; }} />
      {notes.length ? <div className="aive-error">{notes.map((n) => n.message).join(" ")} <button className="aive-link" onClick={() => dismissVeRefusals(area.kind)}>Dismiss</button></div> : null}
    </div>
  );
}

const KIND_ICON: Record<VeUploadKind, ReactNode> = { main: <Film />, clip: <ImageIcon />, music: <Music />, reference: <Sparkles /> };

function FileRow({ file, index, last }: { file: VeFile; index: number | null; last: boolean }) {
  const pct = file.size ? Math.round((file.sent / file.size) * 100) : 0;
  const status = file.phase === "done" ? (file.seconds ? `${Math.round(file.seconds)} s` : "Ready")
    : file.phase === "failed" ? ""
    : file.phase === "offline" ? "Waiting for the connection…"
    : file.phase === "starting" ? "Checking…"
    : file.phase === "finishing" ? "Finishing…" : `${pct}%`;
  return (
    <div className={`aive-file ${file.phase}`}>
      <span className="aive-thumb">{file.thumb ? <img src={file.thumb} alt="" /> : KIND_ICON[file.kind]}</span>
      <div className="aive-file-meta">
        <span className="aive-file-top"><b>{index !== null ? `${index + 1}. ` : ""}{file.name}</b><small>{status}</small></span>
        {file.phase === "failed" ? <span className="aive-file-error">{file.error}</span>
          : file.phase !== "done" ? <span className="aive-bar thin"><i style={{ width: `${Math.max(2, pct)}%` }} /></span> : null}
      </div>
      {index !== null && index > 0 ? <button className="iconbtn" title="Up" aria-label={`Move ${file.name} up`} onClick={() => moveVeFile(file.localId, -1)}><ArrowUp /></button> : null}
      {index !== null && !last ? <button className="iconbtn" title="Down" aria-label={`Move ${file.name} down`} onClick={() => moveVeFile(file.localId, 1)}><ArrowDown /></button> : null}
      {file.phase === "failed" ? <button className="iconbtn" title="Try again" onClick={() => retryVeFile(file.localId)}><RotateCcw /></button> : null}
      <button className="iconbtn" title={file.phase === "failed" ? "Dismiss" : "Remove"} onClick={() => removeVeFile(file.localId)}><X /></button>
    </div>
  );
}

/* ---------- We're on it ---------- */

function Progress({ project, stopping, onStartOver }: { project: VeProject; stopping: boolean; onStartOver: () => void }) {
  const pct = Math.round((project.progress ?? 0) * 100);
  const lastMove = useRef({ key: "", at: Date.now() });
  const [slow, setSlow] = useState(false);
  const key = `${project.status}|${project.stage}|${project.progress}|${project.message}`;
  useEffect(() => { lastMove.current = { key, at: Date.now() }; setSlow(false); }, [key]);
  useEffect(() => {
    const t = setInterval(() => setSlow(Date.now() - lastMove.current.at > SLOW_AFTER_MS), 10_000);
    return () => clearInterval(t);
  }, []);
  // A reference video adds its own step; without one it is skipped (same for extra footage).
  const hasReference = project.files.some((f) => f.kind === "reference");
  const hasClips = project.files.some((f) => f.kind === "clip");
  const steps = VE_STAGES.filter((s) => (s.stage !== "reference" || hasReference) && (s.stage !== "look" || hasClips));
  const at = Math.max(0, steps.findIndex((s) => s.stage === project.stage));
  return (
    <div className="aive-making">
      <h3>{project.finalizing ? "Making your final videos" : "We're on it"}</h3>
      <p className="muted">{project.message ?? "Getting started"}</p>
      <div className="aive-bar big"><i style={{ width: `${Math.max(3, pct)}%` }} /></div>
      <p className="aive-small">{pct}%. You can leave this page open, or come back later and it will pick up where you left off.</p>
      {!project.finalizing ? (
        <ol className="aive-steps">
          {steps.map((s, i) => (
            <li key={s.stage} className={i < at ? "past" : i === at ? "now" : ""}>
              <span className="dot">{i < at ? <Check /> : i === at ? <Loader2 className="spin" /> : null}</span>{s.label}
            </li>
          ))}
        </ol>
      ) : null}
      {slow ? <div className="aive-notice">This is taking longer than it should. You can keep waiting, or start over with the button below.</div> : null}
      <button className="btn dark" disabled={stopping} onClick={onStartOver}><RotateCcw />{stopping ? "Stopping…" : "Cancel and start over"}</button>
    </div>
  );
}

/* ---------- The preview: pinned comments, Change something, Approve ---------- */

function Preview({ project, allowance }: { project: VeProject; allowance: VeAllowance | null }) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [changing, setChanging] = useState(false);
  const [notes, setNotes] = useState("");
  const [comments, setComments] = useState<{ t: number; text: string }[]>([]);
  const [draft, setDraft] = useState<{ t: number; text: string } | null>(null);
  const [busy, setBusy] = useState<"revise" | "approve" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const changesLeftToday = allowance?.changesLeft ?? null;
  const noChangesLeft = project.revisionsLeft <= 0 || (changesLeftToday !== null && changesLeftToday <= 0);

  // Signed links are short-lived: coming back to the window fetches fresh ones.
  useEffect(() => ch.window.onFocus((focused) => { if (focused) void queryClient.invalidateQueries({ queryKey: [...VE_KEY, "project", project.id] }); }), [project.id]);

  function commentHere() {
    const v = videoRef.current;
    if (v) v.pause();
    setDraft({ t: v ? Math.round(v.currentTime * 10) / 10 : 0, text: "" });
    setChanging(true);
  }
  const addComment = () => {
    if (!draft || draft.text.trim().length < 3) return;
    setComments((c) => [...c, { t: draft.t, text: draft.text.trim() }].sort((a, b) => a.t - b.t).slice(0, 12));
    setDraft(null);
  };
  async function act(kind: "revise" | "approve") {
    setBusy(kind);
    setError(null);
    try {
      const { project: next } = kind === "approve" ? await veApi.approve(project.id) : await veApi.revise(project.id, { notes: notes.trim(), comments });
      setProject(next);
      if (kind === "revise") { setNotes(""); setComments([]); setDraft(null); setChanging(false); }
    } catch (e) {
      setError(sentenceOf(e));
    } finally {
      setBusy(null);
    }
  }
  const seek = (t: number) => { if (videoRef.current) videoRef.current.currentTime = t; };

  return (
    <div className="aive-review">
      <div className="aive-player-wrap">
        {project.previewUrl ? <video ref={videoRef} className="aive-player" src={project.previewUrl} controls playsInline preload="metadata" />
          : <div className="aive-player empty">The preview link expired. Refreshing…</div>}
        {comments.length && project.durationSeconds ? (
          <div className="aive-pins" aria-label="Your comments on the timeline">
            {comments.map((c, i) => <button key={`${c.t}-${i}`} style={{ left: `${Math.min(100, (c.t / project.durationSeconds!) * 100)}%` }} title={`${fmtTime(c.t)} · ${c.text}`} onClick={() => seek(c.t)}><MapPin /></button>)}
          </div>
        ) : null}
      </div>
      <div className="aive-review-side scroll">
        <div><h3>Here's your preview</h3><p className="muted">Watch it all the way through. The final version will look sharper.</p></div>
        {project.previewUrl && !noChangesLeft ? (
          <div className="aive-comment-help">
            <b>Want to change something at a specific moment?</b>
            <ol><li>Pause the video where you want the change.</li><li>Tap the button below.</li><li>Type what should change. You can add as many as you like.</li></ol>
            <button className="btn honey" onClick={commentHere}><MessageSquarePlus />Comment at this moment</button>
          </div>
        ) : null}
        {changing ? (
          <div className="aive-change">
            <b>What would you like to change?</b>
            <p className="aive-small">Comments are pinned to a moment of the video. Use the yellow box above to add as many as you like, and anything for the whole video below.</p>
            {draft ? (
              <div className="aive-draft">
                <label htmlFor="aive-draft">At {fmtTime(draft.t)}, what should change?</label>
                <input id="aive-draft" className="field" autoFocus maxLength={300} value={draft.text} placeholder="For example: use a different clip here, or make this shorter"
                  onChange={(e) => setDraft({ ...draft, text: e.target.value })} onKeyDown={(e) => { if (e.key === "Enter") addComment(); }} />
                <div className="aive-row"><button className="btn dark" onClick={() => setDraft(null)}>Cancel</button><button className="btn honey" disabled={draft.text.trim().length < 3} onClick={addComment}>Add comment</button></div>
              </div>
            ) : null}
            {comments.map((c, i) => (
              <div key={`${c.t}-${i}`} className="aive-comment">
                <button className="aive-time" onClick={() => seek(c.t)}>{fmtTime(c.t)}</button>
                <span className="selectable">{c.text}</span>
                <button className="aive-link" onClick={() => setComments(comments.filter((_, j) => j !== i))}>Remove</button>
              </div>
            ))}
            <span className="aive-label">Anything for the whole video? (optional)</span>
            <div className="aive-presets">{VE_CHANGE_PRESETS.map((c) => <button key={c} className="chip" onClick={() => setNotes((n) => (n ? `${n}. ${c}` : c))}>{c}</button>)}</div>
            <textarea className="field area" rows={3} maxLength={500} value={notes} aria-label="Anything for the whole video" placeholder="Tap an option above or write it in your own words" onChange={(e) => setNotes(e.target.value)} />
            {error ? <div className="aive-error">{error}</div> : null}
            <div className="aive-row">
              <button className="btn dark" onClick={() => setChanging(false)}>Cancel</button>
              <button className="btn honey" disabled={busy !== null || (notes.trim().length < 3 && !comments.length)} onClick={() => void act("revise")}>{busy === "revise" ? "Sending…" : "Make these changes"}</button>
            </div>
          </div>
        ) : (
          <>
            {error ? <div className="aive-error">{error}</div> : null}
            <div className="aive-review-actions">
              <button className="btn dark lg" disabled={noChangesLeft} onClick={() => setChanging(true)}>Change something</button>
              <button className="btn honey lg" disabled={busy !== null} onClick={() => void act("approve")}>{busy === "approve" ? "Starting…" : "Looks good, make my final videos"}</button>
            </div>
          </>
        )}
        <p className="aive-small">{project.revisionsLeft <= 0 ? "You've used every change for this video."
          : `${project.revisionsLeft} ${project.revisionsLeft === 1 ? "change" : "changes"} left for this video${changesLeftToday !== null ? `, ${changesLeftToday} today` : ""}.`}</p>
        <WhyAndNotices project={project} />
      </div>
    </div>
  );
}

/* ---------- Done: downloads, why, Make another video ---------- */

const fmtBytes = (n: number) => (n >= 1024 * 1024 ? `${Math.round(n / 1024 / 1024)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

function Done({ project, onAgain }: { project: VeProject; onAgain: () => void }) {
  const [saving, setSaving] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  async function save(d: VeProject["downloads"][number]) {
    setSaving(d.name);
    setNote(null);
    const r = await ch.files.save(d.url, d.name);
    setSaving(null);
    if (!r.ok && !r.canceled) {
      setNote("That download didn't finish. Try again.");
      void queryClient.invalidateQueries({ queryKey: [...VE_KEY, "project", project.id] }); // a fresh link for the next try
    }
  }
  return (
    <div className="aive-review">
      <div className="aive-player-wrap">
        {project.downloads[0] ? <video className="aive-player" src={project.downloads[0].url} controls playsInline preload="metadata" /> : null}
      </div>
      <div className="aive-review-side scroll">
        <div><h3>Your videos are ready</h3><p className="muted">Download both and post when you're ready.</p></div>
        <ul className="aive-downloads">
          {project.downloads.map((d) => (
            <li key={d.name}>
              <span><b>{d.label}</b><small>{d.name} · {fmtBytes(d.bytes)}</small></span>
              <button className="btn honey" disabled={saving !== null} onClick={() => void save(d)}>{saving === d.name ? <Loader2 className="spin" /> : <Download />}Download</button>
            </li>
          ))}
        </ul>
        {note ? <div className="aive-error">{note}</div> : null}
        <WhyAndNotices project={project} />
        <div className="aive-review-actions"><button className="btn honey lg" onClick={onAgain}>Make another video</button></div>
      </div>
    </div>
  );
}

function Failed({ project, onAgain }: { project: VeProject; onAgain: () => void }) {
  return (
    <div className="aive-making">
      <AlertTriangle className="aive-warn" />
      <h3>That didn't work</h3>
      <div className="aive-error">{project.message ?? "Something went wrong."}</div>
      <WhyAndNotices project={project} />
      <button className="btn honey lg" onClick={onAgain}>Make another video</button>
    </div>
  );
}

function WhyAndNotices({ project }: { project: VeProject }) {
  return (
    <>
      {project.explanation ? <div className="aive-why"><b>Why we made these choices</b><p className="selectable">{project.explanation}</p></div> : null}
      {project.notices.map((n) => <div className="aive-notice" key={n}>{n}</div>)}
    </>
  );
}

/* ---------- Clip strip ---------- */

function ClipStrip({ project }: { project: VeProject | null }) {
  const local = useVeFiles().files;
  // A still the server couldn't make (or whose link expired) shows the file's icon instead.
  const [broken, setBroken] = useState<Set<string>>(() => new Set());
  const tiles = useMemo(() => (project
    ? project.files.filter((f) => f.kind === "main" || f.kind === "clip").map((f, i) => ({ key: `${f.kind}-${i}-${f.fileName}`, name: f.fileName, thumb: f.thumbnailUrl, kind: f.kind as VeUploadKind, pct: null as number | null }))
    : local.filter((f) => (f.kind === "main" || f.kind === "clip") && f.phase !== "failed").map((f) => ({ key: f.localId, name: f.name, thumb: f.thumb, kind: f.kind, pct: f.phase === "done" ? null : f.size ? Math.round((f.sent / f.size) * 100) : 0 }))), [project, local]);
  const mains = local.filter((f) => f.kind === "main" && f.phase !== "failed");
  const seconds = project ? project.durationSeconds : mains.some((f) => f.seconds) ? mains.reduce((s, f) => s + (f.seconds ?? 0), 0) : null;
  if (!tiles.length) return null;
  return (
    <div className="aive-strip" aria-label="Your clips">
      <div className="aive-strip-tiles">
        {tiles.map((t, i) => (
          <div key={t.key} className={`aive-tile ${i === 0 ? "first" : ""}`} title={t.name}>
            {t.thumb && !broken.has(t.key) ? <img src={t.thumb} alt="" onError={() => setBroken((b) => new Set(b).add(t.key))} /> : <span className="aive-tile-ico">{KIND_ICON[t.kind]}</span>}
            {t.pct !== null ? <span className="aive-tile-pct">{t.pct}%</span> : null}
          </div>
        ))}
      </div>
      {seconds ? <span className="aive-strip-len">{fmtLength(seconds)}</span> : null}
    </div>
  );
}
