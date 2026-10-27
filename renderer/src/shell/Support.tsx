import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { ArrowUp, ImagePlus, X } from "lucide-react";
import { ch } from "../lib/bridge";
import { queryClient, rateLimitMessage } from "../lib/api";
import {
  HIDDEN_TOAST, SUPPORT_GREETING, SUPPORT_KEY, SUPPORT_NAME, SUPPORT_TOPICS,
  isSupportImage, markSupportRead, newMutationId, sendSupportMessage, setHelpButtonHidden, statusLine, uploadSupportImage, useSupport,
  type SupportAttachment, type SupportMessage, type SupportState,
} from "../lib/support";
import "../styles/support.css";

/*
  Live chat with support, on every screen of the main window: the small "?"
  bottom right (hover says "Live chat with support", the × hides it), and the
  chat it opens, from "CreatorHive Support" with the logo — never a teammate's
  name or photo. Hidden stays hidden on every device until Settings → Help
  shows it again (the server keeps the setting). See lib/support.ts.
*/

type Pending = SupportMessage & { pending?: boolean; failed?: string };

function Logo() {
  return <span className="sp-logo" aria-hidden><img src="./ch-logo.svg" alt="" /></span>;
}

const time = (iso: string) => new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });

function Bubble({ message }: { message: Pending }) {
  const mine = message.sender === "student";
  return (
    <div className={`sp-row ${mine ? "me" : "them"}`}>
      {message.body ? <div className={`sp-msg ${mine ? "me" : "them"}`}>{message.body}</div> : null}
      {message.attachments.map((a) => (
        <button key={a.url} type="button" className={`sp-pic ${mine ? "me" : ""}`} onClick={() => void ch.files.quickLook(a.url, a.name)} aria-label={`Open ${a.name}`}>
          <img src={a.url} alt={a.name} />
        </button>
      ))}
      <div className={`sp-meta ${mine ? "r" : ""}`}>
        {message.failed ? <span className="sp-failed">{message.failed}</span>
          : mine ? (message.pending ? "Sending…" : `You · ${time(message.createdAt)}`)
          : `${SUPPORT_NAME}${message.sender === "auto" ? " · automatic reply" : ""} · ${time(message.createdAt)}`}
      </div>
    </div>
  );
}

