import { useSyncExternalStore } from "react";
import { api, ApiError, rateLimitMessage } from "./api";
import { ch, type LocalVideoFile } from "./bridge";

/*
  A new post's video (docs/post-videos.md on the website, "Upload v2"). One
  stream to Mux crawled (3–30 Mbit/s on a 38 Mbit/s line), so the video goes to
  R2 in 16 MB parts, 4 at a time, and Mux copies it from there once complete.

  The parts go out from the main process (ch.files.putPart: streamed from disk,
  never read into memory, a silent connection dropped after 30 s), as Improve
  clips do; the window's CSP doesn't reach R2. The parts R2 holds are the
  resume state: after a reload or a restart the draft (lib/postVideo's
  savePostDraft) brings back the upload id and the file's path, the server says
  which parts it has, and only the missing ones are sent.

  There's one composer, so one upload at a time. It lives here, not in the
  composer, so leaving Home doesn't stop it.
*/

export type PostVideoPhase = "starting" | "uploading" | "finishing" | "offline" | "done" | "failed" | "missing";

export interface PostVideo {
  uploadId: string | null;
  name: string;
  size: number;
  mimeType: string;
  path: string;
  /** A frame read on this Mac (data: URL), kept with the draft. */
  preview: string | null;
  /** Bytes R2 has, plus the parts on their way. */
  sent: number;
  phase: PostVideoPhase;
  error: string | null;
}

/** What a draft keeps of its video. */
export interface SavedPostVideo { uploadId: string; path: string; name: string; size: number; mimeType: string; preview: string | null }

interface Upload { uploadId: string; partSize: number; partCount: number; status: "uploading" | "complete" | "posted"; partsDone: number[] }

const PARTS_AT_ONCE = 4;
// The contract's waits between tries of a part: 1, 2, 4, 8, 15, 30 s.
const RETRY_DELAYS = [1_000, 2_000, 4_000, 8_000, 15_000, 30_000];
const STOPPED = "The upload stopped. Check your connection, then try again.";

const MIME_BY_EXT: Record<string, string> = { mp4: "video/mp4", mov: "video/quicktime", m4v: "video/x-m4v", webm: "video/webm" };
export const postVideoMime = (name: string, type: string) => (/^video\/(mp4|quicktime|webm|x-m4v)$/.test(type) ? type : MIME_BY_EXT[name.split(".").pop()?.toLowerCase() ?? ""] ?? null);

class Stop extends Error {}

interface Job {
  state: PostVideo;
  partSize: number;
  partCount: number;
  done: Set<number>;
  inFlight: Map<string, number>;
  urls: Map<number, string>;
  urlFetch: Promise<void> | null;
  running: boolean;
  cancelled: boolean;
  startedAt: number;
  bytesAtStart: number;
}

let job: Job | null = null;
let snapshot: PostVideo | null = null;
const listeners = new Set<() => void>();
const emit = () => {
  snapshot = job ? { ...job.state } : null;
  listeners.forEach((l) => l());
};
const set = (j: Job, change: Partial<PostVideo>) => {
  if (j !== job) return;
  Object.assign(j.state, change);
  emit();
};

/** The post video in the composer (null when there's none). */
export function usePostVideo(): PostVideo | null {
  return useSyncExternalStore((l) => { listeners.add(l); return () => listeners.delete(l); }, () => snapshot);
}

/* ---------- Progress, offline ---------- */

let hooked = false;
function hook() {
  if (hooked) return;
  hooked = true;
  ch.files.onPutProgress(({ id, sent }) => {
    if (!job || !job.inFlight.has(id)) return;
    job.inFlight.set(id, sent);
    showProgress(job);
  });
  // A request on a dead connection doesn't fail by itself for a while: stop the parts in flight, wait, send them again.
  window.addEventListener("offline", () => { if (job) for (const id of job.inFlight.keys()) ch.files.cancelPut(id); });
}

