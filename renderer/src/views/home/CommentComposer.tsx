import { useEffect, useRef, useState, type MouseEvent, type ReactNode, type RefObject } from "react";
import { Download, FileText, Loader2, Paperclip, Play, Search, SendHorizontal, Smile, X } from "lucide-react";
import { ch } from "../../lib/bridge";
import { ApiError, rateLimitMessage } from "../../lib/api";
import { localPosters } from "../../lib/community";
import { MAX_COMMENT_MEDIA, attachmentName, isGiphyUrl, isImageUrl, searchGifs, uploadCommentVideo, type Comment, type Gif } from "../../lib/feed";
import { bytes } from "../../lib/format";
import { EmojiPicker } from "../messages/EmojiPicker";
import { VideoPlayer } from "../messages/VideoPlayer";
import { videoThumbnail } from "../messages/Composer";

/*
  The comment (and reply) box, as the website's (components/feed/CommentComposer.tsx
  there): staged photos, files, GIFs or one video above the words, and Emoji,
  Files and GIF inside the box on the right. Photos and files upload as soon as
  they're picked (the post composer's routes and limits); a video goes to Mux
  and is sent on its own. The sentences are the website's.
*/

const FULL = `Up to ${MAX_COMMENT_MEDIA} photos, files or GIFs per comment.`;
const VIDEO_ALONE = "Send a video on its own. Remove the other attachments first.";
const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
const IMAGE_LIMIT = 8 * 1024 * 1024;
const FILE_LIMIT = 20 * 1024 * 1024;
const VIDEO_LIMIT = 2 * 1024 * 1024 * 1024;
const MAX_VIDEO_SECONDS = 5 * 60;
// The Mac often leaves a document's type blank: its extension decides, as on the website.
const DOCUMENT_TYPES: Record<string, string> = {
  pdf: "application/pdf",
  txt: "text/plain",
  csv: "text/csv",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ppt: "application/vnd.ms-powerpoint",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
};
const ACCEPT = ["image/jpeg", "image/png", "image/webp", "image/gif", "video/*", ...Object.keys(DOCUMENT_TYPES).map((ext) => `.${ext}`)].join(",");

const extension = (name: string) => name.split(".").pop()?.toLowerCase() ?? "";
const documentType = (file: File) => DOCUMENT_TYPES[extension(file.name)] ?? (Object.values(DOCUMENT_TYPES).includes(file.type) ? file.type : null);
const stamp = (name: string) => `${Date.now()}-${name.replace(/[/\\]/g, "-")}`;

type Staged = { key: string; state: "uploading" | "done" | "failed"; failedReason?: string } & (
  | { kind: "image"; preview: string; name: string; url?: string }
  | { kind: "file"; name: string; size: number; url?: string }
  | { kind: "gif"; preview: string; url: string }
  | { kind: "video"; name: string; preview: string | null; progress: number; done: Promise<{ uploadToken: string; uid: string }> }
);

let keys = 0;

/** The website's sentence for a refused request, or null. */
export function serverSentence(error: unknown) {
  const limited = rateLimitMessage(error);
  if (limited) return limited;
  const sentence = error instanceof ApiError ? error.data?.error : null;
  return typeof sentence === "string" && /\s/.test(sentence) && error instanceof ApiError && error.status < 500 ? sentence : null;
}

