import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Attachment, UploadedVideo, VideoAttachment } from "./community";
import { localPosters } from "./community";
import { editAttachmentProblem, type EditSurface } from "./editAttachmentRules";
import { videoThumbnail } from "../views/messages/Composer";

/*
  What an edit box holds besides the words: the attachments already on the
  message (each can be removed) and new ones (uploading as soon as they're
  picked, as the composer does). Nothing is sent until Save; Cancel aborts
  the uploads still running and drops the lot (Tara, Nov 1 2026).
*/

export type EditItem = { key: string } & (
  /** A photo or file already on it. */
  | { kind: "kept"; attachment: Attachment }
  | { kind: "kept-video"; video: VideoAttachment }
  /** A new photo or file. */
  | { kind: "new"; file: File; image: boolean; preview: string | null; state: "uploading" | "done" | "failed"; sent?: Attachment; failedReason?: string }
  | { kind: "new-video"; file: File; preview: string | null; duration: number; progress: number; state: "uploading" | "done" | "failed"; uploaded?: UploadedVideo; failedReason?: string }
);

export type FileUploader = (file: File) => Promise<Attachment | { failedReason?: string }>;
export type VideoUploader = (file: File, onProgress: (pct: number) => void, signal: AbortSignal) => Promise<UploadedVideo>;

export interface EditAttachmentsResult {
  /** Every photo and file, kept and new, in order. */
  mediaUrls: string[];
  /** Metadata for the new ones. */
  attachments: Attachment[];
  /** The videos kept. */
  videoUids: string[];
  /** Finished new video uploads (bytes at Mux; the edit attaches them). */
  videoUploadTokens: string[];
}

let keys = 0;
const key = () => `e${++keys}`;

/** A file's url, name and kind, from a message's attachments or (older messages) its bare url. */
export function keptAttachment(url: string, known: Attachment[] | undefined): Attachment {
  const found = known?.find((a) => a.url === url);
  if (found) return found;
  let name = "file";
  try { name = decodeURIComponent(new URL(url).pathname.split("/").pop() ?? "file").replace(/-[A-Za-z0-9]{20,}(?=\.)/, ""); } catch { /* keep "file" */ }
  const image = /\.(png|jpe?g|gif|webp|heic)(\?|$)/i.test(url) || /(^|\.)giphy\.com\//i.test(url);
  return { url, name, size: 0, mimeType: "", kind: image ? "image" : "file" };
}