function showProgress(j: Job) {
  let sent = 0;
  for (const n of j.done) sent += partBytes(j, n);
  for (const bytes of j.inFlight.values()) sent += bytes;
  set(j, { sent: Math.min(j.state.size, sent) });
}

const partBytes = (j: Job, n: number) => Math.min(n * j.partSize, j.state.size) - (n - 1) * j.partSize;
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

async function online(j: Job) {
  if (navigator.onLine) return;
  const before = j.state.phase;
  set(j, { phase: "offline" });
  await new Promise<void>((resolve) => window.addEventListener("online", () => resolve(), { once: true }));
  if (j.state.phase === "offline") set(j, { phase: before === "finishing" ? "finishing" : "uploading" });
}

/** No answer, or the server or storage had a moment: worth sending again. */
const passing = (status: number | undefined) => !status || status >= 500 || status === 408 || status === 429;
const codeOf = (error: unknown) => (error instanceof ApiError && typeof error.data?.code === "string" ? error.data.code : null);
const sentenceOf = (error: unknown, fallback: string) => {
  const limited = rateLimitMessage(error);
  if (limited) return limited;
  return error instanceof ApiError && typeof error.data?.error === "string" && /\s/.test(error.data.error) ? error.data.error : fallback;
};

/* ---------- Sending ---------- */

async function partUrl(j: Job, n: number): Promise<string> {
  while (!j.urls.has(n)) {
    if (!j.urlFetch) {
      const parts: number[] = [];
      for (let p = n; p <= j.partCount && parts.length < 100; p += 1) if (!j.done.has(p) && !j.urls.has(p)) parts.push(p);
      j.urlFetch = api<{ urls: { partNumber: number; url: string }[] }>(`/api/posts/videos/uploads/${j.state.uploadId}/parts`, { method: "POST", body: { parts } })
        .then(({ urls }) => { for (const u of urls) j.urls.set(u.partNumber, u.url); })
        .finally(() => { j.urlFetch = null; });
    }
    await j.urlFetch;
  }
  return j.urls.get(n)!;
}

async function sendPart(j: Job, n: number) {
  const start = (n - 1) * j.partSize;
  const end = Math.min(n * j.partSize, j.state.size);
  const id = `post-video:${j.state.uploadId}:${n}`;
  let refreshed = 0;
  for (let attempt = 0; ; ) {
    await online(j);
    if (j.cancelled) return;
    let url: string;
    try {
      url = await partUrl(j, n);
    } catch (error) {
      if (j.cancelled) return;
      if (!(error instanceof ApiError && passing(error.status)) || attempt >= RETRY_DELAYS.length) throw new Stop(sentenceOf(error, STOPPED));
      await sleep(RETRY_DELAYS[attempt++]);
      continue;
    }
    j.inFlight.set(id, 0);
    const result = await ch.files.putPart({ id, url, filePath: j.state.path, start, end });
    j.inFlight.delete(id);
    if (j.cancelled) return;
    if (!result.ok && result.error === "cancelled" && !navigator.onLine) { showProgress(j); continue; } // offline: wait, send again
    if (result.ok) {
      j.done.add(n);
      showProgress(j);
      return;
    }
    showProgress(j);
    if (result.error === "no_file") throw new Stop("missing");
    // The part's link expired (6 h): ask for a new one.
    if (result.status === 403 && refreshed < 3) { refreshed += 1; j.urls.delete(n); continue; }
    if (!passing(result.status) || attempt >= RETRY_DELAYS.length) throw new Stop(STOPPED);
    await sleep(RETRY_DELAYS[attempt++]);
  }
}

