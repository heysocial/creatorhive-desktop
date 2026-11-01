import { useCallback, useEffect, useRef, useState } from "react";
import { File as FileIcon, Loader2, Play, Plus, X } from "lucide-react";
import type { Attachment, Message, VideoAttachment } from "../../lib/community";
import { UPLOAD_FAILED, keptAttachment, useEditAttachments, useSaveWhenUploaded, type EditAttachmentsResult, type EditItem, type VideoUploader } from "../../lib/editAttachments";
import type { EditSurface } from "../../lib/editAttachmentRules";
import { bytes } from "../../lib/format";
import { pastedFiles } from "../../lib/paste";
import { uploadFile } from "./Composer";

/** Where an edit box's new files go: the composer's routes for this conversation. */
export interface EditUploads {
  surface: EditSurface;
  /** Hey Social Inc.: its own Blob folder (a channel id, or dm-<conversation id>). */
  uploadFolder?: string;
  /** CreatorHive channels and DMs: videos to Mux, as the composer sends them. */
  uploadVideo?: VideoUploader;
}

export const EMPTY_EDIT = "A message can't be empty. Delete it instead?";

const clock = (seconds: number) => `${Math.floor(seconds / 60)}:${String(Math.round(seconds % 60)).padStart(2, "0")}`;

/*
  The edit box for a channel message, thread reply or DM: the words, the
  attachments already on it (each with an ×) and the composer's + to add more,
  with the composer's tiles, progress and limits. Saving replaces the
  attachments for everyone; Cancel drops anything staged and stops its upload.
*/
export function MessageEditor({ message, uploads, onSave, onClose }: {
  message: Message;
  uploads: EditUploads;
  /** Resolves with the sentence to show when it didn't save, else null. */
  onSave: (body: string, attachments?: EditAttachmentsResult) => Promise<string | null>;
  onClose: () => void;
}) {
  const [text, setText] = useState(message.body);
  const [saving, setSaving] = useState(false);
  const picker = useRef<HTMLInputElement>(null);
  const box = useRef<HTMLTextAreaElement>(null);
  const [files] = useState<Attachment[]>(() => message.mediaUrls.map((url) => keptAttachment(url, message.attachments)));
  const [videos] = useState<VideoAttachment[]>(() => (message.videoAttachments?.length ? message.videoAttachments : message.videoAttachment ? [message.videoAttachment] : []));
  const upload = useCallback((file: File) => uploadFile(file, uploads.uploadFolder), [uploads.uploadFolder]);
  const staged = useEditAttachments({ surface: uploads.surface, files, videos, uploadFile: upload, uploadVideo: uploads.uploadVideo });
  const after = useSaveWhenUploaded(staged.uploading);
  // A voice clip takes nothing else; its recording stays as it is.
  const canAttach = !message.voiceMemo;

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }, []);

  function cancel() {
    after.cancel();
    staged.discard();
    onClose();
  }

  async function save() {
    if (saving) return;
    const words = text.trim();
    if (!words && staged.empty && !message.voiceMemo) { staged.setError(EMPTY_EDIT); return; }
    // Still uploading: saved by itself as soon as they finish.
    if (staged.uploading) { after.later(() => void latest.current()); return; }
    if (staged.failed) { staged.setError(UPLOAD_FAILED); return; }
    // Nothing changed: close without stamping "(edited)" on it.
    if (words === message.body.trim() && !staged.changed) { onClose(); return; }
    setSaving(true);
    staged.setError(null);
    try {
      const sentence = await onSave(text, staged.changed ? staged.result() : undefined);
      if (sentence) { staged.setError(sentence); return; }
      onClose();
    } finally {
      setSaving(false);
    }
  }

  const latest = useRef(save);
  latest.current = save;
  const busy = saving || after.waiting;
  return (
    <div className="inline-edit">
      {staged.items.length ? (
        <div className="staged">
          {staged.items.map((item) => <EditTile key={item.key} item={item} onRemove={() => staged.remove(item.key)} disabled={saving} />)}
        </div>
      ) : null}
      <textarea ref={box} value={text} disabled={busy} onChange={(e) => setText(e.target.value)}
        onPaste={(event) => { if (canAttach) void pastedFiles(event).then((list) => list && void staged.add(list)); }}
        onKeyDown={(e) => {
          if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); cancel(); }
          if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void save(); }
        }} />
      {staged.error ? <div className="edit-error" role="alert">{staged.error}</div> : null}
      <div className="hint">
        {canAttach ? <button className="edit-attach" title="Attach files" aria-label="Attach files" disabled={saving} onClick={() => picker.current?.click()}><Plus /></button> : null}
        Escape to cancel · Return to save
        <button className="btn" onClick={cancel}>Cancel</button>
        <button className="btn honey" disabled={busy} onClick={() => void save()}>{busy ? <Loader2 className="spin" /> : null}Save</button>
      </div>
      <input ref={picker} type="file" multiple hidden onChange={(event) => {
        void staged.add([...(event.target.files ?? [])]);
        event.target.value = "";
      }} />
    </div>
  );
}

/** One attachment in the edit box, as the composer's chip. */
function EditTile({ item, onRemove, disabled }: { item: EditItem; onRemove: () => void; disabled: boolean }) {
  const remove = <button aria-label="Remove" title="Remove" disabled={disabled} onClick={onRemove}><X /></button>;
  if (item.kind === "kept-video" || item.kind === "new-video") {
    const name = item.kind === "kept-video" ? item.video.fileName : item.file.name;
    const poster = item.kind === "kept-video" ? item.video.thumbnailUrl : item.preview;
    const duration = item.kind === "kept-video" ? item.video.durationSeconds ?? 0 : item.duration;
    const line = item.kind === "kept-video" ? (duration ? clock(duration) : "Video")
      : item.state === "failed" ? item.failedReason ?? "Couldn't upload"
      : item.state === "done" ? `Ready to save${duration ? ` · ${clock(duration)}` : ""}`
      : `Uploading ${item.progress}%`;
    const state = item.kind === "kept-video" ? "kept" : item.state;
    return (
      <div className={`chip-file is-video ${state}`}>
        <span className="vthumb">{poster ? <img src={poster} alt="" /> : null}<Play /></span>
        <span className="fmeta"><b>{name}</b><span>{line}</span>
          {item.kind === "new-video" && item.state === "uploading" ? <i className="vprog"><i style={{ width: `${item.progress}%` }} /></i> : null}
        </span>
        {remove}
      </div>
    );
  }
  const name = item.kind === "kept" ? item.attachment.name : item.file.name;
  const image = item.kind === "kept" ? item.attachment.kind === "image" : item.image;
  const preview = item.kind === "kept" ? (image ? item.attachment.url : null) : item.preview;
  const type = item.kind === "kept" ? item.attachment.mimeType || item.attachment.name : item.file.type;
  const size = item.kind === "kept" ? item.attachment.size : item.file.size;
  const state = item.kind === "kept" ? "kept" : item.state;
  const line = item.kind === "new" && item.state === "failed" ? item.failedReason ?? "Couldn't upload"
    : item.kind === "new" && item.state === "uploading" ? "Uploading…"
    : size ? bytes(size) : image ? "Photo" : "File";
  return (
    <div className={`chip-file ${state}`}>
      {preview ? <img src={preview} alt="" /> : <span className={`ficon ${/pdf/i.test(type) ? "" : "generic"}`}><FileIcon /></span>}
      <span className="fmeta"><b>{name}</b><span>{line}</span></span>
      {item.kind === "new" && item.state === "uploading" ? <Loader2 className="spin" /> : null}
      {remove}
    </div>
  );
}