export function CommentComposer({ postId, value, setValue, box, placeholder, onKeyDown, onChange, extra, onSend }: {
  postId: string;
  value: string;
  setValue: (next: string | ((current: string) => string)) => void;
  box: RefObject<HTMLTextAreaElement | null>;
  placeholder: string;
  /** True when the @ list used the key. */
  onKeyDown: (event: React.KeyboardEvent<HTMLTextAreaElement>) => boolean;
  onChange: (value: string, caret: number) => void;
  /** The @ list. */
  extra?: ReactNode;
  /** Sends the comment; resolves with the sentence to show (everything kept) when it didn't go, else null. */
  onSend: (input: { body: string; mediaUrls: string[]; videoUploadToken?: string; videoUid?: string; videoPreview?: string | null }) => Promise<string | null>;
}) {
  const [staged, setStaged] = useState<Staged[]>([]);
  const [open, setOpen] = useState<"emoji" | "gif" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const picker = useRef<HTMLInputElement>(null);
  const root = useRef<HTMLDivElement>(null);
  const caret = useRef<{ start: number; end: number } | null>(null);
  const current = useRef(staged);
  current.current = staged;

  const update = (key: string, change: (item: Staged) => Staged) => setStaged((all) => all.map((s) => (s.key === key ? change(s) : s)));

  async function addFiles(files: File[]) {
    setError(null);
    if (!files.length) return;
    const now = current.current;
    const video = files.find((file) => file.type.startsWith("video/"));
    if (video) {
      if (now.length > 0 || files.length > 1) return setError(VIDEO_ALONE);
      if (video.size > VIDEO_LIMIT) return setError("Video must be 2 GB or smaller");
      // Read before staging, so a video over 5 minutes never starts uploading.
      const { url: preview, duration } = await videoThumbnail(video);
      if (duration > MAX_VIDEO_SECONDS + 1) return setError("Videos must be 5 minutes or shorter.");
      const key = `v${++keys}`;
      const done = uploadCommentVideo(postId, video, (progress) => update(key, (s) => (s.kind === "video" ? { ...s, progress } : s)));
      setStaged([{ key, kind: "video", name: video.name, preview, progress: 0, state: "uploading", done }]);
      done.then(() => update(key, (s) => ({ ...s, state: "done" })),
        (failure) => update(key, (s) => ({ ...s, state: "failed", failedReason: serverSentence(failure) ?? "The video didn't upload. Remove it and try again." })));
      return;
    }
    if (now.some((s) => s.kind === "video")) return setError(VIDEO_ALONE);
    const next: { file: File; image: boolean; type: string }[] = [];
    for (const file of files) {
      const image = IMAGE_TYPES.has(file.type);
      if (image && file.size > IMAGE_LIMIT) { setError("Choose a JPEG, PNG, WebP, or GIF image smaller than 8MB."); continue; }
      const type = image ? file.type : documentType(file);
      if (!type) { setError("Choose a PDF, text, Word, Excel, or PowerPoint file."); continue; }
      if (!image && file.size > FILE_LIMIT) { setError("Choose a file smaller than 20MB."); continue; }
      next.push({ file, image, type });
    }
    const room = MAX_COMMENT_MEDIA - now.length;
    if (next.length > room) setError(FULL);
    for (const { file, image, type } of next.slice(0, Math.max(0, room))) {
      const key = `f${++keys}`;
      setStaged((all) => [...all, image
        ? { key, kind: "image", preview: URL.createObjectURL(file), name: file.name, state: "uploading" }
        : { key, kind: "file", name: file.name, size: file.size, state: "uploading" }]);
      void file.arrayBuffer().then((buffer) => ch.files.upload({
        route: image ? "/api/upload" : "/api/upload/feed-attachments",
        name: `${image ? "feed-images" : "feed-files"}/${stamp(file.name)}`,
        type,
        bytes: buffer,
      })).then((result) => {
        if (result.ok) update(key, (s) => ({ ...s, state: "done", url: result.url } as Staged));
        else update(key, (s) => ({ ...s, state: "failed", failedReason: (result.error === "rate_limited" && result.message) || "Couldn't upload" }));
      });
    }
  }

  function addGif(gif: Gif) {
    setOpen(null);
    setError(null);
    const now = current.current;
    if (now.some((s) => s.kind === "video")) return setError(VIDEO_ALONE);
    if (now.length >= MAX_COMMENT_MEDIA) return setError(FULL);
    setStaged([...now, { key: `g${++keys}`, kind: "gif", preview: gif.preview, url: gif.url, state: "done" }]);
    box.current?.focus();
  }

  function remove(key: string) {
    setError(null);
    setStaged((all) => all.filter((s) => {
      if (s.key === key && s.kind === "image") URL.revokeObjectURL(s.preview);
      return s.key !== key;
    }));
  }

  // The emoji goes where the caret was when the picker took the click.
  function insertEmoji(emoji: string) {
    const el = box.current;
    const at = caret.current ?? { start: value.length, end: value.length };
    const next = value.slice(0, at.start) + emoji + value.slice(at.end);
    setValue(next);
    const position = at.start + emoji.length;
    caret.current = { start: position, end: position };
    requestAnimationFrame(() => { el?.focus(); el?.setSelectionRange(position, position); });
  }

  function toggle(which: "emoji" | "gif") {
    const el = box.current;
    if (el) caret.current = { start: el.selectionStart, end: el.selectionEnd };
    setOpen((now) => (now === which ? null : which));
  }

  // Closing on a click elsewhere or Escape (the emoji popover closes itself).
  useEffect(() => {
    if (open !== "gif") return;
    const down = (event: globalThis.MouseEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(null); };
    const key = (event: KeyboardEvent) => { if (event.key === "Escape") { event.stopPropagation(); setOpen(null); box.current?.focus(); } };
    window.addEventListener("mousedown", down);
    window.addEventListener("keydown", key, true);
    return () => { window.removeEventListener("mousedown", down); window.removeEventListener("keydown", key, true); };
  }, [open, box]);

  const uploading = staged.some((s) => s.state === "uploading" && s.kind !== "video");
  const failed = staged.some((s) => s.state === "failed");
  const canSend = !sending && !uploading && !failed && (value.trim().length > 0 || staged.length > 0);

  async function send() {
    if (!canSend) return;
    setSending(true);
    setError(null);
    try {
      const video = staged.find((s) => s.kind === "video");
      // A video still on its way to Mux: the comment waits for it.
      const uploaded = video?.kind === "video" ? await video.done : null;
      const sentence = await onSend({
        body: value.trim(),
        mediaUrls: staged.flatMap((s) => (s.kind !== "video" && s.url ? [s.url] : [])),
        videoUploadToken: uploaded?.uploadToken,
        videoUid: uploaded?.uid,
        videoPreview: video?.kind === "video" ? video.preview : null,
      });
      if (sentence) { setError(sentence); return; }
      staged.forEach((s) => s.kind === "image" && URL.revokeObjectURL(s.preview));
      setStaged([]);
    } catch {
      setError("The video didn't upload. Remove it and try again.");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="cc" ref={root}>
      <div className={`composer compact cc-box ${staged.length ? "has-staged" : ""}`}
        onDragOver={(e) => e.dataTransfer.types.includes("Files") && e.preventDefault()}
        onDrop={(e) => { e.preventDefault(); void addFiles([...e.dataTransfer.files]); }}>
        {staged.length ? (
          <div className="cc-staged">
            {staged.map((s) => <StagedItem key={s.key} item={s} onRemove={() => remove(s.key)} />)}
          </div>
        ) : null}
        <div className="cc-row">
          <textarea ref={box} rows={1} value={value} maxLength={2000} placeholder={placeholder}
            onChange={(e) => { setValue(e.target.value); onChange(e.target.value, e.target.selectionStart); }}
            onPaste={(e) => {
              const files = [...e.clipboardData.files];
              if (files.length) { e.preventDefault(); void addFiles(files); }
            }}
            onKeyDown={(e) => {
              if (onKeyDown(e)) return;
              if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void send(); }
            }} />
          <div className="cc-icons">
            <button className={open === "emoji" ? "on" : ""} title="Emoji" aria-label="Emoji" onMouseDown={(e) => e.preventDefault()} onClick={() => toggle("emoji")}><Smile /></button>
            <button title="Photos, video or files" aria-label="Attach photos, a video or files" onClick={() => { setOpen(null); picker.current?.click(); }}><Paperclip /></button>
            <button className={`gif ${open === "gif" ? "on" : ""}`} title="GIF" aria-label="GIF" onMouseDown={(e) => e.preventDefault()} onClick={() => toggle("gif")}><span>GIF</span></button>
          </div>
        </div>
        {extra}
        {open === "emoji" ? <EmojiPicker placement="above" onPick={(emoji) => { insertEmoji(emoji); setOpen(null); }} onClose={() => setOpen(null)} /> : null}
        {open === "gif" ? <GifPicker onPick={addGif} /> : null}
        <input ref={picker} type="file" accept={ACCEPT} multiple hidden onChange={(e) => { void addFiles([...(e.target.files ?? [])]); e.target.value = ""; }} />
      </div>
      {canSend || sending ? (
        <button className="cc-send" disabled={!canSend} onClick={() => void send()} aria-label="Send">{sending ? <Loader2 className="spin" /> : <SendHorizontal />}</button>
      ) : null}
      {error ? <div className="cc-error" role="alert">{error}</div> : null}
    </div>
  );
}

