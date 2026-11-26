import { useEffect, useRef, useState } from "react";
import { AlertCircle, Check, Circle, ExternalLink, FileText, Globe, Link2, Lock, X } from "lucide-react";
import { ch } from "../../lib/bridge";
import {
  SCRIPT_LINK_ERROR,
  SCRIPT_TEXT_MAX_CHARS,
  countWords,
  formatBytes,
  googleScriptLink,
  saveScript,
  shortScriptLink,
  uploadScriptFile,
  type ScriptKind,
  type VideoScript,
} from "../../lib/starter";

/*
  The Weekend Starter's "Your script" (creatorhive-app docs/video-scripts.md),
  the same as the website's step 2: each video needs the exact words said in
  it before it can be sent. Paste it (saved as she types), upload a PDF, DOC
  or DOCX (up to 20 MB), or a Google Docs/Drive link (anything else is
  refused). Saving again replaces it until the video is sent; then it locks.
*/

/** ✓ Script / ✓ Video, green once each is in. */
export function ScriptChecklist({ script, video }: { script: boolean; video: boolean }) {
  return (
    <span className="vs-checks">
      <CheckChip label="Script" on={script} />
      <CheckChip label="Video" on={video} />
    </span>
  );
}

function CheckChip({ label, on }: { label: string; on: boolean }) {
  return <span className={`vs-check ${on ? "on" : ""}`}>{on ? <Check /> : <Circle />}{label}</span>;
}

/* The website's labels; a narrow card (the 3-video overview) shows the short ones (starter.css). */
const TABS: ReadonlyArray<readonly [ScriptKind, string, string]> = [["text", "Paste script", "Paste"], ["file", "Upload file", "File"], ["link", "Google Drive link", "Google link"]];
const FILE_ACCEPT = ".pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document";

export function ScriptField({ slot, script, required }: { slot: number; script: VideoScript | null; required: boolean }) {
  const [tab, setTab] = useState<ScriptKind>(script?.kind ?? "text");
  const [text, setText] = useState(script?.kind === "text" ? script.text ?? "" : "");
  const [link, setLink] = useState(script?.kind === "link" ? script.linkUrl ?? "" : "");
  const [linkError, setLinkError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const timer = useRef<number | null>(null);
  const savedText = script?.kind === "text" ? script.text ?? "" : null;

  useEffect(() => () => { if (timer.current) window.clearTimeout(timer.current); }, []);

  async function saveText(value: string) {
    if (!value.trim() || value.trim() === (savedText ?? "").trim()) return;
    setSaving(true);
    setError(null);
    try {
      await saveScript(slot, { kind: "text", text: value });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Couldn't save the script. Try again.");
    } finally {
      setSaving(false);
    }
  }

  function onText(value: string) {
    setText(value);
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => void saveText(value), 900);
  }

  async function saveLink(value: string) {
    const trimmed = value.trim();
    if (!trimmed) { setLinkError(null); return; }
    const google = googleScriptLink(trimmed);
    if (!google) { setLinkError(SCRIPT_LINK_ERROR); return; }
    setLinkError(null);
    if (script?.kind === "link" && script.linkUrl === google.url) return;
    setSaving(true);
    try {
      const saved = await saveScript(slot, { kind: "link", url: trimmed });
      setLink(saved.linkUrl ?? trimmed);
    } catch (reason) {
      setLinkError(reason instanceof Error ? reason.message : SCRIPT_LINK_ERROR);
    } finally {
      setSaving(false);
    }
  }

  async function upload(file: File | undefined) {
    if (!file) return;
    setError(null);
    setUploading(true);
    try {
      await uploadScriptFile(slot, file);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The file didn't upload. Try again.");
    } finally {
      setUploading(false);
    }
  }

  const words = countWords(text);
  const textSaved = savedText != null && savedText.trim() === text.trim() && text.trim().length > 0;

  return (
    <div className={`vs-block ${linkError && tab === "link" ? "bad" : ""}`}>
      <div className="vs-label-row">
        <span className="vs-label">Your script</span>
        {required ? <span className="vs-required">Required</span> : null}
      </div>
      <div className="seg vs-tabs" role="tablist" aria-label={`Video ${slot} script`}>
        {TABS.map(([kind, label, short]) => (
          <button key={kind} type="button" role="tab" aria-selected={tab === kind} aria-label={label} className={tab === kind ? "on" : ""} onClick={() => setTab(kind)}>
            <span className="vs-tab-long">{label}</span><span className="vs-tab-short">{short}</span>
          </button>
        ))}
      </div>

      {tab === "text" ? (
        <>
          <textarea
            className="field area vs-text"
            value={text}
            rows={5}
            maxLength={SCRIPT_TEXT_MAX_CHARS}
            placeholder="Paste the exact words you say in this video"
            aria-label={`Video ${slot} script`}
            onChange={(event) => onText(event.target.value)}
            onBlur={() => { if (timer.current) window.clearTimeout(timer.current); void saveText(text); }}
          />
          <span className="vs-meta">
            {saving ? "Saving…"
              : textSaved ? <span className="vs-saved"><Check />Script saved · {words} {words === 1 ? "word" : "words"}</span>
                : text.trim() ? `${words} ${words === 1 ? "word" : "words"}`
                  : script && script.kind !== "text" ? `Saved as ${script.kind === "file" ? "a file" : "a Google link"}. Pasting here replaces it.` : "0 words"}
          </span>
        </>
      ) : null}

      {tab === "file" ? (
        <>
          {script?.kind === "file" ? (
            <div className="vs-file">
              <span className="vs-file-ico"><FileText /></span>
              <span className="vs-file-text">
                <b>{script.fileName}</b>
                <span className="muted">{(script.fileType ?? "").toUpperCase()}{script.fileSize ? ` · ${formatBytes(script.fileSize)}` : ""} · Uploaded</span>
              </span>
              <button type="button" className="btn" disabled={uploading} onClick={() => fileInput.current?.click()}>{uploading ? "Uploading…" : "Replace"}</button>
            </div>
          ) : (
            <button type="button" className="vs-drop" disabled={uploading} onClick={() => fileInput.current?.click()}>
              <FileText />
              <b>{uploading ? "Uploading…" : "Upload your script"}</b>
              <span className="faint">PDF, DOC or DOCX · up to 20 MB</span>
            </button>
          )}
          <input ref={fileInput} type="file" hidden accept={FILE_ACCEPT} onChange={(event) => { void upload(event.target.files?.[0]); event.target.value = ""; }} />
          {script && script.kind !== "file" && !uploading ? <span className="vs-meta">Saved as {script.kind === "text" ? "pasted text" : "a Google link"}. Uploading a file replaces it.</span> : null}
        </>
      ) : null}

      {tab === "link" ? (
        <>
          <label className={`vs-link ${linkError ? "bad" : ""}`}>
            {linkError ? <Globe /> : <Link2 />}
            <input
              type="url"
              value={link}
              placeholder="docs.google.com/document/…"
              aria-label={`Video ${slot} Google Docs or Drive link`}
              aria-invalid={Boolean(linkError)}
              onChange={(event) => { setLink(event.target.value); if (linkError) setLinkError(null); }}
              onBlur={() => void saveLink(link)}
              onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); void saveLink(link); } }}
            />
          </label>
          {linkError ? <span className="st-error vs-error" role="alert"><AlertCircle />{linkError}</span> : null}
          {!linkError && script?.kind === "link" ? (
            <button type="button" className="vs-doc" onClick={() => script.linkUrl && ch.app.openExternal(script.linkUrl)}>
              <FileText />
              <span className="vs-file-text">
                <b>Video {slot} script</b>
                <span className="muted">{script.linkKind === "drive" ? "Google Drive" : "Google Docs"} · Make sure anyone with the link can view it</span>
              </span>
              <ExternalLink />
            </button>
          ) : null}
          {!linkError && script && script.kind !== "link" ? <span className="vs-meta">Saved as {script.kind === "text" ? "pasted text" : "a file"}. Adding a link replaces it.</span> : null}
        </>
      ) : null}

      {error ? <span className="st-error vs-error" role="alert"><AlertCircle />{error}</span> : null}
    </div>
  );
}