function SupportChat({ state, onClose, onHide }: { state: SupportState | undefined; onClose: () => void; onHide: () => void }) {
  const [pending, setPending] = useState<Pending[]>([]);
  const [text, setText] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const list = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const picker = useRef<HTMLInputElement>(null);

  const server = state?.messages ?? [];
  // A sent message stays as typed until the server's copy (same clientMutationId) arrives.
  const shown: Pending[] = [...server, ...pending.filter((p) => !server.some((m) => m.clientMutationId && m.clientMutationId === p.clientMutationId))];
  // No ticket yet, or the last one is closed: the greeting and the quick buttons.
  const fresh = !state?.ticket || state.ticket.status === "closed";
  const showTopics = fresh && !shown.some((m) => m.sender === "student" && (!state?.ticket || m.pending));

  useEffect(() => { input.current?.focus(); }, []);
  useLayoutEffect(() => { list.current?.scrollTo({ top: list.current.scrollHeight }); }, [shown.length]);
  // Read while it's open and the window is in front.
  const unread = state?.unread ?? 0;
  useEffect(() => {
    if (unread > 0 && document.hasFocus()) void markSupportRead().then(() => queryClient.invalidateQueries({ queryKey: SUPPORT_KEY }));
  }, [unread]);
  useEffect(() => ch.window.onFocus((focused) => { if (focused && unread > 0) void markSupportRead().then(() => queryClient.invalidateQueries({ queryKey: SUPPORT_KEY })); }), [unread]);

  const addFiles = (incoming: File[]) => {
    const images = incoming.filter(isSupportImage);
    if (images.length < incoming.length) setError("Only pictures and screenshots can be sent here.");
    setFiles((current) => [...current, ...images].slice(0, 4));
  };

  const send = useCallback(async (body: string, topic?: string) => {
    const words = body.trim();
    if ((!words && files.length === 0) || sending) return;
    setSending(true);
    setError(null);
    const clientMutationId = newMutationId();
    const local: Pending = { id: `local-${clientMutationId}`, sender: "student", body: words, attachments: [], createdAt: new Date().toISOString(), clientMutationId, pending: true };
    const outgoing = files;
    setPending((p) => [...p, local]);
    setText("");
    setFiles([]);
    try {
      const attachments: SupportAttachment[] = [];
      for (const file of outgoing) {
        const uploaded = await uploadSupportImage(file);
        if (!("url" in uploaded)) throw Object.assign(new Error("upload"), { reason: uploaded.failedReason ?? "That picture didn't upload. Try again." });
        attachments.push(uploaded);
      }
      setPending((p) => p.map((m) => (m.clientMutationId === clientMutationId ? { ...m, attachments } : m)));
      const result = await sendSupportMessage({ body: words, attachments, topic, clientMutationId });
      queryClient.setQueryData<SupportState & { ok: true }>(SUPPORT_KEY, (old) => old ? {
        ...old,
        ticket: result.ticket,
        messages: [...old.messages.filter((m) => m.clientMutationId !== clientMutationId), result.message, ...(result.autoReply ? [result.autoReply] : [])],
      } : old);
      setPending((p) => p.filter((m) => m.clientMutationId !== clientMutationId));
      void queryClient.invalidateQueries({ queryKey: SUPPORT_KEY });
    } catch (caught) {
      const reason = (caught as { reason?: string }).reason ?? rateLimitMessage(caught) ?? "Not sent. Check your connection and try again.";
      setPending((p) => p.map((m) => (m.clientMutationId === clientMutationId ? { ...m, pending: false, failed: reason } : m)));
      setText((current) => current || words);
    } finally {
      setSending(false);
      input.current?.focus();
    }
  }, [files, sending]);

  return (
    <div className={`sp-chat ${dragging ? "drop" : ""}`} role="dialog" aria-label={SUPPORT_NAME}
      onDragOver={(e) => { if (e.dataTransfer.types.includes("Files")) { e.preventDefault(); setDragging(true); } }}
      onDragLeave={(e) => { if (e.currentTarget === e.target) setDragging(false); }}
      onDrop={(e) => { e.preventDefault(); setDragging(false); addFiles([...e.dataTransfer.files]); }}
      onKeyDown={(e) => { if (e.key === "Escape") onClose(); }}>
      <header className="sp-head">
        <Logo />
        <div>
          <b>{SUPPORT_NAME}</b>
          <small><i className={`sp-dot ${state?.status.online ? "" : "away"}`} />{statusLine(state?.status)}</small>
        </div>
        <button type="button" className="sp-x" onClick={onClose} aria-label="Close"><X size={18} /></button>
      </header>
      <div className="sp-msgs" ref={list}>
        {fresh ? <div className="sp-row them"><div className="sp-msg them">{SUPPORT_GREETING}</div><div className="sp-meta">{SUPPORT_NAME}</div></div> : null}
        {(fresh ? shown.filter((m) => m.pending || m.failed || !state?.ticket || state.ticket.status !== "closed") : shown).map((m) => <Bubble key={m.id} message={m} />)}
        {showTopics ? (
          <div className="sp-chips">
            {SUPPORT_TOPICS.map((topic) => <button key={topic} type="button" className="sp-chip" disabled={sending} onClick={() => void send(topic, topic)}>{topic}</button>)}
          </div>
        ) : null}
      </div>
      {error ? <div className="sp-error" role="alert">{error}</div> : null}
      {files.length ? (
        <div className="sp-staged">
          {files.map((file, i) => (
            <span key={`${file.name}-${i}`} className="sp-thumb">
              <img src={URL.createObjectURL(file)} alt={file.name} />
              <button type="button" aria-label={`Remove ${file.name}`} onClick={() => setFiles((f) => f.filter((_x, j) => j !== i))}><X size={11} /></button>
            </span>
          ))}
        </div>
      ) : null}
      <form className="sp-comp" onSubmit={(e) => { e.preventDefault(); void send(text); }}>
        <button type="button" className="sp-attach" aria-label="Add a picture" onClick={() => picker.current?.click()}><ImagePlus size={18} /></button>
        <input ref={picker} type="file" accept="image/png,image/jpeg,image/webp,image/gif,image/heic" multiple hidden onChange={(e) => { addFiles([...(e.target.files ?? [])]); e.target.value = ""; }} />
        <textarea ref={input} rows={1} value={text} placeholder="Type your message…" aria-label="Message"
          onChange={(e) => { setText(e.target.value); setError(null); }}
          onPaste={(e) => { const pasted = [...e.clipboardData.files]; if (pasted.length) { e.preventDefault(); addFiles(pasted); } }}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void send(text); } }} />
        <button type="submit" className="sp-send" disabled={sending || (!text.trim() && files.length === 0)} aria-label="Send"><ArrowUp size={18} /></button>
      </form>
      <button type="button" className="sp-hide" onClick={onHide}>Hide the help button</button>
    </div>
  );
}

