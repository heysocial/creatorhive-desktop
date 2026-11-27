import { forwardRef, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { Play, Mic, AtSign, Hash, Bold, Code, File as FileIcon, Italic, Link2, List, ListOrdered, Loader2, Plus, SendHorizontal, Smile, Strikethrough, X } from "lucide-react";
import { ch, type UploadResult } from "../../lib/bridge";
import { convertEmoticon } from "../../lib/emoji";
import { bytes } from "../../lib/format";
import { Avatar } from "../../lib/ui";
import { EmojiPicker } from "./EmojiPicker";
import { VoiceRecorder } from "./VoiceRecorder";
import { pastedFiles } from "../../lib/paste";
import { startVideoJob, type UploadedVideo, type VideoJob } from "../../lib/community";

export interface MentionCandidate {
  id: string;
  name: string;
  avatarUrl: string | null;
  sub?: string | null;
}

/** A channel for the `#` list (CreatorHive DMs). `name` is shown and inserted as `#name`. */
export interface ChannelCandidate {
  id: string;
  name: string;
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
  /** `#Channel` ranges, when the box offers channels (`searchChannels`). */
  channelMentions: { id: string; start: number; end: number }[];
  files: SentFile[];
  /** Videos on their way to Mux; the message can go before they finish (not Hey Social Inc., where videos are files). */
  videos: VideoJob[];
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
  /** Why it failed, when the website said (over the daily upload limit). */
  failedReason?: string;
  video?: { progress: number; job: VideoJob; duration?: number };
}

/** A frame from the video and its length, made on the Mac for the chip before anything uploads. */
export function videoThumbnail(file: File): Promise<{ url: string | null; duration: number }> {
  return new Promise((resolve) => {
    const src = URL.createObjectURL(file);
    const el = document.createElement("video");
    el.muted = true;
    el.preload = "metadata";
    el.src = src;
    const done = (url: string | null) => { URL.revokeObjectURL(src); resolve({ url, duration: Number.isFinite(el.duration) ? el.duration : 0 }); };
    el.onloadeddata = () => { el.currentTime = Math.min(1, (el.duration || 2) / 2); };
    el.onseeked = () => {
      try {
        const canvas = document.createElement("canvas");
        const scale = 160 / Math.max(el.videoWidth, el.videoHeight, 1);
        canvas.width = Math.round(el.videoWidth * scale);
        canvas.height = Math.round(el.videoHeight * scale);
        canvas.getContext("2d")!.drawImage(el, 0, 0, canvas.width, canvas.height);
        done(canvas.toDataURL("image/jpeg", 0.8));
      } catch { done(null); }
    };
    el.onerror = () => done(null);
    setTimeout(() => done(null), 8000);
  });
}

const DRAFTS = new Map<string, string>();

/*
  CreatorHive DMs keep their unsent text on this Mac (docs/academy-onboarding-nov27.md §4):
  localStorage `dm-draft:<conversationId>`, restored when the conversation opens, cleared on send.
  Picked mentions aren't kept: after a restart they're plain text.
*/
function readDraft(draftKey: string, storageKey?: string) {
  const held = DRAFTS.get(draftKey);
  if (held !== undefined || !storageKey) return held ?? "";
  try { return localStorage.getItem(storageKey) ?? ""; } catch { return ""; }
}
function writeDraft(draftKey: string, value: string, storageKey?: string) {
  if (value) DRAFTS.set(draftKey, value);
  else DRAFTS.delete(draftKey);
  if (!storageKey) return;
  try {
    if (value.trim()) localStorage.setItem(storageKey, value);
    else localStorage.removeItem(storageKey);
  } catch { /* full or unavailable: the in-memory draft still holds */ }
}

/** "@name" or "#channel" just before the caret. A "#" must touch its word, so "# Heading" stays markdown. */
const AT_TRIGGER = /(^|\s)@([^\s@]{0,30}(?: [^\s@]{0,30})?)$/;
const HASH_TRIGGER = /(^|\s)#((?:[^\s#]{1,30}(?: [^\s#]{0,30})?)?)$/;
const MAX_FILES = 10;

/** The website's sentence for a refused upload (over the daily limit), or undefined. */
const uploadRefusal = (result: UploadResult) => (!result.ok && result.error === "rate_limited" ? result.message : undefined);

/**
 * Uploads one file through the website's Blob route, the same one its composer
 * uses. A failure carries the website's reason when it gave one.
 */
export async function uploadFile(file: File, folder?: string): Promise<SentFile | { failedReason?: string }> {
  // Hey Social Inc. takes any file up to 1 GB into its own folder; pictures show inline only for these four types.
  if (folder) {
    const inline = /^image\/(jpeg|png|webp|gif)$/.test(file.type);
    const result = await ch.files.upload({ route: "/api/upload/hey-social", name: `hey-social-files/${folder}/${Date.now()}-${file.name}`, type: file.type || "application/octet-stream", bytes: await file.arrayBuffer() });
    if (!result.ok) return { failedReason: uploadRefusal(result) };
    return { url: result.url, name: file.name, size: file.size, mimeType: file.type || "application/octet-stream", kind: inline ? "image" : "file" };
  }
  const image = file.type.startsWith("image/") && file.type !== "image/svg+xml";
  const result = await ch.files.upload({
    route: image ? "/api/upload" : "/api/upload/feed-attachments",
    name: file.name,
    type: file.type || "application/octet-stream",
    bytes: await file.arrayBuffer(),
  });
  if (!result.ok) return { failedReason: uploadRefusal(result) };
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
  /** CreatorHive DMs: channels after "#", sent as `channelMentions`. */
  searchChannels?: (query: string) => ChannelCandidate[];
  /** Keep the draft in localStorage under this key too (CreatorHive DMs: `dm-draft:<id>`). */
  storageKey?: string;
  onTyping?: () => void;
  compact?: boolean;
  allowFiles?: boolean;
  autoFocus?: boolean;
  /** Hey Social Inc.: where files go (a channel id, or dm-<conversation id>). */
  uploadFolder?: string;
  /** Videos (CreatorHive channels and DMs): uploads one to Mux, reporting progress. */
  uploadVideo?: (file: File, onProgress: (pct: number) => void, signal?: AbortSignal) => Promise<UploadedVideo>;
  /** Voice memos: the route, the thread (if any), and what to do with the sent message. */
  voice?: { path: string; parentMessageId?: string | null; onSent: (message: unknown) => void };
}>(function Composer({ draftKey, placeholder, onSend, searchPeople, searchChannels, storageKey, onTyping, compact = false, allowFiles = true, autoFocus = true, uploadFolder, voice, uploadVideo }, ref) {
  const [recording, setRecording] = useState(false);
  const [value, setValue] = useState(() => readDraft(draftKey, storageKey));
  const [picked, setPicked] = useState<MentionCandidate[]>([]);
  const [pickedChannels, setPickedChannels] = useState<ChannelCandidate[]>([]);
  const [staged, setStaged] = useState<Staged[]>([]);
  /** Sends still on their way; only for the spinner — typing and Return never wait for them. */
  const [sending, setSending] = useState(0);
  const [emoji, setEmoji] = useState(false);
  const [mention, setMention] = useState<{ start: number; query: string; kind: "@" | "#" } | null>(null);
  const [mentionIndex, setMentionIndex] = useState(0);
  const input = useRef<HTMLTextAreaElement>(null);
  // Where the caret goes after the next render (set with the value, so fast typing can't land in between).
  const caretAfter = useRef<number | null>(null);
  const filePicker = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setValue(readDraft(draftKey, storageKey));
    setPicked([]);
    setPickedChannels([]);
    setStaged([]);
    if (autoFocus) input.current?.focus();
  }, [draftKey, storageKey, autoFocus]);

  // Skips the first run after a switch: `value` is still the last conversation's until the effect above lands.
  const draftFor = useRef(draftKey);
  useEffect(() => {
    if (draftFor.current !== draftKey) { draftFor.current = draftKey; return; }
    writeDraft(draftKey, value, storageKey);
  }, [draftKey, storageKey, value]);

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
    const next: Staged[] = files.slice(0, Math.max(0, room)).map((file) => ({
      key: `${file.name}-${file.size}-${Math.random()}`,
      file,
      preview: file.type.startsWith("image/") ? URL.createObjectURL(file) : null,
      state: "uploading",
      video: uploadVideo && file.type.startsWith("video/") ? { progress: 0, job: startVideoJob(file, uploadVideo) } : undefined,
    }));
    if (next.length === 0) return;
    setStaged((current) => [...current, ...next]);
    // Videos: a thumbnail right away, then straight to Mux with progress, as Slack does.
    for (const item of next.filter((n) => n.video)) {
      const update = (change: (s: Staged) => Staged) => setStaged((current) => current.map((s) => (s.key === item.key ? change(s) : s)));
      const job = item.video!.job;
      void videoThumbnail(item.file).then(({ url, duration }) => {
        job.preview = url;
        job.duration = duration;
        update((s) => ({ ...s, preview: url, video: { ...s.video!, duration } }));
      });
      job.subscribe(() => update((s) => ({ ...s, state: job.failed ? "failed" : job.uploaded ? "done" : "uploading", failedReason: job.failedReason, video: { ...s.video!, progress: job.progress } })));
    }
    for (const item of next.filter((n) => !n.video)) {
      void uploadFile(item.file, uploadFolder).then((outcome) => {
        const sent = "url" in outcome ? outcome : undefined;
        const failedReason = sent ? undefined : (outcome as { failedReason?: string }).failedReason;
        setStaged((current) => current.map((s) => (s.key === item.key ? { ...s, state: sent ? "done" : "failed", sent, failedReason } : s)));
      });
    }
    input.current?.focus();
  }, [allowFiles, staged.length, uploadFolder, uploadVideo]);

  /** Puts text at the caret; returns the new value and caret. */
  const insert = useCallback((text: string) => {
    const el = input.current;
    if (!el) { setValue((v) => v + text); return null; }
    const { selectionStart: start, selectionEnd: end } = el;
    const next = value.slice(0, start) + text + value.slice(end);
    caretAfter.current = start + text.length;
    setValue(next);
    return { next, caret: start + text.length };
  }, [value]);

  useImperativeHandle(ref, () => ({ addFiles, focus: () => input.current?.focus(), insert: (text) => void insert(text) }), [addFiles, insert]);

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

  const candidates = useMemo((): (MentionCandidate | ChannelCandidate)[] => {
    if (!mention) return [];
    const search = mention.kind === "@" ? searchPeople : searchChannels;
    return search ? search(mention.query).slice(0, 8) : [];
  }, [mention, searchPeople, searchChannels]);

  function trackMention(next: string, caret: number) {
    const before = next.slice(0, caret);
    const at = searchPeople ? AT_TRIGGER.exec(before) : null;
    const hash = !at && searchChannels ? HASH_TRIGGER.exec(before) : null;
    const match = at ?? hash;
    if (match) {
      setMention({ start: caret - match[2].length - 1, query: match[2], kind: at ? "@" : "#" });
      setMentionIndex(0);
    } else {
      setMention(null);
    }
  }

  function pickMention(item: MentionCandidate | ChannelCandidate) {
    if (!mention) return;
    const el = input.current;
    const caret = el?.selectionStart ?? value.length;
    const text = `${mention.kind}${item.name} `;
    const next = value.slice(0, mention.start) + text + value.slice(caret);
    caretAfter.current = mention.start + text.length;
    setValue(next);
    if (mention.kind === "@") setPicked((current) => (current.some((p) => p.id === item.id) ? current : [...current, item as MentionCandidate]));
    else setPickedChannels((current) => (current.some((c) => c.id === item.id) ? current : [...current, item]));
    setMention(null);
  }

  /** The ranges of the picked people (or channels) still in the text, as the server wants them. */
  function mentionRanges(body: string, items: { id: string; name: string }[] = picked, mark = "@") {
    const ranges: ComposerSend["mentions"] = [];
    for (const person of items) {
      const token = `${mark}${person.name}`;
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

  // Videos don't hold up Send (the message waits for them); other files do.
  const uploading = staged.some((s) => s.state === "uploading" && !s.video);
  const ready = staged.filter((s) => s.state === "done" && s.sent).map((s) => s.sent!);
  const videos = staged.filter((s) => s.video && s.state !== "failed").map((s) => s.video!.job);
  const canSend = !uploading && (value.trim().length > 0 || ready.length > 0 || videos.length > 0);

  /*
    The box empties the moment Return is pressed, not when the server answers.
    It used to wait: whatever was typed while a send was on its way was then
    wiped by that send's clear, and Return did nothing until it answered — so
    in a quick run a message could vanish without ever being sent (2.0.6).
    A send that fails stays in the conversation as a failed message with Try
    again (sendMessage's optimistic copy), so clearing early loses nothing.
    Each message shows at once; sendMessage keeps their requests in order.
  */
  function send() {
    if (!canSend) return;
    const message: ComposerSend = { body: value, mentions: mentionRanges(value), channelMentions: mentionRanges(value, pickedChannels, "#"), files: ready, videos };
    const previews = staged.map((s) => s.preview).filter((preview): preview is string => Boolean(preview));
    setValue("");
    setPicked([]);
    setPickedChannels([]);
    setStaged([]);
    setMention(null);
    writeDraft(draftKey, "", storageKey);
    input.current?.focus();
    setSending((n) => n + 1);
    void Promise.resolve()
      .then(() => onSend(message))
      .catch(() => false)
      .finally(() => {
        setSending((n) => n - 1);
        previews.forEach((preview) => URL.revokeObjectURL(preview));
      });
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
      send();
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
            <div key={s.key} className={`chip-file ${s.state} ${s.video ? "is-video" : ""}`}>
              {s.video ? (
                <span className="vthumb">{s.preview ? <img src={s.preview} alt="" /> : null}<Play /></span>
              ) : s.preview ? <img src={s.preview} alt="" /> : <span className={`ficon ${/pdf/i.test(s.file.type) ? "" : "generic"}`}><FileIcon /></span>}
              <span className="fmeta"><b>{s.file.name}</b><span>{s.state === "failed" ? (s.failedReason ?? "Couldn't upload") : s.video ? (s.state === "done" ? `Ready to send${s.video.duration ? ` · ${Math.floor(s.video.duration / 60)}:${String(Math.round(s.video.duration % 60)).padStart(2, "0")}` : ""}` : `Uploading ${s.video.progress}% · you can send now`) : s.state === "uploading" ? "Uploading…" : bytes(s.file.size)}</span>
                {s.video && s.state === "uploading" ? <i className="vprog"><i style={{ width: `${s.video.progress}%` }} /></i> : null}
              </span>
              {s.state === "uploading" && !s.video ? <Loader2 className="spin" /> : null}
              <button aria-label="Remove" onClick={() => { s.video?.job.cancel(); setStaged((c) => c.filter((x) => x.key !== s.key)); }}><X /></button>
            </div>
          ))}
        </div>
      ) : null}
      {recording && voice ? (
        <VoiceRecorder path={voice.path} body={value} parentMessageId={voice.parentMessageId}
          onCancel={() => setRecording(false)}
          onSent={(message) => { setRecording(false); setValue(""); writeDraft(draftKey, "", storageKey); voice.onSent(message); }} />
      ) : null}
      <textarea
        ref={input}
        hidden={recording}
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
          if (!allowFiles) return;
          void pastedFiles(event).then((files) => files && addFiles(files));
        }}
      />
      {mention && candidates.length > 0 ? (
        <div className="mention-list" role="listbox">
          {candidates.map((item, i) => (
            <button key={item.id} className={i === mentionIndex ? "sel" : ""} onMouseDown={(e) => { e.preventDefault(); pickMention(item); }}>
              {"avatarUrl" in item ? <Avatar name={item.name} src={item.avatarUrl} seed={item.id} size={22} radius="6px" /> : <Hash className="mention-hash" />}
              <b>{item.name}</b>{"sub" in item && item.sub ? <span>{item.sub}</span> : null}
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
        {searchPeople ? <button title="Mention someone" onClick={() => {
          // The list opens right away, as if "@" had been typed.
          const at = insert(value && !/\s$/.test(value) ? " @" : "@");
          if (at) trackMention(at.next, at.caret);
        }}><AtSign /></button> : null}
        {voice ? <button title="Record a voice memo" onClick={() => setRecording(true)}><Mic /></button> : null}
        <button className={`send ${canSend ? "on" : ""}`} disabled={!canSend} title="Send (Return)" onClick={() => send()}>
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