async function sendParts(j: Job, only?: number[]) {
  const todo = (only ?? Array.from({ length: j.partCount }, (_, i) => i + 1)).filter((n) => !j.done.has(n));
  let failure: unknown = null;
  const worker = async () => {
    while (!failure && !j.cancelled) {
      const n = todo.shift();
      if (n === undefined) return;
      try { await sendPart(j, n); } catch (error) { failure = error; }
    }
  };
  await Promise.all(Array.from({ length: PARTS_AT_ONCE }, worker));
  if (failure && !j.cancelled) throw failure;
}

async function complete(j: Job) {
  set(j, { phase: "finishing", sent: j.state.size });
  for (let attempt = 0, resent = 0; ; ) {
    await online(j);
    if (j.cancelled) return;
    try {
      await api(`/api/posts/videos/uploads/${j.state.uploadId}/complete`, { method: "POST" });
      return;
    } catch (error) {
      if (j.cancelled) return;
      if (codeOf(error) === "INCOMPLETE" && resent < 2) {
        // Parts R2 doesn't have after all: send those, then ask again.
        resent += 1;
        const missing = ((error as ApiError).data?.missing as number[] | undefined) ?? [];
        for (const n of missing) j.done.delete(n);
        set(j, { phase: "uploading" });
        showProgress(j);
        await sendParts(j, missing.length ? missing : undefined);
        if (j.cancelled) return;
        set(j, { phase: "finishing", sent: j.state.size });
        continue;
      }
      if (!(error instanceof ApiError && passing(error.status)) || attempt >= RETRY_DELAYS.length) throw new Stop(sentenceOf(error, STOPPED));
      await sleep(RETRY_DELAYS[attempt++]);
    }
  }
}

async function run(j: Job) {
  if (j.running || j.cancelled) return;
  j.running = true;
  j.startedAt = performance.now();
  j.bytesAtStart = [...j.done].reduce((sum, n) => sum + partBytes(j, n), 0);
  set(j, { phase: "uploading", error: null });
  showProgress(j);
  try {
    await sendParts(j);
    if (j.cancelled) return;
    await complete(j);
    if (j.cancelled) return;
    const seconds = (performance.now() - j.startedAt) / 1000;
    const mb = (j.state.size - j.bytesAtStart) / 1e6;
    console.info(`[post video] ${mb.toFixed(1)} MB in ${seconds.toFixed(1)} s = ${(mb / seconds).toFixed(2)} MB/s (${(mb * 8 / seconds).toFixed(1)} Mbit/s)`);
    set(j, { phase: "done", sent: j.state.size });
  } catch (error) {
    if (j.cancelled) return;
    if (error instanceof Stop && error.message === "missing") set(j, { phase: "missing", error: null });
    else set(j, { phase: "failed", error: error instanceof Error && error.message ? error.message : STOPPED });
  } finally {
    j.running = false;
  }
}

function newJob(state: PostVideo): Job {
  hook();
  return { state, partSize: 0, partCount: 0, done: new Set(), inFlight: new Map(), urls: new Map(), urlFetch: null, running: false, cancelled: false, startedAt: 0, bytesAtStart: 0 };
}

const fromUpload = (j: Job, upload: Upload) => {
  j.partSize = upload.partSize;
  j.partCount = upload.partCount;
  j.done = new Set(upload.partsDone ?? []);
};

/* ---------- The composer's calls ---------- */

/** A picked video: the upload is opened on the server and its parts start at once. */
export async function startPostVideo(file: LocalVideoFile, mimeType: string, preview: string | null) {
  if (job) cancelPostVideo();
  const j = newJob({ uploadId: null, name: file.name, size: file.size, mimeType, path: file.path, preview, sent: 0, phase: "starting", error: null });
  job = j;
  emit();
  try {
    const { upload } = await api<{ upload: Upload }>("/api/posts/videos/uploads", { method: "POST", body: { fileName: file.name, mimeType, sizeBytes: file.size } });
    if (j.cancelled) {
      void api(`/api/posts/videos/uploads/${upload.uploadId}`, { method: "DELETE" }).catch(() => undefined);
      return;
    }
    fromUpload(j, upload);
    set(j, { uploadId: upload.uploadId });
    void run(j);
  } catch (error) {
    set(j, { phase: "failed", error: sentenceOf(error, "The video couldn't start uploading. Remove it and try again.") });
  }
}