/** The "?" bottom right, its chat, and the Undo after hiding it. */
export function SupportWidget() {
  const [open, setOpen] = useState(false);
  const support = useSupport(true, { open });
  const state = support.data;
  // Opening the chat always shows what's new, even if a realtime signal was missed.
  useEffect(() => { if (open) void queryClient.invalidateQueries({ queryKey: SUPPORT_KEY }); }, [open]);
  const [undo, setUndo] = useState(false);

  // A support push clicked (/?support=open), or "Live chat with support" from elsewhere.
  useEffect(() => {
    const show = () => { setOpen(true); void queryClient.invalidateQueries({ queryKey: SUPPORT_KEY }); };
    window.addEventListener("ch:support-open", show);
    return () => window.removeEventListener("ch:support-open", show);
  }, []);
  // Shown again from Settings → Help (the Settings window has its own cache).
  useEffect(() => ch.app.onRelay((m) => { if (m.topic === "support") void queryClient.invalidateQueries({ queryKey: SUPPORT_KEY }); }), []);
  useEffect(() => {
    if (!undo) return;
    const timer = setTimeout(() => setUndo(false), 6000);
    return () => clearTimeout(timer);
  }, [undo]);

  const hide = () => {
    setOpen(false);
    setUndo(true);
    void setHelpButtonHidden(true);
  };

  const hidden = state?.helpButtonHidden ?? false;
  return (
    <>
      {!hidden || open ? (
        <div className={`sp-fabw ${open ? "open" : ""}`}>
          {!open ? <button type="button" className="sp-hidex" onClick={hide} aria-label="Hide the help button" title="Hide the help button"><X size={11} /></button> : null}
          <button type="button" className="sp-fab" onClick={() => setOpen((o) => !o)} aria-label="Live chat with support" aria-expanded={open}>
            ?
            {!open ? <span className="sp-lbl">Live chat with support</span> : null}
            {(state?.unread ?? 0) > 0 && !open ? <span className="sp-unread" aria-label={`${state?.unread} unread`} /> : null}
          </button>
        </div>
      ) : null}
      {open ? <SupportChat state={state} onClose={() => setOpen(false)} onHide={hide} /> : null}
      {undo ? (
        <div className="sp-toast" role="status">
          {HIDDEN_TOAST}
          <button type="button" onClick={() => { setUndo(false); void setHelpButtonHidden(false); }}>Undo</button>
        </div>
      ) : null}
    </>
  );
}