/** "View script" on a sent video: what she gave the editor, read-only. */
export function ScriptViewer({ script, onClose }: { script: VideoScript; onClose: () => void }) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  const sent = new Date(script.updatedAt).toLocaleDateString("en-US", { month: "short", day: "numeric" });
  return (
    <div className="vs-scrim" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="vs-viewer card" role="dialog" aria-modal="true" aria-label={`Video ${script.slot} script`}>
        <header>
          <b>Video {script.slot} script</b>
          <button type="button" className="btn vs-close" onClick={onClose} aria-label="Close"><X /></button>
        </header>
        {script.kind === "text" ? (
          <>
            <span className="muted">{script.wordCount ?? 0} {script.wordCount === 1 ? "word" : "words"} · Sent {sent}</span>
            <div className="vs-viewer-text">{script.text}</div>
          </>
        ) : script.kind === "file" ? (
          <div className="vs-file">
            <span className="vs-file-ico"><FileText /></span>
            <span className="vs-file-text"><b>{script.fileName}</b><span className="muted">{(script.fileType ?? "").toUpperCase()}{script.fileSize ? ` · ${formatBytes(script.fileSize)}` : ""}</span></span>
            {script.fileUrl ? <button type="button" className="btn" onClick={() => ch.app.openExternal(script.fileUrl!)}>Open {(script.fileType ?? "file").toUpperCase()}</button> : null}
          </div>
        ) : (
          <button type="button" className="vs-doc" onClick={() => script.linkUrl && ch.app.openExternal(script.linkUrl)}>
            <FileText />
            <span className="vs-file-text"><b>{shortScriptLink(script.linkUrl ?? "")}</b><span className="muted">{script.linkKind === "drive" ? "Google Drive" : "Google Docs"}</span></span>
            <ExternalLink />
          </button>
        )}
        <span className="muted vs-locked"><Lock />Locked after sending. To change it, message him.</span>
      </div>
    </div>
  );
}