function StagedItem({ item, onRemove }: { item: Staged; onRemove: () => void }) {
  const close = <button className="cc-x" onClick={onRemove} aria-label="Remove"><X /></button>;
  if (item.kind === "image" || item.kind === "gif") {
    return (
      <span className={`cc-thumb ${item.state}`} title={item.failedReason}>
        <img src={item.preview} alt="" />
        {item.kind === "gif" ? <i className="gif-tag">GIF</i> : null}
        {item.state === "uploading" ? <span className="cc-busy"><Loader2 className="spin" /></span> : null}
        {close}
      </span>
    );
  }
  if (item.kind === "file") {
    const ext = extension(item.name).toUpperCase();
    return (
      <span className={`cc-file ${item.state}`}>
        <span className="ficon"><FileText /></span>
        <span className="fmeta"><b>{item.name}</b><span>{item.state === "failed" ? item.failedReason : item.state === "uploading" ? "Uploading…" : `${ext} · ${bytes(item.size)}`}</span></span>
        {close}
      </span>
    );
  }
  return (
    <span className={`cc-file video ${item.state}`}>
      <span className="ficon vthumb">{item.preview ? <img src={item.preview} alt="" /> : null}<Play /></span>
      <span className="fmeta"><b>{item.name}</b><span>{item.state === "failed" ? item.failedReason : item.state === "done" ? "Ready to send" : `Uploading ${item.progress}%`}</span>
        {item.state === "uploading" ? <i className="vprog"><i style={{ width: `${item.progress}%` }} /></i> : null}
      </span>
      {close}
    </span>
  );
}