export function useEditAttachments({ surface, files, videos, uploadFile, uploadVideo, check }: {
  surface: EditSurface;
  /** What's on it now. */
  files: Attachment[];
  videos: VideoAttachment[];
  uploadFile: FileUploader;
  /** Where videos go to Mux; without it a video is a file (Hey Social Inc.). */
  uploadVideo?: VideoUploader;
  /** A composer's own check of one file (type, size, length): the sentence to show, or null. */
  check?: (file: File, video: boolean) => Promise<string | null> | string | null;
}) {
  const [items, setItems] = useState<EditItem[]>(() => [
    ...files.map((attachment) => ({ key: key(), kind: "kept" as const, attachment })),
    ...videos.map((video) => ({ key: key(), kind: "kept-video" as const, video })),
  ]);
  const [error, setError] = useState<string | null>(null);
  /** Files still being looked at (a video's length) before they're staged: Save waits for them too. */
  const [checking, setChecking] = useState(0);
  const current = useRef(items);
  current.current = items;
  /** Running video uploads, by item: aborted on remove, cancel or close. */
  const aborts = useRef(new Map<string, AbortController>());
  const closed = useRef(false);

  const update = useCallback((k: string, change: (item: EditItem) => EditItem) => {
    if (closed.current) return;
    setItems((all) => all.map((item) => (item.key === k ? change(item) : item)));
  }, []);

  /** Cancel (or the box closing): stop every upload and forget what was staged. */
  const discard = useCallback(() => {
    closed.current = true;
    for (const controller of aborts.current.values()) controller.abort();
    aborts.current.clear();
    for (const item of current.current) if ((item.kind === "new" || item.kind === "new-video") && item.preview?.startsWith("blob:")) URL.revokeObjectURL(item.preview);
  }, []);
  useEffect(() => { closed.current = false; return () => discard(); }, [discard]);

  const counts = (list: EditItem[]) => {
    const live = list.filter((item) => !("state" in item) || item.state !== "failed");
    return {
      files: live.filter((item) => item.kind === "kept" || item.kind === "new").length,
      videos: live.filter((item) => item.kind === "kept-video" || item.kind === "new-video").length,
    };
  };

  const add = useCallback(async (picked: File[]) => {
    setError(null);
    if (!picked.length || closed.current) return;
    const isVideo = (file: File) => Boolean(uploadVideo) && file.type.startsWith("video/");
    const now = counts(current.current);
    const incomingVideos = picked.filter(isVideo).length;
    const problem = editAttachmentProblem(surface, { files: now.files + picked.length - incomingVideos, videos: now.videos + incomingVideos });
    if (problem) { setError(problem); return; }
    for (const file of picked) {
      const video = isVideo(file);
      let refused: string | null = null;
      if (check) {
        setChecking((n) => n + 1);
        try { refused = await check(file, video); } finally { setChecking((n) => n - 1); }
      }
      if (refused) { setError(refused); continue; }
      if (closed.current) return;
      const k = key();
      if (video) {
        const controller = new AbortController();
        aborts.current.set(k, controller);
        setItems((all) => [...all, { key: k, kind: "new-video", file, preview: null, duration: 0, progress: 0, state: "uploading" }]);
        void videoThumbnail(file).then(({ url, duration }) => update(k, (item) => (item.kind === "new-video" ? { ...item, preview: url, duration } : item)));
        uploadVideo!(file, (progress) => update(k, (item) => (item.kind === "new-video" ? { ...item, progress } : item)), controller.signal).then(
          (uploaded) => { aborts.current.delete(k); update(k, (item) => (item.kind === "new-video" ? { ...item, state: "done", progress: 100, uploaded } : item)); },
          (failure: unknown) => {
            aborts.current.delete(k);
            if (controller.signal.aborted) return;
            const data = (failure as { data?: { error?: unknown; code?: unknown }; status?: number })?.data;
            const sentence = typeof data?.error === "string" && /\s/.test(data.error) ? data.error : null;
            update(k, (item) => ({ ...item, state: "failed", failedReason: sentence ?? "The video didn't upload. Remove it and try again." } as EditItem));
          },
        );
      } else {
        const image = file.type.startsWith("image/") && file.type !== "image/svg+xml";
        setItems((all) => [...all, { key: k, kind: "new", file, image, preview: image ? URL.createObjectURL(file) : null, state: "uploading" }]);
        void uploadFile(file).then((outcome) => {
          const sent = "url" in outcome ? (outcome as Attachment) : undefined;
          update(k, (item) => (item.kind === "new" ? { ...item, state: sent ? "done" : "failed", sent, failedReason: sent ? undefined : (outcome as { failedReason?: string }).failedReason ?? "Couldn't upload" } : item));
        }, () => update(k, (item) => (item.kind === "new" ? { ...item, state: "failed", failedReason: "Couldn't upload" } : item)));
      }
    }
  }, [surface, uploadFile, uploadVideo, check, update]);

  const remove = useCallback((k: string) => {
    setError(null);
    aborts.current.get(k)?.abort();
    aborts.current.delete(k);
    setItems((all) => all.filter((item) => {
      if (item.key === k && (item.kind === "new" || item.kind === "new-video") && item.preview?.startsWith("blob:")) URL.revokeObjectURL(item.preview);
      return item.key !== k;
    }));
  }, []);

  const uploading = checking > 0 || items.some((item) => "state" in item && item.state === "uploading");
  const failed = items.some((item) => "state" in item && item.state === "failed");
  const changed = useMemo(() => {
    const before = [...files.map((f) => f.url), ...videos.map((v) => v.uid)];
    const after = items.flatMap((item) => (item.kind === "kept" ? [item.attachment.url] : item.kind === "kept-video" ? [item.video.uid] : [`new:${item.key}`]));
    return before.length !== after.length || before.some((id, i) => id !== after[i]);
  }, [items, files, videos]);
  const empty = items.length === 0;

  /** What Save sends; also hands this Mac's video frames to the player while Mux makes its own. */
  const result = useCallback((): EditAttachmentsResult => {
    const list = current.current;
    for (const item of list) if (item.kind === "new-video" && item.uploaded && item.preview) localPosters.set(item.uploaded.uid, item.preview);
    return {
      mediaUrls: list.flatMap((item) => (item.kind === "kept" ? [item.attachment.url] : item.kind === "new" && item.sent ? [item.sent.url] : [])),
      attachments: list.flatMap((item) => (item.kind === "new" && item.sent ? [item.sent] : [])),
      videoUids: list.flatMap((item) => (item.kind === "kept-video" ? [item.video.uid] : [])),
      videoUploadTokens: list.flatMap((item) => (item.kind === "new-video" && item.uploaded ? [item.uploaded.uploadToken] : [])),
    };
  }, []);

  return { items, add, remove, error, setError, uploading, failed, changed, empty, result, discard };
}

/** What Save says when a new file failed to upload (the Mac has no retry: remove it). */
export const UPLOAD_FAILED = "A file didn't upload — remove it to save.";

/**
 * Save pressed while uploads are still running: the box saves by itself once
 * they finish (Save shows a spinner meanwhile), as the website's edit box does.
 * `run` should call the latest save (through a ref), which checks again.
 */
export function useSaveWhenUploaded(uploading: boolean) {
  const [waiting, setWaiting] = useState(false);
  const pending = useRef<(() => void) | null>(null);
  useEffect(() => {
    if (!waiting || uploading) return;
    setWaiting(false);
    const run = pending.current;
    pending.current = null;
    run?.();
  }, [waiting, uploading]);
  return {
    waiting,
    later: (run: () => void) => { pending.current = run; setWaiting(true); },
    cancel: () => { pending.current = null; setWaiting(false); },
  };
}