/**
 * A draft's video, after a reload or a restart: the upload carries on from the
 * parts R2 has. Null when the server no longer has it (keep the words, drop the
 * video). A file that's moved or gone leaves the tile at "Pick the video again".
 */
export async function restorePostVideo(saved: SavedPostVideo): Promise<"kept" | "gone"> {
  if (job?.state.uploadId === saved.uploadId) return "kept"; // still going (Home was only left)
  if (job) cancelPostVideo();
  const j = newJob({ ...saved, sent: 0, phase: "starting", error: null });
  job = j;
  emit();
  let upload: Upload;
  try {
    upload = (await api<{ upload: Upload }>(`/api/posts/videos/uploads/${saved.uploadId}`)).upload;
  } catch (error) {
    if (error instanceof ApiError && (error.status === 404 || error.status === 403)) {
      if (job === j) { job = null; emit(); }
      return "gone";
    }
    set(j, { phase: "failed", error: STOPPED });
    return "kept";
  }
  if (j.cancelled) return "kept";
  if (upload.status === "posted") {
    if (job === j) { job = null; emit(); }
    return "gone";
  }
  fromUpload(j, upload);
  showProgress(j);
  if (upload.status === "complete") {
    set(j, { phase: "done", sent: j.state.size });
    return "kept";
  }
  const file = await ch.files.videoInfoAt(saved.path);
  if (!file || file.size !== saved.size || file.name !== saved.name) set(j, { phase: "missing" });
  else void run(j);
  return "kept";
}

/** "Pick the video again": only the same file (name and size), then the missing parts are sent. */
export function repickPostVideo(file: LocalVideoFile): string | null {
  const j = job;
  if (!j) return null;
  if (file.name !== j.state.name || file.size !== j.state.size) return `Pick the same video: ${j.state.name}.`;
  set(j, { path: file.path });
  void run(j);
  return null;
}

/** Try again after the upload stopped: only the parts R2 doesn't have go out. */
export function retryPostVideo() {
  if (job && job.state.phase === "failed" && job.state.uploadId) void run(job);
}

/** The × on the tile: stops the parts and frees what R2 holds. */
export function cancelPostVideo() {
  const j = job;
  if (!j) return;
  j.cancelled = true;
  for (const id of j.inFlight.keys()) ch.files.cancelPut(id);
  if (j.state.uploadId) void api(`/api/posts/videos/uploads/${j.state.uploadId}`, { method: "DELETE" }).catch(() => undefined);
  job = null;
  emit();
}

/** Posted: the upload now belongs to the post, so it's let go without being deleted. */
export function releasePostVideo() {
  job = null;
  emit();
}

/* ---------- The draft ----------
   Words, group and video, kept on this Mac per member, so closing the app (or
   reloading the window) in the middle of an upload loses neither. */

export interface PostDraft { text: string; category: string; video: SavedPostVideo | null }

const draftKey = (userId: string) => `ch:post-draft:${userId}`;

export function loadPostDraft(userId: string): PostDraft | null {
  try {
    const raw = localStorage.getItem(draftKey(userId));
    return raw ? (JSON.parse(raw) as PostDraft) : null;
  } catch {
    return null;
  }
}

export function savePostDraft(userId: string, draft: PostDraft) {
  try {
    if (!draft.text.trim() && !draft.video) localStorage.removeItem(draftKey(userId));
    else localStorage.setItem(draftKey(userId), JSON.stringify(draft));
  } catch { /* storage full or off: the draft just isn't kept */ }
}

export function clearPostDraft(userId: string) {
  try { localStorage.removeItem(draftKey(userId)); } catch { /* nothing kept */ }
}