/** GIPHY search (trending until something is typed), as the website's picker. */
function GifPicker({ onPick }: { onPick: (gif: Gif) => void }) {
  const [query, setQuery] = useState("");
  const [state, setState] = useState<{ gifs: Gif[]; loading: boolean; error: string | null }>({ gifs: [], loading: true, error: null });
  useEffect(() => {
    let stale = false;
    setState((s) => ({ ...s, loading: true }));
    const timer = setTimeout(() => {
      searchGifs(query)
        .then((gifs) => !stale && setState({ gifs, loading: false, error: null }))
        .catch((error) => !stale && setState({ gifs: [], loading: false, error: serverSentence(error) ?? "GIPHY could not load results." }));
    }, query ? 300 : 0);
    return () => { stale = true; clearTimeout(timer); };
  }, [query]);
  return (
    <div className="gif-pop" role="dialog" aria-label="GIFs">
      <label className="gif-search"><Search /><input autoFocus placeholder="Search GIPHY" value={query} onChange={(e) => setQuery(e.target.value)} /></label>
      <div className="gif-grid scroll">
        {state.gifs.map((gif) => (
          <button key={gif.id} onClick={() => onPick(gif)} title={gif.title} aria-label={`Select ${gif.title}`}><img src={gif.preview} alt="" loading="lazy" /></button>
        ))}
        {state.loading && !state.gifs.length ? <div className="gif-note"><Loader2 className="spin" /></div> : null}
        {state.error ? <div className="gif-note">{state.error}</div> : null}
        {!state.loading && !state.error && !state.gifs.length ? <div className="gif-note">No GIFs found.</div> : null}
      </div>
      <div className="gif-by">Powered by GIPHY</div>
    </div>
  );
}

/* ---------- In the bubble ---------- */

/** A comment's photos, GIFs, files and video, under its words. */
export function CommentMedia({ comment }: { comment: Comment }) {
  const urls = comment.mediaUrls ?? [];
  const videos = comment.videoAttachments ?? [];
  if (comment.deleted || (!urls.length && !videos.length)) return null;
  const menu = async (event: MouseEvent, url: string, name: string, image: boolean) => {
    event.preventDefault();
    event.stopPropagation();
    const choice = await ch.menu.popup([
      { id: "look", label: "Quick Look" },
      { id: "save", label: "Save to Downloads…" },
      ...(image ? [{ id: "copy", label: "Copy image address" }] : []),
    ]);
    if (choice === "look") void ch.files.quickLook(url, name);
    if (choice === "save") void ch.files.save(url, name);
    if (choice === "copy") void navigator.clipboard.writeText(url);
  };
  return (
    <div className="c-media">
      {urls.map((url) => {
        const name = attachmentName(url);
        if (isImageUrl(url)) {
          const gif = isGiphyUrl(url);
          return (
            <button key={url} className="c-img" title="Click to preview (Quick Look)" onClick={() => void ch.files.quickLook(url, gif ? "GIF.gif" : name)} onContextMenu={(e) => void menu(e, url, gif ? "GIF.gif" : name, true)}>
              <img src={url} alt={gif ? "GIF" : "Comment photo"} loading="lazy" decoding="async" draggable={false} />
              {gif ? <i className="gif-tag">GIF</i> : null}
            </button>
          );
        }
        return (
          <div key={url} className="post-file c-file" role="button" tabIndex={0} title="Click to preview (Quick Look)"
            onClick={() => void ch.files.quickLook(url, name)} onContextMenu={(e) => void menu(e, url, name, false)}>
            <span><FileText /></span><b>{name}</b>
            <button className="c-dl" title="Save to Downloads…" aria-label="Download" onClick={(e) => { e.stopPropagation(); void ch.files.save(url, name); }}><Download /></button>
          </div>
        );
      })}
      {videos.map((video) => <div key={video.uid} className="c-video"><VideoPlayer video={video} /></div>)}
    </div>
  );
}

/** A frame taken on this Mac stands in for Mux's poster while it processes. */
export const rememberPoster = (uid: string | undefined, preview: string | null | undefined) => { if (uid && preview) localPosters.set(uid, preview); };
