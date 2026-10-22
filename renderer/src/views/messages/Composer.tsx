import { forwardRef, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { AtSign, Bold, Code, File as FileIcon, Italic, Link2, List, ListOrdered, Loader2, Plus, SendHorizontal, Smile, Strikethrough, X } from "lucide-react";
import { ch } from "../../lib/bridge";
import { convertEmoticon } from "../../lib/emoji";
import { bytes } from "../../lib/format";
import { Avatar } from "../../lib/ui";
import { EmojiPicker } from "./EmojiPicker";

export interface MentionCandidate {
  id: string;
  name: string;
  avatarUrl: string | null;
  sub?: string | null;
}

export interface SentFile {
  url: string;
  name: string;
  size: number;
  mimeType: string;
  kind: "image" | "file";
}

export interface ComposerSend {
  body: string;
  mentions: { id: string; start: number; end: number }[];
  files: SentFile[];
}

export interface ComposerHandle {
  addFiles(files: File[]): void;
  focus(): void;
  insert(text: string): void;
}

interface Staged {
  key: string;
  file: File;
  preview: string | null;
  state: "uploading" | "done" | "failed";
  sent?: SentFile;
}

const DRAFTS = new Map<string, string>();
const MAX_FILES = 10;

/** Uploads one file through the website's Blob route, the same one its composer uses. */
async function uploadFile(file: File, folder?: string): Promise<SentFile | null> {
  // Hey Social Inc. takes any file up to 1 GB into its own folder; pictures show inline only for these four types.
  if (folder) {
    const inline = /^image\/(jpeg|png|webp|gif)$/.test(file.type);
    const result = await ch.files.upload({ route: "/api/upload/hey-social", name: `hey-social-files/${folder}/${Date.now()}-${file.name}`, type: file.type || "application/octet-stream", bytes: await file.arrayBuffer() });
    if (!result.ok) return null;
    return { url: result.url, name: file.name, size: file.size, mimeType: file.type || "application/octet-stream", kind: inline ? "image" : "file" };
  }
  const image = file.type.startsWith("image/") && file.type !== "image/svg+xml";
  const result = await ch.files.upload({
    route: image ? "/api/upload" : "/api/upload/feed-attachments",
    name: file.name,
    type: file.type || "application/octet-stream",
    bytes: await file.arrayBuffer(),
  });
  if (!result.ok) return null;
  return { url: result.url, name: file.name, size: file.size, mimeType: file.type || "application/octet-stream", kind: image ? "image" : "file" };
}

/*
  The message box: plain text with markdown shortcuts (the server turns
  markdown into the stored HTML), @mentions picked from a list and sent as
  ranges, emoji, and files from the + button, a paste or a drop.
*/
export const Composer = forwardRef<ComposerHandle, {
  draftKey: string;
  placeholder: string;
  onSend: (message: ComposerSend) => Promise<boolean>;
  searchPeople?: (query: string) => MentionCandidate[];
  onTyping?: () => void;
  compact?: boolean;
  allowFiles?: boolean;
  autoFocus?: boolean;
  /** Hey Social Inc.: where files go (a channel id, or dm-<conversation id>). */
  uploadFolder?: string;
}>(function Composer({ draftKey, placeholder, onSend, searchPeople, onTyping, compact = false, allowFiles = true, autoFocus = true, uploadFolder }, ref) {
  const [value, setValue] = useState(() => DRAFTS.get(draftKey) ?? "");
  const [picked, setPicked] = useState<MentionCandidate[]>([]);
  const [staged, setStaged] = useState<Staged[]>([]);
  const [sending, setSending] = useState(false);
  const [emoji, setEmoji] = useState(false);
  const [mention, setMention] = useState<{ start: number; query: string } | null>(null);
  const [mentionIndex, setMentionIndex] = useState(0);
  const input = useRef<HTMLTextAreaElement>(null);
  // Where the caret goes after the next render (set with the value, so fast typing can't land in between).
  const caretAfter = useRef<number | null>(null);
  const filePicker = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setValue(DRAFTS.get(draftKey) ?? "");
    setPicked([]);
    setStaged([]);
    if (autoFocus) input.current?.focus();
  }, [draftKey, autoFocus]);

  useEffect(() => {
    if (value) DRAFTS.set(draftKey, value);
    else DRAFTS.delete(draftKey);
  }, [draftKey, value]);

  useLayoutEffect(() => {
    if (caretAfter.current === null || !input.current) return;
    input.current.focus();
    input.current.setSelectionRange(caretAfter.current, caretAfter.current);
    caretAfter.current = null;
  }, [value]);

  // Grow with the text, up to a limit.
  useEffect(() => {
    const el = input.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 220)}px`;
  }, [value]);

  const addFiles = useCallback((files: File[]) => {
    if (!allowFiles) return;
    const room = MAX_FILES - staged.length;
    const next = files.slice(0, Math.max(0, room)).map((file) => ({
      key: `${file.name}-${file.size}-${Math.random()}`,
      file,
      preview: file.type.startsWith("image/") ? URL.createObjectURL(file) : null,
      state: "uploading" as const,
    }));
    if (next.length === 0) return;
    setStaged((current) => [...current, ...next]);
    for (const item of next) {
      void uploadFile(item.file, uploadFolder).then((sent) => {
        setStaged((current) => current.map((s) => (s.key === item.key ? { ...s, state: sent ? "done" : "failed", sent: sent ?? undefined } : s)));
      });
    }
    input.current?.focus();
  }, [allowFiles, staged.length, uploadFolder]);

  const insert = useCallback((text: string) => {
    const el = input.current;
    if (!el) return setValue((v) => v + text);
    const { selectionStart: start, selectionEnd: end } = el;
    const next = value.slice(0, start) + text + value.slice(end);
    caretAfter.current = start + text.length;
    setValue(next);
  }, [value]);

  useImperativeHandle(ref, () => ({ addFiles, focus: () => input.current?.focus(), insert }), [addFiles, insert]);

  /** Wrap the selection in markdown (⌘B, ⌘I, ⌘⇧X, ...). */
  function wrap(before: string, after = before, linePrefix = false) {
    const el = input.current;
    if (!el) return;
    const { selectionStart: start, selectionEnd: end } = el;
    const selected = value.slice(start, end);
    let replacement: string;
    if (linePrefix) {
      replacement = (selected || "").split("\n").map((line, i) => `${before === "1. " ? `${i + 1}. ` : before}${line}`).join("\n");
    } else {
      replacement = `${before}${selected}${after}`;
    }
    const next = value.slice(0, start) + replacement + value.slice(end);
    caretAfter.current = selected || linePrefix ? start + replacement.length : start + before.length;
    setValue(next);
  }

  function link() {
    const el = input.current;
    if (!el) return;
    const selected = value.slice(el.selectionStart, el.selectionEnd) || "link";
    const start = el.selectionStart;
    const text = `[${selected}](https://)`;
    setValue(value.slice(0, start) + text + value.slice(el.selectionEnd));
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(start + selected.length + 3, start + text.length - 1);
    });
  }

  const candidates = useMemo(() => {
    if (!mention || !searchPeople) return [];
    return searchPeople(mention.query).slice(0, 8);
  }, [mention, searchPeople]);

  function trackMention(next: string, caret: number) {
    const before = next.slice(0, caret);
    const match = /(^|\s)@([^\s@]{0,30}(?: [^\s@]{0,30})?)$/.exec(before);
    if (match && searchPeople) {
      setMention({ start: caret - match[2].length - 1, query: match[2] });
      setMentionIndex(0);
    } else {
      setMention(null);
    }
  }

  function pickMention(person: MentionCandidate) {
    if (!mention) return;
    const el = input.current;
    const caret = el?.selectionStart ?? value.length;
    const text = `@${person.name} `;
    const next = value.slice(0, mention.start) + text + value.slice(caret);
    caretAfter.current = mention.start + text.length;
    setValue(next);
    setPicked((current) => (current.some((p) => p.id === person.id) ? current : [...current, person]));
    setMention(null);
  }

  /** The ranges of the picked people still in the text, as the server wants them. */
  function mentionRanges(body: string) {
    const ranges: ComposerSend["mentions"] = [];
    for (const person of picked) {
      const token = `@${person.name}`;
      let from = 0;
      for (;;) {
        const start = body.indexOf(token, from);
        if (start < 0) break;
        ranges.push({ id: person.id, start, end: start + token.length });
        from = start + token.length;
      }
    }
    return ranges.sort((a, b) => a.start - b.start);
  }

  const uploading = staged.some((s) => s.state === "uploading");
  const ready = staged.filter((s) => s.state === "done" && s.sent).map((s) => s.sent!);
  const canSend = !sending && !uploading && (value.trim().length > 0 || ready.length > 0);

  async function send() {
    if (!canSend) return;
    setSending(true);
    const body = value;
    const ok = await onSend({ body, mentions: mentionRanges(body), files: ready });
    setSending(false);
    if (ok) {
      setValue("");
      setPicked([]);
      staged.forEach((s) => s.preview && URL.revokeObjectURL(s.preview));
      setStaged([]);
      DRAFTS.delete(draftKey);
    }
    input.current?.focus();
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (mention && candidates.length > 0) {
      if (event.key === "ArrowDown") { event.preventDefault(); setMentionIndex((i) => (i + 1) % candidates.length); return; }
      if (event.key === "ArrowUp") { event.preventDefault(); setMentionIndex((i) => (i - 1 + candidates.length) % candidates.length); return; }
      if (event.key === "Enter" || event.key === "Tab") { event.preventDefault(); pickMention(candidates[mentionIndex]); return; }
      if (event.key === "Escape") { event.preventDefault(); setMention(null); return; }
    }
    const mod = event.metaKey || event.ctrlKey;
    if (mod && event.key.toLowerCase() === "b") { event.preventDefault(); wrap("**"); return; }
    if (mod && event.key.toLowerCase() === "i") { event.preventDefault(); wrap("_"); return; }
    if (mod && event.shiftKey && event.key.toLowerCase() === "x") { event.preventDefault(); wrap("~~"); return; }
    if (mod && event.shiftKey && event.key.toLowerCase() === "u") { event.preventDefault(); link(); return; }
    if (event.key === "Enter" && !event.shiftKey && !event.altKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      void send();
    }
  }

  return (
    <div className={`composer ${compact ? "compact" : ""}`}
      onDragOver={(event) => allowFiles && event.dataTransfer.types.includes("Files") && event.preventDefault()}
      onDrop={(event) => {
        if (!allowFiles || event.dataTransfer.files.length === 0) return;
        event.preventDefault();
        addFiles([...event.dataTransfer.files]);
      }}>
      {!compact ? (
        <div className="fmt">
          <button title="Bold (⌘B)" onClick={() => wrap("**")}><Bold /></button>
          <button title="Italic (⌘I)" onClick={() => wrap("_")}><Italic /></button>
          <button title="Strikethrough (⌘⇧X)" onClick={() => wrap("~~")}><Strikethrough /></button>
          <button title="Link (⌘⇧U)" onClick={link}><Link2 /></button>
          <button title="Bulleted list" onClick={() => wrap("- ", "", true)}><List /></button>
          <button title="Numbered list" onClick={() => wrap("1. ", "", true)}><ListOrdered /></button>
          <button title="Code" onClick={() => wrap("`")}><Code /></button>
        </div>
      ) : null}
      {staged.length > 0 ? (
        <div className="staged">
          {staged.map((s) => (
            <div key={s.key} className={`chip-file ${s.state}`}>
              {s.preview ? <img src={s.preview} alt="" /> : <span className="ficon"><FileIcon /></span>}
              <span className="fmeta"><b>{s.file.name}</b><span>{s.state === "failed" ? "Couldn't upload" : s.state === "uploading" ? "Uploading…" : bytes(s.file.size)}</span></span>
              {s.state === "uploading" ? <Loader2 className="spin" /> : null}
              <button aria-label="Remove" onClick={() => setStaged((c) => c.filter((x) => x.key !== s.key))}><X /></button>
            </div>
          ))}
        </div>
      ) : null}
      <textarea
        ref={input}
        rows={1}
        value={value}
        placeholder={placeholder}
        spellCheck
        onChange={(event) => {
          let next = event.target.value;
          let caret = event.target.selectionStart;
          const converted = convertEmoticon(next, caret);
          if (converted) {
            next = converted.value;
            caret = converted.caret;
            caretAfter.current = caret;
          }
          setValue(next);
          trackMention(next, caret);
          onTyping?.();
        }}
        onKeyDown={onKeyDown}
        onPaste={(event) => {
          const files = [...event.clipboardData.files];
          if (files.length > 0 && allowFiles) {
            event.preventDefault();
            addFiles(files);
          }
        }}
      />
      {mention && candidates.length > 0 ? (
        <div className="mention-list" role="listbox">
          {candidates.map((person, i) => (
            <button key={person.id} className={i === mentionIndex ? "sel" : ""} onMouseDown={(e) => { e.preventDefault(); pickMention(person); }}>
              <Avatar name={person.name} src={person.avatarUrl} seed={person.id} size={22} radius="6px" />
              <b>{person.name}</b>{person.sub ? <span>{person.sub}</span> : null}
            </button>
          ))}
        </div>
      ) : null}
      <div className="tools">
        {allowFiles ? <button title="Attach files" onClick={() => filePicker.current?.click()}><Plus /></button> : null}
        <span style={{ position: "relative" }}>
          <button title="Emoji" onClick={() => setEmoji(!emoji)}><Smile /></button>
          {emoji ? <EmojiPicker onPick={(e) => { insert(e); setEmoji(false); }} onClose={() => setEmoji(false)} placement="above" /> : null}
        </span>
        {searchPeople ? <button title="Mention someone" onClick={() => insert(value && !/\s$/.test(value) ? " @" : "@")}><AtSign /></button> : null}
        <button className={`send ${canSend ? "on" : ""}`} disabled={!canSend} title="Send (Return)" onClick={() => void send()}>
          {sending ? <Loader2 className="spin" /> : <SendHorizontal />}
        </button>
      </div>
      <input ref={filePicker} type="file" multiple hidden onChange={(event) => {
        addFiles([...(event.target.files ?? [])]);
        event.target.value = "";
      }} />
    </div>
  );
});
